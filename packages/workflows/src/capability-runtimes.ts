import { capabilityRegistry } from '@binflow/policies';
import { DomainError } from '@binflow/domain';

export type CapabilityRuntimeKind = 'blog' | 'delete_blog' | 'delete_project' | 'project';

export type CatalogContentScope = 'blog' | 'portfolio';

export type ResolvedCapabilityRuntime = Readonly<{
  consumerPrefix: CapabilityRuntimeKind;
  executorId: string;
  kind: CapabilityRuntimeKind;
  titleField: 'descriptor' | 'resolvedTitle' | 'titulo';
}>;

/**
 * Declares which GitHub content trees a capability may sync. Shared catalog
 * ports must never default to both; ADR-0042.
 */
export const catalogScopeForRuntimeKind = (
  kind: CapabilityRuntimeKind,
): CatalogContentScope => {
  switch (kind) {
    case 'blog':
    case 'delete_blog':
      return 'blog';
    case 'project':
    case 'delete_project':
      return 'portfolio';
  }
};

export const catalogContentKindsForRuntimeKind = (
  kind: CapabilityRuntimeKind,
): readonly CatalogContentScope[] => [catalogScopeForRuntimeKind(kind)];

const runtimeByExecutorId = Object.freeze({
  'workflow.create_blog@1': Object.freeze({
    consumerPrefix: 'blog',
    kind: 'blog',
    titleField: 'titulo',
  }),
  'workflow.create_blog_orbitype@1': Object.freeze({
    consumerPrefix: 'blog',
    kind: 'blog',
    titleField: 'titulo',
  }),
  'workflow.create_project@1': Object.freeze({
    consumerPrefix: 'project',
    kind: 'project',
    titleField: 'descriptor',
  }),
  'workflow.delete_blog@1': Object.freeze({
    consumerPrefix: 'delete_blog',
    kind: 'delete_blog',
    titleField: 'resolvedTitle',
  }),
  'workflow.delete_project@1': Object.freeze({
    consumerPrefix: 'delete_project',
    kind: 'delete_project',
    titleField: 'resolvedTitle',
  }),
} as const satisfies Record<
  string,
  Readonly<{
    consumerPrefix: CapabilityRuntimeKind;
    kind: CapabilityRuntimeKind;
    titleField: 'descriptor' | 'resolvedTitle' | 'titulo';
  }>
>);

const resolveCapabilityDefinition = (capabilityId: string) => {
  const direct = capabilityRegistry.find(
    (candidate) => candidate.id === capabilityId,
  );
  if (direct !== undefined) return direct;
  if (capabilityId === 'create_project_draft')
    return capabilityRegistry.find(
      (candidate) => candidate.id === 'create_project_astro',
    );
  return undefined;
};

export const resolveCapabilityRuntime = (
  capabilityId: string,
): ResolvedCapabilityRuntime => {
  const definition = resolveCapabilityDefinition(capabilityId);
  if (definition === undefined)
    throw new DomainError(
      'validation_error',
      `Unknown capability ${capabilityId}.`,
      { code: 'unknown_capability' },
    );
  const runtime =
    runtimeByExecutorId[
      definition.executorId as keyof typeof runtimeByExecutorId
    ];
  if (runtime === undefined)
    throw new DomainError(
      'validation_error',
      `No runtime registry entry for executor ${definition.executorId}.`,
      { code: 'unknown_executor' },
    );
  return Object.freeze({
    ...runtime,
    executorId: definition.executorId,
  });
};

export const listRegisteredExecutorIds = (): readonly string[] =>
  Object.freeze(Object.keys(runtimeByExecutorId));

export const resolveBundleTitle = (
  runtime: ResolvedCapabilityRuntime,
  bundle: Readonly<{
    es: Readonly<{ descriptor?: string; titulo?: string }>;
    resolvedTitle?: string;
  }>,
): string => {
  if (runtime.titleField === 'descriptor')
    return bundle.es.descriptor ?? '—';
  if (runtime.titleField === 'resolvedTitle')
    return bundle.resolvedTitle ?? bundle.es.titulo ?? '—';
  return bundle.es.titulo ?? '—';
};
