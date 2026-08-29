export type ToolGraphEdgeInput = Readonly<{
  from: string;
  to: string;
  when?: string;
}>;

export type ToolGraphNodePosition = Readonly<{
  column: number;
  id: string;
  indexInLayer: number;
  layer: number;
  x: number;
  y: number;
}>;

export type ToolGraphLayout = Readonly<{
  height: number;
  layers: readonly (readonly string[])[];
  minWidth: number;
  nodeHeight: number;
  nodeWidth: number;
  positions: ReadonlyMap<string, ToolGraphNodePosition>;
  width: number;
}>;

export type ToolGraphLayoutOptions = Readonly<{
  /** Available container width in CSS pixels. Layout fills up to this width. */
  targetWidth?: number;
}>;

export type ToolGraphEdgePath = Readonly<{
  d: string;
  from: string;
  key: string;
  labelX: number;
  labelY: number;
  to: string;
  when?: string;
}>;

export const TOOL_GRAPH_NODE_WIDTH = 220;
export const TOOL_GRAPH_NODE_HEIGHT = 92;
export const TOOL_GRAPH_H_GAP_MIN = 64;
export const TOOL_GRAPH_V_GAP = 96;
export const TOOL_GRAPH_PAD = 56;
/** @deprecated use TOOL_GRAPH_H_GAP_MIN */
export const TOOL_GRAPH_H_GAP = TOOL_GRAPH_H_GAP_MIN;

/**
 * Layer nodes top-to-bottom using every edge for ranking. Cycle-breaking edges
 * (target already ranked / would re-enter remaining cycle) are ignored only for
 * layer assignment; callers still draw all original edges.
 */
export const layerToolGraphNodes = (
  nodeIds: readonly string[],
  edges: readonly ToolGraphEdgeInput[],
): string[][] => {
  const nodes = [...new Set(nodeIds)];
  if (nodes.length === 0) return [];

  const nodeSet = new Set(nodes);
  const rankingEdges = edges.filter(
    (edge) =>
      nodeSet.has(edge.from) && nodeSet.has(edge.to) && edge.from !== edge.to,
  );

  const remaining = new Set(nodes);
  const layers: string[][] = [];
  const ranked = new Set<string>();

  const indegreeAmongRemaining = (): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const id of remaining) counts.set(id, 0);
    for (const edge of rankingEdges) {
      if (!remaining.has(edge.from) || !remaining.has(edge.to)) continue;
      counts.set(edge.to, (counts.get(edge.to) ?? 0) + 1);
    }
    return counts;
  };

  while (remaining.size > 0) {
    const indegree = indegreeAmongRemaining();
    let layer = [...remaining].filter((id) => (indegree.get(id) ?? 0) === 0);
    if (layer.length === 0) {
      const candidates = [...remaining].sort((left, right) => {
        const leftFromRanked = rankingEdges.some(
          (edge) => ranked.has(edge.from) && edge.to === left,
        );
        const rightFromRanked = rankingEdges.some(
          (edge) => ranked.has(edge.from) && edge.to === right,
        );
        if (leftFromRanked !== rightFromRanked)
          return leftFromRanked ? -1 : 1;
        const leftDegree = indegree.get(left) ?? 0;
        const rightDegree = indegree.get(right) ?? 0;
        if (leftDegree !== rightDegree) return leftDegree - rightDegree;
        return left.localeCompare(right);
      });
      layer = [candidates[0]!];
    } else {
      layer.sort((a, b) => a.localeCompare(b));
    }
    layers.push(layer);
    for (const id of layer) {
      remaining.delete(id);
      ranked.add(id);
    }
  }
  return layers;
};

/**
 * Assign horizontal columns so multi-out / multi-in nodes get distinct lanes.
 * Forward edges only (target layer > source layer) drive fan-out placement.
 */
export const assignToolGraphColumns = (
  layers: readonly (readonly string[])[],
  edges: readonly ToolGraphEdgeInput[],
): Map<string, number> => {
  const layerOf = new Map<string, number>();
  for (const [layerIndex, layer] of layers.entries()) {
    for (const id of layer) layerOf.set(id, layerIndex);
  }

  const successors = new Map<string, string[]>();
  const predecessors = new Map<string, string[]>();
  for (const edge of edges) {
    const fromLayer = layerOf.get(edge.from);
    const toLayer = layerOf.get(edge.to);
    if (
      fromLayer === undefined ||
      toLayer === undefined ||
      toLayer <= fromLayer
    )
      continue;
    const outs = successors.get(edge.from) ?? [];
    if (!outs.includes(edge.to)) outs.push(edge.to);
    successors.set(edge.from, outs);
    const ins = predecessors.get(edge.to) ?? [];
    if (!ins.includes(edge.from)) ins.push(edge.from);
    predecessors.set(edge.to, ins);
  }

  for (const [id, outs] of successors) {
    outs.sort((left, right) => {
      const layerDelta =
        (layerOf.get(left) ?? 0) - (layerOf.get(right) ?? 0);
      if (layerDelta !== 0) return layerDelta;
      return left.localeCompare(right);
    });
    successors.set(id, outs);
  }

  const column = new Map<string, number>();

  for (const [index, id] of (layers[0] ?? []).entries()) {
    column.set(id, index);
  }

  for (const layer of layers) {
    for (const id of layer) {
      if (!column.has(id)) {
        const preds = predecessors.get(id) ?? [];
        const placed = preds.filter((pred) => column.has(pred));
        if (placed.length > 0) {
          const sum = placed.reduce(
            (total, pred) => total + (column.get(pred) ?? 0),
            0,
          );
          column.set(id, sum / placed.length);
        } else {
          column.set(id, 0);
        }
      }

      const outs = successors.get(id) ?? [];
      if (outs.length === 0) continue;
      const parentCol = column.get(id) ?? 0;
      if (outs.length === 1) {
        const child = outs[0]!;
        if (!column.has(child)) column.set(child, parentCol);
        continue;
      }

      // Fan-out: place each successor on its own horizontal lane around the parent.
      const start = parentCol - (outs.length - 1) / 2;
      for (const [index, child] of outs.entries()) {
        const desired = start + index;
        if (!column.has(child)) {
          column.set(child, desired);
          continue;
        }
        const existing = column.get(child)!;
        column.set(child, (existing + desired) / 2);
      }
    }
  }

  // Same-layer nodes must not share a column.
  for (const layer of layers) {
    if (layer.length <= 1) continue;
    const ordered = [...layer].sort((left, right) => {
      const delta = (column.get(left) ?? 0) - (column.get(right) ?? 0);
      if (delta !== 0) return delta;
      return left.localeCompare(right);
    });
    let previous = Number.NEGATIVE_INFINITY;
    for (const id of ordered) {
      let next = column.get(id) ?? 0;
      if (next < previous + 1) next = previous + 1;
      column.set(id, next);
      previous = next;
    }
  }

  // Nodes that still share a column across nearby layers but are connected from
  // a high out-degree parent already got distinct lanes; normalize so min = 0.
  let min = Number.POSITIVE_INFINITY;
  for (const value of column.values()) min = Math.min(min, value);
  if (Number.isFinite(min) && min !== 0) {
    for (const [id, value] of column) column.set(id, value - min);
  }

  return column;
};

export const layoutToolGraph = (
  nodeIds: readonly string[],
  edges: readonly ToolGraphEdgeInput[],
  options: ToolGraphLayoutOptions = {},
): ToolGraphLayout => {
  const layers = layerToolGraphNodes(nodeIds, edges);
  const columns = assignToolGraphColumns(layers, edges);
  const positions = new Map<string, ToolGraphNodePosition>();
  const nodeWidth = TOOL_GRAPH_NODE_WIDTH;
  const nodeHeight = TOOL_GRAPH_NODE_HEIGHT;

  let maxColumn = 0;
  for (const value of columns.values())
    maxColumn = Math.max(maxColumn, value);

  const columnSpanUnits = Math.max(0, maxColumn);
  const naturalWidth =
    TOOL_GRAPH_PAD * 2 +
    nodeWidth +
    columnSpanUnits * (nodeWidth + TOOL_GRAPH_H_GAP_MIN);

  const minWidth = Math.max(naturalWidth, TOOL_GRAPH_PAD * 2 + nodeWidth);

  const target = options.targetWidth;
  const width =
    target === undefined || !Number.isFinite(target) || target <= 0
      ? minWidth
      : Math.max(minWidth, Math.floor(target));

  const usable = width - TOOL_GRAPH_PAD * 2 - nodeWidth;
  const colSpan =
    columnSpanUnits <= 0
      ? 0
      : Math.max(nodeWidth + TOOL_GRAPH_H_GAP_MIN, usable / columnSpanUnits);

  const contentWidth = nodeWidth + columnSpanUnits * colSpan;
  const originX = TOOL_GRAPH_PAD + (width - TOOL_GRAPH_PAD * 2 - contentWidth) / 2;

  for (const [layerIndex, layer] of layers.entries()) {
    const ordered = [...layer].sort((left, right) => {
      const delta = (columns.get(left) ?? 0) - (columns.get(right) ?? 0);
      if (delta !== 0) return delta;
      return left.localeCompare(right);
    });
    for (const [indexInLayer, id] of ordered.entries()) {
      const column = columns.get(id) ?? 0;
      positions.set(id, {
        column,
        id,
        indexInLayer,
        layer: layerIndex,
        x: originX + column * colSpan,
        y:
          TOOL_GRAPH_PAD +
          layerIndex * (nodeHeight + TOOL_GRAPH_V_GAP),
      });
    }
  }

  const height =
    TOOL_GRAPH_PAD * 2 +
    Math.max(1, layers.length) * nodeHeight +
    Math.max(0, layers.length - 1) * TOOL_GRAPH_V_GAP;

  return {
    height,
    layers,
    minWidth,
    nodeHeight,
    nodeWidth,
    positions,
    width,
  };
};

export const isBackEdge = (
  from: ToolGraphNodePosition,
  to: ToolGraphNodePosition,
): boolean => to.layer <= from.layer;

export const truncatePredicate = (when: string, max = 36): string =>
  when.length <= max ? when : `${when.slice(0, max - 1)}…`;

/**
 * Scale factor so a fixed layout width fits inside the container without
 * horizontal overflow. Values > 1 are never returned (expansion is done by
 * re-layout with targetWidth).
 */
export const fitToolGraphScale = (
  layoutWidth: number,
  containerWidth: number,
): number => {
  if (layoutWidth <= 0 || containerWidth <= 0) return 1;
  return Math.min(1, containerWidth / layoutWidth);
};

const portX = (
  nodeX: number,
  nodeWidth: number,
  index: number,
  total: number,
): number => {
  if (total <= 1) return nodeX + nodeWidth / 2;
  return nodeX + (nodeWidth * (index + 1)) / (total + 1);
};

const pointOnCubic = (
  t: number,
  x1: number,
  y1: number,
  cx1: number,
  cy1: number,
  cx2: number,
  cy2: number,
  x2: number,
  y2: number,
): Readonly<{ x: number; y: number }> => {
  const u = 1 - t;
  return {
    x:
      u * u * u * x1 +
      3 * u * u * t * cx1 +
      3 * u * t * t * cx2 +
      t * t * t * x2,
    y:
      u * u * u * y1 +
      3 * u * u * t * cy1 +
      3 * u * t * t * cy2 +
      t * t * t * y2,
  };
};

export const buildToolGraphEdgePaths = (
  positions: ReadonlyMap<string, ToolGraphNodePosition>,
  edges: readonly ToolGraphEdgeInput[],
  nodeWidth = TOOL_GRAPH_NODE_WIDTH,
  nodeHeight = TOOL_GRAPH_NODE_HEIGHT,
  canvasWidth?: number,
): ToolGraphEdgePath[] => {
  const outTotal = new Map<string, number>();
  const inTotal = new Map<string, number>();
  for (const edge of edges) {
    if (!positions.has(edge.from) || !positions.has(edge.to)) continue;
    outTotal.set(edge.from, (outTotal.get(edge.from) ?? 0) + 1);
    inTotal.set(edge.to, (inTotal.get(edge.to) ?? 0) + 1);
  }
  const outIndex = new Map<string, number>();
  const inIndex = new Map<string, number>();
  let sideLane = 0;

  return edges.flatMap((edge, index) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (from === undefined || to === undefined) return [];

    const oi = outIndex.get(edge.from) ?? 0;
    outIndex.set(edge.from, oi + 1);
    const ii = inIndex.get(edge.to) ?? 0;
    inIndex.set(edge.to, ii + 1);

    const x1 = portX(from.x, nodeWidth, oi, outTotal.get(edge.from) ?? 1);
    const y1 = from.y + nodeHeight;
    const x2 = portX(to.x, nodeWidth, ii, inTotal.get(edge.to) ?? 1);
    const y2 = to.y;

    let cx1: number;
    let cy1: number;
    let cx2: number;
    let cy2: number;

    const horizontalGap = Math.abs(x2 - x1);
    if (!isBackEdge(from, to) && to.layer === from.layer + 1) {
      const midY = (y1 + y2) / 2;
      cx1 = x1;
      cy1 = midY;
      cx2 = x2;
      cy2 = midY;
    } else if (!isBackEdge(from, to)) {
      const midY = (y1 + y2) / 2;
      // Keep long skip edges in their column corridor; nudge only when stacked.
      const bend =
        horizontalGap < 8
          ? (oi - ((outTotal.get(edge.from) ?? 1) - 1) / 2) * 36
          : 0;
      cx1 = x1 + bend;
      cy1 = midY;
      cx2 = x2 + bend;
      cy2 = midY;
    } else {
      const lane = sideLane++;
      const fromCenter = from.x + nodeWidth / 2;
      const toCenter = to.x + nodeWidth / 2;
      const midCanvas = (canvasWidth ?? Math.max(fromCenter, toCenter)) / 2;
      const leftBias = (fromCenter + toCenter) / 2 <= midCanvas;
      const margin = 32 + lane * 24;
      const rawRail = leftBias
        ? Math.min(from.x, to.x) - margin
        : Math.max(from.x + nodeWidth, to.x + nodeWidth) + margin;
      const rail =
        canvasWidth === undefined
          ? rawRail
          : Math.min(Math.max(rawRail, 12), Math.max(12, canvasWidth - 12));
      cx1 = rail;
      cy1 = y1 + 28 + lane * 10;
      cx2 = rail;
      cy2 = y2 - 28 - lane * 10;
    }

    const mid = pointOnCubic(0.5, x1, y1, cx1, cy1, cx2, cy2, x2, y2);
    return [
      {
        d: `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`,
        from: edge.from,
        key: `${edge.from}->${edge.to}:${edge.when ?? 'always'}:${index}`,
        labelX: mid.x,
        labelY: mid.y,
        to: edge.to,
        ...(edge.when === undefined ? {} : { when: edge.when }),
      },
    ];
  });
};
