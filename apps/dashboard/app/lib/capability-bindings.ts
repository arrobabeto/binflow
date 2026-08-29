import type {
  CapabilityBinding,
  CapabilityCatalogResponse,
  ToolCatalogResponse,
} from '@binflow/contracts';

export const capabilityKey = (id: string, version: number): string =>
  `${id}@${version}`;

export const enabledCapabilityKeys = (
  catalog: CapabilityCatalogResponse | null | undefined,
): Set<string> =>
  new Set(
    (catalog?.items ?? [])
      .filter((item) => item.enabled)
      .map((item) => capabilityKey(item.id, item.version)),
  );

export const buildCapabilityBindings = (
  tools: ToolCatalogResponse['items'],
  enabledKeys: ReadonlySet<string>,
): CapabilityBinding[] =>
  tools
    .filter((tool) => enabledKeys.has(capabilityKey(tool.id, tool.version)))
    .map((tool) => ({
      access: 'client_publish' as const,
      capabilityId: tool.id,
      capabilityVersion: tool.version,
    }));
