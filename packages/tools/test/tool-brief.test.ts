import { describe, expect, it } from 'vitest';

import { parseToolBriefYaml } from '../src/tool-brief.js';

describe('tool brief schema', () => {
  it('parses the delete_project dry-run brief', async () => {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const body = await readFile(
      join(import.meta.dirname, '../briefs/delete_project_astro.brief.yaml'),
      'utf8',
    );
    const brief = parseToolBriefYaml(body);
    expect(brief.identity.id).toBe('delete_project_astro');
    expect(brief.identity.mutationClass).toBe('destructive');
    expect(brief.nodes.length).toBeGreaterThan(5);
    expect(brief.edges.length).toBeGreaterThan(5);
  });
});
