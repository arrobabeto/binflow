export type RedisPollingLockClient = Readonly<{
  eval(
    script: string,
    numKeys: number,
    ...args: string[]
  ): Promise<unknown>;
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    expiryMode: 'PX',
    expiryMs: number,
    setMode: 'NX',
  ): Promise<'OK' | null>;
}>;

export const telegramPollingLockKey = (botId: string): string =>
  `binflow:telegram:polling:${botId}`;

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`.trim();

const RENEW_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
else
  return 0
end
`.trim();

export class TelegramPollingLock {
  private readonly held = new Set<string>();

  public constructor(
    private readonly redis: RedisPollingLockClient,
    private readonly holderId: string,
    private readonly ttlMs: number,
  ) {}

  public async tryAcquire(botId: string): Promise<boolean> {
    const key = telegramPollingLockKey(botId);
    const acquired = await this.redis.set(
      key,
      this.holderId,
      'PX',
      this.ttlMs,
      'NX',
    );
    if (acquired === 'OK') {
      this.held.add(botId);
      return true;
    }
    const current = await this.redis.get(key);
    if (current !== this.holderId) return false;
    await this.redis.eval(RENEW_SCRIPT, 1, key, this.holderId, String(this.ttlMs));
    this.held.add(botId);
    return true;
  }

  public async renewHeld(): Promise<void> {
    await Promise.all(
      [...this.held].map(async (botId) => {
        const renewed = await this.redis.eval(
          RENEW_SCRIPT,
          1,
          telegramPollingLockKey(botId),
          this.holderId,
          String(this.ttlMs),
        );
        if (renewed !== 1) this.held.delete(botId);
      }),
    );
  }

  public async release(botId: string): Promise<void> {
    if (!this.held.has(botId)) return;
    await this.redis.eval(
      RELEASE_SCRIPT,
      1,
      telegramPollingLockKey(botId),
      this.holderId,
    );
    this.held.delete(botId);
  }

  public async releaseAll(): Promise<void> {
    await Promise.all([...this.held].map((botId) => this.release(botId)));
  }
}
