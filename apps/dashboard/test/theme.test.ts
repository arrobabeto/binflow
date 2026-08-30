import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const stylesheet = new URL('../app/assets/css/main.css', import.meta.url);

describe('dashboard theme', () => {
  it('defines dark control-plane tokens and semantic UI aliases', async () => {
    const css = await readFile(stylesheet, 'utf8');

    expect(css).toContain('--binflow-canvas: #0b0c10;');
    expect(css).toContain('--binflow-surface: #13161f;');
    expect(css).toContain('--binflow-primary: #3b82f6;');
    expect(css).toContain('--binflow-accent: #22d3ee;');
    expect(css).toContain('--ui-primary: var(--ui-color-primary-500);');
    expect(css).toContain('--ui-success: var(--ui-color-success-500);');
    expect(css).toContain('--ui-error: var(--ui-color-error-500);');
    expect(css).toContain('.binflow-sidebar');
    expect(css).toContain('.tool-graph-panel');
  });
});
