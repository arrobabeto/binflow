import type { ToolCatalogItem } from '@binflow/contracts';

export const allToolStacks = 'all-stacks';

export type ToolCatalogSort = 'name-asc' | 'name-desc' | 'stack-asc';

export const toolCatalogSortOptions: readonly {
  label: string;
  value: ToolCatalogSort;
}[] = [
  { label: 'Name A–Z', value: 'name-asc' },
  { label: 'Name Z–A', value: 'name-desc' },
  { label: 'Stack A–Z', value: 'stack-asc' },
];

const matchesQuery = (item: ToolCatalogItem, query: string): boolean => {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  return (
    item.displayName.toLowerCase().includes(needle) ||
    item.id.toLowerCase().includes(needle) ||
    item.command.toLowerCase().includes(needle) ||
    item.stack.toLowerCase().includes(needle)
  );
};

export const availableToolStacks = (
  items: readonly ToolCatalogItem[],
): string[] =>
  [...new Set(items.map((item) => item.stack))].sort((left, right) =>
    left.localeCompare(right),
  );

export const filterToolCatalog = (
  items: readonly ToolCatalogItem[],
  input: Readonly<{
    query: string;
    sort: ToolCatalogSort;
    stack: string;
  }>,
): ToolCatalogItem[] => {
  const filtered = items.filter((item) => {
    if (input.stack !== allToolStacks && item.stack !== input.stack) {
      return false;
    }
    return matchesQuery(item, input.query);
  });

  const sorted = [...filtered];
  sorted.sort((left, right) => {
    if (input.sort === 'name-desc') {
      return right.displayName.localeCompare(left.displayName);
    }
    if (input.sort === 'stack-asc') {
      const byStack = left.stack.localeCompare(right.stack);
      if (byStack !== 0) return byStack;
      return left.displayName.localeCompare(right.displayName);
    }
    return left.displayName.localeCompare(right.displayName);
  });
  return sorted;
};

export const groupToolsByStack = (
  items: readonly ToolCatalogItem[],
): [string, ToolCatalogItem[]][] => {
  const groups = new Map<string, ToolCatalogItem[]>();
  for (const item of items) {
    const current = groups.get(item.stack) ?? [];
    current.push(item);
    groups.set(item.stack, current);
  }
  return [...groups.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
};
