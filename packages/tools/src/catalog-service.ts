import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { and, desc, eq, inArray } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import {
  toolAssignmentsResponseSchema,
  toolCatalogResponseSchema,
  toolCustomizationDetailSchema,
  toolCustomizationSummarySchema,
  toolGraphResponseSchema,
  type ToolAssignmentsResponse,
  type ToolCatalogResponse,
  type ToolCustomizationDetail,
  type ToolCustomizationSummary,
  type ToolGraphResponse,
  type UploadToolCustomizationInput,
} from '@binflow/contracts';
import {
  schema,
  withPlatformOwnerScope,
  type Database,
} from '@binflow/db';
import { DomainError, type Clock, systemClock } from '@binflow/domain';
import {
  getTool,
  listTools,
  validateCustomizationDocument,
} from './load.js';
import { validateAndParseContentSchemaSection } from './content-schema.js';

const digest = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

export class ToolCatalogService {
  public constructor(
    private readonly database: Database,
    private readonly clock: Clock = systemClock,
  ) {}

  public async listCatalog(): Promise<ToolCatalogResponse> {
    const tools = await listTools();
    const items = await Promise.all(
      tools.map(async (tool) => {
        const assigned = await withPlatformOwnerScope(
          this.database,
          {
            actorId: 'system',
            correlationId: 'tool-catalog',
            reason: 'Count tool assignments',
          },
          async (database) =>
            database
              .select({ id: schema.projectCapabilityBindings.id })
              .from(schema.projectCapabilityBindings)
              .where(
                and(
                  eq(
                    schema.projectCapabilityBindings.capabilityId,
                    tool.tool.id,
                  ),
                  eq(
                    schema.projectCapabilityBindings.capabilityVersion,
                    tool.tool.version,
                  ),
                ),
              ),
        );
        return {
          assignedClientCount: assigned.length,
          command: tool.tool.command,
          displayName: tool.tool.displayName,
          graphVersion: tool.tool.graphVersion,
          id: tool.tool.id,
          nodeCount: tool.nodes.length,
          profile: tool.tool.profile,
          requiresPreview: tool.tool.requiresPreview,
          riskClass: tool.tool.riskClass,
          stack: tool.stack,
          version: tool.tool.version,
        };
      }),
    );
    return toolCatalogResponseSchema.parse({ items });
  }

  public async listAssignments(
    capabilityId: string,
  ): Promise<ToolAssignmentsResponse> {
    await getTool(capabilityId);
    const rows = await withPlatformOwnerScope(
      this.database,
      {
        actorId: 'system',
        correlationId: 'tool-assignments',
        reason: 'List tool assignments',
      },
      async (database) =>
        database
          .select({
            access: schema.projectCapabilityBindings.access,
            enrollmentId: schema.clientEnrollments.id,
            manifestVersion: schema.projectManifestVersions.version,
            projectId: schema.projectCapabilityBindings.projectId,
            projectKey: schema.projects.key,
            tenantKey: schema.tenants.key,
          })
          .from(schema.projectCapabilityBindings)
          .innerJoin(
            schema.projectManifestVersions,
            eq(
              schema.projectCapabilityBindings.manifestVersionId,
              schema.projectManifestVersions.id,
            ),
          )
          .innerJoin(
            schema.clientEnrollments,
            eq(
              schema.clientEnrollments.projectId,
              schema.projectManifestVersions.projectId,
            ),
          )
          .innerJoin(
            schema.projects,
            eq(schema.projects.id, schema.clientEnrollments.projectId),
          )
          .innerJoin(
            schema.tenants,
            eq(schema.tenants.id, schema.clientEnrollments.tenantId),
          )
          .where(
            and(
              eq(schema.projectCapabilityBindings.capabilityId, capabilityId),
              inArray(schema.projectManifestVersions.status, [
                'validated',
                'active',
              ]),
            ),
          )
          .orderBy(desc(schema.projectManifestVersions.version)),
    );

    const latestByProject = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const existing = latestByProject.get(row.projectId);
      if (
        existing === undefined ||
        row.manifestVersion > existing.manifestVersion
      )
        latestByProject.set(row.projectId, row);
    }

    return toolAssignmentsResponseSchema.parse({
      items: [...latestByProject.values()].map((row) => ({
        access: row.access,
        enrollmentId: row.enrollmentId,
        manifestVersion: row.manifestVersion,
        projectId: row.projectId,
        projectKey: row.projectKey,
        tenantKey: row.tenantKey,
      })),
    });
  }

  public async getGraph(capabilityId: string): Promise<ToolGraphResponse> {
    const tool = await getTool(capabilityId);
    return toolGraphResponseSchema.parse({
      customizationTemplate: tool.customizationTemplate,
      edges: tool.graph.edges,
      fingerprint: tool.fingerprint,
      graphVersion: tool.graph.version,
      nodes: tool.nodes.map((node) => ({
        acceptsClientCustomization: node.acceptsClientCustomization,
        ...(node.effort === undefined ? {} : { effort: node.effort }),
        id: node.id,
        kind: node.kind,
        label: node.label,
        ...(node.model === undefined ? {} : { model: node.model }),
        nodeKind: node.nodeKind,
        rulesMarkdown: node.rulesMarkdown,
        ...(node.workload === undefined ? {} : { workload: node.workload }),
      })),
      tool: {
        command: tool.tool.command,
        displayName: tool.tool.displayName,
        graphVersion: tool.tool.graphVersion,
        id: tool.tool.id,
        nodeCount: tool.nodes.length,
        profile: tool.tool.profile,
        requiresPreview: tool.tool.requiresPreview,
        riskClass: tool.tool.riskClass,
        stack: tool.stack,
        version: tool.tool.version,
      },
    });
  }

  public async getTemplate(capabilityId: string): Promise<string> {
    const tool = await getTool(capabilityId);
    return tool.customizationTemplate;
  }

  public async getCurrentCustomization(
    projectId: string,
    capabilityId: string,
    actorId: string,
    correlationId: string,
  ): Promise<ToolCustomizationDetail | null> {
    return withPlatformOwnerScope(
      this.database,
      {
        actorId,
        correlationId,
        reason: 'Read tool customization',
      },
      async (database) => {
        const [row] = await database
          .select()
          .from(schema.projectToolCustomizations)
          .where(
            and(
              eq(schema.projectToolCustomizations.projectId, projectId),
              eq(schema.projectToolCustomizations.capabilityId, capabilityId),
            ),
          )
          .orderBy(desc(schema.projectToolCustomizations.version))
          .limit(1);
        if (row === undefined) return null;
        return toolCustomizationDetailSchema.parse({
          body: row.body,
          capabilityId: row.capabilityId,
          createdAt: row.createdAt.toISOString(),
          createdBy: row.createdBy,
          id: row.id,
          projectId: row.projectId,
          sha256: row.sha256,
          version: row.version,
        });
      },
    );
  }

  public async uploadCustomization(
    input: UploadToolCustomizationInput,
    context: Readonly<{
      actorId: string;
      correlationId: string;
      tenantId: string;
    }>,
  ): Promise<ToolCustomizationSummary> {
    const tool = await getTool(input.capabilityId);
    validateCustomizationDocument(tool.customizationTemplate, input.body);
    const sha256 = digest(input.body);
    return withPlatformOwnerScope(
      this.database,
      {
        actorId: context.actorId,
        correlationId: context.correlationId,
        reason: 'Upload tool customization',
      },
      async (database) => {
        const [latest] = await database
          .select()
          .from(schema.projectToolCustomizations)
          .where(
            and(
              eq(schema.projectToolCustomizations.projectId, input.projectId),
              eq(
                schema.projectToolCustomizations.capabilityId,
                input.capabilityId,
              ),
            ),
          )
          .orderBy(desc(schema.projectToolCustomizations.version))
          .limit(1);
        const now = this.clock.now();
        const version = (latest?.version ?? 0) + 1;
        const id = uuidv7();
        await database.insert(schema.projectToolCustomizations).values({
          body: input.body,
          capabilityId: input.capabilityId,
          createdBy: context.actorId,
          id,
          projectId: input.projectId,
          sha256,
          tenantId: context.tenantId,
          version,
        });
        return toolCustomizationSummarySchema.parse({
          capabilityId: input.capabilityId,
          createdAt: now.toISOString(),
          createdBy: context.actorId,
          id,
          projectId: input.projectId,
          sha256,
          version,
        });
      },
    );
  }
}

export const loadCustomizationSection = async (
  database: Database,
  input: Readonly<{
    capabilityId: string;
    nodeId: string;
    projectId: string;
    tenantId: string;
  }>,
): Promise<string | undefined> => {
  const tool = await getTool(input.capabilityId);
  const [row] = await withPlatformOwnerScope(
    database,
    {
      actorId: 'system',
      correlationId: 'load-customization',
      reason: 'Load frozen customization for generation',
    },
    async (scoped) =>
      scoped
        .select()
        .from(schema.projectToolCustomizations)
        .where(
          and(
            eq(schema.projectToolCustomizations.projectId, input.projectId),
            eq(
              schema.projectToolCustomizations.capabilityId,
              input.capabilityId,
            ),
          ),
        )
        .orderBy(desc(schema.projectToolCustomizations.version))
        .limit(1),
  );
  const body =
    row?.body ??
    (input.capabilityId === 'create_blog_draft'
      ? await readFile(
          join(tool.toolPath, 'customizations', 'webbin.md'),
          'utf8',
        ).catch(() => undefined)
      : undefined);
  if (body === undefined) return undefined;
  try {
    const sections = validateCustomizationDocument(
      tool.customizationTemplate,
      body,
    );
    return sections[input.nodeId];
  } catch (error) {
    if (error instanceof DomainError) throw error;
    return undefined;
  }
};

export const loadProjectContentSchema = async (
  database: Database,
  input: Readonly<{
    capabilityId: string;
    projectId: string;
    tenantId: string;
  }>,
): Promise<
  import('./content-schema.js').ContentSchemaDocument
> => {
  const tool = await getTool(input.capabilityId);
  const [row] = await withPlatformOwnerScope(
    database,
    {
      actorId: 'system',
      correlationId: 'load-content-schema',
      reason: 'Load content_schema for project collection',
    },
    async (scoped) =>
      scoped
        .select()
        .from(schema.projectToolCustomizations)
        .where(
          and(
            eq(schema.projectToolCustomizations.projectId, input.projectId),
            eq(
              schema.projectToolCustomizations.capabilityId,
              input.capabilityId,
            ),
          ),
        )
        .orderBy(desc(schema.projectToolCustomizations.version))
        .limit(1),
  );
  if (row?.body === undefined) return { fields: [] };
  try {
    const sections = validateCustomizationDocument(
      tool.customizationTemplate,
      row.body,
    );
    return validateAndParseContentSchemaSection(sections.content_schema);
  } catch (error) {
    if (error instanceof DomainError) throw error;
    return { fields: [] };
  }
};
