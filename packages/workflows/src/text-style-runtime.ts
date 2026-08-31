import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { ArtifactStore } from '@binflow/artifacts';
import {
  editTextStyleInputSchema,
  workflowResumeSignalSchema,
  type WorkflowResumeSignal,
} from '@binflow/contracts';
import {
  resolveTextEditCandidate,
  restoreOrbitypeTextPreview,
  type EditTextStyleExecutor,
  type OrbitypeTextPagesPort,
  type TextStylePatchArtifact,
} from '@binflow/text';
import {
  schema,
  withSystemTenantScope,
  type Database,
  type ScopedDatabase,
} from '@binflow/db';
import { DomainError, type Clock, systemClock } from '@binflow/domain';

import { resolveEditTextStyleProductionOrigin } from './edit-text-style-ingress.js';

const digest = (value: string): string =>
  createHash('sha256').update(value).digest('hex');
const APPROVAL_TTL_MS = 72 * 60 * 60 * 1_000;

/** Prefer version-scoped style patch; fall back to latest request patch. */
export const selectTextStyleRestoreRow = <T>(
  byVersion: T | undefined,
  byRequestFallback: T | undefined,
): T | undefined => byVersion ?? byRequestFallback;

export type TextStylePreviewActions = Readonly<{
  approve: string;
  cancel: string;
}>;

const stageRequestState = (node: string): string => {
  switch (node) {
    case 'sync_editable_copy':
    case 'validate_text_style':
    case 'render_style_patch':
    case 'open_style_edit_pr':
    case 'apply_orbitype_preview':
      return 'GENERATING';
    case 'wait_preview':
      return 'PREVIEW_DEPLOYING';
    case 'awaiting_client_approval':
      return 'AWAITING_CLIENT_APPROVAL';
    case 'awaiting_admin_approval':
      return 'AWAITING_ADMIN_APPROVAL';
    case 'merge_github':
    case 'publish_orbitype_pages':
      return 'APPLYING_CHANGE';
    case 'verify_production':
      return 'VERIFYING_PRODUCTION';
    case 'completed':
      return 'COMPLETED';
    case 'failed':
      return 'FAILED_FINAL';
    default:
      return 'GENERATING';
  }
};

export class TextStyleWorkflowRuntime {
  public constructor(
    private readonly database: Database,
    private readonly artifacts: ArtifactStore,
    private readonly executor: EditTextStyleExecutor,
    private readonly orbitype: OrbitypeTextPagesPort,
    private readonly clock: Clock = systemClock,
  ) {}

  public async execute(raw: WorkflowResumeSignal): Promise<
    Readonly<{
      actions: TextStylePreviewActions;
      result: Readonly<{
        deployment: Awaited<
          ReturnType<EditTextStyleExecutor['preparePreview']>
        >['deployment'];
        patch: TextStylePatchArtifact;
        publication: Awaited<
          ReturnType<EditTextStyleExecutor['preparePreview']>
        >['publication'];
      }>;
    }>
  > {
    const signal = workflowResumeSignalSchema.parse(raw);
    const context = await withSystemTenantScope(
      this.database,
      { operation: 'edit_text_style.execute.load', tenantId: signal.tenantId },
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
            eq(
              schema.projectManifestVersions.id,
              schema.requestVersions.manifestVersionId,
            ),
          )
          .innerJoin(
            schema.graphRuns,
            eq(schema.graphRuns.requestVersionId, schema.requestVersions.id),
          )
          .where(eq(schema.requests.id, signal.requestId))
          .limit(1);
        if (row === undefined)
          throw new DomainError(
            'validation_error',
            'Edit text style workflow context is missing.',
          );
        if (
          !['QUEUED', 'FAILED_RETRYABLE', 'GENERATING'].includes(
            row.request.state,
          ) ||
          row.version.confirmedAt === null
        )
          throw new DomainError(
            'conflict_error',
            'Edit text style request is not executable.',
          );
        await database
          .update(schema.requests)
          .set({
            state: 'GENERATING',
            updatedAt: this.clock.now(),
            version: row.request.version + 1,
          })
          .where(eq(schema.requests.id, row.request.id));
        await database
          .update(schema.graphRuns)
          .set({
            currentNode: 'sync_editable_copy',
            startedAt: this.clock.now(),
            status: 'running',
          })
          .where(eq(schema.graphRuns.id, row.graph.id));
        return row;
      },
    );
    const parsed = editTextStyleInputSchema.parse(
      context.version.interpretedInput,
    );
    if (parsed.mode !== 'execute')
      throw new DomainError(
        'validation_error',
        'Edit text style execute input is required.',
      );
    const pages = await this.orbitype.listPages();
    const candidate = resolveTextEditCandidate(
      pages,
      context.manifest.document.contentLocales,
      parsed.targetKey,
    );
    if (candidate === null)
      throw new DomainError(
        'validation_error',
        'Text style target is no longer available.',
        { code: 'text_target_not_found' },
      );
    const actions = Object.freeze({
      approve: randomBytes(24).toString('base64url'),
      cancel: randomBytes(24).toString('base64url'),
    });
    const recordStage = async (node: string): Promise<void> => {
      await withSystemTenantScope(
        this.database,
        { operation: 'edit_text_style.execute.stage', tenantId: signal.tenantId },
        async (database) => this.recordStage(database, context.graph.id, node),
      );
    };
    let preview: Awaited<
      ReturnType<EditTextStyleExecutor['preparePreview']>
    >;
    try {
      preview = await this.executor.preparePreview({
        candidate,
        defaultBranchRef:
          context.manifest.document.repository.productionBranch,
        manifest: context.manifest.document,
        onStage: recordStage,
        orbitype: this.orbitype,
        productionOrigin: resolveEditTextStyleProductionOrigin(
          context.manifest.document,
        ),
        requestId: context.request.id,
        style: parsed.style,
        targetExcerpt: parsed.targetExcerpt,
      });
    } catch (error) {
      await this.recordFailure(signal, context.graph.id, error);
      throw error;
    }
    await withSystemTenantScope(
      this.database,
      { operation: 'edit_text_style.execute.persist', tenantId: signal.tenantId },
      async (database) => {
        const now = this.clock.now();
        const prefix = `${context.request.tenantId}/${context.request.projectId}/${context.request.id}/${context.version.id}`;
        const bytes = new TextEncoder().encode(JSON.stringify(preview.patch));
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const key = `${prefix}/text_style_patch.json`;
        await this.artifacts.put({
          bytes,
          key,
          mime: 'application/json',
          sha256,
        });
        await database.insert(schema.artifacts).values({
          bytes: bytes.byteLength,
          id: uuidv7(),
          kind: 'text_style_patch',
          mime: 'application/json',
          projectId: context.request.projectId,
          requestId: context.request.id,
          requestVersionId: context.version.id,
          sha256,
          storageKey: key,
          tenantId: context.request.tenantId,
        });
        const repoChangeId = uuidv7();
        await database.insert(schema.repoChanges).values({
          artifactHashes: Object.fromEntries(
            preview.publication.files.map((path) => [path, sha256]),
          ),
          baseSha: preview.publication.baseCommitSha,
          branch: preview.publication.branch,
          files: [...preview.publication.files],
          headSha: preview.publication.headCommitSha,
          id: repoChangeId,
          projectId: context.request.projectId,
          requestId: context.request.id,
          requestVersionId: context.version.id,
          tenantId: context.request.tenantId,
        });
        await database.insert(schema.pullRequests).values({
          baseSha: preview.publication.baseCommitSha,
          headSha: preview.publication.headCommitSha,
          id: uuidv7(),
          projectId: context.request.projectId,
          providerId: preview.publication.pullRequestId,
          repoChangeId,
          requestVersionId: context.version.id,
          state: 'open',
          tenantId: context.request.tenantId,
          url: preview.publication.pullRequestUrl,
        });
        await database.insert(schema.deployments).values({
          commitSha: preview.deployment.sha,
          environment: preview.deployment.environment,
          id: uuidv7(),
          projectId: context.request.projectId,
          providerId: preview.deployment.deploymentId,
          readyAt: new Date(preview.deployment.readyAt),
          requestVersionId: context.version.id,
          state: 'ready',
          tenantId: context.request.tenantId,
          urls: preview.deployment.urls,
        });
        for (const [action, token] of [
          ['approve_preview', actions.approve],
          ['cancel', actions.cancel],
        ] as const)
          await database.insert(schema.requestActions).values({
            action,
            expiresAt: new Date(now.getTime() + APPROVAL_TTL_MS),
            id: uuidv7(),
            projectId: context.request.projectId,
            requestId: context.request.id,
            requestVersionId: context.version.id,
            tenantId: context.request.tenantId,
            tokenHash: digest(token),
            userId: context.request.userId,
          });
        await database
          .update(schema.requests)
          .set({
            state: 'AWAITING_CLIENT_APPROVAL',
            terminalResult: {
              approvalStatus: 'awaiting_client',
              branch: preview.publication.branch,
              files: preview.publication.files,
              headCommitSha: preview.publication.headCommitSha,
              patchDigest: sha256,
              previewDeploymentId: preview.deployment.deploymentId,
              previewRoute: preview.patch.previewRoute,
              previewUrls: preview.deployment.urls,
              pullRequestUrl: preview.publication.pullRequestUrl,
              targetKey: parsed.targetKey,
            },
            updatedAt: now,
            version: context.request.version + 2,
          })
          .where(eq(schema.requests.id, context.request.id));
        await this.recordStage(
          database,
          context.graph.id,
          'awaiting_client_approval',
          {
            deploymentId: preview.deployment.deploymentId,
            headSha: preview.publication.headCommitSha,
            requestState: 'AWAITING_CLIENT_APPROVAL',
          },
        );
      },
    );
    return { actions, result: preview };
  }

  public async restorePreview(raw: WorkflowResumeSignal): Promise<void> {
    const signal = workflowResumeSignalSchema.parse(raw);
    const context = await withSystemTenantScope(
      this.database,
      {
        operation: 'edit_text_style.restore_preview.load',
        tenantId: signal.tenantId,
      },
      async (database) => {
        const [byVersion] = await database
          .select({ artifact: schema.artifacts, request: schema.requests })
          .from(schema.requests)
          .innerJoin(
            schema.artifacts,
            and(
              eq(schema.artifacts.requestVersionId, signal.requestVersionId),
              eq(schema.artifacts.kind, 'text_style_patch'),
            ),
          )
          .where(eq(schema.requests.id, signal.requestId))
          .limit(1);
        if (byVersion !== undefined)
          return selectTextStyleRestoreRow(byVersion, undefined);
        // Fallback: latest style patch for this request (cancel may race versions).
        const [byRequest] = await database
          .select({ artifact: schema.artifacts, request: schema.requests })
          .from(schema.requests)
          .innerJoin(
            schema.artifacts,
            and(
              eq(schema.artifacts.requestId, signal.requestId),
              eq(schema.artifacts.kind, 'text_style_patch'),
            ),
          )
          .where(eq(schema.requests.id, signal.requestId))
          .orderBy(desc(schema.artifacts.createdAt))
          .limit(1);
        return selectTextStyleRestoreRow(undefined, byRequest);
      },
    );
    if (context === undefined) {
      const [request] = await withSystemTenantScope(
        this.database,
        {
          operation: 'edit_text_style.restore_preview.missing_request',
          tenantId: signal.tenantId,
        },
        async (database) =>
          database
            .select()
            .from(schema.requests)
            .where(eq(schema.requests.id, signal.requestId))
            .limit(1),
      );
      if (request !== undefined)
        await this.markRestoreResult(signal, request, {
          orbitypeRestoreError: 'text_style_patch artifact not found',
          orbitypeRestoreFailed: true,
        });
      return;
    }
    let object: Uint8Array;
    try {
      object = await this.artifacts.get(context.artifact.storageKey);
    } catch (error) {
      await this.markRestoreResult(signal, context.request, {
        orbitypeRestoreError:
          error instanceof Error ? error.message : 'artifact get failed',
        orbitypeRestoreFailed: true,
      });
      return;
    }
    const patch = JSON.parse(
      new TextDecoder().decode(object),
    ) as TextStylePatchArtifact;
    const preview = patch.orbitypePreview;
    if (preview === undefined) {
      await this.markRestoreResult(signal, context.request, {
        orbitypeRestoreError: 'orbitypePreview snapshot missing on patch',
        orbitypeRestoreFailed: true,
      });
      return;
    }
    if (preview.restored === true) return;
    try {
      await restoreOrbitypeTextPreview(this.orbitype, preview.restore);
    } catch (error) {
      await this.markRestoreResult(signal, context.request, {
        orbitypeRestoreError:
          error instanceof Error ? error.message : 'restore failed',
        orbitypeRestoreFailed: true,
      });
      return;
    }
    const restored: TextStylePatchArtifact = {
      ...patch,
      orbitypePreview: { ...preview, restored: true },
    };
    const bytes = new TextEncoder().encode(JSON.stringify(restored));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await this.artifacts.put({
      bytes,
      key: context.artifact.storageKey,
      mime: 'application/json',
      sha256,
    });
    await withSystemTenantScope(
      this.database,
      {
        operation: 'edit_text_style.restore_preview.persist',
        tenantId: signal.tenantId,
      },
      async (database) => {
        await database
          .update(schema.artifacts)
          .set({ bytes: bytes.byteLength, sha256 })
          .where(eq(schema.artifacts.id, context.artifact.id));
      },
    );
    await this.markRestoreResult(signal, context.request, {
      orbitypePreviewRestored: true,
    });
  }

  public async publish(raw: WorkflowResumeSignal): Promise<
    Readonly<{
      mergeCommitSha: string;
      urls: Readonly<Record<string, string>>;
    }>
  > {
    const signal = workflowResumeSignalSchema.parse(raw);
    const context = await withSystemTenantScope(
      this.database,
      { operation: 'edit_text_style.publish.load', tenantId: signal.tenantId },
      async (database) => {
        const [row] = await database
          .select({
            artifact: schema.artifacts,
            pull: schema.pullRequests,
            repo: schema.repoChanges,
            request: schema.requests,
            version: schema.requestVersions,
          })
          .from(schema.requests)
          .innerJoin(
            schema.requestVersions,
            eq(schema.requestVersions.id, signal.requestVersionId),
          )
          .innerJoin(
            schema.repoChanges,
            eq(schema.repoChanges.requestVersionId, signal.requestVersionId),
          )
          .innerJoin(
            schema.pullRequests,
            eq(schema.pullRequests.requestVersionId, signal.requestVersionId),
          )
          .innerJoin(
            schema.artifacts,
            and(
              eq(schema.artifacts.requestVersionId, signal.requestVersionId),
              eq(schema.artifacts.kind, 'text_style_patch'),
            ),
          )
          .where(eq(schema.requests.id, signal.requestId))
          .limit(1);
        if (
          row === undefined ||
          !['APPROVED_FOR_PUBLISH', 'FAILED_RETRYABLE', 'REVALIDATING'].includes(
            row.request.state,
          )
        )
          throw new DomainError(
            'conflict_error',
            'Text style request is not approved for publication.',
          );
        const [manifest] = await database
          .select({ document: schema.projectManifestVersions.document })
          .from(schema.projectManifestVersions)
          .where(
            eq(
              schema.projectManifestVersions.id,
              row.version.manifestVersionId,
            ),
          )
          .limit(1);
        if (manifest === undefined)
          throw new DomainError(
            'validation_error',
            'Text style manifest context is missing.',
          );
        return { ...row, manifest: manifest.document };
      },
    );
    const object = await this.artifacts.get(context.artifact.storageKey);
    const patch = JSON.parse(
      new TextDecoder().decode(object),
    ) as TextStylePatchArtifact;
    const graphRunId = await withSystemTenantScope(
      this.database,
      { operation: 'edit_text_style.publish.graph', tenantId: signal.tenantId },
      async (database) => {
        const [graph] = await database
          .select()
          .from(schema.graphRuns)
          .where(
            eq(schema.graphRuns.requestVersionId, signal.requestVersionId),
          )
          .limit(1);
        if (graph === undefined)
          throw new DomainError('internal_error', 'Graph run is missing.');
        await database
          .update(schema.requests)
          .set({
            state: 'APPLYING_CHANGE',
            updatedAt: this.clock.now(),
            version: context.request.version + 1,
          })
          .where(eq(schema.requests.id, context.request.id));
        return graph.id;
      },
    );
    const recordStage = async (node: string): Promise<void> => {
      await withSystemTenantScope(
        this.database,
        { operation: 'edit_text_style.publish.stage', tenantId: signal.tenantId },
        async (database) => this.recordStage(database, graphRunId, node),
      );
    };
    let published: Awaited<ReturnType<EditTextStyleExecutor['publish']>>;
    try {
      published = await this.executor.publish({
        expectedHeadSha: context.repo.headSha,
        manifest: context.manifest,
        onStage: recordStage,
        orbitype: this.orbitype,
        patch,
        productionOrigin: resolveEditTextStyleProductionOrigin(context.manifest),
        pullRequestId: context.pull.providerId,
      });
    } catch (error) {
      await this.recordFailure(signal, graphRunId, error);
      throw error;
    }
    await withSystemTenantScope(
      this.database,
      {
        operation: 'edit_text_style.publish.persist',
        tenantId: signal.tenantId,
      },
      async (database) => {
        await database
          .update(schema.pullRequests)
          .set({ mergeCommitSha: published.mergeCommitSha, state: 'merged' })
          .where(eq(schema.pullRequests.id, context.pull.id));
        await database
          .update(schema.requests)
          .set({
            state: 'COMPLETED',
            terminalResult: {
              approvalStatus: 'published',
              mergeCommitSha: published.mergeCommitSha,
              previewRoute: patch.previewRoute,
              urls: published.urls,
            },
            updatedAt: this.clock.now(),
            version: context.request.version + 2,
          })
          .where(eq(schema.requests.id, context.request.id));
      },
    );
    return {
      mergeCommitSha: published.mergeCommitSha,
      urls: published.urls,
    };
  }

  private async markRestoreResult(
    signal: WorkflowResumeSignal,
    request: typeof schema.requests.$inferSelect,
    result: Record<string, unknown>,
  ): Promise<void> {
    await withSystemTenantScope(
      this.database,
      {
        operation: 'edit_text_style.restore_preview.result',
        tenantId: signal.tenantId,
      },
      async (database) => {
        const terminal =
          request.terminalResult !== null &&
          typeof request.terminalResult === 'object' &&
          !Array.isArray(request.terminalResult)
            ? (request.terminalResult as Record<string, unknown>)
            : {};
        await database
          .update(schema.requests)
          .set({
            terminalResult: { ...terminal, ...result },
            updatedAt: this.clock.now(),
            version: request.version + 1,
          })
          .where(eq(schema.requests.id, request.id));
      },
    );
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
        status: node === 'completed' ? 'completed' : 'running',
        updatedAt: this.clock.now(),
      })
      .where(eq(schema.graphRuns.id, graphRunId));
  }

  private async recordFailure(
    signal: WorkflowResumeSignal,
    graphRunId: string,
    error: unknown,
  ): Promise<void> {
    await withSystemTenantScope(
      this.database,
      { operation: 'edit_text_style.fail', tenantId: signal.tenantId },
      async (database) => {
        const retryable =
          error instanceof DomainError &&
          error.category === 'provider_retryable';
        const [request] = await database
          .select()
          .from(schema.requests)
          .where(eq(schema.requests.id, signal.requestId))
          .limit(1);
        if (request === undefined) return;
        await this.recordStage(database, graphRunId, 'failed');
        await database
          .update(schema.requests)
          .set({
            state: retryable ? 'FAILED_RETRYABLE' : 'FAILED_FINAL',
            terminalResult: {
              errorCategory:
                error instanceof DomainError ? error.category : 'internal_error',
              errorMessage:
                error instanceof Error
                  ? error.message
                  : 'Text style change failed without an error message.',
              failureCode:
                error instanceof DomainError
                  ? (error.metadata.code ?? '')
                  : undefined,
            },
            updatedAt: this.clock.now(),
            version: request.version + 1,
          })
          .where(eq(schema.requests.id, request.id));
      },
    );
  }
}
