import { describe, expect, it } from 'vitest';

import {
  inventoryImagesForArea,
  listInventoryImageAreas,
  parseSurfaceInventoryImages,
  searchInventoryImages,
} from '../src/surface-inventory.js';

const sampleInventory = `
version: 1
project_key: elayva
surfaces:
  - bf_id: home.hero.image
    kind: image
    area: home
    section: hero
    path: sections/home-hero.liquid
    locator: settings.image
    locales: [en]
    publication_target: github_theme
    sample: "assets/home-hero-image.jpg"
  - bf_id: home.intro.heading
    kind: copy
    area: home
    section: intro
    path: sections/home-intro.liquid
    locator: settings.heading
    locales: [en]
    publication_target: github_theme
  - bf_id: home.product.image
    kind: image
    area: home
    section: product
    path: sections/home-featured-product.liquid
    locator: settings.image
    locales: [en]
    publication_target: github_theme
    sample: "assets/home-product-image.png"
`;

describe('surface inventory', () => {
  it('parses only github_theme image rows', () => {
    const rows = parseSurfaceInventoryImages(sampleInventory);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.bfId)).toEqual([
      'home.hero.image',
      'home.product.image',
    ]);
  });

  it('searches by bf_id fragment', () => {
    const rows = parseSurfaceInventoryImages(sampleInventory);
    const matches = searchInventoryImages(rows, 'hero');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.key).toBe('home.hero.image');
    expect(matches[0]?.currentPath).toBe('assets/home-hero-image.jpg');
  });

  it('lists unique areas and images for an area', () => {
    const rows = parseSurfaceInventoryImages(sampleInventory);
    expect(listInventoryImageAreas(rows)).toEqual(['home']);
    const homeImages = inventoryImagesForArea(rows, 'home');
    expect(homeImages.map((item) => item.key)).toEqual([
      'home.hero.image',
      'home.product.image',
    ]);
    expect(inventoryImagesForArea(rows, 'missing')).toEqual([]);
  });
});
