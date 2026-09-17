import { describe, expect, it } from 'vitest';

import {
  buildEditTextShopifyTargetNotFoundMessage,
  editTextShopifyActionLabels,
  editTextShopifyGuidance,
  editTextShopifyStyleTargetMissMessage,
  editTextShopifyTargetNotFoundMessage,
  parseEditTextShopifyExecuteInput,
} from '../src/edit-text-shopify-ingress.js';
import { settingIdFromLocator } from '@binflow/text';

describe('edit-text-shopify', () => {
  it('exposes Astro-like guidance without bf_id or deep search CTAs', () => {
    expect(editTextShopifyGuidance.en).toContain('current text');
    expect(editTextShopifyGuidance.en).not.toContain('bf_id');
    expect(editTextShopifyTargetNotFoundMessage.en).toContain('longer excerpt');
    expect(editTextShopifyStyleTargetMissMessage.en).toContain('style heading');
    expect(editTextShopifyActionLabels.en.confirmPlan).toBe('Publish text');
    expect(
      'deepSearch' in editTextShopifyActionLabels.en,
    ).toBe(false);
  });

  it('mentions non-home catalog areas on copy miss', () => {
    expect(
      buildEditTextShopifyTargetNotFoundMessage('en', ['home', 'story', 'bio']),
    ).toContain('Catalog also includes: bio, story');
    expect(
      buildEditTextShopifyTargetNotFoundMessage('en', ['home']),
    ).toBe(editTextShopifyTargetNotFoundMessage.en);
  });

  it('parses collect → execute input with setting locator', () => {
    const execute = parseEditTextShopifyExecuteInput('proj_1', {
      collectionStep: 'ready',
      contentLocale: 'en',
      mode: 'collect',
      newValue: 'Hello again',
      projectId: 'proj_1',
      targetKey: 'home.intro.heading',
      discoveredTargets: [
        {
          currentValue: 'Welcome',
          field: 'heading',
          key: 'home.intro.heading',
          label: 'Welcome',
          locale: 'en',
          pageId: 'home',
          pageSlug: 'home',
          pageTitle: 'Home',
          sectionIndex: 0,
        },
      ],
    });
    expect(execute.mode).toBe('execute');
    expect(execute.targetKey).toBe('home.intro.heading');
    expect(execute.newValue).toBe('Hello again');
    expect(settingIdFromLocator('settings.heading')).toBe('heading');
  });
});
