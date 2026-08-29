import { describe, expect, it } from 'vitest';

import { createProjectAstroInputSchema } from '../src/index.js';

describe('createProjectAstroInputSchema collect mode', () => {
  it('parses collect and brief with closedFacts', () => {
    const collect = createProjectAstroInputSchema.parse({
      mode: 'collect',
      projectId: 'project-1',
      closedFacts: { name: 'Demo' },
      messages: ['Demo'],
    });
    expect(collect.mode).toBe('collect');
    expect(collect.closedFacts.name).toBe('Demo');

    const brief = createProjectAstroInputSchema.parse({
      mode: 'brief',
      projectId: 'project-1',
      brief: 'name: Demo',
      closedFacts: {
        name: 'Demo',
        fecha: '2024-01',
        projectDescription:
          'A portfolio case study description with enough detail for the base contract.',
      },
    });
    expect(brief.mode).toBe('brief');
    expect(brief.closedFacts?.name).toBe('Demo');
  });
});
