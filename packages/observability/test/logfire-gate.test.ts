import { describe, expect, it } from 'vitest';

import { isLogfireTokenPresent } from '../src/index.js';

describe('observability logfire gate', () => {
  it('reports token presence without echoing the value', () => {
    const previous = process.env.LOGFIRE_TOKEN;
    delete process.env.LOGFIRE_TOKEN;
    expect(isLogfireTokenPresent()).toBe(false);
    process.env.LOGFIRE_TOKEN = '  ';
    expect(isLogfireTokenPresent()).toBe(false);
    process.env.LOGFIRE_TOKEN = 'test-token-not-a-secret-for-assert';
    expect(isLogfireTokenPresent()).toBe(true);
    if (previous === undefined) delete process.env.LOGFIRE_TOKEN;
    else process.env.LOGFIRE_TOKEN = previous;
  });
});
