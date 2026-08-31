import { createHash, randomBytes } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { ArtifactStore } from '@binflow/artifacts';
import type { ProjectExecutor, ProjectExecutionResult } from '@binflow/projects';
import {
  adaptedGeneratedProjectBundleSchema,
  createProjectAstroInputSchema,
  revisionPlanValidatedSchema,
  workflowResumeSignalSchema,
  type GeneratedProjectBundle,
  type RevisionPlan,
  type WorkflowResumeSignal,
} from '@binflow/contracts';
import {
  schema,
  withSystemTenantScope,
  type Database,
  type ScopedDatabase,
} from '@binflow/db';
import { DomainError, type Clock, systemClock } from '@binflow/domain';
import { decideProjectPublicationPolicy } from '@binflow/policies';
import { loadCustomizationSection } from '@binflow/tools';

const digest = (value: string): string =>
  createHash('sha256').update(value).digest('hex');
const newActionToken = (): string => randomBytes(32).toString('base64url');
const APPROVAL_TTL_MS = 24 * 60 * 60 * 1_000;

const stageRequestState = (node: string): string => {
  switch (node) {
    case 'catalog_sync':
    case 'similarity':
    case 'read_project_url':
    case 'generate':
    case 'interpret_revision':
      return 'GENERATING';
    case 'apply_revision':
    case 'render_artifacts':
      return 'APPLYING_CHANGE';
    case 'normalize_project_bundle':
    case 'validate_project_bundle':
    case 'validate_privacy_and_evidence':
    case 'repo_contract_checks':
      return 'VALIDATING';
    case 'create_draft':
    case 'wait_preview':
      return 'PREVIEW_DEPLOYING';
    case 'awaiting_revision_plan_confirmation':
      return 'AWAITING_REVISION_PLAN_CONFIRMATION';
    case 'awaiting_client_approval':
      return 'AWAITING_CLIENT_APPROVAL';
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

type PreviewActions = Readonly<{
  approve: string;
  cancel: string;
  revise: string;
}>;

type RevisionPlanActions = Readonly<{
  adjust: string;
  cancel: string;
  confirm: string;
}>;

export class ProjectWorkflowRuntime {
  public constructor(
    private readonly database: Database,
    private readonly artifacts: ArtifactStore,
    private readonly executor: ProjectExecutor,
    private readonly clock: Clock = systemClock,
  ) {}

  public async execute(raw: WorkflowResumeSignal): Promise<
    Readonly<{
      actions: PreviewActions;
      result: ProjectExecutionResult;
    }>
  > {
    const signal = workflowResumeSignalSchema.parse(raw);
    const context = await withSystemTenantScope(
      this.database,
      { operation: 'project.execute.load', tenantId: signal.tenantId },
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
            'Project workflow context is missing.',
          );
        if (
          !['QUEUED', 'FAILED_RETRYABLE', 'GENERATING'].includes(
            row.request.state,
          ) ||
          row.version.confirmedAt === null
        )
          throw new DomainError(
            'conflict_error',
            'Project request is not executable.',
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

    let result: ProjectExecutionResult;
    const graphRunId = context.graph.id;
    const recordExecutionStage = async (node: string): Promise<void> => {
      await withSystemTenantScope(
        this.database,
        { operation: 'project.execute.stage', tenantId: signal.tenantId },
        async (database) => {
          await this.recordStage(database, graphRunId, node);
        },
      );
    };
    try {
      const customizationSection = await loadCustomizationSection(
        this.database,
        {
          capabilityId: context.request.capabilityId,
          nodeId: 'generate',
          projectId: context.request.projectId,
          tenantId: signal.tenantId,
        },
      );
      const projectInput = createProjectAstroInputSchema.parse(
        context.version.interpretedInput,
      );
      const coverKey =
        projectInput.mode === 'brief'
          ? (projectInput.imageAssetId ??
            (typeof projectInput.closedFacts?.heroScreenshot === 'string'
              ? projectInput.closedFacts.heroScreenshot
              : undefined))
          : projectInput.mode === 'structured'
            ? projectInput.imageAssetId
            : undefined;
      const coverImage =
        coverKey === undefined
          ? undefined
          : await this.artifacts.get(coverKey);
      result = await this.executor.execute({
        ...(customizationSection === undefined
          ? {}
          : { customizationSection }),
        ...(coverImage === undefined ? {} : { coverImage }),
        input: projectInput,
        manifest: context.manifest.document,
        onStage: recordExecutionStage,
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
      { operation: 'project.execute.persist', tenantId: signal.tenantId },
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
        const intent = result.intent;
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
            kind: file.mime === 'image/jpeg' ? 'cover_image' : 'project_markdown',
            mime: file.mime,
            projectId: context.request.projectId,
            requestId: context.request.id,
            requestVersionId: context.version.id,
            sha256: file.sha256,
            storageKey: `${prefix}/${file.path.replaceAll('/', '_')}`,
            tenantId: context.request.tenantId,
          });
        }
        const bundleBytes = new TextEncoder().encode(
          JSON.stringify(result.bundle),
        );
        const bundleDigest = createHash('sha256')
          .update(bundleBytes)
          .digest('hex');
        const bundleKey = `${prefix}/project_bundle.json`;
        await this.artifacts.put({
          bytes: bundleBytes,
          key: bundleKey,
          mime: 'application/json',
          sha256: bundleDigest,
        });
        await database.insert(schema.artifacts).values({
          bytes: bundleBytes.byteLength,
          id: uuidv7(),
          kind: 'project_bundle',
          mime: 'application/json',
          projectId: context.request.projectId,
          requestId: context.request.id,
          requestVersionId: context.version.id,
          sha256: bundleDigest,
          storageKey: bundleKey,
          tenantId: context.request.tenantId,
        });
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
        {
          const [existingPull] = await database
            .select()
            .from(schema.pullRequests)
            .where(
              and(
                eq(schema.pullRequests.projectId, context.request.projectId),
                eq(
                  schema.pullRequests.providerId,
                  result.publication.pullRequestId,
                ),
              ),
            )
            .limit(1);
          if (existingPull === undefined) {
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
          } else {
            await database
              .update(schema.pullRequests)
              .set({
                baseSha: result.publication.baseCommitSha,
                headSha: result.publication.headCommitSha,
                repoChangeId,
                requestVersionId: context.version.id,
                state: 'open',
                updatedAt: now,
                url: result.publication.pullRequestUrl,
              })
              .where(eq(schema.pullRequests.id, existingPull.id));
          }
        }
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
              bundleDigest,
              destacada: result.bundle.destacada,
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
        await this.recordStage(
          database,
          context.graph.id,
          'awaiting_client_approval',
          {
            deploymentId: result.deployment.deploymentId,
            headSha: result.publication.headCommitSha,
            requestState: 'AWAITING_CLIENT_APPROVAL',
          },
        );
        await database.insert(schema.auditEvents).values({
          action: 'request.preview_ready',
          actorId: 'worker:project',
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

  public async interpretRevision(raw: WorkflowResumeSignal): Promise<
    Readonly<{
      actions: RevisionPlanActions;
      plan: RevisionPlan;
    }>
  > {
    const signal = workflowResumeSignalSchema.parse(raw);
    const context = await withSystemTenantScope(
      this.database,
      { operation: 'project.interpret_revision.load', tenantId: signal.tenantId },
      async (database) => {
        const [row] = await database
          .select({
            graph: schema.graphRuns,
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
            schema.graphRuns,
            eq(schema.graphRuns.requestVersionId, schema.requestVersions.id),
          )
          .where(eq(schema.requests.id, signal.requestId))
          .limit(1);
        if (row === undefined)
          throw new DomainError(
            'validation_error',
            'Revision interpret context is missing.',
          );
        const [prior] = await database
          .select()
          .from(schema.requestVersions)
          .where(
            and(
              eq(schema.requestVersions.requestId, row.request.id),
              eq(schema.requestVersions.supersededById, row.version.id),
            ),
          )
          .limit(1);
        if (prior === undefined)
          throw new DomainError(
            'conflict_error',
            'Prior request version is required for revision interpretation.',
          );
        if (!['QUEUED', 'FAILED_RETRYABLE', 'GENERATING'].includes(row.request.state))
          throw new DomainError(
            'conflict_error',
            'Request is not ready to interpret a revision.',
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
            currentNode: 'interpret_revision',
            startedAt: this.clock.now(),
            status: 'running',
          })
          .where(eq(schema.graphRuns.id, row.graph.id));
        return { ...row, prior };
      },
    );

    const planFeedback = (
      context.version.plan as { revisionFeedback?: unknown } | null
    )?.revisionFeedback;
    if (typeof planFeedback !== 'string' || planFeedback.trim().length === 0)
      throw new DomainError(
        'validation_error',
        'Revision feedback is missing from the request version plan.',
      );

    const priorBundle = await this.loadProjectBundleArtifact(
      context.prior.id,
      context.request,
    );

    let plan: RevisionPlan;
    try {
      await withSystemTenantScope(
        this.database,
        {
          operation: 'project.interpret_revision.stage',
          tenantId: signal.tenantId,
        },
        async (database) => {
          await this.recordStage(
            database,
            context.graph.id,
            'interpret_revision',
          );
        },
      );
      plan = await this.executor.interpretRevisionPlan({
        bundle: priorBundle,
        feedback: planFeedback,
      });
    } catch (error) {
      await this.recordFailure(signal, context.graph.id, error);
      throw error;
    }

    const actions = {
      adjust: newActionToken(),
      cancel: newActionToken(),
      confirm: newActionToken(),
    };
    await withSystemTenantScope(
      this.database,
      { operation: 'project.interpret_revision.persist', tenantId: signal.tenantId },
      async (database) => {
        const now = this.clock.now();
        await database
          .update(schema.requestVersions)
          .set({
            plan: {
              ...(context.version.plan as Record<string, unknown>),
              revisionFeedback: planFeedback,
              revisionPlan: plan,
            },
          })
          .where(eq(schema.requestVersions.id, context.version.id));
        for (const [action, token] of [
          ['confirm_revision_plan', actions.confirm],
          ['adjust_revision_plan', actions.adjust],
          ['cancel_revision', actions.cancel],
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
            state: 'AWAITING_REVISION_PLAN_CONFIRMATION',
            terminalResult: {
              ...(context.request.terminalResult as Record<string, unknown>),
              revisionMagnitude: plan.magnitude,
              revisionSummary: plan.summary,
            },
            updatedAt: now,
            version: context.request.version + 2,
          })
          .where(eq(schema.requests.id, context.request.id));
        await this.recordStage(
          database,
          context.graph.id,
          'awaiting_revision_plan_confirmation',
          {
            magnitude: plan.magnitude,
            requestState: 'AWAITING_REVISION_PLAN_CONFIRMATION',
          },
        );
      },
    );
    return { actions, plan };
  }

  public async applyRevision(raw: WorkflowResumeSignal): Promise<
    Readonly<{
      actions: PreviewActions;
      bundle: GeneratedProjectBundle;
      deployment: ProjectExecutionResult['deployment'];
      files: ProjectExecutionResult['files'];
      publication: ProjectExecutionResult['publication'];
    }>
  > {
    const signal = workflowResumeSignalSchema.parse(raw);
    const context = await withSystemTenantScope(
      this.database,
      { operation: 'project.apply_revision.load', tenantId: signal.tenantId },
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
            'Revision apply context is missing.',
          );
        const [prior] = await database
          .select()
          .from(schema.requestVersions)
          .where(
            and(
              eq(schema.requestVersions.requestId, row.request.id),
              eq(schema.requestVersions.supersededById, row.version.id),
            ),
          )
          .limit(1);
        if (prior === undefined)
          throw new DomainError(
            'conflict_error',
            'Prior request version is required for revision apply.',
          );
        const plan = revisionPlanValidatedSchema.parse(
          (row.version.plan as { revisionPlan?: unknown }).revisionPlan,
        );
        if (
          ![
            'QUEUED',
            'FAILED_RETRYABLE',
            'APPLYING_CHANGE',
            'PREVIEW_DEPLOYING',
          ].includes(row.request.state)
        )
          throw new DomainError(
            'conflict_error',
            'Request is not ready to apply a revision.',
          );
        await database
          .update(schema.requests)
          .set({
            state: 'APPLYING_CHANGE',
            updatedAt: this.clock.now(),
            version: row.request.version + 1,
          })
          .where(eq(schema.requests.id, row.request.id));
        await database
          .update(schema.graphRuns)
          .set({
            currentNode: 'apply_revision',
            startedAt: row.graph.startedAt ?? this.clock.now(),
            status: 'running',
            updatedAt: this.clock.now(),
          })
          .where(eq(schema.graphRuns.id, row.graph.id));
        return { ...row, plan, prior };
      },
    );

    const priorBundle = await this.loadProjectBundleArtifact(
      context.prior.id,
      context.request,
    );
    const priorImage = await this.loadCoverImageArtifact(
      context.prior.id,
      context.request,
    );
    const projectInput = createProjectAstroInputSchema.parse(
      context.version.interpretedInput,
    );
    const publicationDate =
      projectInput.mode === 'revision'
        ? priorBundle.fecha
        : projectInput.mode === 'collect'
          ? priorBundle.fecha
          : (projectInput.fecha ??
            priorBundle.fecha ??
            new Date().toISOString().slice(0, 10));
    const recordExecutionStage = async (node: string): Promise<void> => {
      await withSystemTenantScope(
        this.database,
        { operation: 'project.apply_revision.stage', tenantId: signal.tenantId },
        async (database) => {
          await this.recordStage(database, context.graph.id, node);
        },
      );
    };

    let outcome: Readonly<{
      bundle: GeneratedProjectBundle;
      deployment: ProjectExecutionResult['deployment'];
      files: ProjectExecutionResult['files'];
      publication: ProjectExecutionResult['publication'];
    }>;
    try {
      const customizationSection = await loadCustomizationSection(
        this.database,
        {
          capabilityId: context.request.capabilityId,
          nodeId:
            context.plan.magnitude === 'full_regenerate'
              ? 'generate'
              : 'apply_revision',
          projectId: context.request.projectId,
          tenantId: signal.tenantId,
        },
      );
      if (context.plan.magnitude === 'full_regenerate') {
        outcome = await this.executor.regenerateFromPlan({
          priorBundle,
          priorImage,
          plan: context.plan,
          request: projectInput,
          manifest: context.manifest.document,
          requestId: context.request.id,
          onStage: recordExecutionStage,
          ...(customizationSection === undefined
            ? {}
            : { customizationSection }),
        });
      } else {
        outcome = await this.executor.applySurgicalRevision({
          priorBundle,
          priorImage,
          plan: context.plan,
          publicationDate,
          manifest: context.manifest.document,
          requestId: context.request.id,
          requestVersionId: context.version.id,
          onStage: recordExecutionStage,
          ...(typeof context.request.terminalResult === 'object' &&
          context.request.terminalResult !== null &&
          typeof (context.request.terminalResult as { headCommitSha?: unknown })
            .headCommitSha === 'string'
            ? {
                priorHeadCommitSha: (
                  context.request.terminalResult as { headCommitSha: string }
                ).headCommitSha,
              }
            : {}),
          ...(customizationSection === undefined
            ? {}
            : { customizationSection }),
        });
      }
    } catch (error) {
      await this.recordFailure(signal, context.graph.id, error);
      throw error;
    }

    const prefix = `${context.request.tenantId}/${context.request.projectId}/${context.request.id}/${context.version.id}`;
    for (const file of outcome.files) {
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
      { operation: 'project.apply_revision.persist', tenantId: signal.tenantId },
      async (database) => {
        const now = this.clock.now();
        for (const file of outcome.files) {
          await database.insert(schema.artifacts).values({
            bytes: file.bytes.byteLength,
            id: uuidv7(),
            kind: file.mime === 'image/jpeg' ? 'cover_image' : 'project_markdown',
            mime: file.mime,
            projectId: context.request.projectId,
            requestId: context.request.id,
            requestVersionId: context.version.id,
            sha256: file.sha256,
            storageKey: `${prefix}/${file.path.replaceAll('/', '_')}`,
            tenantId: context.request.tenantId,
          });
        }
        const bundleBytes = new TextEncoder().encode(
          JSON.stringify(outcome.bundle),
        );
        const bundleDigest = createHash('sha256')
          .update(bundleBytes)
          .digest('hex');
        const bundleKey = `${prefix}/project_bundle.json`;
        await this.artifacts.put({
          bytes: bundleBytes,
          key: bundleKey,
          mime: 'application/json',
          sha256: bundleDigest,
        });
        await database.insert(schema.artifacts).values({
          bytes: bundleBytes.byteLength,
          id: uuidv7(),
          kind: 'project_bundle',
          mime: 'application/json',
          projectId: context.request.projectId,
          requestId: context.request.id,
          requestVersionId: context.version.id,
          sha256: bundleDigest,
          storageKey: bundleKey,
          tenantId: context.request.tenantId,
        });
        const repoChangeId = uuidv7();
        await database.insert(schema.repoChanges).values({
          artifactHashes: Object.fromEntries(
            outcome.files.map((file) => [file.path, file.sha256]),
          ),
          baseSha: outcome.publication.baseCommitSha,
          branch: outcome.publication.branch,
          files: [...outcome.publication.files],
          headSha: outcome.publication.headCommitSha,
          id: repoChangeId,
          projectId: context.request.projectId,
          requestId: context.request.id,
          requestVersionId: context.version.id,
          tenantId: context.request.tenantId,
        });
        const [existingPull] = await database
          .select()
          .from(schema.pullRequests)
          .where(
            and(
              eq(schema.pullRequests.projectId, context.request.projectId),
              eq(
                schema.pullRequests.providerId,
                outcome.publication.pullRequestId,
              ),
            ),
          )
          .limit(1);
        if (existingPull === undefined) {
          await database.insert(schema.pullRequests).values({
            baseSha: outcome.publication.baseCommitSha,
            headSha: outcome.publication.headCommitSha,
            id: uuidv7(),
            projectId: context.request.projectId,
            providerId: outcome.publication.pullRequestId,
            repoChangeId,
            requestVersionId: context.version.id,
            state: 'open',
            tenantId: context.request.tenantId,
            url: outcome.publication.pullRequestUrl,
          });
        } else {
          await database
            .update(schema.pullRequests)
            .set({
              baseSha: outcome.publication.baseCommitSha,
              headSha: outcome.publication.headCommitSha,
              repoChangeId,
              requestVersionId: context.version.id,
              state: 'open',
              updatedAt: now,
              url: outcome.publication.pullRequestUrl,
            })
            .where(eq(schema.pullRequests.id, existingPull.id));
        }
        const [existingDeployment] = await database
          .select()
          .from(schema.deployments)
          .where(
            and(
              eq(
                schema.deployments.providerId,
                outcome.deployment.deploymentId,
              ),
              eq(
                schema.deployments.environment,
                outcome.deployment.environment,
              ),
            ),
          )
          .limit(1);
        if (existingDeployment === undefined) {
          await database.insert(schema.deployments).values({
            commitSha: outcome.deployment.sha,
            environment: outcome.deployment.environment,
            id: uuidv7(),
            projectId: context.request.projectId,
            providerId: outcome.deployment.deploymentId,
            readyAt: new Date(outcome.deployment.readyAt),
            requestVersionId: context.version.id,
            state: 'ready',
            tenantId: context.request.tenantId,
            urls: outcome.deployment.urls,
          });
        } else {
          await database
            .update(schema.deployments)
            .set({
              commitSha: outcome.deployment.sha,
              readyAt: new Date(outcome.deployment.readyAt),
              requestVersionId: context.version.id,
              state: 'ready',
              urls: outcome.deployment.urls,
            })
            .where(eq(schema.deployments.id, existingDeployment.id));
        }
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
        const [freshRequest] = await database
          .select({ version: schema.requests.version })
          .from(schema.requests)
          .where(eq(schema.requests.id, context.request.id))
          .limit(1);
        await database
          .update(schema.requests)
          .set({
            state: 'AWAITING_CLIENT_APPROVAL',
            terminalResult: {
              approvalStatus: 'awaiting_client',
              branch: outcome.publication.branch,
              bundleDigest,
              destacada: outcome.bundle.destacada,
              files: outcome.publication.files,
              headCommitSha: outcome.publication.headCommitSha,
              previewDeploymentId: outcome.deployment.deploymentId,
              previewUrls: outcome.deployment.urls,
              pullRequestUrl: outcome.publication.pullRequestUrl,
              slug: outcome.bundle.slug,
            },
            updatedAt: now,
            version: (freshRequest?.version ?? context.request.version) + 1,
          })
          .where(eq(schema.requests.id, context.request.id));
        await this.recordStage(
          database,
          context.graph.id,
          'awaiting_client_approval',
          {
            deploymentId: outcome.deployment.deploymentId,
            headSha: outcome.publication.headCommitSha,
            requestState: 'AWAITING_CLIENT_APPROVAL',
          },
        );
      },
    );
    return {
      actions,
      bundle: outcome.bundle,
      deployment: outcome.deployment,
      files: outcome.files,
      publication: outcome.publication,
    };
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
      { operation: 'project.publish.load', tenantId: signal.tenantId },
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
        const policy = decideProjectPublicationPolicy({
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
      { operation: 'project.publish.start', tenantId: signal.tenantId },
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
    let published: Awaited<ReturnType<ProjectExecutor['verifyProduction']>>;
    try {
      await withSystemTenantScope(
        this.database,
        { operation: 'project.publish.stage', tenantId: signal.tenantId },
        async (database) => {
          const [run] = await database
            .select()
            .from(schema.graphRuns)
            .where(eq(schema.graphRuns.requestVersionId, context.version.id))
            .limit(1);
          if (run !== undefined)
            await this.recordStage(database, run.id, 'merge_or_publish', {
              requestState: 'MERGING_OR_PUBLISHING',
            });
        },
      );
      const merged = await this.executor.mergeApprovedPreview({
        deploymentId: context.deployment.providerId,
        expectedFiles: context.repo.files,
        headCommitSha: context.repo.headSha,
        previewSha: context.deployment.commitSha,
        pullRequestId: context.pull.providerId,
      });
      await withSystemTenantScope(
        this.database,
        { operation: 'project.publish.record_merge', tenantId: signal.tenantId },
        async (database) => {
          const now = this.clock.now();
          await database
            .update(schema.pullRequests)
            .set({
              mergeCommitSha: merged.mergeCommitSha,
              state: 'merged',
              updatedAt: now,
            })
            .where(eq(schema.pullRequests.id, context.pull.id));
          await database
            .update(schema.publicationAttempts)
            .set({
              mergeCommitSha: merged.mergeCommitSha,
            })
            .where(eq(schema.publicationAttempts.id, attemptId));
        },
      );
      await withSystemTenantScope(
        this.database,
        { operation: 'project.publish.stage', tenantId: signal.tenantId },
        async (database) => {
          const [run] = await database
            .select()
            .from(schema.graphRuns)
            .where(eq(schema.graphRuns.requestVersionId, context.version.id))
            .limit(1);
          if (run !== undefined)
            await this.recordStage(database, run.id, 'verify_production', {
              requestState: 'VERIFYING_PRODUCTION',
            });
        },
      );
      published = await this.executor.verifyProduction({
        mergeCommitSha: merged.mergeCommitSha,
        routes,
      });
    } catch (error) {
      await withSystemTenantScope(
        this.database,
        { operation: 'project.publish.failure', tenantId: signal.tenantId },
        async (database) => {
          const retryable =
            error instanceof DomainError &&
            error.category === 'provider_retryable';
          const now = this.clock.now();
          const errorCategory =
            error instanceof DomainError ? error.category : 'internal_error';
          const errorMessage =
            error instanceof Error
              ? error.message
              : 'Publication failed without an error message.';
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
              completedAt: now,
              result: {
                errorCategory,
                errorMessage,
                failedNode,
              },
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
          if (run !== undefined) {
            await this.recordStage(
              database,
              run.id,
              'failed',
              {
                errorCategory,
                requestState: nextState,
              },
              { status: 'failed' },
            );
          }
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
      { operation: 'project.publish.complete', tenantId: signal.tenantId },
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
              errorCategory: undefined,
              errorMessage: undefined,
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
              status: 'completed',
              updatedAt: now,
            })
            .where(eq(schema.graphRuns.id, run.id));
          await this.recordStage(
            database,
            run.id,
            'completed',
            {
              mergeCommitSha: published.mergeCommitSha,
              requestState: 'COMPLETED',
            },
            { status: 'completed' },
          );
        }
        await this.enqueueAdminNotification(
          database,
          context.request,
          'request.published',
          `Request ${context.request.id} published. Open /requests/${context.request.id} in the dashboard.`,
          context.request.version + 2,
        );
      },
    );
    return {
      mergeCommitSha: published.mergeCommitSha,
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
      state: {
        requestState,
        ...extraState,
      },
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
      requestState === 'PREVIEW_DEPLOYING' ||
      requestState === 'APPLYING_CHANGE' ||
      requestState === 'GENERATING' ||
      requestState === 'AWAITING_CLIENT_APPROVAL'
    ) {
      const [version] = await database
        .select({ requestId: schema.requestVersions.requestId })
        .from(schema.requestVersions)
        .where(eq(schema.requestVersions.id, run.requestVersionId))
        .limit(1);
      if (version !== undefined) {
        await database
          .update(schema.requests)
          .set({
            state: requestState,
            updatedAt: this.clock.now(),
          })
          .where(eq(schema.requests.id, version.requestId));
      }
    }
    return sequence;
  }

  private async loadProjectBundleArtifact(
    requestVersionId: string,
    request: Pick<
      typeof schema.requests.$inferSelect,
      'id' | 'projectId' | 'tenantId'
    >,
  ): Promise<GeneratedProjectBundle> {
    const artifact = await withSystemTenantScope(
      this.database,
      { operation: 'project.load_bundle', tenantId: request.tenantId },
      async (database) => {
        let cursor: string | null = requestVersionId;
        const seen = new Set<string>();
        while (cursor !== null && !seen.has(cursor)) {
          seen.add(cursor);
          const [row] = await database
            .select()
            .from(schema.artifacts)
            .where(
              and(
                eq(schema.artifacts.requestVersionId, cursor),
                eq(schema.artifacts.kind, 'project_bundle'),
              ),
            )
            .limit(1);
          if (row !== undefined) return row;
          const [prior] = await database
            .select({ id: schema.requestVersions.id })
            .from(schema.requestVersions)
            .where(
              and(
                eq(schema.requestVersions.requestId, request.id),
                eq(schema.requestVersions.supersededById, cursor),
              ),
            )
            .limit(1);
          cursor = prior?.id ?? null;
        }
        throw new DomainError(
          'conflict_error',
          'Prior project bundle artifact is missing.',
        );
      },
    );
    const bytes = await this.artifacts.get(artifact.storageKey);
    return adaptedGeneratedProjectBundleSchema.parse(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
  }

  private async loadCoverImageArtifact(
    requestVersionId: string,
    request: Pick<
      typeof schema.requests.$inferSelect,
      'id' | 'projectId' | 'tenantId'
    >,
  ): Promise<Uint8Array> {
    const artifact = await withSystemTenantScope(
      this.database,
      { operation: 'project.load_cover', tenantId: request.tenantId },
      async (database) => {
        let cursor: string | null = requestVersionId;
        const seen = new Set<string>();
        while (cursor !== null && !seen.has(cursor)) {
          seen.add(cursor);
          const [row] = await database
            .select()
            .from(schema.artifacts)
            .where(
              and(
                eq(schema.artifacts.requestVersionId, cursor),
                eq(schema.artifacts.kind, 'cover_image'),
              ),
            )
            .limit(1);
          if (row !== undefined) return row;
          const [prior] = await database
            .select({ id: schema.requestVersions.id })
            .from(schema.requestVersions)
            .where(
              and(
                eq(schema.requestVersions.requestId, request.id),
                eq(schema.requestVersions.supersededById, cursor),
              ),
            )
            .limit(1);
          cursor = prior?.id ?? null;
        }
        throw new DomainError(
          'conflict_error',
          'Prior cover image artifact is missing.',
        );
      },
    );
    return this.artifacts.get(artifact.storageKey);
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
      error instanceof Error
        ? error.message
        : 'Execution failed without an error message.';
    const errorDetail =
      error instanceof DomainError
        ? typeof error.metadata.detail === 'string' &&
          error.metadata.detail.length > 0
          ? error.metadata.detail.slice(0, 500)
          : typeof error.metadata.cause === 'string' &&
              error.metadata.cause.length > 0
            ? error.metadata.cause.slice(0, 500)
            : undefined
        : undefined;
    await withSystemTenantScope(
      this.database,
      { operation: 'project.execute.failure', tenantId: signal.tenantId },
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
              ...(errorDetail === undefined ? {} : { errorDetail }),
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
}
