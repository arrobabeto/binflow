import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const stylesheet = new URL('../app/assets/css/main.css', import.meta.url);

describe('dashboard theme', () => {
  it('maps solid semantic actions to generated palette tokens', async () => {
    const css = await readFile(stylesheet, 'utf8');

    expect(css).toContain('--ui-primary: var(--ui-color-primary-600);');
    expect(css).toContain('--ui-secondary: var(--ui-color-secondary-600);');
    expect(css).toContain('--ui-success: var(--ui-color-success-600);');
    expect(css).toContain('--ui-info: var(--ui-color-info-600);');
    expect(css).toContain('--ui-warning: var(--ui-color-warning-700);');
    expect(css).toContain('--ui-error: var(--ui-color-error-600);');
    expect(css).not.toContain('--ui-color-emerald-600');
  });
});
