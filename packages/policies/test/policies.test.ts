import { describe, expect, it } from 'vitest';

import { DomainError } from '@binflow/domain';

import {
  assertKnownBinding,
  capabilityRegistry,
  decideBlogPublicationPolicy,
  decideProjectPublicationPolicy,
  projectCapabilityCatalog,
  webbinCapabilityBinding,
  webbinDeleteBlogCapabilityBinding,
  webbinProjectCapabilityBinding,
  decideBlogDeletionPolicy,
  decideProjectDeletionPolicy,
  webbinDeleteProjectCapabilityBinding,
} from '../src/index.js';

describe('code-owned capability policy', () => {
  it('exposes Webbin blog, project and delete capabilities', () => {
    expect(capabilityRegistry).toHaveLength(6);
    expect(
      projectCapabilityCatalog([
        webbinCapabilityBinding,
        webbinProjectCapabilityBinding,
        webbinDeleteBlogCapabilityBinding,
        webbinDeleteProjectCapabilityBinding,
      ]),
    ).toEqual([
      expect.objectContaining({
        access: 'client_publish',
        command: '/create_blog',
        enabled: true,
        id: 'create_blog_draft',
        version: 1,
      }),
      expect.objectContaining({
        access: 'client_publish',
        command: '/create_project',
        enabled: true,
        id: 'create_project_astro',
        version: 1,
      }),
      expect.objectContaining({
        access: 'client_publish',
        command: '/delete_blog',
        enabled: true,
        id: 'delete_blog_draft',
        requiresPreview: false,
        version: 2,
      }),
      expect.objectContaining({
        access: 'client_publish',
        command: '/delete_project',
        enabled: true,
        id: 'delete_project_astro',
        requiresPreview: false,
        version: 2,
      }),
    ]);
  });

  it('rejects unknown capability definitions while allowing access levels', () => {
    expect(() =>
      assertKnownBinding({
        access: 'admin_only',
        capabilityId: 'create_blog_draft',
        capabilityVersion: 1,
      }),
    ).not.toThrow();
    expect(() =>
      assertKnownBinding({
        access: 'client_publish',
        capabilityId: 'unknown_tool',
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

  it('requires only client approval for portfolio projects', () => {
    expect(
      decideProjectPublicationPolicy({
        editablePaths: ['src/content/proyectos/*.md'],
      }).requiredApprovals,
    ).toEqual(['client']);
  });

  it('requires admin-only approval for blog deletion', () => {
    expect(
      decideBlogDeletionPolicy({
        editablePaths: ['src/content/articulos/*.md'],
      }).requiredApprovals,
    ).toEqual(['admin']);
  });

  it('requires admin-only approval for portfolio project deletion', () => {
    expect(
      decideProjectDeletionPolicy({
        editablePaths: ['src/content/proyectos/*.md'],
      }).requiredApprovals,
    ).toEqual(['admin']);
  });
});
