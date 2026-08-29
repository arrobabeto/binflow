import { describe, expect, it } from 'vitest';

import { DomainError } from '@binflow/domain';

import {
  buildDeleteProjectPlanMessage,
  buildDeleteProjectNotFoundMessage,
  deleteProjectActionLabels,
  isDeleteProjectNotFoundError,
} from '../src/delete-project-ingress.js';
import {
  deleteProjectNaturalLanguage,
  deleteBlogVerbPattern,
} from '../src/capability-ingress.js';

describe('delete project natural language', () => {
  it('matches delete verbs with portfolio project cues', () => {
    expect(
      deleteProjectNaturalLanguage(
        'Borra el proyecto https://webbin.com.mx/es/proyectos/mi-proyecto',
      ),
    ).toBe(true);
    expect(deleteProjectNaturalLanguage('Elimina este case study del portafolio')).toBe(
      true,
    );
  });

  it('does not match create-project intent without delete verbs', () => {
    expect(
      deleteProjectNaturalLanguage('Quiero un proyecto de portafolio nuevo'),
    ).toBe(false);
    expect(deleteBlogVerbPattern.test('nuevo proyecto destacado')).toBe(false);
  });
});

describe('delete project plan copy', () => {
  it('shows only title and URL in the plan confirm message', () => {
    expect(
      buildDeleteProjectPlanMessage(
        'es',
        {} as never,
        {
          resolvedSlug: 'mi-proyecto',
          resolvedTitle: 'Mi Proyecto',
          resolvedUrl: 'https://webbin.com.mx/es/proyectos/mi-proyecto',
          source: 'url',
        },
      ),
    ).toBe(
      'Plan: borrar el proyecto **Mi Proyecto**.\nURL: https://webbin.com.mx/es/proyectos/mi-proyecto',
    );
  });

  it('uses delete CTAs, not create-draft wording', () => {
    expect(deleteProjectActionLabels.es.confirmPlan).toBe('Borrar proyecto');
    expect(deleteProjectActionLabels.es.confirmTarget).toBe('Sí, es este');
    for (const locale of ['es', 'en', 'de'] as const) {
      expect(deleteProjectActionLabels[locale].confirmPlan.toLowerCase()).not.toMatch(
        /borrador|draft|entwurf/,
      );
    }
  });

  it('detects project_not_found domain errors', () => {
    expect(
      isDeleteProjectNotFoundError(
        new DomainError('validation_error', 'missing', {
          code: 'project_not_found',
        }),
      ),
    ).toBe(true);
  });

  it('returns locale copy when project is missing', () => {
    expect(buildDeleteProjectNotFoundMessage('es')).toContain('ya no existe');
  });
});
