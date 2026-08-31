import { describe, expect, it } from 'vitest';

import { capabilityRegistry } from '@binflow/policies';

import {
  assertClientToolCatalogComplete,
  buildTelegramClientCommands,
  clientToolCatalog,
  formatInfoChooserMessage,
  formatInfoDetailMessage,
  formatInfoMissMessage,
  formatToolsListMessage,
  resolveClientToolCatalogEntry,
} from '../src/client-tool-catalog.js';

describe('client tool catalog (ADR-0054)', () => {
  it('covers every capability in the registry', () => {
    expect(() => assertClientToolCatalogComplete()).not.toThrow();
    expect(clientToolCatalog).toHaveLength(capabilityRegistry.length);
  });

  it('resolves by id, command, and localized title within enabled set', () => {
    const enabled = new Set(['edit_text', 'update_menu']);
    expect(resolveClientToolCatalogEntry('edit_text', enabled)?.capabilityId).toBe(
      'edit_text',
    );
    expect(
      resolveClientToolCatalogEntry('/edit_text', enabled)?.capabilityId,
    ).toBe('edit_text');
    expect(
      resolveClientToolCatalogEntry('Editar texto de página', enabled)
        ?.capabilityId,
    ).toBe('edit_text');
    expect(
      resolveClientToolCatalogEntry('edit_image', enabled),
    ).toBeUndefined();
  });

  it('formats a simple tools list with /info footer', () => {
    const enabled = [
      { id: 'edit_text', command: '/edit_text', displayName: 'Edit page text' },
      { id: 'update_menu', command: '/update_menu', displayName: 'Update menu' },
    ];
    const list = formatToolsListMessage('es', enabled);
    expect(list).toContain('Tools disponibles:');
    expect(list).toBe(
      [
        'Tools disponibles:',
        '/edit_text — Edit page text',
        '/update_menu — Update menu',
        '/open_ticket — Petición personalizada (ticket al admin)',
        '',
        'Más detalle de una tool: /info edit_text',
      ].join('\n'),
    );

    const chooser = formatInfoChooserMessage('es', enabled);
    expect(chooser).toContain('/info edit_text');

    const entry = resolveClientToolCatalogEntry('edit_text', new Set(['edit_text']));
    expect(entry).toBeDefined();
    const detail = formatInfoDetailMessage('es', entry!);
    expect(detail).toContain('/edit_text');
    expect(detail).toContain('Qué hace');

    expect(formatInfoMissMessage('es')).toContain('/tools');
  });

  it('builds setMyCommands payload with meta + deduped capability commands', () => {
    const commands = buildTelegramClientCommands('en', [
      'create_blog_draft',
      'create_blog_orbitype',
      'edit_text',
    ]);
    expect(commands.some((item) => item.command === '/tools')).toBe(true);
    expect(commands.some((item) => item.command === '/info')).toBe(true);
    const createBlog = commands.filter((item) => item.command === '/create_blog');
    expect(createBlog).toHaveLength(1);
    expect(createBlog[0]?.description.length).toBeGreaterThan(10);
    expect(createBlog[0]?.description.length).toBeLessThanOrEqual(256);
  });
});
