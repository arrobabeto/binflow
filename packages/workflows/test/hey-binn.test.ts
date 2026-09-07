import { describe, expect, it } from 'vitest';

import {
  HEY_BINN_THREAD_TTL_MS,
  isHeyBinnIngress,
  matchHeyBinnCommand,
  matchHeyBinnExit,
  matchHeyBinnGreeting,
} from '../src/hey-binn.js';
import { matchConversationalCourtesy } from '../src/open-ticket.js';
import { formatToolsListMessage } from '../src/client-tool-catalog.js';

describe('hey binn ingress (ADR-0062)', () => {
  it('matches /hey-binn with optional seed', () => {
    expect(matchHeyBinnCommand('/hey-binn')).toEqual({
      kind: 'command',
      seed: '',
    });
    expect(matchHeyBinnCommand('/hey-binn@Bot ideas for hero')).toEqual({
      kind: 'command',
      seed: 'ideas for hero',
    });
    expect(matchHeyBinnCommand('/open_ticket')).toBeNull();
  });

  it('matches Binn-addressed greetings without stealing tool NL', () => {
    expect(matchHeyBinnGreeting('Hey Binn')).toEqual({
      kind: 'greeting',
      seed: '',
    });
    expect(matchHeyBinnGreeting('hola binn, ayuda con el menú')).toEqual({
      kind: 'greeting',
      seed: 'ayuda con el menú',
    });
    expect(matchHeyBinnGreeting('Hallo Binn')).not.toBeNull();
    expect(matchHeyBinnGreeting('cambia el texto del hero')).toBeNull();
    expect(matchHeyBinnGreeting('hola')).toBeNull();
    expect(matchConversationalCourtesy('hola')).toBe('greeting');
  });

  it('matches explicit goodbye without stealing bare thanks', () => {
    expect(matchHeyBinnExit('/bye-binn')).toBe(true);
    expect(matchHeyBinnExit('Adios Binn')).toBe(true);
    expect(matchHeyBinnExit('Adiós Binn!')).toBe(true);
    expect(matchHeyBinnExit('Bye Binn')).toBe(true);
    expect(matchHeyBinnExit('Gracias Binn')).toBe(true);
    expect(matchHeyBinnExit('Danke Binn')).toBe(true);
    expect(matchHeyBinnExit('gracias')).toBe(false);
    expect(matchHeyBinnExit('bye')).toBe(false);
    expect(matchConversationalCourtesy('gracias')).toBe('thanks');
  });

  it('uses a 10-minute idle thread TTL', () => {
    expect(HEY_BINN_THREAD_TTL_MS).toBe(10 * 60 * 1_000);
  });

  it('exposes a combined ingress helper', () => {
    expect(isHeyBinnIngress('/hey-binn')).toBe(true);
    expect(isHeyBinnIngress('Hi Binn')).toBe(true);
    expect(isHeyBinnIngress('/bye-binn')).toBe(true);
    expect(isHeyBinnIngress('hi')).toBe(false);
  });

  it('lists hey-binn in /tools copy', () => {
    const list = formatToolsListMessage('en', [
      { command: '/edit_text', displayName: 'Edit text', id: 'edit_text' },
    ]);
    expect(list).toContain('/hey-binn');
    expect(list).toContain('/open_ticket');
  });
});
