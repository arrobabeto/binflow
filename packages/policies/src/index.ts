import {
  capabilityCatalogItemSchema,
  createBlogDraftInputSchema,
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
  command: '/create_blog';
  displayName: 'Create blog';
  executorId: 'workflow.create_blog@1';
  id: 'create_blog_draft';
  inputSchema: typeof createBlogDraftInputSchema;
  requiredPermissions: readonly string[];
  requiresPreview: true;
  retryPolicy: Readonly<{
    maxAttempts: number;
    retryableErrors: readonly string[];
  }>;
  riskClass: 'medium';
  timeoutSeconds: number;
  version: 1;
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

export const capabilityRegistry = Object.freeze([
  createBlogDraftDefinition,
] as const);

export const webbinCapabilityBinding: CapabilityBinding = Object.freeze({
  access: 'client_publish',
  capabilityId: 'create_blog_draft',
  capabilityVersion: 1,
});

export const assertKnownBinding = (binding: CapabilityBinding): void => {
  if (
    binding.capabilityId !== createBlogDraftDefinition.id ||
    binding.capabilityVersion !== createBlogDraftDefinition.version ||
    binding.access !== 'client_publish'
  )
    throw new DomainError(
      'policy_denied',
      'Capability binding is not allowed by the Webbin pilot policy.',
      { code: 'capability_binding_not_allowed' },
    );
};

export const projectCapabilityCatalog = (
  bindings: readonly CapabilityBinding[],
): CapabilityCatalogItem[] => {
  const binding = bindings.find(
    (candidate) =>
      candidate.capabilityId === createBlogDraftDefinition.id &&
      candidate.capabilityVersion === createBlogDraftDefinition.version,
  );
  if (binding === undefined) return [];
  assertKnownBinding(binding);
  return [
    capabilityCatalogItemSchema.parse({
      access: binding.access,
      command: createBlogDraftDefinition.command,
      displayName: createBlogDraftDefinition.displayName,
      enabled: binding.access !== 'disabled',
      id: createBlogDraftDefinition.id,
      requiresPreview: true,
      riskClass: createBlogDraftDefinition.riskClass,
      version: createBlogDraftDefinition.version,
    }),
  ];
};

export type PublicationPolicyDecision = Readonly<{
  allowed: boolean;
  allowedPaths: readonly string[];
  effectiveRisk: 'medium';
  reasons: readonly string[];
  requiredApprovals: readonly ('client' | 'admin')[];
  requiresPreview: true;
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
