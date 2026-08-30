import { describe, expect, it } from 'vitest';

import {
  allRequestInboxClients,
  formatClientKeyLabel,
  labeledRecordFields,
  requestCardAccentClass,
  requestCardTone,
  requestCardToneClass,
  requestInboxClientOptions,
  requestInboxProjectFilter,
  requestListSearchParams,
  requestStateAccent,
  requestStateBadgeColor,
} from '../app/lib/request-inbox';

const enrollmentFixture = (
  overrides: Partial<{
    id: string;
    projectId: string;
    projectKey: string;
    projectProfile: string;
    state: 'draft' | 'active' | 'revalidation_required';
    tenantId: string;
    tenantKey: string;
  }>,
) => ({
  configuration: {
    clientConversationLocale: 'es',
    contentLocales: ['es', 'en'],
    requiredLocales: ['es', 'en'],
    translationPolicy: 'always_translate' as const,
  },
  createdAt: '2026-08-18T00:00:00.000Z',
  currentStep: 11,
  id: 'enrollment-id',
  lastValidatedAt: null,
  projectId: 'project-id',
  projectKey: 'project',
  projectProfile: 'astro_repo',
  state: 'draft' as const,
  tenantId: 'tenant-id',
  tenantKey: 'tenant',
  updatedAt: '2026-08-18T00:00:00.000Z',
  version: 1,
  ...overrides,
});

describe('request inbox helpers', () => {
  it('formats client labels and merges enrollment and request sources', () => {
    expect(formatClientKeyLabel('webbin')).toBe('Webbin');
    expect(
      requestInboxClientOptions(
        [
          enrollmentFixture({
            id: 'enrollment-draft',
            projectId: 'project-draft',
            projectKey: 'draft',
            state: 'draft',
            tenantId: 'tenant-draft',
            tenantKey: 'draft',
          }),
          enrollmentFixture({
            id: 'enrollment-webbin',
            lastValidatedAt: '2026-08-18T00:00:00.000Z',
            projectId: 'project-webbin',
            projectKey: 'webbin',
            state: 'active',
            tenantId: 'tenant-webbin',
            tenantKey: 'webbin',
          }),
          enrollmentFixture({
            id: 'enrollment-revalidate',
            projectId: 'project-revalidate',
            projectKey: 'revalidate',
            state: 'revalidation_required',
            tenantId: 'tenant-revalidate',
            tenantKey: 'revalidate-client',
          }),
        ],
        [
          {
            clientName: 'Webbin',
            projectId: 'project-webbin',
          },
        ],
      ),
    ).toEqual([
      { label: 'Revalidate Client', projectId: 'project-revalidate' },
      { label: 'Webbin', projectId: 'project-webbin' },
    ]);
    expect(
      requestListSearchParams({
        cursor: 'abc',
        limit: 30,
        needsAdminApproval: false,
        projectId: 'project-webbin',
      }),
    ).toBe(
      'limit=30&needsAdminApproval=false&projectId=project-webbin&cursor=abc',
    );
  });

  it('maps the all-clients sentinel to an absent project filter', () => {
    expect(allRequestInboxClients).not.toBe('');
    expect(requestInboxProjectFilter(allRequestInboxClients)).toBeUndefined();
    expect(requestInboxProjectFilter('')).toBeUndefined();
    expect(requestInboxProjectFilter('project-webbin')).toBe('project-webbin');
    expect(
      requestListSearchParams({
        limit: 10,
        needsAdminApproval: true,
        projectId: requestInboxProjectFilter(allRequestInboxClients),
      }),
    ).toBe('limit=10&needsAdminApproval=true');
  });

  it('labels request fields without empty dumps', () => {
    expect(
      labeledRecordFields({
        apiKey: '',
        keywords: ['ia', 'seguridad'],
        topic: 'Automatización',
      }),
    ).toEqual([
      { label: 'keywords', value: 'ia, seguridad' },
      { label: 'topic', value: 'Automatización' },
    ]);
    expect(labeledRecordFields(null)).toEqual([]);
  });

  it('accents request cards from workflow state (Figma)', () => {
    expect(requestStateAccent('COMPLETED')).toBe('success');
    expect(requestStateAccent('PREVIEW_DEPLOYING')).toBe('primary');
    expect(requestStateAccent('REVISION_REQUESTED')).toBe('warning');
    expect(requestStateAccent('AWAITING_ADMIN_APPROVAL')).toBe('warning');
    expect(requestStateAccent('CANCELLED')).toBe('neutral');
    expect(requestStateAccent('FAILED_FINAL')).toBe('error');
    expect(requestCardAccentClass('success')).toContain('border-l-emerald-500');
    expect(requestCardAccentClass('primary')).toContain('border-l-blue-500');
    expect(requestCardAccentClass('warning')).toContain('border-l-amber-500');
    expect(requestCardAccentClass('neutral')).toContain('binflow-border');
    expect(requestStateBadgeColor('CANCELLED')).toBe('neutral');
    expect(requestStateBadgeColor('COMPLETED')).toBe('success');
  });

  it('keeps legacy approval tone helpers mapped to accents', () => {
    expect(
      requestCardTone({
        approvalStatus: 'approved_for_publish',
        state: 'APPROVED_FOR_PUBLISH',
      }),
    ).toBe('approved');
    expect(
      requestCardTone({
        approvalStatus: 'admin_rejected',
        state: 'REVISION_REQUESTED',
      }),
    ).toBe('rejected');
    expect(requestCardToneClass('approved')).toContain('border-l-emerald-500');
    expect(requestCardToneClass('rejected')).toContain('border-l-amber-500');
  });
});
