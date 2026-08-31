import {
  capabilityCatalogItemSchema,
  createBlogDraftInputSchema,
  createBlogOrbitypeInputSchema,
  createProjectAstroInputSchema,
  deleteBlogDraftInputSchema,
  deleteProjectAstroInputSchema,
  editTextInputSchema,
  updateMenuInputSchema,
  type CapabilityBinding,
  type CapabilityCatalogItem,
} from '@binflow/contracts';
import { DomainError } from '@binflow/domain';

export type CapabilityDefinition = Readonly<{
  approvalPolicyId: string;
  budget: Readonly<{
    maxEstimatedCostCents: number;
    maxModelCalls: number;
    maxTokens: number;
  }>;
  command: string;
  displayName: string;
  executorId: string;
  id: string;
  inputSchema:
    | typeof createBlogDraftInputSchema
    | typeof createBlogOrbitypeInputSchema
    | typeof createProjectAstroInputSchema
    | typeof deleteBlogDraftInputSchema
    | typeof deleteProjectAstroInputSchema
    | typeof editTextInputSchema
    | typeof updateMenuInputSchema;
  requiredPermissions: readonly string[];
  requiresPreview: boolean;
  retryPolicy: Readonly<{
    maxAttempts: number;
    retryableErrors: readonly string[];
  }>;
  riskClass: 'low' | 'medium' | 'high';
  timeoutSeconds: number;
  version: number;
}>;

export const createBlogDraftDefinition: CapabilityDefinition = Object.freeze({
  approvalPolicyId: 'webbin-blog-publication@1',
  budget: Object.freeze({
    maxEstimatedCostCents: 500,
    maxModelCalls: 12,
    maxTokens: 120_000,
  }),
  command: '/create_blog',
  displayName: 'Create blog',
  executorId: 'workflow.create_blog@1',
  id: 'create_blog_draft',
  inputSchema: createBlogDraftInputSchema,
  requiredPermissions: Object.freeze([
    'github:metadata:read',
    'github:contents:write',
    'github:pull_requests:write',
    'github:checks:read',
    'github:statuses:read',
    'vercel:deployments:read',
  ]),
  requiresPreview: true,
  retryPolicy: Object.freeze({
    maxAttempts: 3,
    retryableErrors: Object.freeze([
      'provider_retryable',
      'deployment_pending',
    ]),
  }),
  riskClass: 'medium',
  timeoutSeconds: 1_800,
  version: 1,
});

export const createBlogOrbitypeDefinition: CapabilityDefinition = Object.freeze({
  approvalPolicyId: 'astro-orbitype-blog-publication@1',
  budget: Object.freeze({
    maxEstimatedCostCents: 500,
    maxModelCalls: 12,
    maxTokens: 120_000,
  }),
  command: '/create_blog',
  displayName: 'Create blog',
  executorId: 'workflow.create_blog_orbitype@1',
  id: 'create_blog_orbitype',
  inputSchema: createBlogOrbitypeInputSchema,
  requiredPermissions: Object.freeze([
    'github:metadata:read',
    'github:contents:write',
    'github:pull_requests:write',
    'github:checks:read',
    'github:statuses:read',
    'vercel:deployments:read',
    'orbitype:content:write',
  ]),
  requiresPreview: true,
  retryPolicy: Object.freeze({
    maxAttempts: 3,
    retryableErrors: Object.freeze([
      'provider_retryable',
      'deployment_pending',
    ]),
  }),
  riskClass: 'medium',
  timeoutSeconds: 1_800,
  version: 1,
});

export const createProjectAstroDefinition: CapabilityDefinition = Object.freeze({
  approvalPolicyId: 'webbin-project-publication@1',
  budget: Object.freeze({
    maxEstimatedCostCents: 500,
    maxModelCalls: 12,
    maxTokens: 120_000,
  }),
  command: '/create_project',
  displayName: 'Create portfolio project',
  executorId: 'workflow.create_project@1',
  id: 'create_project_astro',
  inputSchema: createProjectAstroInputSchema,
  requiredPermissions: Object.freeze([
    'github:metadata:read',
    'github:contents:write',
    'github:pull_requests:write',
    'github:checks:read',
    'github:statuses:read',
    'vercel:deployments:read',
  ]),
  requiresPreview: true,
  retryPolicy: Object.freeze({
    maxAttempts: 3,
    retryableErrors: Object.freeze([
      'provider_retryable',
      'deployment_pending',
    ]),
  }),
  riskClass: 'medium',
  timeoutSeconds: 1_800,
  version: 1,
});

export const deleteProjectAstroDefinition: CapabilityDefinition = Object.freeze({
  approvalPolicyId: 'webbin-project-deletion@1',
  budget: Object.freeze({
    maxEstimatedCostCents: 200,
    maxModelCalls: 1,
    maxTokens: 1_000,
  }),
  command: '/delete_project',
  displayName: 'Delete portfolio project',
  executorId: 'workflow.delete_project@1',
  id: 'delete_project_astro',
  inputSchema: deleteProjectAstroInputSchema,
  requiredPermissions: Object.freeze([
    'github:metadata:read',
    'github:contents:write',
    'github:pull_requests:write',
    'github:checks:read',
    'github:statuses:read',
    'vercel:deployments:read',
  ]),
  requiresPreview: false,
  retryPolicy: Object.freeze({
    maxAttempts: 3,
    retryableErrors: Object.freeze([
      'provider_retryable',
      'deployment_pending',
    ]),
  }),
  riskClass: 'high',
  timeoutSeconds: 1_800,
  version: 2,
});

export const deleteBlogDraftDefinition: CapabilityDefinition = Object.freeze({
  approvalPolicyId: 'webbin-blog-deletion@1',
  budget: Object.freeze({
    maxEstimatedCostCents: 200,
    maxModelCalls: 1,
    maxTokens: 1_000,
  }),
  command: '/delete_blog',
  displayName: 'Delete blog post',
  executorId: 'workflow.delete_blog@1',
  id: 'delete_blog_draft',
  inputSchema: deleteBlogDraftInputSchema,
  requiredPermissions: Object.freeze([
    'github:metadata:read',
    'github:contents:write',
    'github:pull_requests:write',
    'github:checks:read',
    'github:statuses:read',
    'vercel:deployments:read',
  ]),
  requiresPreview: false,
  retryPolicy: Object.freeze({
    maxAttempts: 3,
    retryableErrors: Object.freeze([
      'provider_retryable',
      'deployment_pending',
    ]),
  }),
  riskClass: 'high',
  timeoutSeconds: 1_800,
  version: 2,
});

export const editTextDefinition: CapabilityDefinition = Object.freeze({
  approvalPolicyId: 'astro-orbitype-text-edit@1',
  budget: Object.freeze({
    maxEstimatedCostCents: 50,
    maxModelCalls: 1,
    maxTokens: 1_000,
  }),
  command: '/edit_text',
  displayName: 'Edit page text',
  executorId: 'workflow.edit_text@1',
  id: 'edit_text',
  inputSchema: editTextInputSchema,
  requiredPermissions: Object.freeze([
    'github:metadata:read',
    'github:contents:write',
    'github:pull_requests:write',
    'github:checks:read',
    'github:statuses:read',
    'vercel:deployments:read',
    'orbitype:content:read',
    'orbitype:content:write',
  ]),
  requiresPreview: true,
  retryPolicy: Object.freeze({
    maxAttempts: 3,
    retryableErrors: Object.freeze([
      'provider_retryable',
      'deployment_pending',
    ]),
  }),
  riskClass: 'medium',
  timeoutSeconds: 1_800,
  version: 1,
});

export const updateMenuDefinition: CapabilityDefinition = Object.freeze({
  approvalPolicyId: 'astro-orbitype-menu-update@1',
  budget: Object.freeze({
    maxEstimatedCostCents: 50,
    maxModelCalls: 1,
    maxTokens: 1_000,
  }),
  command: '/update_menu',
  displayName: 'Update menu',
  executorId: 'workflow.update_menu@1',
  id: 'update_menu',
  inputSchema: updateMenuInputSchema,
  requiredPermissions: Object.freeze([
    'github:metadata:read',
    'github:contents:write',
    'github:pull_requests:write',
    'github:checks:read',
    'github:statuses:read',
    'vercel:deployments:read',
    'orbitype:content:read',
    'orbitype:content:write',
  ]),
  requiresPreview: false,
  retryPolicy: Object.freeze({
    maxAttempts: 3,
    retryableErrors: Object.freeze([
      'provider_retryable',
      'deployment_pending',
    ]),
  }),
  riskClass: 'medium',
  timeoutSeconds: 1_800,
  version: 1,
});

/** @deprecated Use createProjectAstroDefinition */
export const createProjectDraftDefinition = createProjectAstroDefinition;

export const capabilityRegistry = Object.freeze([
  createBlogDraftDefinition,
  createBlogOrbitypeDefinition,
  createProjectAstroDefinition,
  deleteBlogDraftDefinition,
  deleteProjectAstroDefinition,
  editTextDefinition,
  updateMenuDefinition,
] as const);

export const webbinCapabilityBinding: CapabilityBinding = Object.freeze({
  access: 'client_publish',
  capabilityId: 'create_blog_draft',
  capabilityVersion: 1,
});

export const webbinProjectCapabilityBinding: CapabilityBinding = Object.freeze({
  access: 'client_publish',
  capabilityId: 'create_project_astro',
  capabilityVersion: 1,
});

export const webbinDeleteBlogCapabilityBinding: CapabilityBinding = Object.freeze({
  access: 'client_publish',
  capabilityId: 'delete_blog_draft',
  capabilityVersion: 2,
});

export const webbinDeleteProjectCapabilityBinding: CapabilityBinding =
  Object.freeze({
    access: 'client_publish',
    capabilityId: 'delete_project_astro',
    capabilityVersion: 2,
  });

export const astroRepoDefaultCapabilityBindings: readonly CapabilityBinding[] =
  Object.freeze([
    webbinCapabilityBinding,
    webbinProjectCapabilityBinding,
    webbinDeleteBlogCapabilityBinding,
    webbinDeleteProjectCapabilityBinding,
  ]);

export const resolveProjectCapabilityBindings = (
  configuration: Readonly<{
    enabledCapabilities?: readonly CapabilityBinding[] | undefined;
  }>,
  options: Readonly<{ allowEmpty?: boolean }> = {},
): readonly CapabilityBinding[] => {
  if (configuration.enabledCapabilities !== undefined) {
    if (configuration.enabledCapabilities.length === 0) {
      if (options.allowEmpty === true) return [];
      throw new DomainError(
        'policy_denied',
        'At least one capability must remain enabled.',
        { code: 'capability_catalog_empty' },
      );
    }
    for (const binding of configuration.enabledCapabilities) {
      assertKnownBinding(binding);
      if (binding.access === 'disabled')
        throw new DomainError(
          'validation_error',
          'Use the assignment API to disable a tool; do not send access disabled.',
          { code: 'capability_binding_disabled' },
        );
    }
    return configuration.enabledCapabilities;
  }
  if (options.allowEmpty === true) return [];
  return astroRepoDefaultCapabilityBindings;
};

const accessValues = new Set([
  'disabled',
  'client_publish',
  'admin_required',
  'admin_only',
]);

export const assertKnownBinding = (binding: CapabilityBinding): void => {
  const definition = capabilityRegistry.find(
    (candidate) =>
      candidate.id === binding.capabilityId &&
      candidate.version === binding.capabilityVersion,
  );
  if (definition === undefined || !accessValues.has(binding.access))
    throw new DomainError(
      'policy_denied',
      'Capability binding is not allowed by the code-owned registry.',
      { code: 'capability_binding_not_allowed' },
    );
};

export const projectCapabilityCatalog = (
  bindings: readonly CapabilityBinding[],
): CapabilityCatalogItem[] => {
  const items: CapabilityCatalogItem[] = [];
  for (const binding of bindings) {
    assertKnownBinding(binding);
    const definition = capabilityRegistry.find(
      (candidate) =>
        candidate.id === binding.capabilityId &&
        candidate.version === binding.capabilityVersion,
    );
    if (definition === undefined) continue;
    items.push(
      capabilityCatalogItemSchema.parse({
        access: binding.access,
        command: definition.command,
        displayName: definition.displayName,
        enabled: binding.access !== 'disabled',
        id: definition.id,
        requiresPreview: definition.requiresPreview,
        riskClass: definition.riskClass,
        version: definition.version,
      }),
    );
  }
  return items;
};

export type PublicationPolicyDecision = Readonly<{
  allowed: boolean;
  allowedPaths: readonly string[];
  effectiveRisk: 'medium';
  reasons: readonly string[];
  requiredApprovals: readonly ('client' | 'admin')[];
  requiresPreview: boolean;
}>;

export const decideBlogPublicationPolicy = (
  input: Readonly<{
    categoryKind: 'existing' | 'likely_typo' | 'new';
    editablePaths: readonly string[];
  }>,
): PublicationPolicyDecision => ({
  allowed: true,
  allowedPaths: [...input.editablePaths],
  effectiveRisk: 'medium',
  reasons:
    input.categoryKind === 'new'
      ? ['New category requires platform-owner approval.']
      : ['Existing or normalized category requires client approval.'],
  requiredApprovals:
    input.categoryKind === 'new' ? ['client', 'admin'] : ['client'],
  requiresPreview: true,
});

export const decideBlogDeletionPolicy = (
  input: Readonly<{
    editablePaths: readonly string[];
  }>,
): PublicationPolicyDecision => ({
  allowed: true,
  allowedPaths: [...input.editablePaths],
  effectiveRisk: 'medium',
  reasons: ['Blog deletion requires admin-only approval.'],
  requiredApprovals: ['admin'],
  requiresPreview: false,
});

export const decideProjectDeletionPolicy = (
  input: Readonly<{
    editablePaths: readonly string[];
  }>,
): PublicationPolicyDecision => ({
  allowed: true,
  allowedPaths: [...input.editablePaths],
  effectiveRisk: 'medium',
  reasons: ['Portfolio project deletion requires admin-only approval.'],
  requiredApprovals: ['admin'],
  requiresPreview: false,
});

export const decideProjectPublicationPolicy = (
  input: Readonly<{
    editablePaths: readonly string[];
  }>,
): PublicationPolicyDecision => ({
  allowed: true,
  allowedPaths: [...input.editablePaths],
  effectiveRisk: 'medium',
  reasons: ['Portfolio publication requires client approval.'],
  requiredApprovals: ['client'],
  requiresPreview: true,
});

export const decideTextEditPublicationPolicy = (
  input: Readonly<{
    editablePaths: readonly string[];
  }>,
): PublicationPolicyDecision => ({
  allowed: true,
  allowedPaths: [...input.editablePaths],
  effectiveRisk: 'medium',
  reasons: [
    'Literal page text edits require client preview approval and admin publication approval.',
  ],
  requiredApprovals: ['client', 'admin'],
  requiresPreview: true,
});
