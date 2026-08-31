import { describe, expect, it } from 'vitest';

import {
  selectSendOnlyTelegramBotsToPromote,
  selectUnstartedTelegramBots,
} from '../src/telegram-runtime-reconcile.js';

describe('selectUnstartedTelegramBots', () => {
  it('returns only bots that are not already started', () => {
    const started = new Set(['1']);
    expect(
      selectUnstartedTelegramBots(started, [
        { botId: '1', kind: 'telegram-admin' },
        { botId: '2', kind: 'telegram-client' },
        { botId: '3', kind: 'telegram-client' },
      ]),
    ).toEqual([
      { botId: '2', kind: 'telegram-client' },
      { botId: '3', kind: 'telegram-client' },
    ]);
  });

  it('deduplicates candidates by botId', () => {
    expect(
      selectUnstartedTelegramBots(new Set(), [
        { botId: '9', kind: 'telegram-client' },
        { botId: '9', kind: 'telegram-client' },
      ]),
    ).toEqual([{ botId: '9', kind: 'telegram-client' }]);
  });
});

describe('selectSendOnlyTelegramBotsToPromote', () => {
  it('returns only send-only bots that remain active candidates', () => {
    expect(
      selectSendOnlyTelegramBotsToPromote(new Set(['2', '9']), [
        { botId: '1', kind: 'telegram-admin' },
        { botId: '2', kind: 'telegram-client' },
        { botId: '3', kind: 'telegram-client' },
      ]),
    ).toEqual([{ botId: '2', kind: 'telegram-client' }]);
  });
});
