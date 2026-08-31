import { createHash } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { ArtifactStore } from '@binflow/artifacts';
import {
  updateMenuInputSchema,
  workflowResumeSignalSchema,
  type WorkflowResumeSignal,
} from '@binflow/contracts';
import {
  UpdateMenuExecutor,
  type OrbitypeMenuPagesPort,
  type UpdateMenuExecutionResult,
} from '@binflow/menu';
import type { RepositoryPublicationPort } from '@binflow/blog';
import {
  schema,
  withSystemTenantScope,
  type Database,
  type ScopedDatabase,
} from '@binflow/db';
import { DomainError, type Clock, systemClock } from '@binflow/domain';
import { loadCustomizationSection } from '@binflow/tools';

import {
  parseMenuCtaKeywordSection,
  resolveUpdateMenuProductionOrigin,
} from './update-menu-ingress.js';

const stageRequestState = (node: string): string => {
  switch (node) {
    case 'sync_pages':
    case 'validate_menu_update':
    case 'render_menu_artifacts':
    case 'open_menu_update_pr':
    case 'apply_orbitype_draft':
    case 'merge_github':
    case 'publish_orbitype_pages':
      return 'GENERATING';
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

export class MenuWorkflowRuntime {
  public constructor(
    private readonly database: Database,
    private readonly artifacts: ArtifactStore,
    private readonly executor: UpdateMenuExecutor,
    private readonly orbitype: OrbitypeMenuPagesPort,
    private readonly clock: Clock = systemClock,
  ) {}

  public async execute(raw: WorkflowResumeSignal): Promise<
    Readonly<{
      result: UpdateMenuExecutionResult;
    }>
  > {
    const signal = workflowResumeSignalSchema.parse(raw);
    const context = await withSystemTenantScope(
      this.database,
      { operation: 'update_menu.execute.load', tenantId: signal.tenantId },
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
            'Update menu workflow context is missing.',
          );
        if (
          !['QUEUED', 'FAILED_RETRYABLE', 'GENERATING'].includes(
            row.request.state,
          ) ||
          row.version.confirmedAt === null
        )
          throw new DomainError(
            'conflict_error',
            'Update menu request is not executable.',
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
            currentNode: 'sync_pages',
            startedAt: this.clock.now(),
            status: 'running',
          })
          .where(eq(schema.graphRuns.id, row.graph.id));
        return row;
      },
    );

    const parsedInput = updateMenuInputSchema.parse(
      context.version.interpretedInput,
    );
    if (parsedInput.mode !== 'execute')
      throw new DomainError(
        'validation_error',
        'Update menu execute input is required.',
      );
    const pdfObject = await this.artifacts.get(parsedInput.pdfArtifactKey);
    if (pdfObject === undefined)
      throw new DomainError(
        'validation_error',
        'Menu PDF artifact is missing.',
        { code: 'pdf_missing' },
      );

    let result: UpdateMenuExecutionResult;
    const graphRunId = context.graph.id;
    const recordExecutionStage = async (node: string): Promise<void> => {
      await withSystemTenantScope(
        this.database,
        { operation: 'update_menu.execute.stage', tenantId: signal.tenantId },
        async (database) => {
          await this.recordStage(database, graphRunId, node);
        },
      );
    };
    try {
      const keywordSection = await loadCustomizationSection(this.database, {
        capabilityId: 'update_menu',
        nodeId: 'menu_cta_keywords',
        projectId: context.request.projectId,
        tenantId: context.request.tenantId,
      });
      result = await this.executor.execute({
        extraMenuCtaKeywords: parseMenuCtaKeywordSection(keywordSection),
        input: parsedInput,
        manifest: context.manifest.document,
        onStage: recordExecutionStage,
        orbitype: this.orbitype,
        pdfBytes: pdfObject,
        productionOrigin: resolveUpdateMenuProductionOrigin(
          context.manifest.document,
        ),
        requestId: context.request.id,
        requestVersionId: context.version.id,
      });
    } catch (error) {
      await this.recordFailure(signal, context.graph.id, error);
      throw error;
    }

    await withSystemTenantScope(
      this.database,
      { operation: 'update_menu.execute.persist', tenantId: signal.tenantId },
      async (database) => {
        const now = this.clock.now();
        const prefix = `${context.request.tenantId}/${context.request.projectId}/${context.request.id}/${context.version.id}`;
        const planBytes = new TextEncoder().encode(
          JSON.stringify({
            menuPdfPublicPath: result.menuPdfPublicPath,
            menuPdfPublicUrl: result.menuPdfPublicUrl,
            selectedCtaCount: result.selectedCtaCount,
            updatedPageSlugs: result.updatedPageSlugs,
          }),
        );
        const planDigest = createHash('sha256').update(planBytes).digest('hex');
        const planKey = `${prefix}/menu_update_plan.json`;
        await this.artifacts.put({
          bytes: planBytes,
          key: planKey,
          mime: 'application/json',
          sha256: planDigest,
        });
        await database.insert(schema.artifacts).values({
          bytes: planBytes.byteLength,
          id: uuidv7(),
          kind: 'menu_update_plan',
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
          artifactHashes: {
            [result.menuPdfPublicPath]: planDigest,
          },
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
          mergeCommitSha: result.mergeCommitSha,
          projectId: context.request.projectId,
          providerId: result.publication.pullRequestId,
          repoChangeId,
          requestVersionId: context.version.id,
          state: 'merged',
          tenantId: context.request.tenantId,
          url: result.publication.pullRequestUrl,
        });
        await database
          .update(schema.requests)
          .set({
            state: 'COMPLETED',
            terminalResult: {
              menuPdfPublicUrl: result.menuPdfPublicUrl,
              mergeCommitSha: result.mergeCommitSha,
              selectedCtaCount: result.selectedCtaCount,
              updatedPageSlugs: result.updatedPageSlugs,
            },
            updatedAt: now,
            version: context.request.version + 2,
          })
          .where(eq(schema.requests.id, context.request.id));
        await this.recordStage(database, context.graph.id, 'completed', {
          requestState: 'COMPLETED',
        });
      },
    );
    return { result };
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
      { operation: 'update_menu.execute.fail', tenantId: signal.tenantId },
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
                  : 'Update menu failed without an error message.',
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
