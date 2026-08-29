import { describe, expect, it } from 'vitest';

import {
  buildDeleteBlogPlanMessage,
  buildDeleteBlogArticleNotFoundMessage,
  deleteBlogActionLabels,
  isDeleteBlogArticleNotFoundError,
} from '../src/delete-blog-ingress.js';
import { DomainError } from '@binflow/domain';
import {
  deleteBlogNaturalLanguage,
  deleteBlogVerbPattern,
} from '../src/capability-ingress.js';

describe('delete blog natural language', () => {
  it('matches conjugated Spanish delete verbs with blog cues', () => {
    expect(
      deleteBlogNaturalLanguage(
        'Borra el blog https://webbin.com.mx/es/articulos/mi-articulo',
      ),
    ).toBe(true);
    expect(deleteBlogNaturalLanguage('Elimina este artículo del blog')).toBe(
      true,
    );
  });

  it('matches infinitive and English delete verbs', () => {
    expect(deleteBlogVerbPattern.test('borrar el artículo')).toBe(true);
    expect(deleteBlogNaturalLanguage('delete this blog post')).toBe(true);
  });

  it('does not match blog-only intent without delete verbs', () => {
    expect(
      deleteBlogNaturalLanguage('Quiero un artículo sobre SEO local'),
    ).toBe(false);
  });
});

describe('delete blog plan copy', () => {
  it('shows only title and URL in the plan confirm message', () => {
    expect(
      buildDeleteBlogPlanMessage(
        'es',
        {} as never,
        {
          resolvedSlug: 'mi-articulo',
          resolvedTitle: 'Mi Artículo',
          resolvedUrl: 'https://webbin.com.mx/es/articulos/mi-articulo',
          source: 'url',
        },
      ),
    ).toBe(
      'Plan: borrar el artículo **Mi Artículo**.\nURL: https://webbin.com.mx/es/articulos/mi-articulo',
    );
  });

  it('uses delete CTAs, not create-draft wording', () => {
    expect(deleteBlogActionLabels.es.confirmPlan).toBe('Borrar artículo');
    expect(deleteBlogActionLabels.es.confirmTarget).toBe('Sí, es este');
    expect(deleteBlogActionLabels.en.confirmPlan).toBe('Delete post');
    expect(deleteBlogActionLabels.de.confirmPlan).toBe('Beitrag löschen');
    for (const locale of ['es', 'en', 'de'] as const) {
      expect(deleteBlogActionLabels[locale].confirmPlan.toLowerCase()).not.toMatch(
        /borrador|draft|entwurf/,
      );
    }
  });

  it('detects article_not_found domain errors', () => {
    expect(
      isDeleteBlogArticleNotFoundError(
        new DomainError('validation_error', 'missing', {
          code: 'article_not_found',
        }),
      ),
    ).toBe(true);
    expect(
      isDeleteBlogArticleNotFoundError(
        new DomainError('validation_error', 'other', { code: 'ambiguous_title' }),
      ),
    ).toBe(false);
  });

  it('returns locale copy when article is missing', () => {
    expect(buildDeleteBlogArticleNotFoundMessage('es')).toContain('ya no existe');
  });
});
