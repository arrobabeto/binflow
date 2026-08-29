import { describe, expect, it } from 'vitest';

import {
  buildToolGraphEdgePaths,
  fitToolGraphScale,
  isBackEdge,
  layoutToolGraph,
  layerToolGraphNodes,
  truncatePredicate,
} from '../app/lib/tool-graph-layout';

const createBlogLike = () => {
  const nodes = [
    'catalog_sync',
    'interpret_brief',
    'similarity',
    'category_decision',
    'generate',
    'prepare_image',
    'render_artifacts',
    'create_draft',
    'wait_preview',
    'awaiting_client_approval',
    'interpret_revision',
    'awaiting_revision_plan_confirmation',
    'apply_revision',
    'awaiting_admin_approval',
    'merge_or_publish',
    'verify_production',
    'completed',
  ];
  const edges = [
    { from: 'catalog_sync', to: 'interpret_brief' },
    { from: 'interpret_brief', to: 'similarity' },
    {
      from: 'similarity',
      to: 'category_decision',
      when: 'similarity.is_not_high_overlap',
    },
    { from: 'category_decision', to: 'generate' },
    { from: 'generate', to: 'prepare_image' },
    { from: 'prepare_image', to: 'render_artifacts' },
    { from: 'render_artifacts', to: 'create_draft' },
    { from: 'create_draft', to: 'wait_preview' },
    { from: 'wait_preview', to: 'awaiting_client_approval' },
    {
      from: 'awaiting_client_approval',
      to: 'interpret_revision',
      when: 'review.is_revision',
    },
    {
      from: 'interpret_revision',
      to: 'awaiting_revision_plan_confirmation',
    },
    {
      from: 'awaiting_revision_plan_confirmation',
      to: 'apply_revision',
      when: 'revision_plan.is_confirmed_surgical',
    },
    {
      from: 'awaiting_revision_plan_confirmation',
      to: 'generate',
      when: 'revision_plan.is_confirmed_full',
    },
    {
      from: 'awaiting_revision_plan_confirmation',
      to: 'interpret_revision',
      when: 'revision_plan.is_adjusted',
    },
    {
      from: 'awaiting_revision_plan_confirmation',
      to: 'awaiting_client_approval',
      when: 'revision_plan.is_cancelled',
    },
    { from: 'apply_revision', to: 'render_artifacts' },
    {
      from: 'awaiting_client_approval',
      to: 'awaiting_admin_approval',
      when: 'category.is_new',
    },
    {
      from: 'awaiting_client_approval',
      to: 'merge_or_publish',
      when: 'category.is_existing_or_normalized',
    },
    { from: 'awaiting_admin_approval', to: 'merge_or_publish' },
    { from: 'merge_or_publish', to: 'verify_production' },
    { from: 'verify_production', to: 'completed' },
  ];
  return { edges, nodes };
};

describe('tool graph layout', () => {
  it('ranks conditional revision nodes after client approval', () => {
    const { edges, nodes } = createBlogLike();
    const layers = layerToolGraphNodes(nodes, edges);
    const rank = (id: string) =>
      layers.findIndex((layer) => layer.includes(id));
    expect(rank('catalog_sync')).toBe(0);
    expect(rank('interpret_brief')).toBeGreaterThan(rank('catalog_sync'));
    expect(rank('awaiting_client_approval')).toBeGreaterThan(
      rank('wait_preview'),
    );
    expect(rank('interpret_revision')).toBeGreaterThan(
      rank('awaiting_client_approval'),
    );
    expect(rank('awaiting_revision_plan_confirmation')).toBeGreaterThan(
      rank('interpret_revision'),
    );
    expect(rank('apply_revision')).toBeGreaterThan(
      rank('awaiting_revision_plan_confirmation'),
    );
    expect(rank('completed')).toBeGreaterThan(rank('verify_production'));
  });

  it('assigns coordinates and marks cycle edges as back-edges', () => {
    const { edges, nodes } = createBlogLike();
    const layout = layoutToolGraph(nodes, edges);
    expect(layout.positions.size).toBe(nodes.length);
    expect(layout.width).toBeGreaterThan(200);
    expect(layout.height).toBeGreaterThan(400);
    const from = layout.positions.get('awaiting_revision_plan_confirmation')!;
    const to = layout.positions.get('interpret_revision')!;
    expect(isBackEdge(from, to)).toBe(true);
    expect(
      truncatePredicate('revision_plan.is_confirmed_surgical', 20),
    ).toMatch(/…$/);
  });

  it('expands horizontally to the target width without shrinking below min', () => {
    const { edges, nodes } = createBlogLike();
    const natural = layoutToolGraph(nodes, edges);
    const wide = layoutToolGraph(nodes, edges, {
      targetWidth: natural.minWidth + 400,
    });
    expect(wide.width).toBe(natural.minWidth + 400);
    expect(wide.minWidth).toBe(natural.minWidth);
    const narrow = layoutToolGraph(nodes, edges, {
      targetWidth: 120,
    });
    expect(narrow.width).toBe(natural.minWidth);
    expect(fitToolGraphScale(narrow.width, 120)).toBeLessThan(1);
    expect(fitToolGraphScale(wide.width, wide.width)).toBe(1);
  });

  it('spreads multi-out children onto distinct horizontal columns', () => {
    const { edges, nodes } = createBlogLike();
    const layout = layoutToolGraph(nodes, edges);
    const client = layout.positions.get('awaiting_client_approval')!;
    const revision = layout.positions.get('interpret_revision')!;
    const admin = layout.positions.get('awaiting_admin_approval')!;
    const merge = layout.positions.get('merge_or_publish')!;
    const plan = layout.positions.get('awaiting_revision_plan_confirmation')!;
    const apply = layout.positions.get('apply_revision')!;

    const xs = [revision.x, admin.x, merge.x];
    expect(new Set(xs.map((value) => Math.round(value))).size).toBeGreaterThanOrEqual(
      2,
    );
    expect(Math.abs(revision.x - client.x)).toBeGreaterThan(40);
    expect(Math.abs(admin.x - revision.x)).toBeGreaterThan(40);
    expect(Math.abs(plan.x - apply.x)).toBeLessThan(40);
  });

  it('fans ports and labels conditional edges along the curve', () => {
    const { edges, nodes } = createBlogLike();
    const layout = layoutToolGraph(nodes, edges, { targetWidth: 960 });
    const paths = buildToolGraphEdgePaths(
      layout.positions,
      edges,
      layout.nodeWidth,
      layout.nodeHeight,
      layout.width,
    );
    expect(paths.length).toBe(edges.length);
    const conditional = paths.find(
      (path) => path.when === 'revision_plan.is_confirmed_surgical',
    );
    expect(conditional).toBeDefined();
    expect(conditional!.d.startsWith('M ')).toBe(true);
    expect(conditional!.labelX).toBeGreaterThan(0);
    expect(conditional!.labelY).toBeGreaterThan(0);
  });
});
