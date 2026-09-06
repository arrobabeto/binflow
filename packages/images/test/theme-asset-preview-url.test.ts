import { describe, expect, it } from 'vitest';

import {
  buildGitHubRawThemeAssetUrl,
  findThemeAssetUrlInHtml,
  resolveThemeAssetPreviewUrl,
} from '../src/theme-asset-preview-url.js';

describe('theme asset preview url', () => {
  it('finds CDN URLs containing the asset basename in HTML', () => {
    const html = `
      <img src="https://cdn.shopify.com/s/files/1/0/t/2/assets/story-discovery-1.jpg?v=123" />
      <img src="https://cdn.shopify.com/s/files/1/0/t/2/assets/other.jpg" />
    `;
    expect(findThemeAssetUrlInHtml(html, 'assets/story-discovery-1.jpg')).toBe(
      'https://cdn.shopify.com/s/files/1/0/t/2/assets/story-discovery-1.jpg?v=123',
    );
  });

  it('builds GitHub raw fallback URLs', () => {
    expect(
      buildGitHubRawThemeAssetUrl({
        assetPath: 'assets/home-hero.jpg',
        owner: 'acme',
        productionBranch: 'main',
        repo: 'elayva',
      }),
    ).toBe(
      'https://raw.githubusercontent.com/acme/elayva/main/assets/home-hero.jpg',
    );
  });

  it('prefers live CDN from storefront HTML when fetch succeeds', async () => {
    const response = {
      ok: true,
      text: async () =>
        `<img src="https://cdn.shopify.com/s/files/1/x/assets/story-hero.jpg?v=9">`,
      url: 'https://shop.example/',
    } as Response;
    const url = await resolveThemeAssetPreviewUrl({
      assetPath: 'assets/story-hero.jpg',
      fetchImpl: (async () => response) as typeof fetch,
      productionOrigin: 'https://shop.example',
      repository: {
        name: 'elayva',
        owner: 'acme',
        productionBranch: 'main',
      },
    });
    expect(url).toBe(
      'https://cdn.shopify.com/s/files/1/x/assets/story-hero.jpg?v=9',
    );
  });

  it('falls back to GitHub raw when storefront has no match', async () => {
    const response = {
      ok: true,
      text: async () => `<html><body>no assets</body></html>`,
      url: 'https://shop.example/',
    } as Response;
    const url = await resolveThemeAssetPreviewUrl({
      assetPath: 'assets/missing.jpg',
      fetchImpl: (async () => response) as typeof fetch,
      productionOrigin: 'https://shop.example',
      repository: {
        name: 'elayva',
        owner: 'acme',
        productionBranch: 'main',
      },
    });
    expect(url).toBe(
      'https://raw.githubusercontent.com/acme/elayva/main/assets/missing.jpg',
    );
  });
});
