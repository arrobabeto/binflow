import { describe, expect, it } from 'vitest';

import {
  HEY_BINN_THREAD_TTL_MS,
  allocateHeyBinnExcerpt,
  claimHeyBinnFreeTextRoute,
  isHeyBinnIngress,
  matchHeyBinnCommand,
  matchHeyBinnExit,
  matchHeyBinnGreeting,
  resolveFreeTextRouteOwner,
  stripMarkdownFrontmatter,
} from '../src/hey-binn.js';
import { matchConversationalCourtesy } from '../src/open-ticket.js';
import { formatToolsListMessage } from '../src/client-tool-catalog.js';

/** Mirrors create-blog NL in capability-ingress (order tests only). */
const blogNaturalLanguage = (text: string): boolean =>
  /\b(blog|article|artículo|articulo|beitrag|post)\b/iu.test(text);

describe('hey binn ingress (ADR-0062)', () => {
  it('matches /hey_binn with optional seed', () => {
    expect(matchHeyBinnCommand('/hey_binn')).toEqual({
      kind: 'command',
      seed: '',
    });
    expect(matchHeyBinnCommand('/hey_binn@Bot ideas for hero')).toEqual({
      kind: 'command',
      seed: 'ideas for hero',
    });
    expect(matchHeyBinnCommand('/hey-binn')).toEqual({
      kind: 'command',
      seed: '',
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
    expect(matchHeyBinnExit('/bye_binn')).toBe(true);
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
    expect(isHeyBinnIngress('/hey_binn')).toBe(true);
    expect(isHeyBinnIngress('Hi Binn')).toBe(true);
    expect(isHeyBinnIngress('/bye_binn')).toBe(true);
    expect(isHeyBinnIngress('hi')).toBe(false);
  });

  it('lists hey_binn in /tools copy', () => {
    const list = formatToolsListMessage('en', [
      { command: '/edit_text', displayName: 'Edit text', id: 'edit_text' },
    ]);
    expect(list).toContain('/hey_binn');
    expect(list).toContain('/open_ticket');
  });

  it('strips frontmatter and allocates excerpt budget', () => {
    const body = stripMarkdownFrontmatter(
      '---\ntitulo: Hello\n---\n\nBody paragraph one.\n\nMore.',
    );
    expect(body).toContain('Body paragraph one');
    expect(body).not.toContain('titulo');
    const first = allocateHeyBinnExcerpt({
      budgetRemaining: 20,
      text: 'abcdefghijklmnopqrstuvwxyz',
    });
    expect(first.excerpt?.length).toBeLessThanOrEqual(20);
    expect(first.spent).toBeGreaterThan(0);
    const second = allocateHeyBinnExcerpt({
      budgetRemaining: 0,
      text: 'ignored',
    });
    expect(second.excerpt).toBeUndefined();
  });

  it('claims active-thread and greeting free-text before create-blog NL', () => {
    expect(
      resolveFreeTextRouteOwner({
        hasActiveHeyBinnThread: true,
        text: 'analiza el blog',
        toolNaturalLanguageMatches: blogNaturalLanguage('analiza el blog'),
      }),
    ).toBe('hey_binn');
    expect(
      claimHeyBinnFreeTextRoute({
        hasActiveThread: true,
        text: 'analiza el blog',
      }),
    ).toEqual({ kind: 'active_thread', message: 'analiza el blog' });

    expect(
      resolveFreeTextRouteOwner({
        hasActiveHeyBinnThread: false,
        text: 'Hey Binn, analiza el blog',
        toolNaturalLanguageMatches: blogNaturalLanguage(
          'Hey Binn, analiza el blog',
        ),
      }),
    ).toBe('hey_binn');
    expect(
      claimHeyBinnFreeTextRoute({
        hasActiveThread: false,
        text: 'Hey Binn, analiza el blog',
      }),
    ).toEqual({
      kind: 'greeting',
      seed: 'analiza el blog',
    });

    expect(
      resolveFreeTextRouteOwner({
        hasActiveHeyBinnThread: false,
        text: 'analiza el blog',
        toolNaturalLanguageMatches: blogNaturalLanguage('analiza el blog'),
      }),
    ).toBe('tool_nl');

    expect(
      resolveFreeTextRouteOwner({
        hasActiveHeyBinnThread: true,
        text: '/create_blog tema de prueba',
        toolNaturalLanguageMatches: true,
      }),
    ).toBe('tool_nl');
    expect(
      claimHeyBinnFreeTextRoute({
        hasActiveThread: true,
        text: '/create_blog tema de prueba',
      }),
    ).toBeNull();
  });
});
