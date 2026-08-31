import { describe, expect, it, vi } from 'vitest';

import { restoreOrbitypeTextPreview } from '../src/edit-text.js';

describe('orbitype text preview restore', () => {
  it('restores page sections via Orbitype port', async () => {
    const applySectionPatches = vi.fn(async () => undefined);
    await restoreOrbitypeTextPreview(
      {
        applySectionPatches,
        listPages: async () => [],
      },
      {
        pageId: 'page-1',
        sections: [{ title: { es: 'Antes' } }],
      },
    );
    expect(applySectionPatches).toHaveBeenCalledWith({
      patches: [
        { pageId: 'page-1', sections: [{ title: { es: 'Antes' } }] },
      ],
    });
  });
});
