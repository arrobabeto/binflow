import { createHash } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { ArtifactStore } from '@binflow/artifacts';
import {
  deleteBlogDraftInputSchema,
  workflowResumeSignalSchema,
  type WorkflowResumeSignal,
} from '@binflow/contracts';
import {
  DeleteBlogExecutor,
  composeBlogArticleUrl,
  resolveDeleteBlogProductionOrigin,
  type DeleteBlogExecutionResult,
} from '@binflow/blog';
import {
  schema,
  withSystemTenantScope,
  type Database,
  type ScopedDatabase,
} from '@binflow/db';
import { DomainError, type Clock, systemClock } from '@binflow/domain';
import { decideBlogDeletionPolicy } from '@binflow/policies';

import { enqueueAdminApprovalRequired } from './admin-approval-notification.js';


const stageRequestState = (node: string): string => {
  switch (node) {
    case 'catalog_sync':
    case 'resolve_target':
    case 'validate_deletion':
    case 'render_deletion_artifacts':
    case 'open_deletion_pr':
      return 'GENERATING';
    case 'awaiting_admin_approval':
      return 'AWAITING_ADMIN_APPROVAL';
    case 'merge_or_publish':
      return 'MERGING_OR_PUBLISHING';
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

export class DeleteBlogWorkflowRuntime {
  public constructor(
    private readonly database: Database,
    private readonly artifacts: ArtifactStore,
    private readonly executor: DeleteBlogExecutor,
    private readonly clock: Clock = systemClock,
  ) {}

  public async execute(raw: WorkflowResumeSignal): Promise<
    Readonly<{
      result: DeleteBlogExecutionResult;
    }>
  > {
    const signal = workflowResumeSignalSchema.parse(raw);
    const context = await withSystemTenantScope(
      this.database,
      { operation: 'delete_blog.execute.load', tenantId: signal.tenantId },
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
            'Delete blog workflow context is missing.',
          );
        if (
          !['QUEUED', 'FAILED_RETRYABLE', 'GENERATING'].includes(
            row.request.state,
          ) ||
          row.version.confirmedAt === null
        )
          throw new DomainError(
            'conflict_error',
            'Delete blog request is not executable.',
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

    let result: DeleteBlogExecutionResult;
    const graphRunId = context.graph.id;
    const recordExecutionStage = async (node: string): Promise<void> => {
      await withSystemTenantScope(
        this.database,
        { operation: 'delete_blog.execute.stage', tenantId: signal.tenantId },
        async (database) => {
          await this.recordStage(database, graphRunId, node);
        },
      );
    };
    try {
      result = await this.executor.execute({
        input: deleteBlogDraftInputSchema.parse(
          context.version.interpretedInput,
        ) as Extract<
          ReturnType<typeof deleteBlogDraftInputSchema.parse>,
          { mode: 'execute' }
        >,
        manifest: context.manifest.document,
        onStage: recordExecutionStage,
        productionOrigin: resolveDeleteBlogProductionOrigin(
          context.manifest.document,
        ),
        requestId: context.request.id,
      });
    } catch (error) {
      await this.recordFailure(signal, context.graph.id, error);
      throw error;
    }

    await withSystemTenantScope(
      this.database,
      { operation: 'delete_blog.execute.persist', tenantId: signal.tenantId },
      async (database) => {
        const now = this.clock.now();
        const prefix = `${context.request.tenantId}/${context.request.projectId}/${context.request.id}/${context.version.id}`;
        const planBytes = new TextEncoder().encode(
          JSON.stringify({
            deletionPaths: result.deletionPaths,
            resolvedSlug: result.resolvedSlug,
            resolvedTitle: result.resolvedTitle,
            routes: result.routes,
          }),
        );
        const planDigest = createHash('sha256').update(planBytes).digest('hex');
        const planKey = `${prefix}/deletion_plan.json`;
        await this.artifacts.put({
          bytes: planBytes,
          key: planKey,
          mime: 'application/json',
          sha256: planDigest,
        });
        const artifactId = uuidv7();
        await database.insert(schema.artifacts).values({
          bytes: planBytes.byteLength,
          id: artifactId,
          kind: 'deletion_plan',
          mime: 'application/json',
          projectId: context.request.projectId,
          requestId: context.request.id,
          requestVersionId: context.version.id,
          sha256: planDigest,
          storageKey: planKey,
          tenantId: context.request.tenantId,
        });
        const repoChangeId = uuidv7();
        await database.insert(schema.repoChanges).values({
          artifactHashes: Object.fromEntries(
            result.deletionPaths.map((path) => [path, 'deleted']),
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
        await database
          .update(schema.requests)
          .set({
            state: 'AWAITING_ADMIN_APPROVAL',
            terminalResult: {
              approvalStatus: 'awaiting_admin',
              branch: result.publication.branch,
              deletionPaths: result.deletionPaths,
              files: result.publication.files,
              headCommitSha: result.publication.headCommitSha,
              planDigest,
              pullRequestUrl: result.publication.pullRequestUrl,
              resolvedSlug: result.resolvedSlug,
              resolvedTitle: result.resolvedTitle,
              routes: result.routes,
            },
            updatedAt: now,
            version: context.request.version + 2,
          })
          .where(eq(schema.requests.id, context.request.id));
        await this.recordStage(
          database,
          context.graph.id,
          'awaiting_admin_approval',
          {
            deploymentId: result.deployment.deploymentId,
            headSha: result.publication.headCommitSha,
            requestState: 'AWAITING_ADMIN_APPROVAL',
          },
        );
        await database.insert(schema.auditEvents).values({
          action: 'request.deletion_pr_ready',
          actorId: 'worker:delete_blog',
          actorType: 'system',
          correlationId: `request:${context.request.id}`,
          id: uuidv7(),
          metadata: {
            headSha: result.publication.headCommitSha,
            pullRequestId: result.publication.pullRequestId,
          },
          objectId: context.request.id,
          objectType: 'request',
          projectId: context.request.projectId,
          tenantId: context.request.tenantId,
        });
        const [scope] = await database
          .select({
            projectKey: schema.projects.key,
            tenantKey: schema.tenants.key,
          })
          .from(schema.projects)
          .innerJoin(
            schema.tenants,
            eq(schema.tenants.id, schema.projects.tenantId),
          )
          .where(eq(schema.projects.id, context.request.projectId))
          .limit(1);
        await enqueueAdminApprovalRequired(database, {
          bindings: {
            artifactId,
            deploymentId: result.deployment.deploymentId,
            headCommitSha: result.publication.headCommitSha,
            requestVersionId: context.version.id,
          },
          clock: this.clock,
          eventVersion: context.request.version + 2,
          message: [
            `Cliente: ${scope?.tenantKey ?? context.request.tenantId}`,
            `Acción: quiere borrar el artículo «${result.resolvedTitle}»`,
            `URL: ${composeBlogArticleUrl(resolveDeleteBlogProductionOrigin(context.manifest.document), context.manifest.document, result.resolvedSlug)}`,
            `PR: ${result.publication.pullRequestUrl}`,
            `Request: ${context.request.id}`,
            `Dashboard: /requests/${context.request.id}`,
            '',
            'Approve → merge and publish path.',
            'Reject → request cancelled; client notified.',
          ].join('\n'),
          projectId: context.request.projectId,
          requestId: context.request.id,
          tenantId: context.request.tenantId,
        });
      },
    );
    return { result };
  }

  public async publish(raw: WorkflowResumeSignal): Promise<
    Readonly<{
      mergeCommitSha: string;
      resolvedTitle: string;
      urls: Readonly<Record<string, string>>;
    }>
  > {
    const signal = workflowResumeSignalSchema.parse(raw);
    const context = await withSystemTenantScope(
      this.database,
      { operation: 'delete_blog.publish.load', tenantId: signal.tenantId },
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
        if (
          row === undefined ||
          ![
            'APPROVED_FOR_PUBLISH',
            'FAILED_FINAL',
            'FAILED_RETRYABLE',
            'REVALIDATING',
          ].includes(row.request.state)
        )
          throw new DomainError(
            'conflict_error',
            'Request is not approved for publication.',
          );
        const policy = decideBlogDeletionPolicy({
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
    const terminal = context.request.terminalResult as
      | {
          routes?: readonly string[];
        }
      | null;
    const routes =
      terminal?.routes ??
      Object.keys(context.deployment.urls as Record<string, string>);
    const attemptId = uuidv7();
    await withSystemTenantScope(
      this.database,
      { operation: 'delete_blog.publish.start', tenantId: signal.tenantId },
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
    let published: Awaited<
      ReturnType<DeleteBlogExecutor['verifyProductionAbsence']>
    >;
    try {
      await withSystemTenantScope(
        this.database,
        { operation: 'delete_blog.publish.stage', tenantId: signal.tenantId },
        async (database) => {
          const [run] = await database
            .select()
            .from(schema.graphRuns)
            .where(eq(schema.graphRuns.requestVersionId, context.version.id))
            .limit(1);
          if (run !== undefined)
            await this.recordStage(database, run.id, 'merge_or_publish');
        },
      );
      const merged = await this.executor.mergeApprovedPreview({
        expectedFiles: context.repo.files,
        headCommitSha: context.repo.headSha,
        previewSha: context.repo.headSha,
        pullRequestId: context.pull.providerId,
      });
      await withSystemTenantScope(
        this.database,
        { operation: 'delete_blog.publish.record_merge', tenantId: signal.tenantId },
        async (database) => {
          await database
            .update(schema.pullRequests)
            .set({
              mergeCommitSha: merged.mergeCommitSha,
              state: 'merged',
              updatedAt: this.clock.now(),
            })
            .where(eq(schema.pullRequests.id, context.pull.id));
        },
      );
      await withSystemTenantScope(
        this.database,
        { operation: 'delete_blog.publish.verify', tenantId: signal.tenantId },
        async (database) => {
          const [run] = await database
            .select()
            .from(schema.graphRuns)
            .where(eq(schema.graphRuns.requestVersionId, context.version.id))
            .limit(1);
          if (run !== undefined)
            await this.recordStage(database, run.id, 'verify_production');
        },
      );
      published = await this.executor.verifyProductionAbsence({
        mergeCommitSha: merged.mergeCommitSha,
        routes,
      });
      const resolvedSlug = (
        context.request.terminalResult as { resolvedSlug?: string } | null
      )?.resolvedSlug;
      if (resolvedSlug !== undefined) {
        await withSystemTenantScope(
          this.database,
          {
            operation: 'delete_blog.publish.tombstone',
            tenantId: signal.tenantId,
          },
          async (database) => {
            const now = this.clock.now();
            await database
              .update(schema.contentCatalogItems)
              .set({ status: 'deleted', updatedAt: now })
              .where(
                and(
                  eq(
                    schema.contentCatalogItems.projectId,
                    context.request.projectId,
                  ),
                  eq(schema.contentCatalogItems.slug, resolvedSlug),
                ),
              );
          },
        );
      }
    } catch (error) {
      await withSystemTenantScope(
        this.database,
        { operation: 'delete_blog.publish.fail', tenantId: signal.tenantId },
        async (database) => {
          const retryable =
            error instanceof DomainError &&
            (error.category === 'provider_retryable' ||
              error.metadata.code === 'route_still_live');
          const now = this.clock.now();
          const errorCategory =
            error instanceof DomainError ? error.category : 'internal_error';
          const errorMessage =
            error instanceof Error
              ? error.message
              : 'Deletion publication failed without an error message.';
          const [run] = await database
            .select()
            .from(schema.graphRuns)
            .where(eq(schema.graphRuns.requestVersionId, context.version.id))
            .limit(1);
          const failedNode = run?.currentNode ?? 'failed';
          const nextState = retryable ? 'FAILED_RETRYABLE' : 'FAILED_FINAL';
          const nextVersion = context.request.version + 2;
          await database
            .update(schema.publicationAttempts)
            .set({
              status: retryable ? 'failed_retryable' : 'failed_final',
            })
            .where(eq(schema.publicationAttempts.id, attemptId));
          await database
            .update(schema.requests)
            .set({
              state: nextState,
              terminalResult: {
                ...(context.request.terminalResult as Record<string, unknown>),
                errorCategory,
                errorMessage,
                failedNode,
              },
              updatedAt: now,
              version: nextVersion,
            })
            .where(eq(schema.requests.id, context.request.id));
          if (run !== undefined)
            await this.recordStage(
              database,
              run.id,
              'failed',
              {
                errorCategory,
                errorMessage,
                requestState: nextState,
              },
              { status: 'failed' },
            );
          if (!retryable) {
            await this.enqueueAdminNotification(
              database,
              context.request,
              'request.failed_final',
              `Request ${context.request.id} failed at ${failedNode}: ${errorMessage}. Open /requests/${context.request.id} in the dashboard.`,
              nextVersion,
            );
          }
        },
      );
      throw error;
    }
    await withSystemTenantScope(
      this.database,
      { operation: 'delete_blog.publish.complete', tenantId: signal.tenantId },
      async (database) => {
        const now = this.clock.now();
        await database
          .update(schema.publicationAttempts)
          .set({ status: 'completed' })
          .where(eq(schema.publicationAttempts.id, attemptId));
        await database.insert(schema.deployments).values({
          commitSha: published.mergeCommitSha,
          environment: 'production',
          id: uuidv7(),
          projectId: context.request.projectId,
          providerId: published.deployment.deploymentId,
          readyAt: new Date(published.deployment.readyAt),
          requestVersionId: context.version.id,
          state: 'ready',
          tenantId: context.request.tenantId,
          urls: published.deployment.urls,
        });
        await database
          .update(schema.requests)
          .set({
            state: 'COMPLETED',
            terminalResult: {
              ...(context.request.terminalResult as Record<string, unknown>),
              approvalStatus: 'published',
              mergeCommitSha: published.mergeCommitSha,
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
        if (run !== undefined)
          await this.recordStage(database, run.id, 'completed', {}, {
            status: 'completed',
          });
      },
    );
    return {
      mergeCommitSha: published.mergeCommitSha,
      resolvedTitle:
        (context.request.terminalResult as { resolvedTitle?: string } | null)
          ?.resolvedTitle ?? 'article',
      urls: published.deployment.urls,
    };
  }

  private async recordStage(
    database: ScopedDatabase,
    graphRunId: string,
    node: string,
    extraState: Record<string, unknown> = {},
    options: Readonly<{
      status?: (typeof schema.graphRuns.$inferSelect)['status'];
    }> = {},
  ): Promise<number> {
    const [run] = await database
      .select()
      .from(schema.graphRuns)
      .where(eq(schema.graphRuns.id, graphRunId))
      .limit(1);
    if (run === undefined)
      throw new DomainError('internal_error', 'Graph run is missing.');
    const sequence = run.checkpointSequence + 1;
    const requestState = stageRequestState(node);
    await database.insert(schema.workflowCheckpoints).values({
      graphRunId,
      id: uuidv7(),
      node,
      projectId: run.projectId,
      sequence,
      state: { requestState, ...extraState },
      tenantId: run.tenantId,
    });
    await database
      .update(schema.graphRuns)
      .set({
        checkpointSequence: sequence,
        currentNode: node,
        status: options.status ?? 'running',
        updatedAt: this.clock.now(),
      })
      .where(eq(schema.graphRuns.id, graphRunId));
    if (
      requestState === 'GENERATING' ||
      requestState === 'AWAITING_ADMIN_APPROVAL'
    ) {
      const [version] = await database
        .select({ requestId: schema.requestVersions.requestId })
        .from(schema.requestVersions)
        .where(eq(schema.requestVersions.id, run.requestVersionId))
        .limit(1);
      if (version !== undefined) {
        await database
          .update(schema.requests)
          .set({ state: requestState, updatedAt: this.clock.now() })
          .where(eq(schema.requests.id, version.requestId));
      }
    }
    return sequence;
  }

  private async recordFailure(
    signal: WorkflowResumeSignal,
    graphRunId: string,
    error: unknown,
  ): Promise<void> {
    const retryable =
      error instanceof DomainError && error.category === 'provider_retryable';
    const errorCategory =
      error instanceof DomainError ? error.category : 'internal_error';
    const errorMessage =
      error instanceof Error ? error.message : 'Delete blog failed.';
    await withSystemTenantScope(
      this.database,
      { operation: 'delete_blog.execute.fail', tenantId: signal.tenantId },
      async (database) => {
        const [run] = await database
          .select()
          .from(schema.graphRuns)
          .where(eq(schema.graphRuns.id, graphRunId))
          .limit(1);
        const failedNode = run?.currentNode ?? 'failed';
        const [request] = await database
          .select()
          .from(schema.requests)
          .where(eq(schema.requests.id, signal.requestId))
          .limit(1);
        if (request === undefined) return;
        const nextState = retryable ? 'FAILED_RETRYABLE' : 'FAILED_FINAL';
        const nextVersion = request.version + 1;
        await database
          .update(schema.requests)
          .set({
            state: nextState,
            terminalResult: {
              errorCategory,
              errorMessage,
              failedNode,
            },
            updatedAt: this.clock.now(),
            version: nextVersion,
          })
          .where(eq(schema.requests.id, signal.requestId));
        await this.recordStage(
          database,
          graphRunId,
          'failed',
          {
            errorCategory,
            errorMessage,
            requestState: nextState,
          },
          { status: 'failed' },
        );
        if (!retryable) {
          await this.enqueueAdminNotification(
            database,
            request,
            'request.failed_final',
            `Request ${request.id} failed at ${failedNode}: ${errorMessage}. Open /requests/${request.id} in the dashboard.`,
            nextVersion,
          );
        }
      },
    );
  }

  private async enqueueAdminNotification(
    database: ScopedDatabase,
    request: Pick<
      typeof schema.requests.$inferSelect,
      'id' | 'projectId' | 'tenantId'
    >,
    notificationType: string,
    message: string,
    eventVersion: number,
  ): Promise<void> {
    await database.insert(schema.outboxEvents).values({
      aggregateId: request.id,
      aggregateType: 'request',
      eventType: 'admin.notification_requested',
      eventVersion,
      id: uuidv7(),
      jobKey: `admin.notification:${notificationType}:${request.id}:${String(eventVersion)}`,
      payload: { message, notificationType, requestId: request.id },
      projectId: request.projectId,
      tenantId: request.tenantId,
    });
  }
}
