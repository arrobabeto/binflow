import { describe, expect, it } from 'vitest';

import {
  CREATE_BLOG_EXECUTION_STAGES,
  CREATE_PROJECT_EXECUTION_STAGES,
  assertBlogExecutionStagesMatchGraph,
  assertProjectExecutionStagesMatchGraph,
  composeGenerationPrompt,
  getTool,
  listTools,
  validateCustomizationDocument,
} from '../src/load.js';

describe('@binflow/tools catalog', () => {
  it('loads Astro tools with matching executor stages', async () => {
    const tools = await listTools();
    expect(tools).toHaveLength(4);
    const blog = tools.find((tool) => tool.tool.id === 'create_blog_draft');
    const project = tools.find((tool) => tool.tool.id === 'create_project_astro');
    const deleteBlog = tools.find((tool) => tool.tool.id === 'delete_blog_draft');
    const deleteProject = tools.find(
      (tool) => tool.tool.id === 'delete_project_astro',
    );
    expect(blog?.tool.profile).toBe('astro_repo');
    expect(project?.tool.profile).toBe('astro_repo');
    expect(deleteBlog?.tool.profile).toBe('astro_repo');
    expect(deleteProject?.tool.profile).toBe('astro_repo');
    expect(blog?.graph.version).toBe('stacks/astro-repo/create-blog@1');
    expect(project?.graph.version).toBe('stacks/astro-repo/create-project@4');
    expect(deleteBlog?.graph.version).toBe('stacks/astro-repo/delete-blog@1');
    expect(deleteProject?.graph.version).toBe(
      'stacks/astro-repo/delete-project@1',
    );
    expect(deleteProject?.nodes.some((node) => node.id === 'open_deletion_pr')).toBe(
      true,
    );
    expect(deleteProject?.nodes.some((node) => node.id === 'wait_preview')).toBe(
      false,
    );
    assertBlogExecutionStagesMatchGraph(blog!);
    assertProjectExecutionStagesMatchGraph(project!);
    for (const stage of CREATE_BLOG_EXECUTION_STAGES)
      expect(blog?.nodes.some((node) => node.id === stage)).toBe(true);
    for (const stage of CREATE_PROJECT_EXECUTION_STAGES)
      expect(project?.nodes.some((node) => node.id === stage)).toBe(true);
    const generate = blog?.nodes.find((node) => node.id === 'generate');
    expect(generate?.model).toBe('gpt-5.6-terra');
    expect(generate?.effort).toBe('medium');
    expect(generate?.rulesMarkdown).toContain('Spanish is the source locale');
  });

  it('validates customization sections against the template', async () => {
    const tool = await getTool('create_blog_draft');
    const sections = validateCustomizationDocument(
      tool.customizationTemplate,
      `# Sample\n\n## generate\nBe concise.\n\n## prepare_image\nSoft light.\n`,
    );
    expect(sections.generate).toContain('Be concise');
    expect(() =>
      validateCustomizationDocument(
        tool.customizationTemplate,
        `## unknown\nNope\n`,
      ),
    ).toThrow(/Unknown customization section/);
  });

  it('loads neutral create_project_astro customization template sections', async () => {
    const tool = await getTool('create_project_astro');
    const sections = validateCustomizationDocument(
      tool.customizationTemplate,
      `# Webbin\n\n## content_schema\n\nfields: []\n\n## generate\nAgency voice.\n\n## interpret_revision\nSurgical.\n\n## apply_revision\nKeep headings.\n`,
    );
    expect(sections.generate).toContain('Agency voice');
    expect(sections.content_schema).toContain('fields');
    expect(tool.customizationTemplate).not.toContain('Webbin');
    expect(tool.nodes.some((node) => node.id === 'prepare_image')).toBe(false);
  });

  it('resolves the latest catalog version when version is omitted', async () => {
    const tool = await getTool('delete_blog_draft');
    expect(tool.tool.version).toBe(2);
    expect(tool.nodes.some((node) => node.id === 'open_deletion_pr')).toBe(true);
    expect(tool.nodes.some((node) => node.id === 'create_draft')).toBe(false);
  });

  it('composes layered generation prompts', () => {
    const composed = composeGenerationPrompt({
      baseRules: 'Do not invent claims.',
      customizationSection: 'Prefer short sections.',
      editorial: {
        editorialAudience: 'Operators',
        editorialVoice: 'Direct',
        prohibitedClaims: ['Guaranteed ROI'],
      },
    });
    expect(composed.system).toContain('Contract rules');
    expect(composed.system).toContain('Untrusted client style guidance');
    expect(composed.system).toContain('Voice: Direct');
    expect(composed.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
  });
});
