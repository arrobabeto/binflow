import { describe, expect, it } from 'vitest';

import { buildNewPublicImagePath } from '../src/edit-image.js';
import {
  applyImageFieldPatchAllLocales,
  discoverEditableImages,
  searchEditableImages,
} from '../src/discover-editable-images.js';

const pages = [
  {
    id: 'page-home',
    sections: [
      {
        _orbi: { component: 'SectionHero' },
        img: '/images/hero-denied.avif',
        title: { de: 'Hero' },
      },
      {
        _orbi: { component: 'SectionGallery' },
        img: '/images/gallery-ok.avif',
        logo: '/images/logo-denied.svg',
        title: { de: 'Gallery' },
      },
      {
        _orbi: { component: 'SectionBrand' },
        brandLogo: '/images/brand-denied.svg',
        photo: '/images/photo-ok.avif',
      },
    ],
    slug: 'home',
    title: { de: 'Home' },
  },
] as const;

const posts = [
  {
    id: 'post-1',
    img: '/images/cover.avif',
    sections: [
      {
        _orbi: { component: 'SectionPostHero' },
        img: '/images/post-hero.avif',
        imgAlt: { de: 'Cover alt text' },
        title: { de: 'Post title' },
      },
      {
        _orbi: { component: 'SectionPostBody' },
        image: { de: '/images/body-de.avif', en: '/images/body-en.avif' },
      },
    ],
    title: { de: 'A blog post' },
  },
] as const;

describe('discoverEditableImages', () => {
  it('discovers page img fields but denies SectionHero and logo fields', () => {
    const candidates = discoverEditableImages(pages, [], ['de', 'en']);
    const keys = candidates.map((candidate) => candidate.key);
    expect(keys).toContain('page:home:1:img');
    expect(keys).toContain('page:home:2:photo');
    expect(keys).not.toContain('page:home:0:img');
    expect(keys).not.toContain('page:home:1:logo');
    expect(keys).not.toContain('page:home:2:brandLogo');
  });

  it('allows SectionPostHero and blog cover images', () => {
    const candidates = discoverEditableImages([], posts, ['de', 'en']);
    const keys = candidates.map((candidate) => candidate.key);
    expect(keys).toContain('blog:post-1:-1:img');
    expect(keys).toContain('blog:post-1:0:img');
    expect(keys).toContain('blog:post-1:1:image');
    const cover = candidates.find((candidate) => candidate.sectionIndex === -1);
    expect(cover?.currentPath).toBe('/images/cover.avif');
    const hero = candidates.find(
      (candidate) =>
        candidate.sectionIndex === 0 && candidate.component === 'SectionPostHero',
    );
    expect(hero?.currentPath).toBe('/images/post-hero.avif');
  });

  it('finds targets by path fragment', () => {
    const matches = searchEditableImages(pages, posts, ['de', 'en'], 'gallery-ok');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.currentPath).toContain('gallery-ok');
  });

  it('applies all-locale image path patch', () => {
    const patched = applyImageFieldPatchAllLocales(posts[0]!.sections, {
      field: 'image',
      locales: ['de', 'en'],
      newPath: '/images/blog/edit-new.avif',
      sectionIndex: 1,
    }) as Array<Record<string, unknown>>;
    expect(patched[1]?.image).toEqual({
      de: '/images/blog/edit-new.avif',
      en: '/images/blog/edit-new.avif',
    });
  });

  it('builds replacement paths under the manifest imageDirectory', () => {
    expect(buildNewPublicImagePath('019f-abcd-1234', 'image/jpeg')).toBe(
      '/images/blog/edit-019fabcd.jpg',
    );
    expect(
      buildNewPublicImagePath(
        '019f-abcd-1234',
        'image/png',
        'public/images/blog',
      ),
    ).toBe('/images/blog/edit-019fabcd.png');
  });
});
