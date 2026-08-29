import { describe, expect, it } from 'vitest';

import type { Enrollment, RequestSummary } from '@binflow/contracts';

import {
  buildAttentionItems,
  buildClientSummaries,
  countPendingApprovals,
  countRequestsOnUtcDay,
  formatApproximateCount,
  pendingApprovalsByProject,
  requestsByProjectOnUtcDay,
  summarizeClientMix,
  summarizeSystemHealth,
} from '../app/lib/overview-metrics';

const enrollment = (
  overrides: Partial<Enrollment> &
    Pick<Enrollment, 'id' | 'projectId' | 'state' | 'tenantKey'>,
): Enrollment => ({
  configuration: {
    clientConversationLocale: 'es',
    contentLocales: ['es', 'en'],
    requiredLocales: ['es', 'en'],
    translationPolicy: 'always_translate',
  },
  createdAt: '2026-08-18T00:00:00.000Z',
  currentStep: 7,
  lastValidatedAt: null,
  projectKey: 'project',
  projectProfile: 'astro_repo',
  tenantId: 'tenant-id',
  updatedAt: '2026-08-18T00:00:00.000Z',
  version: 1,
  ...overrides,
});

const request = (
  overrides: Partial<RequestSummary> &
    Pick<RequestSummary, 'id' | 'projectId' | 'createdAt'>,
): RequestSummary => ({
  approvalStatus: null,
  capabilityId: 'create_blog_draft',
  clientKey: 'client',
  clientName: 'Client',
  currentVersion: 1,
  revision: 1,
  state: 'AWAITING_ADMIN_APPROVAL',
  tenantId: 'tenant-id',
  topic: 'Topic',
  updatedAt: overrides.createdAt,
  ...overrides,
});

describe('overview-metrics', () => {
  it('summarizes client mix and builds cards', () => {
    const enrollments = [
      enrollment({
        id: 'e1',
        projectId: 'p1',
        state: 'active',
        tenantKey: 'webbin',
      }),
      enrollment({
        id: 'e2',
        projectId: 'p2',
        state: 'pairing_pending',
        tenantKey: 'acme',
      }),
    ];
    expect(summarizeClientMix(enrollments)).toEqual({
      active: 1,
      attention: 1,
      total: 2,
    });
    const cards = buildClientSummaries(
      enrollments,
      new Map([['p1', 2]]),
      new Map([['p1', 1]]),
    );
    expect(cards[0]?.label).toBe('Acme');
    expect(cards[1]).toMatchObject({
      label: 'Webbin',
      pendingApprovals: 1,
      requestsToday: 2,
      showEnrollmentStep: false,
    });
  });

  it('counts pending approvals and requests on a UTC day', () => {
    const items = [
      request({
        createdAt: '2026-08-29T10:00:00.000Z',
        id: 'r1',
        projectId: 'p1',
      }),
      request({
        createdAt: '2026-08-28T10:00:00.000Z',
        id: 'r2',
        projectId: 'p1',
      }),
    ];
    expect(countPendingApprovals(items, null)).toEqual({
      approximate: false,
      value: 2,
    });
    expect(countPendingApprovals(items, 'cursor')).toEqual({
      approximate: true,
      value: 2,
    });
    expect(countRequestsOnUtcDay(items, '2026-08-29', true)).toEqual({
      approximate: true,
      value: 1,
    });
    expect(formatApproximateCount({ approximate: true, value: 3 })).toBe('3+');
    expect(requestsByProjectOnUtcDay(items, '2026-08-29').get('p1')).toBe(1);
    expect(pendingApprovalsByProject(items).get('p1')).toBe(2);
  });

  it('summarizes system health and attention items', () => {
    expect(
      summarizeSystemHealth({ status: 'ok' }, { status: 'ready' }),
    ).toMatchObject({ ready: true, status: 'Healthy' });
    expect(
      summarizeSystemHealth({ status: 'ok' }, { status: 'not_ready' }),
    ).toMatchObject({ ready: false, status: 'Degraded' });
    const attention = buildAttentionItems({
      credentials: [
        { alias: 'OpenAI', id: 'c1', status: 'unverified' },
        { alias: 'GitHub', id: 'c2', status: 'active' },
      ],
      enrollments: [
        enrollment({
          id: 'e1',
          projectId: 'p1',
          state: 'validation_failed',
          tenantKey: 'webbin',
        }),
      ],
      pendingApprovals: { approximate: false, value: 2 },
      readinessStatus: 'not_ready',
    });
    expect(attention.map((item) => item.id)).toEqual([
      'pending-approvals',
      'credentials',
      'readiness',
      'enrollment-e1',
    ]);
  });
});
