import { describe, expect, it } from 'vitest';

import {
  astroRepoGlobalProfile,
  buildProjectManifest,
  type BuildManifestInput,
  webbinBudgetDefaults,
} from '../src/index.js';

const input = (): BuildManifestInput => ({
  configuration: {
    budgetPolicy: webbinBudgetDefaults,
    clientConversationLocale: 'de' as const,
    contentLocales: ['en', 'es'],
    defaultContentLocale: 'es' as const,
    requiredLocales: ['es', 'en'],
    slugLocale: 'es' as const,
    translationPolicy: 'always_translate' as const,
  },
  id: 'manifest-1',
  projectId: 'project-1',
  projectKey: 'webbin',
  tenantKey: 'webbin',
  validatedAt: new Date('2026-08-18T00:00:00.000Z'),
  verifiedBindings: {
    github: {
      defaultBranch: 'main',
      installationId: '153846942',
      repository: 'arrobabeto/webbin',
    },
    vercel: {
      productionBranch: 'main',
      projectId: 'prj_webbin',
      repository: 'arrobabeto/webbin',
      teamId: 'team_webbin',
    },
  },
  version: 1,
});

describe('project manifest', () => {
  it('narrows the global profile to the exact Webbin contract', () => {
    const manifest = buildProjectManifest(input());

    expect(astroRepoGlobalProfile.supportedLocales).toEqual(['en', 'es', 'de']);
    expect(manifest.contentLocales).toEqual(['es', 'en']);
    expect(manifest.defaultContentLocale).toBe('es');
    expect(manifest.translationPolicy).toBe('always_translate');
    expect(manifest.content.editablePaths).toEqual([
      'src/content/articulos/*.md',
      'src/content/articulos-es/*.md',
      'public/images/articles/*.avif',
      'public/_redirects',
      'src/content/proyectos/*.md',
      'src/content/proyectos-es/*.md',
      'public/images/projects/*.jpg',
      'public/images/projects/*.avif',
    ]);
    expect(manifest.content.portfolio?.editablePaths).toEqual([
      'src/content/proyectos/*.md',
      'src/content/proyectos-es/*.md',
      'public/images/projects/*.jpg',
      'public/images/projects/*.avif',
    ]);
    expect(manifest.content.portfolio?.collections.es?.directory).toBe(
      'src/content/proyectos-es',
    );
    expect(manifest.content.portfolio?.sectionHeadings.en?.challenge).toBe(
      'Challenge',
    );
    expect(manifest.content.portfolio?.enumFields?.tipo).toContain('Sitio web');
    expect(manifest.enabledCapabilities).toEqual([
      {
        access: 'client_publish',
        capabilityId: 'create_blog_draft',
        capabilityVersion: 1,
      },
      {
        access: 'client_publish',
        capabilityId: 'create_project_astro',
        capabilityVersion: 1,
      },
      {
        access: 'client_publish',
        capabilityId: 'delete_blog_draft',
        capabilityVersion: 2,
      },
    ]);
  });

  it('rejects locale, translation and provider expansion', () => {
    expect(() =>
      buildProjectManifest({
        ...input(),
        configuration: {
          ...input().configuration,
          contentLocales: ['es', 'en', 'de'],
        },
      }),
    ).toThrow(/exactly Spanish and English/);
    expect(() =>
      buildProjectManifest({
        ...input(),
        configuration: {
          ...input().configuration,
          translationPolicy: 'ask_each_action',
        },
      }),
    ).toThrow(/always translate/);
    expect(() =>
      buildProjectManifest({
        ...input(),
        verifiedBindings: {
          ...input().verifiedBindings,
          github: {
            ...input().verifiedBindings.github,
            repository: 'arrobabeto/another-repo',
          },
        },
      }),
    ).toThrow(/do not match the Webbin pilot/);
  });

  it('rejects an invalid budget ceiling', () => {
    expect(() =>
      buildProjectManifest({
        ...input(),
        configuration: {
          ...input().configuration,
          budgetPolicy: {
            ...webbinBudgetDefaults,
            maxEstimatedCostCentsPerDay: 100,
          },
        },
      }),
    ).toThrow(/Daily estimated cost/);
  });
});
