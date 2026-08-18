import { describe, expect, it } from 'vitest';

import { MemoryArtifactStore } from '../src/index.js';

describe('artifact store contract', () => {
  it('round trips isolated keys and rejects traversal', async () => {
    const store = new MemoryArtifactStore();
    await store.put({
      bytes: new Uint8Array([1, 2, 3]),
      key: 'tenant/project/request/file.avif',
    });
    expect(await store.get('tenant/project/request/file.avif')).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    await expect(
      store.put({ bytes: new Uint8Array(), key: '../secret' }),
    ).rejects.toMatchObject({ category: 'policy_denied' });
  });
});
