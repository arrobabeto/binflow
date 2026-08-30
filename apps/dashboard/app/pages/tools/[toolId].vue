<script setup lang="ts">
import type {
  CapabilityCatalogResponse,
  Enrollment,
  ToolAssignmentsResponse,
  ToolGraphResponse,
} from '@binflow/contracts';

import {
  capabilityKey,
  enabledCapabilityKeys,
} from '../../lib/capability-bindings';
import {
  buildToolGraphEdgePaths,
  fitToolGraphScale,
  layoutToolGraph,
  truncatePredicate,
} from '../../lib/tool-graph-layout';

const route = useRoute();
const toolId = computed(() => String(route.params.toolId));
const selectedNodeId = ref<string | null>(null);
const graphViewport = ref<HTMLElement | null>(null);
const containerWidth = ref(0);
const assignmentMessage = ref('');
const assignmentBusy = ref(false);

const { data, error, pending } = await useFetch<ToolGraphResponse>(
  () => `/api/v1/tools/${toolId.value}/graph`,
  { key: `tool-graph:${toolId.value}`, lazy: true },
);
const { data: enrollments } = await useFetch<{ items: Enrollment[] }>(
  '/api/v1/admin/enrollments',
);
const { data: assignments, refresh: refreshAssignments } =
  await useFetch<ToolAssignmentsResponse>(
    () => `/api/v1/tools/${toolId.value}/assignments`,
    { key: () => `tool-assignments:${toolId.value}` },
  );

const assignedProjectIds = computed(
  () => new Set((assignments.value?.items ?? []).map((item) => item.projectId)),
);

const assignableClients = computed(() => {
  const toolProfile = data.value?.tool.profile;
  return (enrollments.value?.items ?? []).filter(
    (item) =>
      item.projectId &&
      item.state !== 'draft' &&
      (toolProfile === undefined || item.projectProfile === toolProfile),
  );
});

const assignmentErrorMessage = (error: unknown): string => {
  if (
    error !== null &&
    typeof error === 'object' &&
    'data' in error &&
    error.data !== null &&
    typeof error.data === 'object' &&
    'error' in error.data &&
    error.data.error !== null &&
    typeof error.data.error === 'object' &&
    'message' in error.data.error &&
    typeof error.data.error.message === 'string'
  )
    return error.data.error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return 'Assignment failed.';
};

const toggleClientAssignment = async (
  enrollment: Enrollment,
  enabled: boolean,
) => {
  assignmentBusy.value = true;
  assignmentMessage.value = '';
  try {
    const catalog = await $fetch<CapabilityCatalogResponse>(
      `/api/v1/projects/${enrollment.projectId}/capabilities`,
    );
    const keys = enabledCapabilityKeys(catalog);
    const key = capabilityKey(toolId.value, data.value?.tool.version ?? 1);
    if (enabled) keys.add(key);
    else keys.delete(key);
    const bindings = [...keys].map((entry) => {
      const [capabilityId, versionText] = entry.split('@');
      return {
        access: 'client_publish' as const,
        capabilityId: capabilityId ?? entry,
        capabilityVersion: Number(versionText ?? 1),
      };
    });
    if (bindings.length === 0) {
      assignmentMessage.value = 'Each client must keep at least one tool enabled.';
      return;
    }
    await $fetch(`/api/v1/projects/${enrollment.projectId}/capabilities`, {
      body: { bindings },
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      method: 'PUT',
    });
    await refreshAssignments();
    assignmentMessage.value = enabled
      ? `${enrollment.projectKey} now has this tool.`
      : `${enrollment.projectKey} no longer has this tool.`;
  } catch (error) {
    assignmentMessage.value = assignmentErrorMessage(error);
  } finally {
    assignmentBusy.value = false;
  }
};

const selected = computed(() =>
  data.value?.nodes.find((node) => node.id === selectedNodeId.value),
);

const layout = computed(() => {
  if (data.value === null || data.value === undefined)
    return layoutToolGraph([], []);
  return layoutToolGraph(
    data.value.nodes.map((node) => node.id),
    data.value.edges,
    {
      ...(containerWidth.value > 0
        ? { targetWidth: containerWidth.value }
        : {}),
    },
  );
});

const scale = computed(() =>
  fitToolGraphScale(layout.value.width, containerWidth.value || layout.value.width),
);

const nodeById = computed(() => {
  const map = new Map(
    (data.value?.nodes ?? []).map((node) => [node.id, node] as const),
  );
  return map;
});

const edgePaths = computed(() => {
  if (data.value === null || data.value === undefined) return [];
  return buildToolGraphEdgePaths(
    layout.value.positions,
    data.value.edges,
    layout.value.nodeWidth,
    layout.value.nodeHeight,
    layout.value.width,
  );
});

const kindBadge = (
  kind: string,
): 'primary' | 'success' | 'warning' | 'error' | 'neutral' => {
  switch (kind) {
    case 'effect':
      return 'primary';
    case 'agent':
      return 'success';
    case 'compute':
      return 'warning';
    case 'interrupt':
      return 'error';
    default:
      return 'neutral';
  }
};

const edgeTouchesSelection = (edge: {
  from: string;
  to: string;
}): boolean =>
  selectedNodeId.value !== null &&
  (edge.from === selectedNodeId.value || edge.to === selectedNodeId.value);

watch(
  graphViewport,
  (element, _previous, onCleanup) => {
    if (element === null) {
      containerWidth.value = 0;
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      containerWidth.value = Math.max(0, Math.floor(entry.contentRect.width));
    });
    observer.observe(element);
    containerWidth.value = Math.max(0, Math.floor(element.clientWidth));
    onCleanup(() => observer.disconnect());
  },
  { flush: 'post' },
);
</script>

<template>
  <main class="mx-auto max-w-7xl px-6 py-8 lg:px-8">
    <PageHeader :crumbs="['Tools', data?.tool.displayName ?? toolId]">
      <template #title>
        <p class="eyebrow">Tools</p>
        <h1 class="mt-1 text-3xl font-semibold tracking-tight text-white">
          {{ data?.tool.displayName ?? toolId }}
        </h1>
      </template>
      <template #actions>
        <UButton to="/tools" color="neutral" variant="soft">All tools</UButton>
        <UButton to="/customizations" color="neutral" variant="soft"
          >Customizations</UButton
        >
      </template>
    </PageHeader>
    <div>
      <p v-if="pending" class="text-muted">Loading graph…</p>
      <UAlert
        v-else-if="error"
        color="error"
        title="Could not load tool graph"
        :description="String(error)"
      />
      <template v-else-if="data">
        <p class="font-mono text-sm text-[var(--binflow-accent)]">
          {{ data.tool.stack }} · {{ data.graphVersion }} · fingerprint
          {{ data.fingerprint.slice(0, 12) }}…
        </p>
        <p class="mt-2 text-sm text-muted">
          Solid arrows are unconditional. Dashed arrows are predicate gates
          (<span class="font-mono">when</span>). The flowchart fills the panel
          width and grows vertically with the graph.
        </p>
        <div
          ref="graphViewport"
          class="tool-graph tool-graph-panel mt-8 w-full overflow-x-hidden border border-[var(--binflow-border)] p-4"
        >
          <div
            class="relative origin-top-left"
            :style="{
              height: `${layout.height * scale}px`,
              width: '100%',
            }"
          >
            <div
              class="absolute left-0 top-0"
              :style="{
                height: `${layout.height}px`,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
                width: `${layout.width}px`,
              }"
            >
              <svg
                class="pointer-events-none absolute inset-0"
                :width="layout.width"
                :height="layout.height"
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id="tool-graph-arrow"
                    markerWidth="10"
                    markerHeight="10"
                    refX="9"
                    refY="5"
                    orient="auto"
                    markerUnits="userSpaceOnUse"
                  >
                    <path d="M0,0 L10,5 L0,10 Z" fill="#64748b" />
                  </marker>
                  <marker
                    id="tool-graph-arrow-active"
                    markerWidth="10"
                    markerHeight="10"
                    refX="9"
                    refY="5"
                    orient="auto"
                    markerUnits="userSpaceOnUse"
                  >
                    <path d="M0,0 L10,5 L0,10 Z" fill="#2563eb" />
                  </marker>
                </defs>
                <g v-for="edge in edgePaths" :key="edge.key">
                  <path
                    :d="edge.d"
                    fill="none"
                    stroke-linecap="round"
                    :stroke="
                      edgeTouchesSelection(edge) ? '#2563eb' : '#64748b'
                    "
                    :stroke-width="edgeTouchesSelection(edge) ? 2.75 : 2"
                    :stroke-dasharray="edge.when ? '7 5' : undefined"
                    :marker-end="
                      edgeTouchesSelection(edge)
                        ? 'url(#tool-graph-arrow-active)'
                        : 'url(#tool-graph-arrow)'
                    "
                    :opacity="
                      selectedNodeId === null || edgeTouchesSelection(edge)
                        ? 1
                        : 0.35
                    "
                  />
                  <title v-if="edge.when">{{ edge.when }}</title>
                  <g v-if="edge.when">
                    <rect
                      :x="edge.labelX - 70"
                      :y="edge.labelY - 10"
                      width="140"
                      height="18"
                      rx="4"
                      fill="white"
                      stroke="#cbd5e1"
                      stroke-width="1"
                      :opacity="
                        selectedNodeId === null || edgeTouchesSelection(edge)
                          ? 1
                          : 0.45
                      "
                    />
                    <text
                      :x="edge.labelX"
                      :y="edge.labelY + 3"
                      text-anchor="middle"
                      fill="#475569"
                      font-size="10"
                      font-family="ui-monospace, SFMono-Regular, Menlo, monospace"
                    >
                      {{ truncatePredicate(edge.when) }}
                    </text>
                  </g>
                </g>
              </svg>
              <button
                v-for="[nodeId, position] in layout.positions"
                :key="nodeId"
                type="button"
                class="absolute rounded-lg border bg-white px-4 py-3 text-left shadow-sm transition hover:border-primary"
                :class="
                  selectedNodeId === nodeId
                    ? 'border-primary ring-2 ring-primary/30'
                    : 'border-default'
                "
                :style="{
                  height: `${layout.nodeHeight}px`,
                  left: `${position.x}px`,
                  top: `${position.y}px`,
                  width: `${layout.nodeWidth}px`,
                }"
                @click="selectedNodeId = nodeId"
              >
                <div class="flex items-start justify-between gap-2">
                  <p class="line-clamp-2 text-sm font-medium leading-snug">
                    {{ nodeById.get(nodeId)?.label }}
                  </p>
                  <UBadge
                    :color="kindBadge(nodeById.get(nodeId)?.kind ?? 'compute')"
                    variant="subtle"
                    class="shrink-0 uppercase"
                    >{{ nodeById.get(nodeId)?.kind }}</UBadge
                  >
                </div>
                <p class="mt-1 truncate font-mono text-xs text-muted">
                  {{ nodeId }}
                </p>
                <p
                  v-if="nodeById.get(nodeId)?.model"
                  class="mt-1 truncate text-xs text-muted"
                >
                  {{ nodeById.get(nodeId)?.model }}
                  <span v-if="nodeById.get(nodeId)?.effort">
                    · {{ nodeById.get(nodeId)?.effort }}
                  </span>
                </p>
              </button>
            </div>
          </div>
        </div>
        <UCard v-if="selected" class="mt-8">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="font-semibold">{{ selected.label }}</p>
              <p class="font-mono text-sm text-muted">
                {{ selected.nodeKind }}
              </p>
            </div>
            <UButton
              color="neutral"
              variant="ghost"
              @click="selectedNodeId = null"
              >Close</UButton
            >
          </div>
          <p v-if="selected.model" class="mt-4 text-sm">
            Model: <span class="font-mono">{{ selected.model }}</span>
            <span v-if="selected.effort">
              · effort
              <span class="font-mono">{{ selected.effort }}</span>
            </span>
          </p>
          <p class="mt-2 text-sm text-muted">
            Accepts client customization:
            {{ selected.acceptsClientCustomization ? 'yes' : 'no' }}
          </p>
          <pre
            class="mt-4 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/30 p-4 text-sm"
            >{{ selected.rulesMarkdown || 'No markdown rules for this node.' }}</pre
          >
        </UCard>
        <UCard class="mt-8">
          <p class="font-semibold">Client assignment</p>
          <p class="mt-1 text-sm text-muted">
            Enable this tool for validated clients whose project profile matches
            this tool’s stack. Clients without a manifest must validate enrollment
            first.
          </p>
          <div
            v-for="client in assignableClients"
            :key="client.id"
            class="mt-3 flex items-center justify-between gap-3 rounded-lg border border-default p-3 text-sm"
          >
            <div>
              <p class="font-medium">{{ client.projectKey }}</p>
              <p class="mt-1 text-muted">
                {{ client.tenantKey }} · {{ client.state }}
              </p>
            </div>
            <USwitch
              :disabled="assignmentBusy"
              :model-value="assignedProjectIds.has(client.projectId)"
              @update:model-value="toggleClientAssignment(client, $event)"
            />
          </div>
          <p
            v-if="assignableClients.length === 0"
            class="mt-3 text-sm text-muted"
          >
            No enrollments with a compatible project profile are ready for
            assignment yet.
          </p>
          <p v-if="assignmentMessage" class="mt-3 text-sm text-muted">
            {{ assignmentMessage }}
          </p>
        </UCard>
      </template>
    </div>
  </main>
</template>

<style scoped>
.tool-graph {
  background-color: #e9edf5;
  background-image: radial-gradient(
    circle,
    rgb(42 49 66 / 16%) 1px,
    transparent 1px
  );
  background-size: 18px 18px;
}
</style>
