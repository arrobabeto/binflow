import { describe, expect, it } from 'vitest';

import {
  TelegramPollingLock,
  telegramPollingLockKey,
  type RedisPollingLockClient,
} from '../src/telegram-polling-lock.js';

const createMemoryRedis = (): RedisPollingLockClient & {
  store: Map<string, { value: string; expiresAt: number }>;
} => {
  const store = new Map<string, { value: string; expiresAt: number }>();
  const now = () => Date.now();
  const isAlive = (entry: { expiresAt: number } | undefined): boolean =>
    entry !== undefined && entry.expiresAt > now();

  return {
    store,
    async get(key) {
      const entry = store.get(key);
      return isAlive(entry) ? (entry?.value ?? null) : null;
    },
    async set(key, value, _expiryMode, expiryMs, setMode) {
      if (setMode === 'NX' && isAlive(store.get(key))) return null;
      store.set(key, { expiresAt: now() + expiryMs, value });
      return 'OK';
    },
    async eval(script, numKeys, ...args) {
      const keys = args.slice(0, numKeys);
      const argv = args.slice(numKeys);
      if (script.includes('pexpire')) {
        const entry = store.get(keys[0]!);
        if (entry?.value !== argv[0]) return 0;
        entry.expiresAt = now() + Number(argv[1]);
        return 1;
      }
      const entry = store.get(keys[0]!);
      if (entry?.value !== argv[0]) return 0;
      store.delete(keys[0]!);
      return 1;
    },
  };
};

describe('TelegramPollingLock', () => {
  it('grants polling to the first holder and denies the second', async () => {
    const redis = createMemoryRedis();
    const first = new TelegramPollingLock(redis, 'worker-a', 15_000);
    const second = new TelegramPollingLock(redis, 'worker-b', 15_000);

    await expect(first.tryAcquire('42')).resolves.toBe(true);
    await expect(second.tryAcquire('42')).resolves.toBe(false);
    expect(redis.store.get(telegramPollingLockKey('42'))?.value).toBe(
      'worker-a',
    );
  });

  it('releases the lock for the holder only', async () => {
    const redis = createMemoryRedis();
    const first = new TelegramPollingLock(redis, 'worker-a', 15_000);
    const second = new TelegramPollingLock(redis, 'worker-b', 15_000);

    await first.tryAcquire('42');
    await second.release('42');
    expect(redis.store.has(telegramPollingLockKey('42'))).toBe(true);

    await first.release('42');
    expect(redis.store.has(telegramPollingLockKey('42'))).toBe(false);
    await expect(second.tryAcquire('42')).resolves.toBe(true);
  });
});
