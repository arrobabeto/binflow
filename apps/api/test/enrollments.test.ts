import { describe, expect, it, vi } from 'vitest';

import type {
  Enrollment,
  ProjectManifest,
  RequestDetail,
} from '@binflow/contracts';

import { buildApp } from '../src/app.js';

const enrollment: Enrollment = {
  configuration: {},
  createdAt: '2026-08-18T00:00:00.000Z',
  currentStep: 1,
  id: 'enrollment-1',
  lastValidatedAt: null,
  projectId: 'project-1',
  projectKey: 'webbin',
  projectProfile: 'astro_repo',
  state: 'draft',
  tenantId: 'tenant-1',
  tenantKey: 'webbin',
  updatedAt: '2026-08-18T00:00:00.000Z',
  version: 1,
};

const manifest: ProjectManifest = {
  budgetPolicy: {
    maxEstimatedCostCentsPerDay: 2000,
    maxEstimatedCostCentsPerRequest: 500,
    maxModelCallsPerRequest: 12,
    maxRequestsPerDay: 10,
    maxTokensPerRequest: 120000,
  },
  content: {
    blockedPaths: ['.github/**'],
    collections: {
      en: { directory: 'src/content/articulos', routePrefix: '/articulos' },
      es: {
        directory: 'src/content/articulos-es',
        routePrefix: '/es/articulos',
      },
    },
    editablePaths: ['src/content/articulos/*.md'],
    frontmatterFields: ['titulo'],
    imageDirectory: 'public/images/articles',
    source: 'github',
  },
  contentLocales: ['es', 'en'],
  conversationLocale: 'es',
  defaultContentLocale: 'es',
  deployment: {
    previewMode: 'git_integration',
    projectId: 'vercel-project',
    protectionMode: 'vercel_auth',
    provider: 'vercel',
  },
  enabledCapabilities: [
    {
      access: 'client_publish',
      capabilityId: 'create_blog_draft',
      capabilityVersion: 1,
    },
  ],
  fingerprint: 'a'.repeat(64),
  globalProfileVersion: 'astro_repo@1',
  graphVersion: 'stacks/astro-repo/create-blog@1',
  id: 'manifest-1',
  profile: 'astro_repo',
  projectId: 'project-1',
  repository: {
    branchPattern: 'bot/webbin/{capability}/{request-id}-{slug}',
    githubInstallationId: 'installation-1',
    name: 'webbin',
    owner: 'arrobabeto',
    productionBranch: 'main',
  },
  requiredContentLocales: ['es', 'en'],
  rulesVersion: 'webbin-editorial@1',
  slugLocale: 'es',
  status: 'validated',
  translationPolicy: 'always_translate',
  validatedAt: '2026-08-18T00:00:00.000Z',
  validationProfileId: 'webbin-astro-repo@1',
  version: 1,
};

const createService = () => ({
  create: vi.fn(async () => enrollment),
  createPairingLink: vi.fn(async () => ({
    enrollment: {
      ...enrollment,
      state: 'pairing_pending' as const,
      version: 2,
    },
    expiresAt: '2026-08-19T00:00:00.000Z',
    pairingUrl: 'https://t.me/binflow_client_bot?start=one-time-token',
  })),
  get: vi.fn(async () => enrollment),
  getCapabilities: vi.fn(async () => ({
    items: [
      {
        access: 'client_publish' as const,
        command: '/create_blog' as const,
        displayName: 'Create blog' as const,
        enabled: true,
        id: 'create_blog_draft' as const,
        requiresPreview: true as const,
        riskClass: 'medium' as const,
        version: 1 as const,
      },
    ],
    manifestVersion: 1,
    projectId: 'project-1',
  })),
  getManifest: vi.fn(async () => ({
    globalProfile: {
      id: 'astro_repo' as const,
      supportedLocales: ['en', 'es', 'de'] as const,
      version: 'astro_repo@1',
    },
    manifest,
  })),
  evaluateActivation: vi.fn(async () => ({
    blockers: ['github_reversible_probe'],
    ready: false,
  })),
  list: vi.fn(async () => [enrollment]),
  update: vi.fn(async () => ({
    ...enrollment,
    state: 'configuring' as const,
    version: 2,
  })),
  validate: vi.fn(async () => ({ attempts: [], enrollment })),
});

const sessionResolver = vi.fn(async () => ({
  actorId: 'owner-1',
  email: 'owner@example.com',
  fresh: true,
  sessionId: 'session-1',
}));

const workflowRequest: RequestDetail = {
  capabilityId: 'create_blog_draft',
  clientKey: 'webbin',
  clientName: 'Webbin',
  confirmedAt: null,
  createdAt: '2026-08-18T00:00:00.000Z',
  currentVersion: 1,
  execution: null,
  failure: null,
  id: 'request-1',
  interpretedInput: {
    mode: 'brief',
    projectId: 'project-1',
    topic: 'A secure AI blog',
  },
  plan: { topic: 'A secure AI blog' },
  projectId: 'project-1',
  revision: 1,
  stages: [],
  state: 'AWAITING_PLAN_CONFIRMATION',
  tenantId: 'tenant-1',
  topic: 'A secure AI blog',
  updatedAt: '2026-08-18T00:00:00.000Z',
};

const workflowSummary = {
  capabilityId: workflowRequest.capabilityId,
  clientKey: workflowRequest.clientKey,
  clientName: workflowRequest.clientName,
  createdAt: workflowRequest.createdAt,
  currentVersion: workflowRequest.currentVersion,
  id: workflowRequest.id,
  projectId: workflowRequest.projectId,
  revision: workflowRequest.revision,
  state: workflowRequest.state,
  tenantId: workflowRequest.tenantId,
  topic: workflowRequest.topic,
  updatedAt: workflowRequest.updatedAt,
};

const createWorkflowService = () => ({
  approveAsAdmin: vi.fn(async () => ({
    ...workflowSummary,
    revision: 2,
    state: 'APPROVED_FOR_PUBLISH' as const,
  })),
  cancelAsAdmin: vi.fn(async () => ({
    ...workflowSummary,
    revision: 2,
    state: 'CANCELLED' as const,
  })),
  createAdminPairingLink: vi.fn(async () => ({
    expiresAt: '2026-08-19T00:00:00.000Z',
    pairingUrl: 'https://t.me/AdminBot?start=abcdefghijklmnopqrstuvwxyz012345',
  })),
  get: vi.fn(async () => workflowRequest),
  getAdminTelegramTarget: vi.fn(async () => null),
  list: vi.fn(async () => ({ items: [workflowSummary], nextCursor: null })),
  rejectAsAdmin: vi.fn(async () => ({
    ...workflowSummary,
    revision: 2,
    state: 'REVISION_REQUESTED' as const,
  })),
  reviseAsAdmin: vi.fn(async () => ({
    ...workflowSummary,
    currentVersion: 2,
    revision: 2,
    state: 'QUEUED' as const,
  })),
});

describe('client enrollment API', () => {
  it('projects requests and applies guarded cancellation', async () => {
    const workflowService = createWorkflowService();
    const app = buildApp({
      resolvePlatformOwnerSession: sessionResolver,
      trustedOrigin: 'http://localhost:3000',
      workflowService,
    });
    const list = await app.inject({ method: 'GET', url: '/api/v1/requests' });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({ items: [{ id: 'request-1' }] });
    expect(workflowService.list).toHaveBeenCalledWith(
      'owner-1',
      expect.any(String),
      { limit: 10 },
    );
    const paged = await app.inject({
      method: 'GET',
      url: '/api/v1/requests?limit=10&needsAdminApproval=true',
    });
    expect(paged.statusCode).toBe(200);
    expect(workflowService.list).toHaveBeenCalledWith(
      'owner-1',
      expect.any(String),
      { limit: 10, needsAdminApproval: true },
    );

    const cancelled = await app.inject({
      headers: {
        'content-type': 'application/json',
        'idempotency-key': '0123456789abcdef',
        'if-match': '"1"',
        origin: 'http://localhost:3000',
      },
      method: 'POST',
      payload: {},
      url: '/api/v1/requests/request-1/cancel',
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.headers.etag).toBe('"2"');
    expect(cancelled.json()).toMatchObject({ state: 'CANCELLED' });
    expect(workflowService.cancelAsAdmin).toHaveBeenCalledWith(
      'request-1',
      1,
      'owner-1',
      expect.any(String),
      '0123456789abcdef',
    );
    await app.close();
  });

  it('returns the mutable resource with a strong ETag', async () => {
    const service = createService();
    const app = buildApp({
      enrollmentService: service,
      resolvePlatformOwnerSession: sessionResolver,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/enrollments/enrollment-1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"1"');
    expect(response.json()).toEqual(enrollment);
    await app.close();
  });

  it('returns only the validated manifest and code-owned profile summary', async () => {
    const service = createService();
    const app = buildApp({
      enrollmentService: service,
      resolvePlatformOwnerSession: sessionResolver,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/enrollments/enrollment-1/manifest',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      globalProfile: { version: 'astro_repo@1' },
      manifest: { id: 'manifest-1', version: 1 },
    });
    await app.close();
  });

  it('returns only project-enabled code-owned capabilities', async () => {
    const service = createService();
    const app = buildApp({
      enrollmentService: service,
      resolvePlatformOwnerSession: sessionResolver,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/project-1/capabilities',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [{ id: 'create_blog_draft', version: 1 }],
      manifestVersion: 1,
      projectId: 'project-1',
    });
    await app.close();
  });

  it('requires a fresh session, trusted origin, idempotency and ETag for updates', async () => {
    const service = createService();
    const resolver = vi.fn(sessionResolver);
    const app = buildApp({
      enrollmentService: service,
      resolvePlatformOwnerSession: resolver,
      trustedOrigin: 'http://localhost:3000',
    });

    const response = await app.inject({
      headers: {
        'content-type': 'application/json',
        'idempotency-key': '0123456789abcdef',
        'if-match': '"1"',
        origin: 'http://localhost:3000',
      },
      method: 'PATCH',
      payload: { configuration: {}, currentStep: 2 },
      url: '/api/v1/admin/enrollments/enrollment-1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"2"');
    expect(resolver).toHaveBeenCalledWith(expect.any(Headers), {
      fresh: true,
      twoFactor: true,
    });
    expect(service.update).toHaveBeenCalledWith(
      'enrollment-1',
      { configuration: {}, currentStep: 2 },
      1,
      expect.objectContaining({ actorId: 'owner-1' }),
    );
    await app.close();
  });

  it('rejects stale or missing mutation guards before calling the service', async () => {
    const service = createService();
    const app = buildApp({
      enrollmentService: service,
      resolvePlatformOwnerSession: sessionResolver,
    });

    const response = await app.inject({
      headers: { origin: 'http://localhost:3000' },
      method: 'PATCH',
      payload: { configuration: {}, currentStep: 2 },
      url: '/api/v1/admin/enrollments/enrollment-1',
    });

    expect(response.statusCode).toBe(400);
    expect(service.update).not.toHaveBeenCalled();
    await app.close();
  });

  it('keeps activation fail-closed while mutable evidence is absent', async () => {
    const service = createService();
    const app = buildApp({
      enrollmentService: service,
      resolvePlatformOwnerSession: sessionResolver,
    });

    const response = await app.inject({
      headers: {
        'content-type': 'application/json',
        'idempotency-key': '0123456789abcdef',
        'if-match': '"1"',
        origin: 'http://localhost:3000',
      },
      method: 'POST',
      payload: {},
      url: '/api/v1/admin/enrollments/enrollment-1/activate',
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: { code: 'activation_evidence_missing' },
    });
    await app.close();
  });
});
