import { randomBytes } from 'node:crypto';

import type { ProjectManifest } from '@binflow/contracts';
import { DomainError } from '@binflow/domain';
import { describe, expect, it } from 'vitest';

import {
  createGitHubContentCatalogPort,
  resolveGitHubCatalogDirectories,
} from '../src/index.js';

const manifest = {
  content: {
    collections: {
      en: {
        directory: 'src/content/articulos',
        routePrefix: '/articulos',
      },
      es: {
        directory: 'src/content/articulos-es',
        routePrefix: '/es/articulos',
      },
    },
    portfolio: {
      collections: {
        en: {
          directory: 'src/content/proyectos',
          routePrefix: '/proyectos',
        },
        es: {
          directory: 'src/content/proyectos-es',
          routePrefix: '/es/proyectos',
        },
      },
    },
  },
} as ProjectManifest;

describe('resolveGitHubCatalogDirectories', () => {
  it('returns blog directories only when contentKinds is blog', () => {
    expect(resolveGitHubCatalogDirectories(manifest, ['blog'])).toEqual([
      {
        kind: 'blog',
        locale: 'en',
        prefix: 'src/content/articulos/',
      },
      {
        kind: 'blog',
        locale: 'es',
        prefix: 'src/content/articulos-es/',
      },
    ]);
  });

  it('returns portfolio directories only when contentKinds is portfolio', () => {
    expect(resolveGitHubCatalogDirectories(manifest, ['portfolio'])).toEqual([
      {
        kind: 'portfolio',
        locale: 'en',
        prefix: 'src/content/proyectos/',
      },
      {
        kind: 'portfolio',
        locale: 'es',
        prefix: 'src/content/proyectos-es/',
      },
    ]);
  });
});

describe('createGitHubContentCatalogPort scope', () => {
  it('rejects an empty contentKinds scope before contacting GitHub', () => {
    expect(() =>
      createGitHubContentCatalogPort({
        contentKinds: [],
        credential: {
          configuration: {},
          envelope: {
            ciphertext: Buffer.alloc(0),
            iv: Buffer.alloc(12),
            tag: Buffer.alloc(16),
          },
          id: 'unused',
          kind: 'github-app',
          ownerScope: 'platform',
          secretContext: {
            credentialId: 'unused',
            keyVersion: 1,
            provider: 'github-app',
            tenantId: 'platform',
          },
          status: 'active',
          version: 1,
        } as never,
        installationId: '1',
        masterKey: randomBytes(32),
        repositoryId: '2',
      }),
    ).toThrow(DomainError);

    try {
      createGitHubContentCatalogPort({
        contentKinds: [],
        credential: {} as never,
        installationId: '1',
        masterKey: randomBytes(32),
        repositoryId: '2',
      });
      expect.unreachable('expected catalog_scope_required');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect(error).toMatchObject({
        category: 'validation_error',
        metadata: { code: 'catalog_scope_required' },
      });
    }
  });
});
