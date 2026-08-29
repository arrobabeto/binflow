import type { CredentialSummary } from '@binflow/contracts';

export const allCredentialClients = 'all-clients';
export const platformCredentialClient = 'platform';

export type CredentialCatalogSort =
  | 'alias-asc'
  | 'alias-desc'
  | 'client-asc'
  | 'status-asc';

export const credentialCatalogSortOptions: readonly {
  label: string;
  value: CredentialCatalogSort;
}[] = [
  { label: 'Alias A–Z', value: 'alias-asc' },
  { label: 'Alias Z–A', value: 'alias-desc' },
  { label: 'Client A–Z', value: 'client-asc' },
  { label: 'Status A–Z', value: 'status-asc' },
];

export const credentialClientKey = (
  credential: Pick<CredentialSummary, 'bindingTenantKey'>,
): string => credential.bindingTenantKey ?? platformCredentialClient;

export const credentialClientLabel = (clientKey: string): string =>
  clientKey === platformCredentialClient
    ? 'Platform'
    : clientKey
        .split(/[-_]/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');

export const availableCredentialClients = (
  items: readonly Pick<CredentialSummary, 'bindingTenantKey'>[],
): string[] => {
  const keys = new Set<string>();
  for (const item of items) {
    keys.add(credentialClientKey(item));
  }
  return [...keys].sort((left, right) => {
    if (left === platformCredentialClient) return -1;
    if (right === platformCredentialClient) return 1;
    return left.localeCompare(right);
  });
};

export const filterCredentialCatalog = (
  items: readonly CredentialSummary[],
  input: Readonly<{
    client: string;
    query: string;
    sort: CredentialCatalogSort;
  }>,
): CredentialSummary[] => {
  const needle = input.query.trim().toLowerCase();
  const filtered = items.filter((item) => {
    if (
      input.client !== allCredentialClients &&
      credentialClientKey(item) !== input.client
    ) {
      return false;
    }
    if (needle.length === 0) return true;
    const haystack = [
      item.alias,
      item.kind,
      item.status,
      credentialClientKey(item),
      item.bindingProjectKey ?? '',
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });

  const sorted = [...filtered];
  sorted.sort((left, right) => {
    if (input.sort === 'alias-desc') {
      return right.alias.localeCompare(left.alias);
    }
    if (input.sort === 'client-asc') {
      const byClient = credentialClientKey(left).localeCompare(
        credentialClientKey(right),
      );
      if (byClient !== 0) return byClient;
      return left.alias.localeCompare(right.alias);
    }
    if (input.sort === 'status-asc') {
      const byStatus = left.status.localeCompare(right.status);
      if (byStatus !== 0) return byStatus;
      return left.alias.localeCompare(right.alias);
    }
    return left.alias.localeCompare(right.alias);
  });
  return sorted;
};
