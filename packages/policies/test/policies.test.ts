import { describe, expect, it } from 'vitest';

import { DomainError } from '@binflow/domain';

import {
  assertKnownBinding,
  capabilityRegistry,
  decideBlogPublicationPolicy,
  projectCapabilityCatalog,
  webbinCapabilityBinding,
} from '../src/index.js';

describe('code-owned capability policy', () => {
  it('exposes only create_blog_draft@1 for Webbin', () => {
    expect(capabilityRegistry).toHaveLength(1);
    expect(projectCapabilityCatalog([webbinCapabilityBinding])).toEqual([
      expect.objectContaining({
        access: 'client_publish',
        command: '/create_blog',
        enabled: true,
        id: 'create_blog_draft',
        version: 1,
      }),
    ]);
  });

  it('rejects an administrator or model widening the binding', () => {
    expect(() =>
      assertKnownBinding({
        access: 'admin_only',
        capabilityId: 'create_blog_draft',
        capabilityVersion: 1,
      }),
    ).toThrow(DomainError);
    expect(projectCapabilityCatalog([])).toEqual([]);
  });

  it('adds admin approval only for a new category', () => {
    expect(
      decideBlogPublicationPolicy({
        categoryKind: 'existing',
        editablePaths: ['src/content/articulos/*.md'],
      }).requiredApprovals,
    ).toEqual(['client']);
    expect(
      decideBlogPublicationPolicy({
        categoryKind: 'new',
        editablePaths: ['src/content/articulos/*.md'],
      }).requiredApprovals,
    ).toEqual(['client', 'admin']);
  });
});
