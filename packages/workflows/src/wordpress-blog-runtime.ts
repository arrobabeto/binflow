import { createHash, randomBytes, randomInt } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { ArtifactStore } from '@binflow/artifacts';
import {
  createBlogWordpressInputSchema,
  workflowResumeSignalSchema,
  wordpressRestManifestSchema,
  type CreateBlogWordpressInput,
  type SupportedLocale,
  type WordpressRestManifest,
  type WorkflowResumeSignal,
} from '@binflow/contracts';
import {
  schema,
  withSystemTenantScope,
  type Database,
  type ScopedDatabase,
} from '@binflow/db';
import { DomainError, type Clock, systemClock } from '@binflow/domain';
import { loadCustomizationSection } from '@binflow/tools';
import {
  wordpressPostContentHash,
  type WordpressBlogPublicationPort,
  type WordpressPostSnapshot,
} from '@binflow/wordpress';

import { WORDPRESS_BLOG_CAPABILITY_ID } from './wordpress-blog-collection.js';
import { composeAsIsHtml } from './wordpress-blog-content.js';

const APPROVAL_TTL_MS = 72 * 60 * 60 * 1_000;
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

const digest = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

export const generateWordpressPreviewPassword = (): string =>
  Array.from({ length: 12 }, () =>
    PASSWORD_ALPHABET.charAt(randomInt(PASSWORD_ALPHABET.length)),
  ).join('');

/**
 * Model output is limited Markdown (paragraphs, `##`/`###`, lists, `**bold**`);
 * the runtime renders it with `composeAsIsHtml`, which escapes all HTML.
 */
export type WordpressGeneratedArticle = Readonly<{
  bodyMarkdown: string;
  excerpt: string;
  imageAlt: string;
  imagePrompt: string;
  title: string;
}>;

/** OpenAI-backed in the worker; text-only, no tools (ADR-0042). */
export type WordpressBlogGenerationPort = Readonly<{
  applyRevision(
    input: Readonly<{
      blogMode: 'as_is' | 'generate';
      customizationSection?: string;
      excerpt: string;
      feedback: string;
      html: string;
      locale: SupportedLocale;
      title: string;
    }>,
  ): Promise<Readonly<{ bodyMarkdown: string; excerpt: string; title: string }>>;
  generateArticle(
    input: Readonly<{
      baseInformation: string;
      categoryName: string;
      customizationSection?: string;
      locale: SupportedLocale;
      title?: string;
    }>,
  ): Promise<WordpressGeneratedArticle>;
  generateImage(
    input: Readonly<{ customizationSection?: string; prompt: string }>,
  ): Promise<Uint8Array>;
}>;

export type WordpressPreviewActions = Readonly<{
  approve: string;
  cancel: string;
  revise: string;
}>;

export type WordpressPreviewResult = Readonly<{
  actions: WordpressPreviewActions;
  link: string;
  password: string;
  title: string;
}>;

export type WordpressPublishResult =
  | Readonly<{ kind: 'published'; link: string; title: string }>
  | Readonly<{ kind: 'reopened'; preview: WordpressPreviewResult }>;

type WordpressTerminal = Readonly<{
  categoryName?: string;
  contentHash?: string;
  featuredMedia?: number;
  link?: string;
  modifiedGmt?: string;
  password?: string;
  postId?: number;
  title?: string;
  trashed?: boolean;
  unlocked?: boolean;
}>;

type ExecuteInput = Extract<CreateBlogWordpressInput, { mode: 'execute' }>;

const stageRequestState = (node: string): string => {
  switch (node) {
    case 'awaiting_client_approval':
      return 'AWAITING_CLIENT_APPROVAL';
    case 'unlock_post':
    case 'create_category':
      return 'APPLYING_CHANGE';
    case 'verify_production':
      return 'VERIFYING_PRODUCTION';
    case 'completed':
      return 'COMPLETED';
    case 'trash_post':
      return 'CANCELLED';
    case 'failed':
      return 'FAILED_FINAL';
    default:
      return 'GENERATING';
  }
};

const terminalOf = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const wordpressTerminal = (value: unknown): WordpressTerminal =>
  terminalOf(terminalOf(value).wordpress);

const parseExecute = (value: unknown): ExecuteInput => {
  const parsed = createBlogWordpressInputSchema.parse(value);
  if (parsed.mode !== 'execute')
    throw new DomainError(
      'validation_error',
      'WordPress blog execute input is required.',
    );
  return parsed;
};

export class WordpressBlogWorkflowRuntime {
  public constructor(
    private readonly database: Database,
    private readonly artifacts: ArtifactStore,
    private readonly port: WordpressBlogPublicationPort,
    private readonly generation: WordpressBlogGenerationPort,
    private readonly clock: Clock = systemClock,
  ) {}

  public async execute(raw: WorkflowResumeSignal): Promise<WordpressPreviewResult> {
    const signal = workflowResumeSignalSchema.parse(raw);
    const context = await this.claim(signal, ['QUEUED', 'FAILED_RETRYABLE', 'GENERATING'], 'catalog_sync');
    const input = parseExecute(context.version.interpretedInput);
    // Stale-execution recovery always resumes with `execute`.
    if (input.revisionNotes.length > 0) return this.revise(signal, context, input);
    const stage = (node: string) => this.stage(signal, context.graphId, node);
    try {
      await stage('catalog_sync');
      const categories = await this.port.listCategories();
      let category = input.category;
      if (category.kind === 'existing') {
        const pickedId = category.id;
        if (!categories.some((candidate) => candidate.id === pickedId))
          throw new DomainError(
            'validation_error',
            'The chosen WordPress category no longer exists.',
            { code: 'wordpress_category_missing' },
          );
      } else {
        const wanted = category.name.trim().toLowerCase();
        const match = categories.find(
          (candidate) => candidate.name.trim().toLowerCase() === wanted,
        );
        if (match !== undefined)
          category = { id: match.id, kind: 'existing', name: match.name };
      }

      const locale = context.manifest.defaultContentLocale;
      let title: string;
      let excerpt: string;
      let html: string;
      let imageAlt: string;
      let imagePrompt: string;
      if (input.blogMode === 'as_is') {
        await stage('compose_article');
        if (input.title === undefined)
          throw new DomainError(
            'validation_error',
            'As-is articles require a title from the client.',
          );
        title = input.title;
        excerpt = input.excerpt ?? '';
        html = composeAsIsHtml(input.content);
        imageAlt = title;
        imagePrompt = `Editorial cover photograph for a blog article titled "${title}". ${excerpt}`.trim();
      } else {
        await stage('generate');
        const generated = await this.generation.generateArticle({
          baseInformation: input.content,
          categoryName: category.name,
          ...(await this.customization(context.request, 'generate')),
          locale,
          ...(input.title === undefined ? {} : { title: input.title }),
        });
        title = input.title ?? generated.title;
        excerpt = input.excerpt ?? generated.excerpt;
        html = composeAsIsHtml(generated.bodyMarkdown);
        imageAlt = generated.imageAlt;
        imagePrompt = generated.imagePrompt;
      }

      const featuredMedia = await this.resolveFeaturedMedia({
        image: input.image,
        imageAlt,
        imagePrompt,
        mediaKey: `binflow-${context.request.id}`,
        projectId: context.request.projectId,
        stage,
        tenantId: context.request.tenantId,
      });

      await stage('upsert_protected_post');
      const previous = wordpressTerminal(context.request.terminalResult);
      const password = previous.password ?? generateWordpressPreviewPassword();
      const draft = {
        categories: category.kind === 'existing' ? [category.id] : [],
        content: html,
        excerpt,
        featuredMedia,
        password,
        title,
      };
      const existingId =
        previous.postId ?? (await this.port.findAdoptablePost(title))?.id;
      const snapshot =
        existingId === undefined
          ? await this.port.createProtectedPost(draft)
          : await this.port.updateProtectedPost(existingId, draft);
      await this.checkpointTerminal(signal, {
        ...previous,
        featuredMedia,
        link: snapshot.link,
        password,
        postId: snapshot.id,
        title,
      });

      await stage('verify_protected_preview');
      await this.verifyProtected(snapshot);

      return await this.persistPreview(signal, {
        categoryKind: category.kind,
        categoryName: category.name,
        graphId: context.graphId,
        password,
        requestId: context.request.id,
        snapshot,
        title,
        versionId: context.version.id,
      });
    } catch (error) {
      await this.recordFailure(signal, context.graphId, error);
      throw error;
    }
  }

  public async applyRevision(raw: WorkflowResumeSignal): Promise<WordpressPreviewResult> {
    const signal = workflowResumeSignalSchema.parse(raw);
    const context = await this.claim(signal, ['QUEUED', 'FAILED_RETRYABLE', 'GENERATING'], 'apply_revision');
    return this.revise(signal, context, parseExecute(context.version.interpretedInput));
  }

  private async revise(
    signal: WorkflowResumeSignal,
    context: Awaited<ReturnType<WordpressBlogWorkflowRuntime['claim']>>,
    input: ExecuteInput,
  ): Promise<WordpressPreviewResult> {
    const previous = wordpressTerminal(context.request.terminalResult);
    const stage = (node: string) => this.stage(signal, context.graphId, node);
    try {
      if (previous.postId === undefined || previous.password === undefined)
        throw new DomainError(
          'conflict_error',
          'The protected preview post is missing; start a new request.',
        );
      const feedback = input.revisionNotes.at(-1);
      if (feedback === undefined)
        throw new DomainError('validation_error', 'Revision feedback is missing.');
      const current = await this.port.getPost(previous.postId);
      await stage('apply_revision');
      const revised = await this.generation.applyRevision({
        blogMode: input.blogMode,
        ...(await this.customization(context.request, 'apply_revision')),
        excerpt: current.excerpt,
        feedback,
        html: current.content,
        locale: context.manifest.defaultContentLocale,
        title: current.title,
      });
      await stage('upsert_protected_post');
      const snapshot = await this.port.updateProtectedPost(previous.postId, {
        categories: current.categories,
        content: composeAsIsHtml(revised.bodyMarkdown),
        excerpt: revised.excerpt,
        featuredMedia: current.featuredMedia,
        password: previous.password,
        title: revised.title,
      });
      await stage('verify_protected_preview');
      await this.verifyProtected(snapshot);
      const terminal = terminalOf(context.request.terminalResult);
      return await this.persistPreview(signal, {
        categoryKind:
          terminal.categoryKind === 'existing' ? 'existing' : input.category.kind,
        categoryName: previous.categoryName ?? input.category.name,
        graphId: context.graphId,
        password: previous.password,
        requestId: context.request.id,
        snapshot,
        title: revised.title,
        versionId: context.version.id,
      });
    } catch (error) {
      await this.recordFailure(signal, context.graphId, error);
      throw error;
    }
  }

  public async publish(raw: WorkflowResumeSignal): Promise<WordpressPublishResult> {
    const signal = workflowResumeSignalSchema.parse(raw);
    const context = await this.claim(
      signal,
      ['APPROVED_FOR_PUBLISH', 'FAILED_RETRYABLE', 'APPLYING_CHANGE'],
      'unlock_post',
      'APPLYING_CHANGE',
    );
    const input = parseExecute(context.version.interpretedInput);
    const bound = wordpressTerminal(context.request.terminalResult);
    const stage = (node: string) => this.stage(signal, context.graphId, node);
    try {
      if (
        bound.postId === undefined ||
        bound.modifiedGmt === undefined ||
        bound.contentHash === undefined
      )
        throw new DomainError(
          'conflict_error',
          'Approved WordPress binding is missing.',
          { code: 'wordpress_post_changed' },
        );
      const current = await this.port.getPost(bound.postId);
      if (bound.unlocked !== true) {
        if (
          current.modifiedGmt !== bound.modifiedGmt ||
          wordpressPostContentHash(current) !== bound.contentHash
        )
          return { kind: 'reopened', preview: await this.reopen(signal, context, current) };
        let categories: readonly number[] | undefined;
        if (input.category.kind === 'new' && terminalOf(context.request.terminalResult).categoryKind === 'new') {
          await stage('create_category');
          categories = [(await this.port.findOrCreateCategory(input.category.name)).id];
        }
        await stage('unlock_post');
        await this.port.unlockPost(bound.postId, categories);
        await this.checkpointTerminal(signal, { ...bound, unlocked: true });
      }
      await stage('verify_production');
      const stillProtected = await this.port.isPublicContentProtected(bound.postId);
      const pageStatus = await this.port.publicPageStatus(current.link);
      if (stillProtected || pageStatus !== 200)
        throw new DomainError(
          'provider_retryable',
          'The published post is not publicly visible yet.',
          { code: 'wordpress_publish_unverified', status: String(pageStatus) },
        );
      await withSystemTenantScope(
        this.database,
        { operation: 'create_blog_wordpress.publish.persist', tenantId: signal.tenantId },
        async (database) => {
          const [request] = await database
            .select()
            .from(schema.requests)
            .where(eq(schema.requests.id, signal.requestId))
            .limit(1);
          if (request === undefined) return;
          await database
            .update(schema.deployments)
            .set({ verifiedAt: this.clock.now() })
            .where(
              and(
                eq(schema.deployments.requestVersionId, signal.requestVersionId),
                eq(schema.deployments.environment, 'preview'),
              ),
            );
          await database
            .update(schema.requests)
            .set({
              state: 'COMPLETED',
              terminalResult: {
                approvalStatus: 'published',
                urls: { post: current.link },
                wordpress: { link: current.link, postId: bound.postId, title: current.title },
              },
              updatedAt: this.clock.now(),
              version: request.version + 1,
            })
            .where(eq(schema.requests.id, request.id));
          await this.recordStage(database, context.graphId, 'completed', {
            requestState: 'COMPLETED',
          });
        },
      );
      return { kind: 'published', link: current.link, title: current.title };
    } catch (error) {
      await this.recordFailure(signal, context.graphId, error);
      throw error;
    }
  }

  /** Cancel / admin reject: move the preview post to trash (never force). */
  public async discard(raw: WorkflowResumeSignal): Promise<Readonly<{ trashed: boolean }>> {
    const signal = workflowResumeSignalSchema.parse(raw);
    const loaded = await withSystemTenantScope(
      this.database,
      { operation: 'create_blog_wordpress.discard.load', tenantId: signal.tenantId },
      async (database) => {
        const [request] = await database
          .select()
          .from(schema.requests)
          .where(eq(schema.requests.id, signal.requestId))
          .limit(1);
        const [graph] = await database
          .select({ id: schema.graphRuns.id })
          .from(schema.graphRuns)
          .where(eq(schema.graphRuns.requestVersionId, signal.requestVersionId))
          .limit(1);
        return { graphId: graph?.id, request };
      },
    );
    if (loaded.request?.capabilityId !== WORDPRESS_BLOG_CAPABILITY_ID)
      throw new DomainError('conflict_error', 'Request is not a WordPress blog.');
    if (loaded.request.state !== 'CANCELLED')
      throw new DomainError('conflict_error', 'Only cancelled requests are discarded.');
    const terminal = wordpressTerminal(loaded.request.terminalResult);
    if (terminal.postId === undefined || terminal.trashed === true)
      return { trashed: false };
    await this.port.trashPost(terminal.postId);
    await withSystemTenantScope(
      this.database,
      { operation: 'create_blog_wordpress.discard.persist', tenantId: signal.tenantId },
      async (database) => {
        await database
          .update(schema.requests)
          .set({
            terminalResult: {
              ...terminalOf(loaded.request?.terminalResult),
              wordpress: { postId: terminal.postId, trashed: true },
            },
            updatedAt: this.clock.now(),
          })
          .where(eq(schema.requests.id, signal.requestId));
        if (loaded.graphId !== undefined)
          await this.recordStage(database, loaded.graphId, 'trash_post', {
            requestState: 'CANCELLED',
          });
      },
    );
    return { trashed: true };
  }

  private async resolveFeaturedMedia(
    input: Readonly<{
      image: ExecuteInput['image'];
      imageAlt: string;
      imagePrompt: string;
      mediaKey: string;
      projectId: string;
      stage: (node: string) => Promise<void>;
      tenantId: string;
    }>,
  ): Promise<number> {
    let bytes: Uint8Array;
    if (input.image.source === 'ai') {
      await input.stage('prepare_image');
      const section = await loadCustomizationSection(this.database, {
        capabilityId: WORDPRESS_BLOG_CAPABILITY_ID,
        nodeId: 'prepare_image',
        projectId: input.projectId,
        tenantId: input.tenantId,
      });
      bytes = await this.generation.generateImage({
        prompt: input.imagePrompt,
        ...(section === undefined ? {} : { customizationSection: section }),
      });
    } else if (input.image.source === 'telegram') {
      try {
        bytes = await this.artifacts.get(input.image.artifactKey);
      } catch {
        throw new DomainError(
          'validation_error',
          'The photo sent in Telegram is no longer available.',
          { code: 'wordpress_image_invalid' },
        );
      }
    } else {
      bytes = await this.port.downloadSiteImage(input.image.url);
    }
    await input.stage('upload_media');
    return (
      await this.port.uploadMedia({
        altText: input.imageAlt,
        bytes,
        mediaKey: input.mediaKey,
      })
    ).id;
  }

  private async verifyProtected(snapshot: WordpressPostSnapshot): Promise<void> {
    if (
      snapshot.status !== 'publish' ||
      snapshot.password.length === 0 ||
      !(await this.port.isPublicContentProtected(snapshot.id))
    )
      throw new DomainError(
        'provider_final',
        'The WordPress preview post is not password protected.',
        { code: 'wordpress_preview_not_protected' },
      );
  }

  private async customization(
    request: typeof schema.requests.$inferSelect,
    nodeId: 'apply_revision' | 'generate',
  ): Promise<Readonly<{ customizationSection?: string }>> {
    const section = await loadCustomizationSection(this.database, {
      capabilityId: WORDPRESS_BLOG_CAPABILITY_ID,
      nodeId,
      projectId: request.projectId,
      tenantId: request.tenantId,
    });
    return section === undefined ? {} : { customizationSection: section };
  }

  private async claim(
    signal: WorkflowResumeSignal,
    states: readonly string[],
    node: string,
    nextState: (typeof schema.requests.$inferSelect)['state'] = 'GENERATING',
  ): Promise<
    Readonly<{
      graphId: string;
      manifest: WordpressRestManifest;
      request: typeof schema.requests.$inferSelect;
      version: typeof schema.requestVersions.$inferSelect;
    }>
  > {
    return withSystemTenantScope(
      this.database,
      { operation: 'create_blog_wordpress.claim', tenantId: signal.tenantId },
      async (database) => {
        const [row] = await database
          .select({
            graph: schema.graphRuns,
            manifest: schema.projectManifestVersions,
            request: schema.requests,
            version: schema.requestVersions,
          })
          .from(schema.requests)
          .innerJoin(
            schema.requestVersions,
            and(
              eq(schema.requestVersions.id, signal.requestVersionId),
              eq(schema.requestVersions.requestId, schema.requests.id),
            ),
          )
          .innerJoin(
            schema.projectManifestVersions,
            eq(schema.projectManifestVersions.id, schema.requestVersions.manifestVersionId),
          )
          .innerJoin(
            schema.graphRuns,
            eq(schema.graphRuns.requestVersionId, schema.requestVersions.id),
          )
          .where(eq(schema.requests.id, signal.requestId))
          .limit(1);
        if (row === undefined)
          throw new DomainError('validation_error', 'WordPress blog workflow context is missing.');
        if (
          row.request.capabilityId !== WORDPRESS_BLOG_CAPABILITY_ID ||
          !states.includes(row.request.state) ||
          row.version.confirmedAt === null ||
          row.request.currentVersion !== row.version.version
        )
          throw new DomainError('conflict_error', 'WordPress blog request is not executable.');
        const manifest = wordpressRestManifestSchema.parse(row.manifest.document);
        await database
          .update(schema.requests)
          .set({ state: nextState, updatedAt: this.clock.now(), version: row.request.version + 1 })
          .where(eq(schema.requests.id, row.request.id));
        await database
          .update(schema.graphRuns)
          .set({ currentNode: node, startedAt: this.clock.now(), status: 'running' })
          .where(eq(schema.graphRuns.id, row.graph.id));
        return {
          graphId: row.graph.id,
          manifest,
          request: { ...row.request, state: nextState, version: row.request.version + 1 },
          version: row.version,
        };
      },
    );
  }

  private async stage(signal: WorkflowResumeSignal, graphId: string, node: string): Promise<void> {
    await withSystemTenantScope(
      this.database,
      { operation: 'create_blog_wordpress.stage', tenantId: signal.tenantId },
      async (database) => this.recordStage(database, graphId, node),
    );
  }

  private async checkpointTerminal(
    signal: WorkflowResumeSignal,
    wordpress: WordpressTerminal,
  ): Promise<void> {
    await withSystemTenantScope(
      this.database,
      { operation: 'create_blog_wordpress.checkpoint', tenantId: signal.tenantId },
      async (database) => {
        const [request] = await database
          .select({ terminalResult: schema.requests.terminalResult })
          .from(schema.requests)
          .where(eq(schema.requests.id, signal.requestId))
          .limit(1);
        await database
          .update(schema.requests)
          .set({
            terminalResult: { ...terminalOf(request?.terminalResult), wordpress },
            updatedAt: this.clock.now(),
          })
          .where(eq(schema.requests.id, signal.requestId));
      },
    );
  }

  /** wp-admin edit after approval: bind a fresh version to the observed post. */
  private async reopen(
    signal: WorkflowResumeSignal,
    context: Readonly<{
      graphId: string;
      request: typeof schema.requests.$inferSelect;
      version: typeof schema.requestVersions.$inferSelect;
    }>,
    current: WordpressPostSnapshot,
  ): Promise<WordpressPreviewResult> {
    const bound = wordpressTerminal(context.request.terminalResult);
    const nextVersionId = uuidv7();
    const nextGraphId = uuidv7();
    await withSystemTenantScope(
      this.database,
      { operation: 'create_blog_wordpress.reopen', tenantId: signal.tenantId },
      async (database) => {
        const nextVersion = context.version.version + 1;
        await database.insert(schema.requestVersions).values({
          capabilityVersion: context.version.capabilityVersion,
          confirmedAt: this.clock.now(),
          id: nextVersionId,
          interpretedInput: context.version.interpretedInput,
          manifestVersionId: context.version.manifestVersionId,
          plan: {
            ...terminalOf(context.version.plan),
            reopenedReason: 'wordpress_post_changed',
          },
          projectId: context.request.projectId,
          requestId: context.request.id,
          tenantId: context.request.tenantId,
          version: nextVersion,
        });
        await database
          .update(schema.requestVersions)
          .set({ supersededById: nextVersionId })
          .where(eq(schema.requestVersions.id, context.version.id));
        await database
          .update(schema.requests)
          .set({ currentVersion: nextVersion })
          .where(eq(schema.requests.id, context.request.id));
        await database.insert(schema.graphRuns).values({
          checkpointSequence: 1,
          currentNode: 'verify_protected_preview',
          graphVersion: 'stacks/wordpress-rest/create-blog@1',
          id: nextGraphId,
          projectId: context.request.projectId,
          requestId: context.request.id,
          requestVersionId: nextVersionId,
          status: 'running',
          tenantId: context.request.tenantId,
        });
        await database.insert(schema.workflowCheckpoints).values({
          graphRunId: nextGraphId,
          id: uuidv7(),
          node: 'verify_protected_preview',
          projectId: context.request.projectId,
          sequence: 1,
          state: { reopenedReason: 'wordpress_post_changed', requestState: 'GENERATING' },
          tenantId: context.request.tenantId,
        });
      },
    );
    const reopened = { ...signal, requestVersionId: nextVersionId };
    await this.verifyProtected(current);
    return this.persistPreview(reopened, {
      categoryKind:
        terminalOf(context.request.terminalResult).categoryKind === 'new' ? 'new' : 'existing',
      categoryName: bound.categoryName ?? '',
      graphId: nextGraphId,
      password: bound.password ?? current.password,
      requestId: context.request.id,
      snapshot: current,
      title: current.title,
      versionId: nextVersionId,
    });
  }

  private async persistPreview(
    signal: WorkflowResumeSignal,
    input: Readonly<{
      categoryKind: 'existing' | 'new';
      categoryName: string;
      graphId: string;
      password: string;
      requestId: string;
      snapshot: WordpressPostSnapshot;
      title: string;
      versionId: string;
    }>,
  ): Promise<WordpressPreviewResult> {
    const actions: WordpressPreviewActions = Object.freeze({
      approve: randomBytes(24).toString('base64url'),
      cancel: randomBytes(24).toString('base64url'),
      revise: randomBytes(24).toString('base64url'),
    });
    const contentHash = wordpressPostContentHash(input.snapshot);
    const route = `wp/v2/posts/${String(input.snapshot.id)}`;
    const headSha = `wp:${String(input.snapshot.id)}:${input.snapshot.modifiedGmt}:${contentHash.slice(0, 16)}`;
    await withSystemTenantScope(
      this.database,
      { operation: 'create_blog_wordpress.preview.persist', tenantId: signal.tenantId },
      async (database) => {
        const [request] = await database
          .select()
          .from(schema.requests)
          .where(eq(schema.requests.id, input.requestId))
          .limit(1);
        if (request === undefined)
          throw new DomainError('internal_error', 'Request disappeared during preview.');
        if (request.state === 'CANCELLED')
          throw new DomainError('conflict_error', 'Request was cancelled during preview.', {
            code: 'wordpress_request_cancelled',
          });
        const now = this.clock.now();
        const snapshotBytes = new TextEncoder().encode(
          JSON.stringify({ ...input.snapshot, password: undefined }),
        );
        const snapshotDigest = createHash('sha256').update(snapshotBytes).digest('hex');
        const storageKey = `${request.tenantId}/${request.projectId}/${request.id}/${input.versionId}/wordpress_post_snapshot.json`;
        await this.artifacts.put({
          bytes: snapshotBytes,
          key: storageKey,
          mime: 'application/json',
          sha256: snapshotDigest,
        });
        await database.insert(schema.artifacts).values({
          bytes: snapshotBytes.byteLength,
          id: uuidv7(),
          kind: 'wordpress_post_snapshot',
          mime: 'application/json',
          projectId: request.projectId,
          requestId: request.id,
          requestVersionId: input.versionId,
          sha256: snapshotDigest,
          storageKey,
          tenantId: request.tenantId,
        });
        await database.insert(schema.repoChanges).values({
          artifactHashes: { [route]: contentHash },
          baseSha: 'wordpress',
          branch: `wp-post:${String(input.snapshot.id)}`,
          files: [route],
          headSha,
          id: uuidv7(),
          projectId: request.projectId,
          requestId: request.id,
          requestVersionId: input.versionId,
          tenantId: request.tenantId,
        });
        await database.insert(schema.deployments).values({
          commitSha: headSha,
          environment: 'preview',
          id: uuidv7(),
          projectId: request.projectId,
          providerId: `wp-post:${String(input.snapshot.id)}:${input.versionId}`,
          readyAt: now,
          requestVersionId: input.versionId,
          state: 'ready',
          tenantId: request.tenantId,
          urls: { post: input.snapshot.link },
        });
        for (const [action, token] of [
          ['approve_preview', actions.approve],
          ['request_revision', actions.revise],
          ['cancel', actions.cancel],
        ] as const)
          await database.insert(schema.requestActions).values({
            action,
            expiresAt: new Date(now.getTime() + APPROVAL_TTL_MS),
            id: uuidv7(),
            projectId: request.projectId,
            requestId: request.id,
            requestVersionId: input.versionId,
            tenantId: request.tenantId,
            tokenHash: digest(token),
            userId: request.userId,
          });
        await database
          .update(schema.requests)
          .set({
            state: 'AWAITING_CLIENT_APPROVAL',
            terminalResult: {
              approvalStatus: 'awaiting_client',
              categoryKind: input.categoryKind,
              previewUrls: { post: input.snapshot.link },
              wordpress: {
                categoryName: input.categoryName,
                contentHash,
                featuredMedia: input.snapshot.featuredMedia,
                link: input.snapshot.link,
                modifiedGmt: input.snapshot.modifiedGmt,
                password: input.password,
                postId: input.snapshot.id,
                title: input.title,
              } satisfies WordpressTerminal,
            },
            updatedAt: now,
            version: request.version + 1,
          })
          .where(eq(schema.requests.id, request.id));
        await this.recordStage(database, input.graphId, 'awaiting_client_approval', {
          deploymentId: `wp-post:${String(input.snapshot.id)}:${input.versionId}`,
          headSha,
          requestState: 'AWAITING_CLIENT_APPROVAL',
        });
      },
    );
    return {
      actions,
      link: input.snapshot.link,
      password: input.password,
      title: input.title,
    };
  }

  private async recordStage(
    database: ScopedDatabase,
    graphRunId: string,
    node: string,
    extraState: Record<string, unknown> = {},
  ): Promise<void> {
    const [run] = await database
      .select()
      .from(schema.graphRuns)
      .where(eq(schema.graphRuns.id, graphRunId))
      .limit(1);
    if (run === undefined)
      throw new DomainError('internal_error', 'Graph run is missing.');
    const sequence = run.checkpointSequence + 1;
    await database.insert(schema.workflowCheckpoints).values({
      graphRunId,
      id: uuidv7(),
      node,
      projectId: run.projectId,
      sequence,
      state: { requestState: stageRequestState(node), ...extraState },
      tenantId: run.tenantId,
    });
    await database
      .update(schema.graphRuns)
      .set({
        checkpointSequence: sequence,
        currentNode: node,
        status:
          node === 'completed'
            ? 'completed'
            : node === 'trash_post'
              ? 'cancelled'
              : 'running',
        updatedAt: this.clock.now(),
      })
      .where(eq(schema.graphRuns.id, graphRunId));
  }

  /**
   * A final failure must not leave a protected preview behind; once unlocked
   * the post is public and is left alone.
   */
  private async recordFailure(
    signal: WorkflowResumeSignal,
    graphRunId: string,
    error: unknown,
  ): Promise<void> {
    const final = !(
      error instanceof DomainError && error.category === 'provider_retryable'
    );
    if (final) {
      const [request] = await withSystemTenantScope(
        this.database,
        { operation: 'create_blog_wordpress.fail.load', tenantId: signal.tenantId },
        async (database) =>
          database
            .select({ terminalResult: schema.requests.terminalResult })
            .from(schema.requests)
            .where(eq(schema.requests.id, signal.requestId))
            .limit(1),
      );
      const terminal = wordpressTerminal(request?.terminalResult);
      if (
        terminal.postId !== undefined &&
        terminal.unlocked !== true &&
        terminal.trashed !== true
      ) {
        try {
          await this.port.trashPost(terminal.postId);
          const { password, ...withoutPassword } = terminal;
          void password;
          await this.checkpointTerminal(signal, { ...withoutPassword, trashed: true });
        } catch {
          // Best effort; the operator sees the post id in the failure record.
        }
      }
    }
    await withSystemTenantScope(
      this.database,
      { operation: 'create_blog_wordpress.fail', tenantId: signal.tenantId },
      async (database) => {
        const retryable =
          error instanceof DomainError && error.category === 'provider_retryable';
        const [request] = await database
          .select()
          .from(schema.requests)
          .where(eq(schema.requests.id, signal.requestId))
          .limit(1);
        if (request === undefined || request.state === 'CANCELLED') return;
        await this.recordStage(database, graphRunId, 'failed');
        await database
          .update(schema.requests)
          .set({
            state: retryable ? 'FAILED_RETRYABLE' : 'FAILED_FINAL',
            terminalResult: {
              ...terminalOf(request.terminalResult),
              errorCategory: error instanceof DomainError ? error.category : 'internal_error',
              errorMessage:
                error instanceof Error ? error.message : 'WordPress blog failed without an error message.',
              failureCode:
                error instanceof DomainError ? (error.metadata.code ?? '') : undefined,
            },
            updatedAt: this.clock.now(),
            version: request.version + 1,
          })
          .where(eq(schema.requests.id, request.id));
      },
    );
  }
}
