import { randomBytes } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { CredentialForVerification } from '@binflow/db';
import { encryptSecret } from '@binflow/secrets';

import {
  createOrbitypeBlogPublicationPort,
  createOrbitypeCredentialVerifier,
  markdownToOrbitypeHtml,
} from '../src/index.js';

const createInput = () => {
  const masterKey = randomBytes(32);
  const secretContext = {
    credentialId: 'orbitype-credential',
    keyVersion: 1,
    provider: 'orbitype-api',
    tenantId: 'tenant-demo',
  } as const;
  const plaintext = Buffer.from(JSON.stringify({ apiKey: 'fixture-api-key' }));
  const envelope = encryptSecret(plaintext, masterKey, secretContext);
  plaintext.fill(0);
  const credential: CredentialForVerification = {
    configuration: { baseUrl: 'https://core.orbitype.com/api/sql/v1' },
    connection: {
      configuration: { baseUrl: 'https://core.orbitype.com/api/sql/v1' },
      id: 'connection-1',
      projectId: 'project-demo',
      tenantId: 'tenant-demo',
    },
    envelope,
    id: secretContext.credentialId,
    kind: 'orbitype-api',
    ownerScope: 'project',
    projectId: 'project-demo',
    secretContext,
    status: 'unverified',
    tenantId: secretContext.tenantId,
    version: 1,
  };
  return {
    credential,
    masterKey,
    signal: AbortSignal.timeout(1_000),
  };
};

describe('Orbitype credential verifier', () => {
  it('probes with read-only SELECT 1 and returns allowlisted evidence', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      expect(String(input)).toBe('https://core.orbitype.com/api/sql/v1');
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('x-api-key')).toBe(
        'fixture-api-key',
      );
      expect(JSON.parse(String(init?.body))).toEqual({
        bindings: {},
        sql: 'SELECT 1 AS ok',
      });
      return new Response(JSON.stringify({ rows: [{ ok: 1 }] }), {
        status: 200,
      });
    });
    const verifier = createOrbitypeCredentialVerifier({ fetch });

    await expect(verifier.verify(createInput())).resolves.toEqual({
      authenticated: true,
      baseUrlHost: 'core.orbitype.com',
      externalResourceId: 'core.orbitype.com',
      readOnlyProbe: 'select_1',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('maps rejected keys to authentication_error', async () => {
    const verifier = createOrbitypeCredentialVerifier({
      fetch: vi.fn(async () => new Response('not found', { status: 404 })),
    });

    await expect(verifier.verify(createInput())).rejects.toMatchObject({
      category: 'authentication_error',
    });
  });

  it('rejects non-project scope', async () => {
    const input = createInput();
    input.credential = {
      ...input.credential,
      ownerScope: 'platform',
      projectId: undefined,
      tenantId: undefined,
    };
    const verifier = createOrbitypeCredentialVerifier({ fetch: vi.fn() });

    await expect(verifier.verify(input)).rejects.toMatchObject({
      category: 'policy_denied',
    });
  });
});

describe('Orbitype blog publication port', () => {
  it('creates Bistro-shaped posts rows and publishes by id', async () => {
    const calls: Array<{ bindings: Record<string, unknown>; sql: string }> =
      [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      calls.push(
        JSON.parse(String(init?.body)) as {
          bindings: Record<string, unknown>;
          sql: string;
        },
      );
      return new Response(JSON.stringify([{ id: 'bfde12345678' }]), {
        status: 200,
      });
    });
    const port = createOrbitypeBlogPublicationPort({
      apiKey: 'fixture-api-key',
      baseUrl: 'https://core.orbitype.com/api/sql/v1',
      fetch,
    });
    const draft = await port.createDraft({
      body: '## Hallo\n\nWillkommen im Bistro.',
      category: 'Gastronomie',
      img: '/images/blog/mittagskarte.avif',
      keywords: ['mittag', 'karte'],
      lead: 'Kurzer Lead',
      locale: 'de',
      requestVersionId: '01a0520d-3ece-75af-85fe-f4000bf7b4ad',
      slug: 'mittagskarte',
      title: 'Mittagskarte',
    });
    expect(draft.draftId.startsWith('bfde')).toBe(true);
    expect(calls[0]?.sql).toContain('INSERT INTO posts');
    expect(calls[0]?.sql).toContain('RETURNING id');
    expect(calls[0]?.bindings.title).toBe(
      JSON.stringify({ de: 'Mittagskarte' }),
    );
    expect(calls[0]?.bindings.lead).toBe(JSON.stringify({ de: 'Kurzer Lead' }));
    expect(calls[0]?.bindings.status).toBe(
      JSON.stringify({
        options: ['draft', 'review', 'published'],
        value: 'draft',
      }),
    );
    expect(calls[0]?.bindings.keywords).toBe(
      JSON.stringify(['mittag', 'karte']),
    );
    const sections = JSON.parse(String(calls[0]?.bindings.sections)) as Array<{
      _orbi: { component: string };
    }>;
    expect(sections.map((section) => section._orbi.component)).toEqual([
      'SectionPostHero',
      'SectionPostBody',
    ]);

    await port.publish({
      draftId: draft.draftId,
      requestVersionId: '01a0520d-3ece-75af-85fe-f4000bf7b4ad',
    });
    expect(calls[1]?.sql).toContain('UPDATE posts');
    expect(JSON.parse(String(calls[1]?.bindings.status))).toMatchObject({
      value: 'published',
    });
  });

  it('maps SQL 4xx to provider_final so BullMQ does not retry forever', async () => {
    const port = createOrbitypeBlogPublicationPort({
      apiKey: 'fixture-api-key',
      baseUrl: 'https://core.orbitype.com/api/sql/v1',
      fetch: vi.fn(async () =>
        new Response('column draft_id does not exist', { status: 400 }),
      ),
    });
    await expect(
      port.createDraft({
        body: 'x',
        locale: 'de',
        requestVersionId: 'version-1',
        slug: 'x',
        title: 'x',
      }),
    ).rejects.toMatchObject({
      category: 'provider_final',
      metadata: { code: 'orbitype_draft_failed' },
    });
  });

  it('renders markdown headings into HTML paragraphs', () => {
    expect(markdownToOrbitypeHtml('## Titel\n\nHallo & Welt')).toContain(
      '<h2>Titel</h2>',
    );
    expect(markdownToOrbitypeHtml('## Titel\n\nHallo & Welt')).toContain(
      'Hallo &amp; Welt',
    );
  });
});
