import { describe, expect, it } from 'vitest';

import type { RepositoryPublicationPort } from '@binflow/blog';

import {
  buildTextEditGithubDraftFiles,
  fallbackTextEditGithubPath,
} from '../src/edit-text.js';
import { applyTextFieldPatch } from '../src/discover-editable-copy.js';

describe('buildTextEditGithubDraftFiles', () => {
  it('always returns at least one draft file when no CMS mirror exists', async () => {
    const repository: RepositoryPublicationPort = {
      async createDraft() {
        throw new Error('unused');
      },
      async merge() {
        throw new Error('unused');
      },
      async readFileAtRef() {
        return null;
      },
      async revalidate() {},
    };
    const page = {
      id: 'page-home',
      sections: [{ content: { de: 'Alt' } }],
      slug: 'home',
      title: { de: 'Home' },
    };
    const resolved = {
      currentValue: 'Alt',
      field: 'content',
      key: 'home:0:content:de',
      label: 'Alt',
      locale: 'de' as const,
      pageId: 'page-home',
      pageSlug: 'home',
      pageTitle: 'Home',
      sectionIndex: 0,
    };
    const patchedSections = applyTextFieldPatch(page.sections, {
      field: 'content',
      locale: 'de',
      newValue: 'Neu',
      sectionIndex: 0,
    });
    const draft = await buildTextEditGithubDraftFiles({
      defaultBranchRef: 'main',
      editablePaths: ['cms/collections/**'],
      newValue: 'Neu',
      page,
      patchedSections,
      repository,
      resolved,
    });
    expect(draft.files).toHaveLength(1);
    expect(draft.path).toBe(fallbackTextEditGithubPath('home'));
    expect(new TextDecoder().decode(draft.files[0]!.bytes)).toContain('Neu');
  });

  it('patches an existing mirror that contains the old value', async () => {
    const repository: RepositoryPublicationPort = {
      async createDraft() {
        throw new Error('unused');
      },
      async merge() {
        throw new Error('unused');
      },
      async readFileAtRef(input) {
        if (input.path === 'cms/collections/home.json')
          return new TextEncoder().encode('{"content":"Alt text"}');
        return null;
      },
      async revalidate() {},
    };
    const page = {
      id: 'page-home',
      sections: [{ content: { de: 'Alt text' } }],
      slug: 'home',
      title: { de: 'Home' },
    };
    const resolved = {
      currentValue: 'Alt text',
      field: 'content',
      key: 'home:0:content:de',
      label: 'Alt text',
      locale: 'de' as const,
      pageId: 'page-home',
      pageSlug: 'home',
      pageTitle: 'Home',
      sectionIndex: 0,
    };
    const draft = await buildTextEditGithubDraftFiles({
      defaultBranchRef: 'main',
      editablePaths: ['cms/collections/**'],
      newValue: 'Neu text',
      page,
      patchedSections: page.sections,
      repository,
      resolved,
    });
    expect(draft.path).toBe('cms/collections/home.json');
    expect(new TextDecoder().decode(draft.files[0]!.bytes)).toContain('Neu text');
  });
});
