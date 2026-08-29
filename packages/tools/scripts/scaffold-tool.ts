#!/usr/bin/env node
/**
 * Scaffold a new Binflow tool from a validated brief YAML.
 *
 * Usage:
 *   pnpm --filter @binflow/tools exec tsx scripts/scaffold-tool.ts briefs/delete_project_astro.brief.yaml
 *   pnpm --filter @binflow/tools exec tsx scripts/scaffold-tool.ts briefs/foo.brief.yaml --dry-run
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stringify as stringifyYaml } from 'yaml';

import {
  parseToolBriefYaml,
  type ToolBriefDocument,
} from '../src/tool-brief.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const briefArg = args.find((arg) => !arg.startsWith('--'));

if (briefArg === undefined) {
  console.error(
    'Usage: scaffold-tool.ts <brief.yaml> [--dry-run] [--force]',
  );
  process.exit(1);
}

const briefPath = briefArg.startsWith('/')
  ? briefArg
  : join(process.cwd(), briefArg);
const briefBody = await readFile(briefPath, 'utf8');
const brief = parseToolBriefYaml(briefBody);
const { identity } = brief;
const graphVersion = `stacks/${identity.stack}/${identity.toolDir}${identity.graphVersionSuffix}`;
const toolRoot = join(
  root,
  'packages/tools/stacks',
  identity.stack,
  identity.toolDir,
);

const writeText = async (path: string, contents: string): Promise<void> => {
  if (dryRun) {
    console.log(`[dry-run] would write ${path} (${contents.length} bytes)`);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  if (!force) {
    try {
      await readFile(path, 'utf8');
      console.log(`[skip] exists ${path}`);
      return;
    } catch {
      // create
    }
  }
  await writeFile(path, contents, 'utf8');
  console.log(`[write] ${path}`);
};

const renderToolYaml = (document: ToolBriefDocument): string =>
  stringifyYaml({
    command: document.identity.command,
    description: document.identity.description,
    displayName: document.identity.displayName,
    executorId: document.identity.executorId,
    graphVersion,
    id: document.identity.id,
    profile: document.identity.profile,
    requiresPreview: document.identity.requiresPreview,
    riskClass: document.identity.riskClass,
    version: document.identity.version,
  });

const renderGraphYaml = (document: ToolBriefDocument): string =>
  stringifyYaml({
    edges: document.edges,
    nodes: document.nodes.map((node) => ({ id: node.id })),
    version: graphVersion,
  });

const renderNodeYaml = (
  node: ToolBriefDocument['nodes'][number],
): string => {
  const payload: Record<string, unknown> = {
    kind: node.kind,
    label: node.label,
    nodeKind: node.nodeKind,
    acceptsClientCustomization: node.acceptsClientCustomization,
  };
  if (node.actor !== undefined) payload.actor = node.actor;
  if (node.effort !== undefined) payload.effort = node.effort;
  if (node.model !== undefined) payload.model = node.model;
  if (node.permissions !== undefined) payload.permissions = node.permissions;
  if (node.rulesRef !== undefined) payload.rulesRef = node.rulesRef;
  if (node.ttlHours !== undefined) payload.ttlHours = node.ttlHours;
  if (node.workload !== undefined) payload.workload = node.workload;
  return stringifyYaml(payload);
};

const renderCustomizationTemplate = (
  document: ToolBriefDocument,
): string => {
  const sections = [
    '# Customization template',
    '',
    'Untrusted client markdown. Cannot change models, paths, permissions or approvals.',
    '',
  ];
  if (document.contentSchemaFields.length > 0) {
    sections.push('## content_schema', '', '```yaml');
    sections.push(
      stringifyYaml({ fields: document.contentSchemaFields }).trimEnd(),
    );
    sections.push('```', '');
  }
  for (const nodeId of document.customizableNodeIds) {
    sections.push(`## ${nodeId}`, '', `Editorial guidance for \`${nodeId}\`.`, '');
  }
  return `${sections.join('\n').trimEnd()}\n`;
};

const renderMigration = (document: ToolBriefDocument): string => {
  const { identity, migration } = document;
  return `INSERT INTO "capability_definitions" (
  "id", "version", "command", "display_name", "executor_id",
  "input_schema_id", "output_schema_id", "allowed_profiles", "risk_class",
  "required_permissions", "requires_preview", "approval_policy_id",
  "timeout_seconds", "retry_policy", "budget_policy"
) VALUES (
  '${identity.id}', ${String(identity.version)}, '${identity.command}', '${identity.displayName}',
  '${identity.executorId}', '${migration.inputSchemaId}',
  '${migration.outputSchemaId}', '${JSON.stringify(migration.allowedProfiles)}'::jsonb, '${identity.riskClass}',
  '${JSON.stringify(migration.requiredPermissions)}'::jsonb,
  ${identity.requiresPreview ? 'true' : 'false'}, '${identity.approvalPolicyId}', ${String(migration.timeoutSeconds)},
  '${JSON.stringify(migration.retryPolicy)}'::jsonb,
  '${JSON.stringify(migration.budget)}'::jsonb
) ON CONFLICT ("id", "version") DO NOTHING;
`;
};

const CREATE_PREVIEW_NODE_IDS = ['create_draft', 'wait_preview'] as const;

const toPascalCase = (id: string): string =>
  id
    .split('_')
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join('');

const briefTouchesEditablePaths = (document: ToolBriefDocument): boolean => {
  const haystack = [
    ...document.layerAssignments.map(
      (entry) => `${entry.behavior} ${entry.customization ?? ''}`,
    ),
    ...document.verification.scenarios,
  ]
    .join('\n')
    .toLowerCase();
  return (
    haystack.includes('editablepaths') ||
    haystack.includes('_redirects') ||
    haystack.includes('rematerialize')
  );
};

const validateGraphCoherence = (document: ToolBriefDocument): string[] => {
  const issues: string[] = [];
  const nodeIds = new Set(document.nodes.map((node) => node.id));
  const createPreviewHits = CREATE_PREVIEW_NODE_IDS.filter((id) =>
    nodeIds.has(id),
  );

  if (
    document.identity.mutationClass === 'destructive' &&
    createPreviewHits.length > 0
  ) {
    issues.push(
      `destructive brief must not include create-flow nodes: ${createPreviewHits.join(', ')} (see graph-by-mutation.md)`,
    );
  }

  if (
    document.identity.mutationClass === 'destructive' &&
    document.identity.requiresPreview
  ) {
    issues.push(
      'destructive brief should set requiresPreview: false unless ADR documents Vercel preview for deletion',
    );
  }

  if (
    document.identity.mutationClass === 'create' &&
    !document.identity.requiresPreview
  ) {
    issues.push(
      'create brief usually requires requiresPreview: true (verify graph-by-mutation.md)',
    );
  }

  return issues;
};

const renderSpec = (document: ToolBriefDocument): string => {
  const { identity } = document;
  return `# ${document.specTitle}

Capability id: \`${identity.id}@${String(identity.version)}\`
Stack: \`${identity.stack}\`
Executor: \`${identity.executorId}\`
Command: \`${identity.command}\`
Graph: \`${graphVersion}\`
Mutation class: \`${identity.mutationClass}\`

---

## 1. Three layers

${document.layerAssignments
  .map(
    (entry) =>
      `- **${entry.layer}** — ${entry.behavior}${entry.customization === undefined ? '' : ` (${entry.customization})`}`,
  )
  .join('\n')}

## 2. Content contract

Document manifest paths and bundle shape before implementation.

## 3. Capability inputs \`[CODE]\`

Define Zod input union modes in \`packages/contracts/src/index.ts\`.

## 4. Graph pipeline \`[CODE]\`

### Graph semantics

| node.id | nodeKind | kind |
|---------|----------|------|
${document.nodes.map((node) => `| \`${node.id}\` | \`${node.nodeKind}\` | ${node.kind} |`).join('\n')}

## 5. Client-facing messages

Document plan confirm and admin notice shapes per \`client-facing-copy.md\`.

## 6. Typed validation errors \`[CODE]\`

${document.typedErrors
  .map((entry) => `- \`${entry.code}\` — ${entry.when}`)
  .join('\n')}

## 7. Stack rollout

1. Run migration then \`pnpm db:migrate\` before dashboard assignment.
2. Add default binding to \`astroRepoDefaultCapabilityBindings\` when \`allowedProfiles\` includes \`astro_repo\`.
${briefTouchesEditablePaths(document) ? '3. Rematerialize enrolled manifests after `editablePaths` changes.\n' : ''}

## 8. Verification

${document.verification.scenarios.map((scenario) => `- ${scenario}`).join('\n')}
`;
};

const renderAdr = (document: ToolBriefDocument): string => {
  const destructiveGate =
    document.identity.mutationClass === 'destructive'
      ? '\n4. Close ADR-0040 gaps: GitHub DELETE via PR, verification semantics (404 vs 301), catalog tombstone, admin policy, no Vercel preview unless documented.'
      : '';
  return `# ADR-XXXX: ${document.specTitle}

- Status: Proposed
- Date: ${new Date().toISOString().slice(0, 10)}
- Supersedes: None
- Superseded by: None

## Context

Generated from \`${briefPath}\` via \`scaffold-tool.ts\`.

## Decision

1. Add capability \`${document.identity.id}@${String(document.identity.version)}\` on stack \`${document.identity.stack}\`.
2. Mutation class: \`${document.identity.mutationClass}\`; requiresPreview: \`${String(document.identity.requiresPreview)}\`.
3. Executor: \`${document.identity.executorId}\`.${destructiveGate}

## Consequences

Review platform gaps before implementation. Post-ship: migrate, default bindings, rematerialize (\`post-ship-ops.md\`).

## Verification

${document.verification.scenarios.map((scenario) => `- ${scenario}`).join('\n')}
`;
};

const nextMigrationTag = async (): Promise<string> => {
  const journalPath = join(root, 'packages/db/migrations/meta/_journal.json');
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
    entries: readonly { idx: number; tag: string }[];
  };
  const nextIdx =
    journal.entries.reduce((max, entry) => Math.max(max, entry.idx), -1) + 1;
  return `${String(nextIdx).padStart(4, '0')}_${identity.id}_capability`;
};

const printStackRolloutChecklist = (document: ToolBriefDocument): void => {
  const { identity, migration } = document;
  const pascal = toPascalCase(identity.id);
  const hasAstroRepo = migration.allowedProfiles.includes('astro_repo');
  const needsRematerialize = briefTouchesEditablePaths(document);

  console.log('\n--- Stack rollout checklist ---\n');
  console.log('1. pnpm db:migrate  # before dashboard assignment');
  console.log('2. Paste manual snippets below (contracts, policies, runtimes, ingress)');
  if (hasAstroRepo) {
    console.log(
      `3. Add webbin${pascal}CapabilityBinding to astroRepoDefaultCapabilityBindings`,
    );
  } else {
    console.log('3. Add stack default binding in policies when pilot stack is known');
  }
  if (needsRematerialize) {
    console.log(
      '4. Rematerialize enrolled manifests (adapt packages/tools/scripts/refresh-webbin-manifest-*.ts)',
    );
    console.log('5. pnpm --filter @binflow/tools build && restart API');
    console.log('6. Dashboard: graph loads, assignment works for compatible profile');
  } else {
    console.log('4. pnpm --filter @binflow/tools build && restart API');
    console.log('5. Dashboard: graph loads, assignment works for compatible profile');
  }
  console.log('   Telegram: command + NL smoke per TELEGRAM.md');

  if (hasAstroRepo) {
    console.log(`\n// packages/policies/src/index.ts — stack default binding
export const webbin${pascal}CapabilityBinding: CapabilityBinding = Object.freeze({
  access: 'client_publish',
  capabilityId: '${identity.id}',
  capabilityVersion: ${String(identity.version)},
});
// Push to astroRepoDefaultCapabilityBindings array.`);
  }
};

const printManualSnippets = (document: ToolBriefDocument): void => {
  const camel =
    document.identity.id.replace(/_([a-z])/gu, (_, letter: string) =>
      letter.toUpperCase(),
    );
  const pascal = `${camel[0]?.toUpperCase() ?? ''}${camel.slice(1)}`;
  console.log('\n--- Manual snippets (paste into existing files) ---\n');
  console.log(`// packages/contracts/src/index.ts
// 1. Add ${pascal}Input schema
// 2. Extend capabilityInputSchema union
// 3. Add '${document.identity.id}' to capabilityIdSchema enum

// packages/policies/src/index.ts
export const ${camel}Definition: CapabilityDefinition = Object.freeze({
  approvalPolicyId: '${document.identity.approvalPolicyId}',
  budget: Object.freeze(${JSON.stringify(document.migration.budget, null, 2)}),
  command: '${document.identity.command}',
  displayName: '${document.identity.displayName}',
  executorId: '${document.identity.executorId}',
  id: '${document.identity.id}',
  inputSchema: ${camel}InputSchema,
  requiredPermissions: Object.freeze(${JSON.stringify(document.migration.requiredPermissions, null, 2)}),
  requiresPreview: ${String(document.identity.requiresPreview)},
  retryPolicy: Object.freeze(${JSON.stringify(document.migration.retryPolicy, null, 2)}),
  riskClass: '${document.identity.riskClass}',
  timeoutSeconds: ${String(document.migration.timeoutSeconds)},
  version: ${String(document.identity.version)},
});
// Push to capabilityRegistry and optional pilot bindings.

// apps/worker/src/main.ts uses resolveCapabilityRuntime from @binflow/workflows

// packages/workflows/src/capability-runtimes.ts
// Add runtimeByExecutorId entry for '${document.identity.executorId}'.

// packages/workflows/src/capability-ingress.ts
// Extend collectionCapabilityIds or naturalLanguage if needed.

// packages/ai/src/index.ts + packages/workflows/src/*-runtime.ts
// Implement executor + generation port when reusing an executor family.
`);
};

const graphIssues = validateGraphCoherence(brief);
if (graphIssues.length > 0) {
  console.error('\n--- Graph coherence issues ---\n');
  for (const issue of graphIssues) console.error(`  ✗ ${issue}`);
  console.error('\nSee .cursor/skills/create-tool/references/graph-by-mutation.md');
  process.exit(1);
}

await writeText(join(toolRoot, 'tool.yaml'), renderToolYaml(brief));
await writeText(join(toolRoot, 'graph.yaml'), renderGraphYaml(brief));
await writeText(
  join(toolRoot, 'customization-template.md'),
  renderCustomizationTemplate(brief),
);
for (const node of brief.nodes) {
  const nodeDir = join(toolRoot, 'nodes', `${node.sortPrefix}-${node.id}`);
  await writeText(join(nodeDir, 'node.yaml'), renderNodeYaml(node));
}
const migrationTag = await nextMigrationTag();
await writeText(
  join(root, 'packages/db/migrations', `${migrationTag}.sql`),
  renderMigration(brief),
);
const specSlug = identity.id.replace(/_astro$/u, '').replaceAll('_', '-');
await writeText(join(root, 'docs/specs', `${specSlug}.md`), renderSpec(brief));
await writeText(
  join(root, 'docs/adr', `${migrationTag.replace('_capability', '')}.md`),
  renderAdr(brief),
);

printManualSnippets(brief);
printStackRolloutChecklist(brief);

if (dryRun) console.log('\n[dry-run] No files written.');
else
  console.log(
    '\nNext: paste manual snippets, implement executor/runtime, run conformance tests.',
  );
