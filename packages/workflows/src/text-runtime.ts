import { createHash, randomBytes } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { ArtifactStore } from '@binflow/artifacts';
import {
  editTextInputSchema,
  workflowResumeSignalSchema,
  type WorkflowResumeSignal,
} from '@binflow/contracts';
import {
  EditTextExecutor,
  resolveTextEditCandidate,
  restoreOrbitypeTextPreview,
  type OrbitypeTextPagesPort,
  type TextEditPatchArtifact,
} from '@binflow/text';
import {
  schema,
  withSystemTenantScope,
  type Database,
  type ScopedDatabase,
} from '@binflow/db';
import { DomainError, type Clock, systemClock } from '@binflow/domain';

import { resolveEditTextProductionOrigin } from './edit-text-ingress.js';

const digest = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const APPROVAL_TTL_MS = 72 * 60 * 60 * 1_000;

export type TextPreviewActions = Readonly<{
  approve: string;
  cancel: string;
}>;

const stageRequestState = (node: string): string => {
  switch (node) {
    case 'sync_editable_copy':
    case 'validate_text_edit':
    case 'render_text_patch':
    case 'open_text_edit_pr':
      return 'GENERATING';
    case 'wait_preview':
      return 'PREVIEW_DEPLOYING';
    case 'apply_orbitype_preview':
      return 'GENERATING';
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

export class TextWorkflowRuntime {
  public constructor(
    private readonly database: Database,
    private readonly artifacts: ArtifactStore,
    private readonly executor: EditTextExecutor,
    private readonly orbitype: OrbitypeTextPagesPort,
    private readonly clock: Clock = systemClock,
  ) {}

  public async execute(raw: WorkflowResumeSignal): Promise<
    Readonly<{
      actions: TextPreviewActions;
      result: Readonly<{
        deployment: Awaited<
          ReturnType<EditTextExecutor['preparePreview']>
        >['deployment'];
        patch: TextEditPatchArtifact;
        publication: Awaited<
          ReturnType<EditTextExecutor['preparePreview']>
        >['publication'];
      }>;
    }>
  > {
    const signal = workflowResumeSignalSchema.parse(raw);
    const context = await withSystemTenantScope(
      this.database,
      { operation: 'edit_text.execute.load', tenantId: signal.tenantId },
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
            'Edit text workflow context is missing.',
          );
        if (
          !['QUEUED', 'FAILED_RETRYABLE', 'GENERATING'].includes(
            row.request.state,
          ) ||
          row.version.confirmedAt === null
        )
          throw new DomainError(
            'conflict_error',
            'Edit text request is not executable.',
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

    const parsedInput = editTextInputSchema.parse(
      context.version.interpretedInput,
    );
    if (parsedInput.mode !== 'execute')
      throw new DomainError(
        'validation_error',
        'Edit text execute input is required.',
      );

    const pages = await this.orbitype.listPages();
    const candidate = resolveTextEditCandidate(
      pages,
      context.manifest.document.contentLocales,
      parsedInput.targetKey,
    );
    if (candidate === null)
      throw new DomainError(
        'validation_error',
        'Text edit target is no longer available.',
        { code: 'text_target_not_found' },
      );

    const actions: TextPreviewActions = Object.freeze({
      approve: randomBytes(24).toString('base64url'),
      cancel: randomBytes(24).toString('base64url'),
    });

    let preview: Awaited<ReturnType<EditTextExecutor['preparePreview']>>;
    const graphRunId = context.graph.id;
    const recordExecutionStage = async (node: string): Promise<void> => {
      await withSystemTenantScope(
        this.database,
        { operation: 'edit_text.execute.stage', tenantId: signal.tenantId },
        async (database) => {
          await this.recordStage(database, graphRunId, node);
        },
      );
    };
    try {
      preview = await this.executor.preparePreview({
        candidate,
        defaultBranchRef:
          context.manifest.document.repository.productionBranch,
        manifest: context.manifest.document,
        newValue: parsedInput.newValue,
        onStage: recordExecutionStage,
        orbitype: this.orbitype,
        productionOrigin: resolveEditTextProductionOrigin(
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
      { operation: 'edit_text.execute.persist', tenantId: signal.tenantId },
      async (database) => {
        const now = this.clock.now();
        const prefix = `${context.request.tenantId}/${context.request.projectId}/${context.request.id}/${context.version.id}`;
        const patchBytes = new TextEncoder().encode(
          JSON.stringify(preview.patch),
        );
        const patchDigest = createHash('sha256').update(patchBytes).digest('hex');
        const patchKey = `${prefix}/text_edit_patch.json`;
        await this.artifacts.put({
          bytes: patchBytes,
          key: patchKey,
          mime: 'application/json',
          sha256: patchDigest,
        });
        await database.insert(schema.artifacts).values({
          bytes: patchBytes.byteLength,
          id: uuidv7(),
          kind: 'text_edit_patch',
          mime: 'application/json',
          projectId: context.request.projectId,
          requestId: context.request.id,
          requestVersionId: context.version.id,
          sha256: patchDigest,
          storageKey: patchKey,
          tenantId: context.request.tenantId,
        });
        const repoChangeId = uuidv7();
        await database.insert(schema.repoChanges).values({
          artifactHashes: Object.fromEntries(
            preview.publication.files.map((path) => [path, patchDigest]),
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
              branch: preview.publication.branch,
              files: preview.publication.files,
              headCommitSha: preview.publication.headCommitSha,
              patchDigest,
              previewDeploymentId: preview.deployment.deploymentId,
              previewRoute: preview.patch.previewRoute,
              previewUrls: preview.deployment.urls,
              pullRequestUrl: preview.publication.pullRequestUrl,
              targetKey: parsedInput.targetKey,
            },
            updatedAt: now,
            version: context.request.version + 2,
          })
          .where(eq(schema.requests.id, context.request.id));
        await this.recordStage(database, context.graph.id, 'awaiting_client_approval', {
          deploymentId: preview.deployment.deploymentId,
          headSha: preview.publication.headCommitSha,
          requestState: 'AWAITING_CLIENT_APPROVAL',
        });
      },
    );

    return {
      actions,
      result: {
        deployment: preview.deployment,
        patch: preview.patch,
        publication: preview.publication,
      },
    };
  }

  public async restorePreview(raw: WorkflowResumeSignal): Promise<void> {
    const signal = workflowResumeSignalSchema.parse(raw);
    const context = await withSystemTenantScope(
      this.database,
      {
        operation: 'edit_text.restore_preview.load',
        tenantId: signal.tenantId,
      },
      async (database) => {
        const [row] = await database
          .select({
            artifact: schema.artifacts,
            request: schema.requests,
          })
          .from(schema.requests)
          .innerJoin(
            schema.artifacts,
            and(
              eq(schema.artifacts.requestVersionId, signal.requestVersionId),
              eq(schema.artifacts.kind, 'text_edit_patch'),
            ),
          )
          .where(eq(schema.requests.id, signal.requestId))
          .limit(1);
        return row;
      },
    );
    if (context === undefined) return;

    const patchObject = await this.artifacts.get(context.artifact.storageKey);
    if (patchObject === undefined) return;
    const patch = JSON.parse(
      new TextDecoder().decode(patchObject),
    ) as TextEditPatchArtifact;
    const preview = patch.orbitypePreview;
    if (preview === undefined || preview.restored === true) return;
    if (preview.applied !== true) return;

    try {
      await restoreOrbitypeTextPreview(this.orbitype, preview.restore);
    } catch (error) {
      await withSystemTenantScope(
        this.database,
        {
          operation: 'edit_text.restore_preview.fail',
          tenantId: signal.tenantId,
        },
        async (database) => {
          const terminal =
            context.request.terminalResult !== null &&
            typeof context.request.terminalResult === 'object' &&
            !Array.isArray(context.request.terminalResult)
              ? (context.request.terminalResult as Record<string, unknown>)
              : {};
          await database
            .update(schema.requests)
            .set({
              terminalResult: {
                ...terminal,
                orbitypeRestoreFailed: true,
                orbitypeRestoreError:
                  error instanceof Error ? error.message : 'restore failed',
              },
              updatedAt: this.clock.now(),
              version: context.request.version + 1,
            })
            .where(eq(schema.requests.id, context.request.id));
        },
      );
      return;
    }

    const restoredPatch: TextEditPatchArtifact = {
      ...patch,
      orbitypePreview: { ...preview, restored: true },
    };
    const restoredBytes = new TextEncoder().encode(
      JSON.stringify(restoredPatch),
    );
    const restoredDigest = createHash('sha256')
      .update(restoredBytes)
      .digest('hex');
    await this.artifacts.put({
      bytes: restoredBytes,
      key: context.artifact.storageKey,
      mime: 'application/json',
      sha256: restoredDigest,
    });
    await withSystemTenantScope(
      this.database,
      {
        operation: 'edit_text.restore_preview.persist',
        tenantId: signal.tenantId,
      },
      async (database) => {
        const terminal =
          context.request.terminalResult !== null &&
          typeof context.request.terminalResult === 'object' &&
          !Array.isArray(context.request.terminalResult)
            ? (context.request.terminalResult as Record<string, unknown>)
            : {};
        await database
          .update(schema.artifacts)
          .set({
            bytes: restoredBytes.byteLength,
            sha256: restoredDigest,
          })
          .where(eq(schema.artifacts.id, context.artifact.id));
        await database
          .update(schema.requests)
          .set({
            terminalResult: {
              ...terminal,
              orbitypePreviewRestored: true,
            },
            updatedAt: this.clock.now(),
            version: context.request.version + 1,
          })
          .where(eq(schema.requests.id, context.request.id));
      },
    );
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
      { operation: 'edit_text.publish.load', tenantId: signal.tenantId },
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
              eq(schema.artifacts.kind, 'text_edit_patch'),
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
            'Edit text request is not approved for publication.',
          );
        const [manifestRow] = await database
          .select({ document: schema.projectManifestVersions.document })
          .from(schema.projectManifestVersions)
          .where(eq(schema.projectManifestVersions.id, row.version.manifestVersionId))
          .limit(1);
        if (manifestRow === undefined)
          throw new DomainError(
            'validation_error',
            'Edit text manifest context is missing.',
          );
        return { ...row, manifest: manifestRow.document };
      },
    );

    const patchObject = await this.artifacts.get(context.artifact.storageKey);
    if (patchObject === undefined)
      throw new DomainError(
        'validation_error',
        'Text edit patch artifact is missing.',
      );
    const patch = JSON.parse(
      new TextDecoder().decode(patchObject),
    ) as TextEditPatchArtifact;

    const graphRunId = await withSystemTenantScope(
      this.database,
      { operation: 'edit_text.publish.graph', tenantId: signal.tenantId },
      async (database) => {
        const [graph] = await database
          .select()
          .from(schema.graphRuns)
          .where(eq(schema.graphRuns.requestVersionId, signal.requestVersionId))
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

    let published: Awaited<ReturnType<EditTextExecutor['publish']>>;
    const recordPublishStage = async (node: string): Promise<void> => {
      await withSystemTenantScope(
        this.database,
        { operation: 'edit_text.publish.stage', tenantId: signal.tenantId },
        async (database) => {
          await this.recordStage(database, graphRunId, node);
        },
      );
    };
    try {
      published = await this.executor.publish({
        expectedHeadSha: context.repo.headSha,
        manifest: context.manifest,
        onStage: recordPublishStage,
        orbitype: this.orbitype,
        patch,
        productionOrigin: resolveEditTextProductionOrigin(context.manifest),
        pullRequestId: context.pull.providerId,
      });
    } catch (error) {
      await this.recordFailure(signal, graphRunId, error);
      throw error;
    }

    await withSystemTenantScope(
      this.database,
      { operation: 'edit_text.publish.persist', tenantId: signal.tenantId },
      async (database) => {
        await database
          .update(schema.pullRequests)
          .set({
            mergeCommitSha: published.mergeCommitSha,
            state: 'merged',
          })
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
      { operation: 'edit_text.fail', tenantId: signal.tenantId },
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
                  : 'Edit text failed without an error message.',
              failureCode:
                error instanceof DomainError
                  ? String(error.metadata.code ?? '')
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
