import { describe, expect, it } from 'vitest';

import {
  enrichInventoryCopyRows,
  enrichInventoryStyleHints,
  patchLiquidSchemaDefault,
  readLiquidSchemaDefault,
} from '../src/edit-theme-text.js';
import {
  inventoryRowToTextEditCandidate,
  matchesInventoryStyleHint,
  parseSurfaceInventoryCopy,
  pickInventoryCopyDisplayValue,
  searchInventoryCopy,
  settingIdFromLocator,
} from '../src/surface-inventory-copy.js';

const sampleInventory = `
version: 1
surfaces:
  - bf_id: home.intro.heading
    kind: copy
    area: home
    section: intro
    path: sections/home-intro.liquid
    locator: settings.heading
    publication_target: github_theme
    locales: [en]
    sample: Welcome to Elayva
  - bf_id: home.intro.body
    kind: copy
    area: home
    section: intro
    path: sections/home-intro.liquid
    locator: settings.body
    publication_target: github_theme
    locales: [en]
  - bf_id: home.hero.image
    kind: image
    area: home
    section: hero
    path: sections/home-hero.liquid
    locator: settings.image
    publication_target: github_theme
    sample: assets/hero.png
`;

const liquidWithSchema = `{% comment %}section{% endcomment %}
<div>{{ section.settings.heading }}</div>
{% schema %}
{
  "name": "Home intro",
  "settings": [
    {
      "type": "text",
      "id": "heading",
      "label": "Heading",
      "default": "Welcome to Elayva"
    },
    {
      "type": "textarea",
      "id": "body",
      "label": "Body",
      "default": "Body copy for search"
    }
  ]
}
{% endschema %}
`;

describe('surface inventory copy', () => {
  it('parses only github_theme copy rows', () => {
    const rows = parseSurfaceInventoryCopy(sampleInventory);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.bfId).toBe('home.intro.heading');
    expect(rows[0]?.sample).toBe('Welcome to Elayva');
  });

  it('searches normalized currentValue text only (not bf_id)', () => {
    const rows = parseSurfaceInventoryCopy(sampleInventory);
    expect(searchInventoryCopy(rows, 'Welcome')).toHaveLength(1);
    expect(searchInventoryCopy(rows, 'welcome to')).toHaveLength(1);
    expect(searchInventoryCopy(rows, 'intro')).toHaveLength(0);
    expect(searchInventoryCopy(rows, 'home.intro.heading')).toHaveLength(0);
    expect(searchInventoryCopy(rows, 'missing')).toHaveLength(0);
  });

  it('candidate label is truncated text without bf_id prefix', () => {
    const rows = parseSurfaceInventoryCopy(sampleInventory);
    const candidate = inventoryRowToTextEditCandidate(rows[0]!);
    expect(candidate).not.toBeNull();
    expect(candidate!.label).toBe('Welcome to Elayva');
    expect(candidate!.currentValue).toBe('Welcome to Elayva');
    expect(candidate!.label).not.toContain('home.intro');
  });

  it('omits rows without readable copy from candidates', () => {
    const rows = parseSurfaceInventoryCopy(sampleInventory);
    expect(inventoryRowToTextEditCandidate(rows[1]!)).toBeNull();
  });

  it('enriches live schema defaults with path cache and searches live text', async () => {
    let reads = 0;
    const rows = parseSurfaceInventoryCopy(sampleInventory);
    const enriched = await enrichInventoryCopyRows(
      {
        async readFile(path) {
          reads += 1;
          if (path === 'sections/home-intro.liquid') return liquidWithSchema;
          return null;
        },
      },
      rows,
    );
    expect(reads).toBeGreaterThanOrEqual(1);
    expect(enriched).toHaveLength(2);
    expect(searchInventoryCopy(enriched, 'Body copy')).toHaveLength(1);
    const body = inventoryRowToTextEditCandidate(
      enriched.find((row) => row.bfId === 'home.intro.body')!,
    );
    expect(body?.currentValue).toBe('Body copy for search');
    expect(body?.label).toBe('Body copy for search');
  });

  it('prefers human sample over t: translation keys for display', () => {
    expect(
      pickInventoryCopyDisplayValue({
        liveDefault: 't:sections.home.heading',
        sample: 'Real heading on the page',
      }),
    ).toBe('Real heading on the page');
    expect(
      searchInventoryCopy(
        [
          {
            area: 'home',
            bfId: 'home.intro.heading',
            kind: 'copy',
            liveDefault: 't:sections.home.heading',
            locales: ['en'],
            locator: 'settings.heading',
            path: 'sections/home-intro.liquid',
            publicationTarget: 'github_theme',
            sample: 'Real heading on the page',
            section: 'intro',
          },
        ],
        'Real heading',
      ),
    ).toHaveLength(1);
  });

  it('keeps sample-only rows when liquid files are unreadable', async () => {
    const rows = parseSurfaceInventoryCopy(sampleInventory);
    const enriched = await enrichInventoryCopyRows(
      {
        async readFile() {
          return null;
        },
      },
      rows,
    );
    expect(enriched).toHaveLength(1);
    expect(enriched[0]?.bfId).toBe('home.intro.heading');
    expect(searchInventoryCopy(enriched, 'Welcome')).toHaveLength(1);
  });

  it('resolves t: schema defaults via locale schema JSON for search', async () => {
    const liquid = `{% schema %}
{
  "name": "Home",
  "settings": [
    {
      "type": "text",
      "id": "heading",
      "default": "t:sections.home.settings.heading.default"
    }
  ]
}
{% endschema %}`;
    const locale = JSON.stringify({
      sections: {
        home: {
          settings: {
            heading: { default: 'Welcome from locale' },
          },
        },
      },
    });
    const enriched = await enrichInventoryCopyRows(
      {
        async readFile(path) {
          if (path === 'sections/home.liquid') return liquid;
          if (path === 'locales/en.default.schema.json') return locale;
          return null;
        },
      },
      [
        {
          area: 'home',
          bfId: 'home.intro.heading',
          kind: 'copy',
          locales: ['en'],
          locator: 'settings.heading',
          path: 'sections/home.liquid',
          publicationTarget: 'github_theme',
          section: 'intro',
        },
      ],
    );
    expect(searchInventoryCopy(enriched, 'Welcome from locale')).toHaveLength(
      1,
    );
    expect(inventoryRowToTextEditCandidate(enriched[0]!)?.currentValue).toBe(
      'Welcome from locale',
    );
  });

  it('enriches template instance values and strips HTML for search', async () => {
    const liquid = `{% schema %}
{
  "name": "Locator",
  "settings": [
    {
      "type": "textarea",
      "id": "body",
      "default": "<p>Short schema default</p>"
    }
  ]
}
{% endschema %}`;
    const template = JSON.stringify({
      sections: {
        home_locator: {
          type: 'home-locator',
          settings: {
            body: '<p>ELAYVA is available in selected stores.</p><p>Find yours.</p>',
          },
        },
      },
    });
    const enriched = await enrichInventoryCopyRows(
      {
        async readFile(path) {
          if (path === 'sections/home-locator.liquid') return liquid;
          if (path === 'templates/index.json') return template;
          return null;
        },
      },
      [
        {
          area: 'home',
          bfId: 'home.locator.body',
          kind: 'copy',
          locales: ['en'],
          locator: 'settings.body',
          path: 'sections/home-locator.liquid',
          publicationTarget: 'github_theme',
          section: 'locator',
        },
      ],
    );
    expect(searchInventoryCopy(enriched, 'Find yours')).toHaveLength(1);
    expect(inventoryRowToTextEditCandidate(enriched[0]!)?.currentValue).toContain(
      'Find yours',
    );
    expect(inventoryRowToTextEditCandidate(enriched[0]!)?.currentValue).not.toContain(
      '<p>',
    );
  });

  it('indexes all templates so non-home areas are searchable', async () => {
    const liquid = `{% schema %}
{
  "name": "Bio",
  "settings": [
    { "type": "text", "id": "lead", "default": "Schema lead only" }
  ]
}
{% endschema %}`;
    const biophenols = JSON.stringify({
      sections: {
        bio_natural: {
          type: 'bio-natural',
          settings: {
            lead: 'Polyphenols that taste like the grove.',
          },
        },
      },
    });
    const enriched = await enrichInventoryCopyRows(
      {
        async listFiles() {
          return ['templates/index.json', 'templates/page.biophenols.json'];
        },
        async readFile(path) {
          if (path === 'sections/bio-natural.liquid') return liquid;
          if (path === 'templates/page.biophenols.json') return biophenols;
          if (path === 'templates/index.json')
            return JSON.stringify({ sections: {} });
          return null;
        },
      },
      [
        {
          area: 'bio',
          bfId: 'bio.natural.lead',
          kind: 'copy',
          locales: ['en'],
          locator: 'settings.lead',
          path: 'sections/bio-natural.liquid',
          publicationTarget: 'github_theme',
          section: 'natural',
        },
      ],
    );
    expect(searchInventoryCopy(enriched, 'taste like the grove')).toHaveLength(
      1,
    );
  });

  it('finds non-home template copy via area-scoped templates without listFiles', async () => {
    const liquid = `{% schema %}
{
  "name": "Bio",
  "settings": [
    { "type": "text", "id": "body", "default": "Schema body" }
  ]
}
{% endschema %}`;
    const biophenols = JSON.stringify({
      sections: {
        hero: {
          type: 'biophenols-hero',
          settings: {
            body: 'Nature’s quiet defense, carried from the olive grove.',
          },
        },
      },
    });
    const enriched = await enrichInventoryCopyRows(
      {
        async readFile(path) {
          if (path === 'sections/biophenols-hero.liquid') return liquid;
          if (path === 'templates/page.biophenols.json') return biophenols;
          return null;
        },
      },
      [
        {
          area: 'bio',
          bfId: 'bio.hero.body',
          kind: 'copy',
          locales: ['en'],
          locator: 'settings.body',
          path: 'sections/biophenols-hero.liquid',
          publicationTarget: 'github_theme',
          section: 'hero',
        },
      ],
    );
    expect(
      searchInventoryCopy(enriched, 'quiet defense, carried from the olive'),
    ).toHaveLength(1);
  });

  it('finds story/bio copy from Liquid schema alone without inventory sample', async () => {
    const storyLiquid = `{% schema %}
{
  "name": "Story hero",
  "settings": [
    {
      "type": "text",
      "id": "eyebrow",
      "default": "Our story · Sicily to Switzerland"
    }
  ]
}
{% endschema %}`;
    const bioLiquid = `{% schema %}
{
  "name": "Bio hero",
  "settings": [
    {
      "type": "textarea",
      "id": "body",
      "default": "Nature’s quiet defense, carried from the olive grove into every sip."
    }
  ]
}
{% endschema %}`;
    const enriched = await enrichInventoryCopyRows(
      {
        async readFile(path) {
          if (path === 'sections/story-hero.liquid') return storyLiquid;
          if (path === 'sections/biophenols-hero.liquid') return bioLiquid;
          return null;
        },
      },
      [
        {
          area: 'story',
          bfId: 'story.hero.eyebrow',
          kind: 'copy',
          locales: ['en'],
          locator: 'settings.eyebrow',
          path: 'sections/story-hero.liquid',
          publicationTarget: 'github_theme',
          section: 'hero',
        },
        {
          area: 'bio',
          bfId: 'bio.hero.body',
          kind: 'copy',
          locales: ['en'],
          locator: 'settings.body',
          path: 'sections/biophenols-hero.liquid',
          publicationTarget: 'github_theme',
          section: 'hero',
        },
      ],
    );
    expect(searchInventoryCopy(enriched, 'Sicily to Switzerland')).toHaveLength(
      1,
    );
    expect(searchInventoryCopy(enriched, 'quiet defense')).toHaveLength(1);
  });

  it('propagates GitHub read errors instead of swallowing them', async () => {
    await expect(
      enrichInventoryCopyRows(
        {
          async readFile(path) {
            if (path.startsWith('templates/')) return null;
            throw new Error('secondary rate limit');
          },
        },
        [
          {
            area: 'bio',
            bfId: 'bio.hero.body',
            kind: 'copy',
            locales: ['en'],
            locator: 'settings.body',
            path: 'sections/biophenols-hero.liquid',
            publicationTarget: 'github_theme',
            section: 'hero',
          },
        ],
      ),
    ).rejects.toThrow(/secondary rate limit/i);
  });

  it('fails closed when non-home inventory areas have no searchable live text', async () => {
    await expect(
      enrichInventoryCopyRows(
        {
          async readFile(path) {
            if (path === 'sections/home-intro.liquid') return liquidWithSchema;
            return null;
          },
        },
        [
          {
            area: 'home',
            bfId: 'home.intro.heading',
            kind: 'copy',
            locales: ['en'],
            locator: 'settings.heading',
            path: 'sections/home-intro.liquid',
            publicationTarget: 'github_theme',
            sample: 'Welcome to Elayva',
            section: 'intro',
          },
          {
            area: 'bio',
            bfId: 'bio.hero.body',
            kind: 'copy',
            locales: ['en'],
            locator: 'settings.body',
            path: 'sections/biophenols-hero.liquid',
            publicationTarget: 'github_theme',
            section: 'hero',
          },
          {
            area: 'story',
            bfId: 'story.hero.body',
            kind: 'copy',
            locales: ['en'],
            locator: 'settings.body',
            path: 'sections/story-hero.liquid',
            publicationTarget: 'github_theme',
            section: 'hero',
          },
        ],
      ),
    ).rejects.toThrow(/enrichment failed for area\(s\): bio, story/i);
  });

  it('ignores hanging listFiles and still indexes area-scoped templates', async () => {
    const liquid = `{% schema %}
{
  "name": "Story",
  "settings": [
    { "type": "text", "id": "body", "default": "Schema only" }
  ]
}
{% endschema %}`;
    const story = JSON.stringify({
      sections: {
        hero: {
          type: 'story-hero',
          settings: { body: 'Our story began under Mediterranean light.' },
        },
      },
    });
    const enriched = await enrichInventoryCopyRows(
      {
        async listFiles() {
          await new Promise(() => {
            // Never resolve — must not block enrichment.
          });
          return [];
        },
        async readFile(path) {
          if (path === 'sections/story-hero.liquid') return liquid;
          if (path === 'templates/page.story.json') return story;
          return null;
        },
      },
      [
        {
          area: 'story',
          bfId: 'story.hero.body',
          kind: 'copy',
          locales: ['en'],
          locator: 'settings.body',
          path: 'sections/story-hero.liquid',
          publicationTarget: 'github_theme',
          section: 'hero',
        },
      ],
    );
    expect(
      searchInventoryCopy(enriched, 'Mediterranean light'),
    ).toHaveLength(1);
  });

  it('detects style_target near misses', () => {
    expect(
      matchesInventoryStyleHint(
        [{ area: 'home', sample: 'ELAYVA. Water reimagined by the olive.' }],
        'Water reimagined by the olive',
      ),
    ).toBe(true);
    expect(
      matchesInventoryStyleHint(
        [{ area: 'home', sample: 'ELAYVA. Water reimagined by the olive.' }],
        'completely different',
      ),
    ).toBe(false);
  });

  it('enriches style hints from live Liquid when inventory sample is empty', async () => {
    const liquid = `{% schema %}
{
  "name": "Story hero",
  "settings": [
    {
      "type": "text",
      "id": "heading",
      "default": "The olive held a secret."
    }
  ]
}
{% endschema %}`;
    const hints = await enrichInventoryStyleHints(
      {
        async readFile(path) {
          if (path === 'sections/story-hero.liquid') return liquid;
          return null;
        },
      },
      [
        {
          area: 'story',
          bfId: 'story.hero.heading',
          locator: 'settings.heading',
          path: 'sections/story-hero.liquid',
        },
      ],
    );
    expect(hints).toHaveLength(1);
    expect(matchesInventoryStyleHint(hints, 'olive held a secret')).toBe(true);
  });

  it('derives setting id from locator', () => {
    expect(settingIdFromLocator('settings.heading')).toBe('heading');
    expect(settingIdFromLocator('heading')).toBe('heading');
  });
});

describe('patchLiquidSchemaDefault', () => {
  it('updates matching setting default in place', () => {
    const next = patchLiquidSchemaDefault(
      liquidWithSchema,
      'heading',
      'New heading',
    );
    expect(readLiquidSchemaDefault(next, 'heading')).toBe('New heading');
    expect(readLiquidSchemaDefault(next, 'body')).toBe('Body copy for search');
    expect(next).toContain('{% schema %}');
    expect(next).toContain('{% endschema %}');
  });

  it('fails closed when setting id is missing', () => {
    expect(() =>
      patchLiquidSchemaDefault(liquidWithSchema, 'missing', 'x'),
    ).toThrow(/not found/i);
  });
});
