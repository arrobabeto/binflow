import { describe, expect, it } from 'vitest';

import type { ToolCatalogItem } from '@binflow/contracts';

import {
  allToolStacks,
  availableToolStacks,
  filterToolCatalog,
  groupToolsByStack,
} from '../app/lib/tool-catalog-filter';

const tool = (
  overrides: Partial<ToolCatalogItem> &
    Pick<ToolCatalogItem, 'id' | 'displayName' | 'stack'>,
): ToolCatalogItem => ({
  assignedClientCount: 0,
  command: overrides.id,
  graphVersion: '1',
  nodeCount: 3,
  profile: overrides.stack,
  requiresPreview: true,
  riskClass: 'medium',
  version: 1,
  ...overrides,
});

describe('tool-catalog-filter', () => {
  const items = [
    tool({ displayName: 'Create blog', id: 'create_blog', stack: 'astro_repo' }),
    tool({
      displayName: 'Delete blog',
      id: 'delete_blog',
      stack: 'astro_repo',
    }),
    tool({
      displayName: 'Alpha other',
      id: 'alpha_other',
      stack: 'other_stack',
    }),
  ];

  it('lists available stacks', () => {
    expect(availableToolStacks(items)).toEqual(['astro_repo', 'other_stack']);
  });

  it('filters by query and stack', () => {
    expect(
      filterToolCatalog(items, {
        query: 'delete',
        sort: 'name-asc',
        stack: allToolStacks,
      }).map((item) => item.id),
    ).toEqual(['delete_blog']);
    expect(
      filterToolCatalog(items, {
        query: '',
        sort: 'name-asc',
        stack: 'other_stack',
      }).map((item) => item.id),
    ).toEqual(['alpha_other']);
  });

  it('sorts and groups by stack', () => {
    const sorted = filterToolCatalog(items, {
      query: '',
      sort: 'name-desc',
      stack: allToolStacks,
    });
    expect(sorted.map((item) => item.displayName)).toEqual([
      'Delete blog',
      'Create blog',
      'Alpha other',
    ]);
    expect(groupToolsByStack(sorted).map(([stack]) => stack)).toEqual([
      'astro_repo',
      'other_stack',
    ]);
  });
});
