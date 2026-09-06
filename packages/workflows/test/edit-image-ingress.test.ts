import { describe, expect, it } from 'vitest';

import {
  buildEditImagePickActionRows,
  buildEditImagePlanMessage,
  buildEditImageTargetConfirmMessage,
  buildImagePublicUrl,
  editImageActionLabels,
  editImageBrowsePagesMessage,
  editImageNaturalLanguage,
  formatEditImagePageLabel,
  resolveEditImageProductionOrigin,
} from '../src/edit-image-ingress.js';
import { discoverEditableImages } from '@binflow/images';
import { shopifyThemeImageConfirmPhotoUrl } from '../src/edit-image-shopify-collection.js';

describe('edit-image ingress', () => {
  it('matches natural-language image edit intents', () => {
    expect(editImageNaturalLanguage('Quiero cambiar la imagen del hero')).toBe(
      true,
    );
    expect(editImageNaturalLanguage('Change image on the menu page')).toBe(
      true,
    );
    expect(editImageNaturalLanguage('Bild ändern auf der Startseite')).toBe(
      true,
    );
    expect(editImageNaturalLanguage('edit image cover')).toBe(true);
    expect(editImageNaturalLanguage('cambiar texto del párrafo')).toBe(false);
    expect(editImageNaturalLanguage('update menu pdf')).toBe(false);
  });

  it('stacks one pick button per Telegram keyboard row', () => {
    const tokens = [
      { action: 'pick_image_target', label: 'Select 1: Hero', token: 't1' },
      { action: 'pick_image_target', label: 'Select 2: Product', token: 't2' },
      { action: 'pick_image_target', label: 'Select 3: Lifestyle', token: 't3' },
    ] as const;
    const rows = buildEditImagePickActionRows(tokens);
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.length === 1)).toBe(true);
    expect(rows.map((row) => row[0]?.token)).toEqual(['t1', 't2', 't3']);
  });

  it('localizes browse-pages copy and page button labels', () => {
    expect(editImageBrowsePagesMessage.es).toContain('página');
    expect(editImageBrowsePagesMessage.es).toContain('profunda');
    expect(editImageBrowsePagesMessage.en).toContain('page');
    expect(editImageBrowsePagesMessage.en).toContain('Deep search');
    expect(formatEditImagePageLabel('en', 'home')).toBe('Page: home');
    expect(formatEditImagePageLabel('es', 'home')).toBe('Página: home');
    expect(editImageActionLabels.es.cancel).toBe('Cancelar');
    expect(editImageActionLabels.es.deepSearch).toBe('Búsqueda profunda');
    expect(editImageActionLabels.en.deepSearch).toBe('Deep search');
    expect(editImageActionLabels.de.deepSearch).toBe('Tiefe Suche');
  });

  it('uses image-specific action labels without create-draft wording', () => {
    expect(editImageActionLabels.es.confirmTarget).toBe('Confirmar imagen');
    expect(editImageActionLabels.es.rejectTarget).toBe('No es esta');
    expect(editImageActionLabels.es.confirmPlan).toBe('Publicar imagen');
    expect(editImageActionLabels.en.pickTarget).toBe('Select');
    expect(editImageActionLabels.de.approvePreview).toBe('Freigeben');
    expect(editImageActionLabels.es.confirmPlan).not.toContain('borrador');
    expect(editImageActionLabels.en.confirmPlan).not.toContain('draft');
  });

  it('does not attach storefront asset URLs for Shopify confirm without resolver', () => {
    const url = shopifyThemeImageConfirmPhotoUrl(
      {
        deployment: { productionOrigin: 'https://elayva.example' },
      } as never,
      {
        component: null,
        currentPath: 'assets/story-discovery-1.jpg',
        field: 'settings.image',
        key: 'story.discovery.image_1',
        kind: 'page',
        label: 'story.discovery.image_1 · assets/story-discovery-1.jpg',
        pageOrPostId: 'story.discovery.image_1',
        pageOrPostSlug: 'story',
        pageOrPostTitle: 'story/discovery',
        sectionIndex: 0,
      },
    );
    expect(url).toBeUndefined();
  });

  it('mentions all languages on multilingual plan messages', () => {
    const candidate = {
      component: null,
      currentPath: '/images/dish.jpg',
      field: 'img',
      key: 'page:menu:0:img',
      kind: 'page' as const,
      label: 'dish.jpg',
      pageOrPostId: 'p1',
      pageOrPostSlug: 'menu',
      pageOrPostTitle: 'Menú',
      sectionIndex: 0,
    };
    const message = buildEditImagePlanMessage('es', candidate, ['es', 'en']);
    expect(message).toContain('todos los idiomas');
    expect(message).not.toContain('cms/');
    expect(message).not.toContain('public/images');
    const mono = buildEditImagePlanMessage('es', candidate, ['es']);
    expect(mono).not.toContain('todos los idiomas');
  });

  it('builds absolute photoUrl for target confirm without repo paths in copy', () => {
    const candidate = {
      component: 'SectionGallery',
      currentPath: '/images/blog/gallery.avif',
      field: 'img',
      key: 'page:kontakt:2:img',
      kind: 'page' as const,
      label: 'gallery.avif',
      pageOrPostId: 'p1',
      pageOrPostSlug: 'kontakt',
      pageOrPostTitle: 'Kontakt',
      sectionIndex: 2,
    };
    const photoUrl = buildImagePublicUrl(
      'https://www.bistrozurlinde.ch',
      candidate.currentPath,
    );
    expect(photoUrl).toBe('https://www.bistrozurlinde.ch/images/blog/gallery.avif');
    const confirm = buildEditImageTargetConfirmMessage(
      'es',
      candidate,
      photoUrl,
    );
    expect(confirm).toContain('/kontakt');
    expect(confirm).toContain('imagen');
    expect(confirm).toContain('gallery.avif');
    expect(confirm).toContain(photoUrl);
    expect(confirm.indexOf('gallery.avif')).toBeLessThan(
      confirm.indexOf(photoUrl),
    );
    expect(confirm).not.toContain('cms/collections');
    expect(confirm).not.toContain('page:kontakt');
  });

  it('resolves production origin from enrolled manifest', () => {
    const origin = resolveEditImageProductionOrigin({
      deployment: { productionOrigin: 'https://www.bistrozurlinde.ch/' },
    } as never);
    expect(origin).toBe('https://www.bistrozurlinde.ch');
  });

  it('denies page heroes while allowing blog cover in discovery', () => {
    const pages = [
      {
        id: 'home',
        sections: [
          {
            _orbi: { component: 'SectionHero' },
            img: '/images/blog/hero-page.avif',
          },
          {
            _orbi: { component: 'SectionGallery' },
            img: '/images/blog/ok.avif',
          },
        ],
        slug: 'home',
        title: { de: 'Home' },
      },
    ] as const;
    const posts = [
      {
        id: 'post1',
        img: '/images/blog/cover.avif',
        sections: [
          {
            _orbi: { component: 'SectionPostHero' },
            img: '/images/blog/cover.avif',
          },
        ],
        title: { de: 'Post' },
      },
    ] as const;
    const found = discoverEditableImages(pages, posts, ['de']);
    const paths = found.map((c) => c.currentPath);
    expect(paths).toContain('/images/blog/ok.avif');
    expect(paths).toContain('/images/blog/cover.avif');
    expect(paths).not.toContain('/images/blog/hero-page.avif');
  });
});

describe('restore_orbitype_preview contract', () => {
  it('accepts restore_orbitype_preview as a workflow resume reason', async () => {
    const { workflowResumeSignalSchema } = await import('@binflow/contracts');
    const parsed = workflowResumeSignalSchema.parse({
      reason: 'restore_orbitype_preview',
      requestId: 'req_1',
      requestVersionId: 'ver_1',
      tenantId: 'ten_1',
    });
    expect(parsed.reason).toBe('restore_orbitype_preview');
  });
});
