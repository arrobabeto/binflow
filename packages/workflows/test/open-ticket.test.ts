import { describe, expect, it } from 'vitest';

import {
  conversationalCourtesyReply,
  fallbackTicketEstimate,
  matchConversationalCourtesy,
  ticketPriorityFromUrgency,
} from '../src/open-ticket.js';

describe('open ticket helpers (ADR-0055)', () => {
  it('detects greetings and thanks without slash commands', () => {
    expect(matchConversationalCourtesy('hola')).toBe('greeting');
    expect(matchConversationalCourtesy('Hi!')).toBe('greeting');
    expect(matchConversationalCourtesy('gracias')).toBe('thanks');
    expect(matchConversationalCourtesy('thank you')).toBe('thanks');
    expect(matchConversationalCourtesy('/tools')).toBeNull();
    expect(matchConversationalCourtesy('cambia el texto del hero')).toBeNull();
  });

  it('returns polite localized courtesy copy', () => {
    expect(conversationalCourtesyReply('es', 'greeting')).toContain('/open_ticket');
    expect(conversationalCourtesyReply('en', 'thanks')).toContain('/tools');
  });

  it('maps urgency to ticket priority and builds a fallback estimate', () => {
    expect(ticketPriorityFromUrgency('normal')).toBe('medium');
    expect(ticketPriorityFromUrgency('urgent')).toBe('high');
    const estimate = fallbackTicketEstimate({
      intent: 'Quiero un formulario',
      kind: 'improvement',
      locale: 'es',
      requirement: 'Formulario de contacto',
      scope: 'Página de contacto',
      urgency: 'high',
    });
    expect(estimate.title).toContain('Formulario');
    expect(estimate.effortEstimate.length).toBeGreaterThan(10);
  });
});
