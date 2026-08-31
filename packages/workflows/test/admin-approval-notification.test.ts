import { describe, expect, it } from 'vitest';

import {
  encodeAdminAction,
  parseAdminAction,
} from '../src/admin-approval-notification.js';

describe('admin approval action encoding', () => {
  it('round-trips bindings when deployment ids contain colons', () => {
    const bindings = {
      artifactId: '01a05677-8614-75d7-9726-3d0bdf0be98b',
      deploymentId: 'deletion-pr:3bea31a31761d1a96b38d480681e46de835f3da7',
      headCommitSha: '3bea31a31761d1a96b38d480681e46de835f3da7',
    };
    const encoded = encodeAdminAction('approve_publish', bindings);
    expect(parseAdminAction(encoded)).toEqual({
      bindings,
      kind: 'approve_publish',
    });
  });

  it('does not parse legacy colon payloads with extra segments', () => {
    expect(
      parseAdminAction(
        'approve_publish:3bea31a31761d1a96b38d480681e46de835f3da7:deletion-pr:3bea31a31761d1a96b38d480681e46de835f3da7:01a05677-8614-75d7-9726-3d0bdf0be98b',
      ),
    ).toBeNull();
  });
});
