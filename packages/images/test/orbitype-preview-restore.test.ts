import { describe, expect, it, vi } from 'vitest';

import {
  previewOriginFromDeployment,
  restoreOrbitypeImagePreview,
  snapshotOrbitypeImageRestore,
} from '../src/edit-image.js';

describe('orbitype preview restore helpers', () => {
  it('extracts preview origin from deployment route urls', () => {
    const origin = previewOriginFromDeployment(
      {
        deploymentId: 'd1',
        environment: 'preview',
        readyAt: new Date().toISOString(),
        sha: 'abc1234',
        urls: {
          '/menu': 'https://edit-image-preview.vercel.app/menu',
        },
      },
      '/menu',
    );
    expect(origin).toBe('https://edit-image-preview.vercel.app');
  });

  it('snapshots page and post restore payloads', () => {
    const pageSnap = snapshotOrbitypeImageRestore(
      [
        {
          id: 'page-1',
          sections: [{ img: '/images/old.jpg' }],
          slug: 'menu',
          title: { es: 'Menú' },
        },
      ],
      [],
      {
        component: 'SectionGallery',
        currentPath: '/images/old.jpg',
        field: 'img',
        key: 'page:menu:0:img',
        kind: 'page',
        label: 'old.jpg',
        pageOrPostId: 'page-1',
        pageOrPostSlug: 'menu',
        pageOrPostTitle: 'Menú',
        sectionIndex: 0,
      },
    );
    expect(pageSnap).toEqual({
      id: 'page-1',
      kind: 'page',
      sections: [{ img: '/images/old.jpg' }],
    });

    const postSnap = snapshotOrbitypeImageRestore(
      [],
      [
        {
          id: 'post-1',
          img: '/images/cover.jpg',
          sections: [{ img: '/images/cover.jpg' }],
          title: { es: 'Post' },
        },
      ],
      {
        component: null,
        currentPath: '/images/cover.jpg',
        field: 'img',
        key: 'blog:post-1:-1:img',
        kind: 'blog',
        label: 'cover.jpg',
        pageOrPostId: 'post-1',
        pageOrPostSlug: 'post-1',
        pageOrPostTitle: 'Post',
        sectionIndex: -1,
      },
    );
    expect(postSnap.kind).toBe('post');
    expect(postSnap.img).toBe('/images/cover.jpg');
  });

  it('restores page sections via Orbitype port', async () => {
    const applyPageSectionPatches = vi.fn(async () => undefined);
    const applyPostPatches = vi.fn(async () => undefined);
    await restoreOrbitypeImagePreview(
      {
        applyPageSectionPatches,
        applyPostPatches,
        listPages: async () => [],
        listPosts: async () => [],
      },
      {
        id: 'page-1',
        kind: 'page',
        sections: [{ img: '/images/old.jpg' }],
      },
    );
    expect(applyPageSectionPatches).toHaveBeenCalledWith({
      patches: [{ pageId: 'page-1', sections: [{ img: '/images/old.jpg' }] }],
    });
    expect(applyPostPatches).not.toHaveBeenCalled();
  });
});
