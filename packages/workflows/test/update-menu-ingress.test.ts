import { describe, expect, it } from 'vitest';

import { updateMenuActionLabels } from '../src/update-menu-ingress.js';

describe('update menu ingress copy', () => {
  it('uses publish-menu labels instead of create-draft wording', () => {
    for (const locale of ['es', 'en', 'de'] as const) {
      expect(updateMenuActionLabels[locale].confirmPlan.toLowerCase()).not.toMatch(
        /borrador|draft|entwurf/u,
      );
    }
  });
});
