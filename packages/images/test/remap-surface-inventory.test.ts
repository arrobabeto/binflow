import { describe, expect, it, vi } from 'vitest';

import {
  EditThemeImageExecutor,
  isThemeAssetPath,
  resolveThemeImagePublishPath,
} from '../src/edit-theme-image.js';
import {
  extractSurfaceMarkersFromSource,
  mergeSurfaceInventoryYaml,
  remapSurfaceInventoryFromSources,
} from '../src/remap-surface-inventory.js';

describe('remap surface inventory', () => {
  it('extracts data-bf markers from liquid', () => {
    const source = `
      <img
        data-bf-id="story.hero.image"
        data-bf-kind="image"
        data-bf-section="hero"
        src="{{ 'assets/story-hero.jpg' | asset_url }}"
      />
      <h1 data-bf-id="story.hero.heading" data-bf-kind="style_target" data-bf-section="hero">Hi</h1>
    `;
    const markers = extractSurfaceMarkersFromSource(
      'sections/story-hero.liquid',
      source,
    );
    expect(markers.map((row) => row.bfId).sort()).toEqual([
      'story.hero.heading',
      'story.hero.image',
    ]);
    expect(markers.find((row) => row.bfId === 'story.hero.image')?.sample).toBe(
      'assets/story-hero.jpg',
    );
  });

  it('preserves hand-tuned sample when merging new markers', () => {
    const existing = `
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
    sample: "assets/custom-hero.png"
`;
    const result = remapSurfaceInventoryFromSources({
      existingYaml: existing,
      projectKey: 'elayva',
      sources: [
        {
          path: 'sections/story-hero.liquid',
          source: `<img data-bf-id="story.hero.image" data-bf-kind="image" data-bf-section="hero" src="assets/story-hero.jpg" />`,
        },
        {
          path: 'sections/home-hero.liquid',
          source: `<img data-bf-id="home.hero.image" data-bf-kind="image" data-bf-section="hero" src="assets/other.jpg" />`,
        },
      ],
    });
    expect(result.changed).toBe(true);
    expect(result.addedBfIds).toContain('story.hero.image');
    expect(result.yaml).toContain('assets/custom-hero.png');
    expect(result.yaml).toContain('story.hero.image');
  });

  it('marks orphan rows without deleting them', () => {
    const existing = `
version: 1
surfaces:
  - bf_id: gone.slot.image
    kind: image
    area: gone
    section: slot
    path: sections/gone.liquid
    locator: settings.image
    locales: [en]
    publication_target: github_theme
`;
    const result = mergeSurfaceInventoryYaml({
      existingYaml: existing,
      markers: [],
    });
    expect(result.yaml).toContain('gone.slot.image');
    expect(result.yaml).toContain('orphaned');
  });
});

describe('theme image publish path', () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);

  it('overwrites inventory assets/** sample in place', () => {
    expect(isThemeAssetPath('assets/story-discovery-1.jpg')).toBe(true);
    expect(
      resolveThemeImagePublishPath({
        candidateKey: 'story.discovery.image_1',
        currentPath: 'assets/story-discovery-1.jpg',
        replacementBytes: bytes,
        replacementMime: 'image/jpeg',
      }),
    ).toBe('assets/story-discovery-1.jpg');
  });

  it('stamps when sample is not an assets path', () => {
    const path = resolveThemeImagePublishPath({
      candidateKey: 'home.hero.image',
      currentPath: 'cdn/legacy.png',
      replacementBytes: bytes,
      replacementMime: 'image/png',
    });
    expect(path).toMatch(/^cdn\/legacy-[a-f0-9]{12}\.png$/u);
  });

  it('preparePreview publishes the inventory asset path', async () => {
    const createDraft = vi.fn(async (draft: { files: { path: string }[] }) => ({
      baseCommitSha: 'b'.repeat(40),
      branch: 'binflow/edit-image',
      files: draft.files.map((file) => file.path),
      headCommitSha: 'h'.repeat(40),
      pullRequestId: '9',
      pullRequestUrl: 'https://github.com/acme/theme/pull/9',
    }));
    const executor = new EditThemeImageExecutor(
      {
        createDraft,
        merge: vi.fn(),
        readFileAtRef: vi.fn(),
        revalidate: vi.fn(),
      } as never,
      { readFile: async () => null },
    );
    const result = await executor.preparePreview({
      candidate: {
        component: null,
        currentPath: 'assets/home-lifestyle-banner.jpg',
        field: 'settings.image',
        key: 'home.lifestyle.image',
        kind: 'page',
        label: 'home.lifestyle.image · assets/home-lifestyle-banner.jpg',
        pageOrPostId: 'home.lifestyle.image',
        pageOrPostSlug: 'home',
        pageOrPostTitle: 'home/lifestyle',
        sectionIndex: 0,
      },
      manifest: {
        repository: {
          branchPattern:
            'binflow/{capability}/{projectKey}/{request-id}/{slug}',
          name: 'elayva',
        },
      } as never,
      productionOrigin: 'https://shop.example',
      replacementBytes: bytes,
      replacementMime: 'image/jpeg',
      requestId: 'req_1',
    });
    expect(createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [
          expect.objectContaining({ path: 'assets/home-lifestyle-banner.jpg' }),
        ],
      }),
    );
    expect(result.patch.githubPath).toBe('assets/home-lifestyle-banner.jpg');
    expect(result.publication.files).toEqual([
      'assets/home-lifestyle-banner.jpg',
    ]);
  });
});

describe('EditThemeImageExecutor.publish', () => {
  it('revalidates with publication.files not an empty list', async () => {
    const revalidate = vi.fn(async () => undefined);
    const merge = vi.fn(async () => ({ mergeCommitSha: 'm'.repeat(40) }));
    const executor = new EditThemeImageExecutor(
      {
        createDraft: vi.fn(),
        merge,
        readFileAtRef: vi.fn(),
        revalidate,
      } as never,
      { readFile: async () => null },
    );
    await executor.publish({
      productionOrigin: 'https://shop.example',
      publication: {
        baseCommitSha: 'b'.repeat(40),
        branch: 'binflow/edit-image',
        files: ['assets/home-hero-abc.jpg'],
        headCommitSha: 'h'.repeat(40),
        pullRequestId: '12',
        pullRequestUrl: 'https://github.com/acme/theme/pull/12',
      },
    });
    expect(revalidate).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedFiles: ['assets/home-hero-abc.jpg'],
        expectedHeadSha: 'h'.repeat(40),
        pullRequestId: '12',
        requireCommitStatus: false,
      }),
    );
  });
});
