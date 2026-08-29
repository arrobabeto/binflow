import { describe, expect, it } from 'vitest';

import type { CredentialSummary } from '@binflow/contracts';

import {
  allCredentialClients,
  availableCredentialClients,
  credentialClientKey,
  filterCredentialCatalog,
  platformCredentialClient,
} from '../app/lib/credential-catalog-filter';

const credential = (
  overrides: Partial<CredentialSummary> &
    Pick<CredentialSummary, 'id' | 'alias' | 'bindingTenantKey' | 'status'>,
): CredentialSummary => ({
  bindingProjectKey: null,
  createdAt: '2026-08-18T00:00:00.000Z',
  kind: 'openai',
  maskedSuffix: 'abcd',
  ownerScope: overrides.bindingTenantKey === null ? 'platform' : 'tenant',
  projectId: null,
  revision: 1,
  tenantId: overrides.bindingTenantKey === null ? null : 'tenant-id',
  testedAt: null,
  usedAt: null,
  verifiedAt: null,
  version: 1,
  ...overrides,
});

describe('credential-catalog-filter', () => {
  const items = [
    credential({
      alias: 'Webbin v3',
      bindingTenantKey: 'webbin',
      id: 'c1',
      status: 'superseded',
    }),
    credential({
      alias: 'Webbin live',
      bindingTenantKey: 'webbin',
      id: 'c2',
      status: 'active',
    }),
    credential({
      alias: 'Admin bot',
      bindingTenantKey: null,
      id: 'c3',
      status: 'active',
    }),
  ];

  it('lists clients with platform first', () => {
    expect(availableCredentialClients(items)).toEqual([
      platformCredentialClient,
      'webbin',
    ]);
    expect(credentialClientKey(items[0] as CredentialSummary)).toBe('webbin');
  });

  it('filters by client and query', () => {
    expect(
      filterCredentialCatalog(items, {
        client: 'webbin',
        query: 'v3',
        sort: 'alias-asc',
      }).map((item) => item.alias),
    ).toEqual(['Webbin v3']);
    expect(
      filterCredentialCatalog(items, {
        client: platformCredentialClient,
        query: '',
        sort: 'alias-asc',
      }).map((item) => item.alias),
    ).toEqual(['Admin bot']);
  });

  it('sorts by status and keeps all-clients', () => {
    expect(
      filterCredentialCatalog(items, {
        client: allCredentialClients,
        query: '',
        sort: 'status-asc',
      }).map((item) => item.status),
    ).toEqual(['active', 'active', 'superseded']);
  });
});
