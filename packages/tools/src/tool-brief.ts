import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

import {
  knownPredicates,
  nodeKinds,
  workloads,
} from './load.js';

const toolBriefContentSchemaFieldSchema = z
  .object({
    ask: z.string().trim().min(1).max(500).optional(),
    default: z.union([z.string(), z.boolean(), z.number()]).optional(),
    id: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,63}$/u),
    max: z.number().int().min(1).max(10_000).optional(),
    maxItems: z.number().int().min(1).max(50).optional(),
    min: z.number().int().min(0).max(10_000).optional(),
    minItems: z.number().int().min(0).max(50).optional(),
    required: z.boolean().default(true),
    type: z.enum([
      'string',
      'boolean',
      'date',
      'yearMonth',
      'url',
      'enum',
      'stringList',
      'image',
    ]),
    values: z.array(z.string().trim().min(1).max(80)).min(1).max(32).optional(),
  })
  .strict();

export const mutationClassSchema = z.enum([
  'create',
  'update',
  'destructive',
  'read_only',
]);

export const toolBriefIdentitySchema = z
  .object({
    approvalPolicyId: z.string().trim().min(1).max(120),
    command: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(2_000),
    displayName: z.string().trim().min(1).max(120),
    executorId: z.string().trim().min(1).max(120),
    graphVersionSuffix: z
      .string()
      .trim()
      .regex(/^@[0-9]+$/u, 'Use @N suffix, e.g. @1'),
    id: z.string().trim().min(1).max(80),
    mutationClass: mutationClassSchema,
    profile: z.string().trim().min(1).max(80),
    requiresPreview: z.boolean(),
    riskClass: z.enum(['low', 'medium', 'high']),
    stack: z.string().trim().min(1).max(80),
    toolDir: z.string().trim().min(1).max(80),
    version: z.number().int().positive(),
  })
  .strict();

export const toolBriefGraphNodeSchema = z
  .object({
    acceptsClientCustomization: z.boolean().default(false),
    actor: z.enum(['client', 'admin']).optional(),
    effort: z.enum(['low', 'medium', 'high']).optional(),
    id: z.string().trim().min(1).max(80),
    kind: z.enum(nodeKinds),
    label: z.string().trim().min(1).max(160),
    model: z.string().trim().min(1).max(80).optional(),
    nodeKind: z.string().trim().min(1).max(120),
    permissions: z.array(z.string().trim().min(1).max(80)).optional(),
    rulesRef: z.string().trim().min(1).max(160).optional(),
    sortPrefix: z.string().trim().regex(/^\d+$/u),
    ttlHours: z.number().int().positive().optional(),
    workload: z.enum(workloads).optional(),
  })
  .strict();

export const toolBriefGraphEdgeSchema = z
  .object({
    from: z.string().trim().min(1).max(80),
    to: z.string().trim().min(1).max(80),
    when: z.enum(knownPredicates).optional(),
  })
  .strict();

export const toolBriefLayerAssignmentSchema = z
  .object({
    behavior: z.string().trim().min(1).max(500),
    customization: z.string().trim().max(1_000).optional(),
    layer: z.enum(['code', 'manifest', 'customization']),
  })
  .strict();

export const toolBriefVerificationSchema = z
  .object({
    fixtures: z.array(z.string().trim().min(1).max(200)).default([]),
    scenarios: z.array(z.string().trim().min(1).max(500)).min(1),
  })
  .strict();

export const toolBriefDocumentSchema = z
  .object({
    contentSchemaFields: z
      .array(toolBriefContentSchemaFieldSchema)
      .max(40)
      .default([]),
    customizableNodeIds: z.array(z.string().trim().min(1).max(80)).default([]),
    edges: z.array(toolBriefGraphEdgeSchema).min(1),
    identity: toolBriefIdentitySchema,
    layerAssignments: z.array(toolBriefLayerAssignmentSchema).default([]),
    migration: z
      .object({
        allowedProfiles: z.array(z.string().trim().min(1).max(80)).min(1),
        budget: z
          .object({
            maxEstimatedCostCents: z.number().int().positive(),
            maxModelCalls: z.number().int().positive(),
            maxTokens: z.number().int().positive(),
          })
          .strict(),
        inputSchemaId: z.string().trim().min(1).max(120),
        outputSchemaId: z.string().trim().min(1).max(120),
        requiredPermissions: z.array(z.string().trim().min(1).max(80)).min(1),
        retryPolicy: z
          .object({
            maxAttempts: z.number().int().positive(),
            retryableErrors: z.array(z.string().trim().min(1).max(80)).min(1),
          })
          .strict(),
        timeoutSeconds: z.number().int().positive(),
      })
      .strict(),
    nodes: z.array(toolBriefGraphNodeSchema).min(1),
    specTitle: z.string().trim().min(1).max(160),
    typedErrors: z
      .array(
        z
          .object({
            code: z.string().trim().min(1).max(80),
            when: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .default([]),
    verification: toolBriefVerificationSchema,
  })
  .strict()
  .superRefine((document, ctx) => {
    const nodeIds = new Set(document.nodes.map((node) => node.id));
    for (const edge of document.edges) {
      if (!nodeIds.has(edge.from))
        ctx.addIssue({
          code: 'custom',
          message: `Unknown edge source ${edge.from}.`,
          path: ['edges'],
        });
      if (!nodeIds.has(edge.to))
        ctx.addIssue({
          code: 'custom',
          message: `Unknown edge target ${edge.to}.`,
          path: ['edges'],
        });
    }
    for (const nodeId of document.customizableNodeIds) {
      if (!nodeIds.has(nodeId))
        ctx.addIssue({
          code: 'custom',
          message: `Unknown customizable node ${nodeId}.`,
          path: ['customizableNodeIds'],
        });
    }
  });

export type ToolBriefDocument = z.infer<typeof toolBriefDocumentSchema>;

export const parseToolBriefYaml = (body: string): ToolBriefDocument => {
  const parsed = parseYaml(body);
  return toolBriefDocumentSchema.parse(parsed);
};

export const serializeToolBriefYaml = (document: ToolBriefDocument): string =>
  stringifyYaml(document);
