import { createHash, randomBytes } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { ArtifactStore } from '@binflow/artifacts';
import type { BlogExecutor, BlogExecutionResult } from '@binflow/blog';
import {
  workflowResumeSignalSchema,
  type WorkflowResumeSignal,
} from '@binflow/contracts';
import {
  schema,
  withSystemTenantScope,
  type Database,
  type ScopedDatabase,
} from '@binflow/db';
import { DomainError, type Clock, systemClock } from '@binflow/domain';
import { decideBlogPublicationPolicy } from '@binflow/policies';

const digest = (value: string): string =>
  createHash('sha256').update(value).digest('hex');
const newActionToken = (): string => randomBytes(32).toString('base64url');
const APPROVAL_TTL_MS = 24 * 60 * 60 * 1_000;

export type PreviewActions = Readonly<{
  approve: string;
  cancel: string;
  revise: string;
}>;

export class BlogWorkflowRuntime {
  public constructor(
    private readonly database: Database,
    private readonly artifacts: ArtifactStore,
    private readonly executor: BlogExecutor,
    private readonly clock: Clock = systemClock,
  ) {}

  public async execute(raw: WorkflowResumeSignal): Promise<
    Readonly<{
      actions: PreviewActions;
      result: BlogExecutionResult;
    }>
  > {
    const signal = workflowResumeSignalSchema.parse(raw);
    const context = await withSystemTenantScope(
      this.database,
      { operation: 'blog.execute.load', tenantId: signal.tenantId },
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
            'Blog workflow context is missing.',
          );
        if (
          !['QUEUED', 'FAILED_RETRYABLE'].includes(row.request.state) ||
          row.version.confirmedAt === null
        )
          throw new DomainError(
            'conflict_error',
            'Blog request is not executable.',
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
            currentNode: 'catalog_sync',
            startedAt: this.clock.now(),
            status: 'running',
          })
          .where(eq(schema.graphRuns.id, row.graph.id));
        return row;
      },
    );

    let result: BlogExecutionResult;
    try {
      result = await this.executor.execute({
        input: context.version.interpretedInput,
        manifest: context.manifest.document,
        requestId: context.request.id,
        requestVersionId: context.version.id,
      });
    } catch (error) {
      await this.recordFailure(signal, context.graph.id, error);
      throw error;
    }

    const prefix = `${context.request.tenantId}/${context.request.projectId}/${context.request.id}/${context.version.id}`;
    for (const file of result.files) {
      await this.artifacts.put({
        bytes: file.bytes,
        key: `${prefix}/${file.path.replaceAll('/', '_')}`,
        mime: file.mime,
        sha256: file.sha256,
      });
    }
    const actions = {
      approve: newActionToken(),
      cancel: newActionToken(),
      revise: newActionToken(),
    };
    await withSystemTenantScope(
      this.database,
      { operation: 'blog.execute.persist', tenantId: signal.tenantId },
      async (database) => {
        const now = this.clock.now();
        const [catalogSync] = await database
          .insert(schema.contentCatalogSyncs)
          .values({
            completedAt: now,
            id: uuidv7(),
            itemCount: result.catalog.length,
            projectId: context.request.projectId,
            sourceRevision: result.catalogRevision,
            status: 'completed',
            tenantId: context.request.tenantId,
          })
          .onConflictDoUpdate({
            set: {
              completedAt: now,
              itemCount: result.catalog.length,
              status: 'completed',
            },
            target: [
              schema.contentCatalogSyncs.projectId,
              schema.contentCatalogSyncs.sourceRevision,
            ],
          })
          .returning({ id: schema.contentCatalogSyncs.id });
        if (catalogSync === undefined)
          throw new DomainError(
            'internal_error',
            'Content catalog sync could not be recorded.',
          );
        for (const item of result.catalog) {
          await database
            .insert(schema.contentCatalogItems)
            .values({
              category: item.category,
              contentHash: item.contentHash,
              embedding: [...item.embedding],
              id: uuidv7(),
              locale: item.locale,
              normalizedTitle: item.normalizedTitle,
              projectId: context.request.projectId,
              slug: item.slug,
              sourceId: item.sourceId,
              sourceRevision: item.sourceRevision,
              syncId: catalogSync.id,
              tenantId: context.request.tenantId,
              title: item.title,
            })
            .onConflictDoUpdate({
              set: {
                category: item.category,
                contentHash: item.contentHash,
                embedding: [...item.embedding],
                normalizedTitle: item.normalizedTitle,
                slug: item.slug,
                sourceRevision: item.sourceRevision,
                status: 'published',
                syncId: catalogSync.id,
                title: item.title,
                updatedAt: now,
              },
              target: [
                schema.contentCatalogItems.projectId,
                schema.contentCatalogItems.sourceId,
                schema.contentCatalogItems.locale,
              ],
            });
        }
        const similarityCheckId = uuidv7();
        const intent =
          context.version.interpretedInput.mode === 'brief'
            ? context.version.interpretedInput.topic
            : context.version.interpretedInput.title;
        await database.insert(schema.similarityChecks).values({
          catalogSyncId: catalogSync.id,
          id: similarityCheckId,
          intentHash: digest(intent),
          level: result.similarity.level,
          projectId: context.request.projectId,
          requestVersionId: context.version.id,
          tenantId: context.request.tenantId,
        });
        for (const [
          index,
          candidate,
        ] of result.similarity.candidates.entries()) {
          const source = result.catalog.find(
            (item) => item.locale === 'es' && item.slug === candidate.slug,
          );
          if (source === undefined)
            throw new DomainError(
              'internal_error',
              'Similarity candidate has no catalog source.',
            );
          await database.insert(schema.candidateMatches).values({
            id: uuidv7(),
            projectId: context.request.projectId,
            rank: index + 1,
            scoreBasisPoints: Math.round(candidate.score * 10_000),
            similarityCheckId,
            slug: candidate.slug,
            sourceId: source.sourceId,
            tenantId: context.request.tenantId,
            title: candidate.title,
          });
        }
        for (const file of result.files) {
          await database.insert(schema.artifacts).values({
            bytes: file.bytes.byteLength,
            id: uuidv7(),
            kind: file.mime === 'image/avif' ? 'cover_image' : 'blog_markdown',
            mime: file.mime,
            projectId: context.request.projectId,
            requestId: context.request.id,
            requestVersionId: context.version.id,
            sha256: file.sha256,
            storageKey: `${prefix}/${file.path.replaceAll('/', '_')}`,
            tenantId: context.request.tenantId,
          });
        }
        const repoChangeId = uuidv7();
        await database.insert(schema.repoChanges).values({
          artifactHashes: Object.fromEntries(
            result.files.map((file) => [file.path, file.sha256]),
          ),
          baseSha: result.publication.baseCommitSha,
          branch: result.publication.branch,
          files: [...result.publication.files],
          headSha: result.publication.headCommitSha,
          id: repoChangeId,
          projectId: context.request.projectId,
          requestId: context.request.id,
          requestVersionId: context.version.id,
          tenantId: context.request.tenantId,
        });
        await database.insert(schema.pullRequests).values({
          baseSha: result.publication.baseCommitSha,
          headSha: result.publication.headCommitSha,
          id: uuidv7(),
          projectId: context.request.projectId,
          providerId: result.publication.pullRequestId,
          repoChangeId,
          requestVersionId: context.version.id,
          state: 'open',
          tenantId: context.request.tenantId,
          url: result.publication.pullRequestUrl,
        });
        await database.insert(schema.deployments).values({
          commitSha: result.deployment.sha,
          environment: result.deployment.environment,
          id: uuidv7(),
          projectId: context.request.projectId,
          providerId: result.deployment.deploymentId,
          readyAt: new Date(result.deployment.readyAt),
          requestVersionId: context.version.id,
          state: 'ready',
          tenantId: context.request.tenantId,
          urls: result.deployment.urls,
        });
        for (const [action, token] of [
          ['approve_preview', actions.approve],
          ['request_revision', actions.revise],
          ['cancel', actions.cancel],
        ] as const) {
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
        }
        await database
          .update(schema.requests)
          .set({
            state: 'AWAITING_CLIENT_APPROVAL',
            terminalResult: {
              approvalStatus: 'awaiting_client',
              branch: result.publication.branch,
              categoryKind: result.bundle.categoryKind,
              files: result.publication.files,
              headCommitSha: result.publication.headCommitSha,
              previewDeploymentId: result.deployment.deploymentId,
              previewUrls: result.deployment.urls,
              pullRequestUrl: result.publication.pullRequestUrl,
              slug: result.bundle.slug,
            },
            updatedAt: now,
            version: context.request.version + 2,
          })
          .where(eq(schema.requests.id, context.request.id));
        await this.checkpoint(
          database,
          context.graph.id,
          3,
          'awaiting_client_approval',
          {
            deploymentId: result.deployment.deploymentId,
            headSha: result.publication.headCommitSha,
            requestState: 'AWAITING_CLIENT_APPROVAL',
          },
        );
        await database.insert(schema.auditEvents).values({
          action: 'request.preview_ready',
          actorId: 'worker:blog',
          actorType: 'system',
          correlationId: `request:${context.request.id}`,
          id: uuidv7(),
          metadata: {
            deploymentId: result.deployment.deploymentId,
            headSha: result.publication.headCommitSha,
            pullRequestId: result.publication.pullRequestId,
          },
          objectId: context.request.id,
          objectType: 'request',
          projectId: context.request.projectId,
          tenantId: context.request.tenantId,
        });
      },
    );
    return { actions, result };
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
      { operation: 'blog.publish.load', tenantId: signal.tenantId },
      async (database) => {
        const [row] = await database
          .select({
            deployment: schema.deployments,
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
            schema.deployments,
            and(
              eq(schema.deployments.requestVersionId, signal.requestVersionId),
              eq(schema.deployments.environment, 'preview'),
            ),
          )
          .where(eq(schema.requests.id, signal.requestId))
          .limit(1);
        if (row?.request.state !== 'APPROVED_FOR_PUBLISH')
          throw new DomainError(
            'conflict_error',
            'Request is not approved for publication.',
          );
        const categoryKind = (
          row.request.terminalResult as { categoryKind?: unknown } | null
        )?.categoryKind;
        if (
          categoryKind !== 'existing' &&
          categoryKind !== 'likely_typo' &&
          categoryKind !== 'new'
        )
          throw new DomainError(
            'internal_error',
            'Category policy evidence is missing.',
          );
        const policy = decideBlogPublicationPolicy({
          categoryKind,
          editablePaths: row.repo.files,
        });
        const approvalRows = await database
          .select()
          .from(schema.approvals)
          .where(
            eq(schema.approvals.requestVersionId, signal.requestVersionId),
          );
        const now = this.clock.now();
        for (const role of policy.requiredApprovals) {
          const approval = approvalRows.find(
            (candidate) =>
              candidate.role === role && candidate.decision === 'approved',
          );
          if (
            approval === undefined ||
            approval.expiresAt <= now ||
            approval.headCommitSha !== row.repo.headSha ||
            approval.deploymentId !== row.deployment.providerId
          )
            throw new DomainError(
              'conflict_error',
              `Required ${role} approval is stale or missing.`,
            );
        }
        await database
          .update(schema.requests)
          .set({
            state: 'REVALIDATING',
            updatedAt: now,
            version: row.request.version + 1,
          })
          .where(eq(schema.requests.id, row.request.id));
        return row;
      },
    );
    const routes = Object.keys(context.deployment.urls);
    const attemptId = uuidv7();
    await withSystemTenantScope(
      this.database,
      { operation: 'blog.publish.start', tenantId: signal.tenantId },
      async (database) => {
        await database.insert(schema.publicationAttempts).values({
          id: attemptId,
          preconditions: {
            deploymentId: context.deployment.providerId,
            headSha: context.repo.headSha,
          },
          projectId: context.request.projectId,
          requestId: context.request.id,
          requestVersionId: context.version.id,
          status: 'running',
          tenantId: context.request.tenantId,
        });
      },
    );
    let published: Awaited<ReturnType<BlogExecutor['publish']>>;
    try {
      published = await this.executor.publish({
        deploymentId: context.deployment.providerId,
        expectedFiles: context.repo.files,
        headCommitSha: context.repo.headSha,
        previewSha: context.deployment.commitSha,
        pullRequestId: context.pull.providerId,
        routes,
      });
    } catch (error) {
      await withSystemTenantScope(
        this.database,
        { operation: 'blog.publish.failure', tenantId: signal.tenantId },
        async (database) => {
          const retryable =
            error instanceof DomainError &&
            error.category === 'provider_retryable';
          const now = this.clock.now();
          await database
            .update(schema.publicationAttempts)
            .set({
              completedAt: now,
              result: {
                errorCategory:
                  error instanceof DomainError
                    ? error.category
                    : 'internal_error',
              },
              status: retryable ? 'failed_retryable' : 'failed_final',
            })
            .where(eq(schema.publicationAttempts.id, attemptId));
          await database
            .update(schema.requests)
            .set({
              state: retryable ? 'FAILED_RETRYABLE' : 'FAILED_FINAL',
              updatedAt: now,
              version: context.request.version + 2,
            })
            .where(eq(schema.requests.id, context.request.id));
        },
      );
      throw error;
    }
    await withSystemTenantScope(
      this.database,
      { operation: 'blog.publish.complete', tenantId: signal.tenantId },
      async (database) => {
        const now = this.clock.now();
        await database
          .update(schema.pullRequests)
          .set({
            mergeCommitSha: published.mergeCommitSha,
            state: 'merged',
            updatedAt: now,
          })
          .where(eq(schema.pullRequests.id, context.pull.id));
        await database.insert(schema.deployments).values({
          commitSha: published.deployment.sha,
          environment: 'production',
          id: uuidv7(),
          projectId: context.request.projectId,
          providerId: published.deployment.deploymentId,
          readyAt: new Date(published.deployment.readyAt),
          requestVersionId: context.version.id,
          state: 'ready',
          tenantId: context.request.tenantId,
          urls: published.deployment.urls,
          verifiedAt: now,
        });
        await database
          .update(schema.publicationAttempts)
          .set({
            completedAt: now,
            mergeCommitSha: published.mergeCommitSha,
            result: { deploymentId: published.deployment.deploymentId },
            status: 'completed',
          })
          .where(eq(schema.publicationAttempts.id, attemptId));
        await database
          .update(schema.requests)
          .set({
            state: 'COMPLETED',
            terminalResult: {
              ...(context.request.terminalResult as Record<string, unknown>),
              approvalStatus: 'published',
              mergeCommitSha: published.mergeCommitSha,
              productionDeploymentId: published.deployment.deploymentId,
              productionUrls: published.deployment.urls,
            },
            updatedAt: now,
            version: context.request.version + 2,
          })
          .where(eq(schema.requests.id, context.request.id));
        const [run] = await database
          .select()
          .from(schema.graphRuns)
          .where(eq(schema.graphRuns.requestVersionId, context.version.id))
          .limit(1);
        if (run !== undefined) {
          await database
            .update(schema.graphRuns)
            .set({
              completedAt: now,
              currentNode: 'completed',
              status: 'completed',
              updatedAt: now,
            })
            .where(eq(schema.graphRuns.id, run.id));
          await this.checkpoint(
            database,
            run.id,
            5,
            'completed',
            {
              mergeCommitSha: published.mergeCommitSha,
              requestState: 'COMPLETED',
            },
            'completed',
          );
        }
      },
    );
    return {
      mergeCommitSha: published.mergeCommitSha,
      urls: published.deployment.urls,
    };
  }

  private async checkpoint(
    database: ScopedDatabase,
    graphRunId: string,
    sequence: number,
    node: string,
    state: Record<string, unknown>,
    status: 'interrupted' | 'completed' = 'interrupted',
  ): Promise<void> {
    const [run] = await database
      .select()
      .from(schema.graphRuns)
      .where(eq(schema.graphRuns.id, graphRunId))
      .limit(1);
    if (run === undefined)
      throw new DomainError('internal_error', 'Graph run is missing.');
    await database.insert(schema.workflowCheckpoints).values({
      graphRunId,
      id: uuidv7(),
      node,
      projectId: run.projectId,
      sequence,
      state,
      tenantId: run.tenantId,
    });
    await database
      .update(schema.graphRuns)
      .set({
        checkpointSequence: sequence,
        currentNode: node,
        status,
        updatedAt: this.clock.now(),
      })
      .where(eq(schema.graphRuns.id, graphRunId));
  }

  private async recordFailure(
    signal: WorkflowResumeSignal,
    graphRunId: string,
    error: unknown,
  ): Promise<void> {
    const retryable =
      error instanceof DomainError && error.category === 'provider_retryable';
    await withSystemTenantScope(
      this.database,
      { operation: 'blog.execute.failure', tenantId: signal.tenantId },
      async (database) => {
        await database
          .update(schema.requests)
          .set({
            state: retryable ? 'FAILED_RETRYABLE' : 'FAILED_FINAL',
            terminalResult: {
              errorCategory:
                error instanceof DomainError
                  ? error.category
                  : 'internal_error',
            },
            updatedAt: this.clock.now(),
          })
          .where(eq(schema.requests.id, signal.requestId));
        await database
          .update(schema.graphRuns)
          .set({
            currentNode: 'failed',
            status: 'failed',
            updatedAt: this.clock.now(),
          })
          .where(eq(schema.graphRuns.id, graphRunId));
      },
    );
  }
}
