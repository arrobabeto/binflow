import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { capabilityIdSchema } from '@binflow/contracts';
import { capabilityRegistry } from '@binflow/policies';
import {
  getTool,
  listTools,
  modelAllowlist,
  knownPredicates,
} from '@binflow/tools';

import { graphVersionForCapability } from '../src/capability-graph.js';
import {
  catalogScopeForRuntimeKind,
  listRegisteredExecutorIds,
  resolveCapabilityRuntime,
} from '../src/capability-runtimes.js';

const repoRoot = join(import.meta.dirname, '../../..');
const migrationsDir = join(repoRoot, 'packages/db/migrations');

const migrationSqlForCapability = async (
  capabilityId: string,
): Promise<string[]> => {
  const files = await readdir(migrationsDir);
  const matches: string[] = [];
  for (const file of files) {
    if (!file.endsWith('.sql')) continue;
    const body = await readFile(join(migrationsDir, file), 'utf8');
    if (body.includes(`'${capabilityId}'`)) matches.push(file);
  }
  return matches;
};

describe('capability conformance', () => {
  it('loads every catalog tool with matching graphVersion', async () => {
    const tools = await listTools();
    expect(tools.length).toBeGreaterThan(0);
    for (const loaded of tools) {
      expect(loaded.tool.graphVersion).toBe(loaded.graph.version);
      for (const edge of loaded.graph.edges) {
        if (edge.when !== undefined)
          expect(knownPredicates).toContain(edge.when);
      }
      for (const node of loaded.nodes) {
        if (node.kind === 'agent') {
          expect(node.workload).toBeDefined();
          expect(node.model).toBeDefined();
          if (node.workload === 'text') expect(node.effort).toBeDefined();
          expect(modelAllowlist[node.workload!]).toContain(node.model);
        }
      }
    }
  });

  it('registers every catalog tool in policies and contracts', async () => {
    const tools = await listTools();
    const registryIds = new Set(
      capabilityRegistry.map((definition) => definition.id),
    );
    const contractIds = capabilityIdSchema.options;
    for (const loaded of tools) {
      expect(registryIds.has(loaded.tool.id)).toBe(true);
      expect(contractIds).toContain(loaded.tool.id);
      const migrations = await migrationSqlForCapability(loaded.tool.id);
      expect(migrations.length).toBeGreaterThan(0);
      const definition = capabilityRegistry.find(
        (candidate) => candidate.id === loaded.tool.id,
      );
      expect(definition?.executorId).toBe(loaded.tool.executorId);
      expect(definition?.command).toBe(loaded.tool.command);
      expect(() =>
        resolveCapabilityRuntime(loaded.tool.id),
      ).not.toThrow();
      expect(listRegisteredExecutorIds()).toContain(definition!.executorId);
    }
  });

  it('resolves graph version from catalog instead of stale hardcodes', async () => {
    const tool = await getTool('create_project_astro');
    await expect(
      graphVersionForCapability('create_project_astro'),
    ).resolves.toBe(tool.tool.graphVersion);
    expect(tool.tool.graphVersion).toBe('stacks/astro-repo/create-project@4');
  });

  it('resolves delete_blog_draft graph via latest catalog version (not @1)', async () => {
    const tool = await getTool('delete_blog_draft');
    expect(tool.tool.version).toBeGreaterThanOrEqual(2);
    await expect(graphVersionForCapability('delete_blog_draft')).resolves.toBe(
      tool.tool.graphVersion,
    );
    await expect(
      graphVersionForCapability('delete_blog_draft', 1),
    ).rejects.toThrow(/delete_blog_draft@1/);
  });

  it('aliases legacy create_project_draft to astro catalog graph version', async () => {
    await expect(
      graphVersionForCapability('create_project_draft'),
    ).resolves.toBe(
      (await getTool('create_project_astro')).tool.graphVersion,
    );
  });

  it('fail-closes unknown executor ids in worker registry', () => {
    expect(() =>
      resolveCapabilityRuntime('create_blog_draft'),
    ).not.toThrow();
    expect(() =>
      resolveCapabilityRuntime('create_project_astro'),
    ).not.toThrow();
    expect(() =>
      resolveCapabilityRuntime('delete_blog_draft'),
    ).not.toThrow();
    expect(() =>
      resolveCapabilityRuntime('unknown_capability'),
    ).toThrow(/Unknown capability/);
  });

  it('requires catalogScope on catalog_sync nodes aligned with runtime kind', async () => {
    const tools = await listTools();
    for (const loaded of tools) {
      const catalogNodes = loaded.nodes.filter(
        (node) => node.id === 'catalog_sync',
      );
      if (catalogNodes.length === 0) continue;
      const runtime = resolveCapabilityRuntime(loaded.tool.id);
      const expectedScope = catalogScopeForRuntimeKind(runtime.kind);
      for (const node of catalogNodes) {
        expect(node.parameters?.catalogScope).toBe(expectedScope);
      }
    }
  });
});
