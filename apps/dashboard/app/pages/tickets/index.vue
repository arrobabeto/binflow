<script setup lang="ts">
import type { Enrollment, TicketPage, TicketState } from '@binflow/contracts';
import { ticketListPageSizes } from '@binflow/contracts';
import {
  allRequestInboxClients,
  requestInboxProjectFilter,
  ticketInboxClientOptions,
  ticketListSearchParams,
  type TicketInboxPageSize,
  type TicketInboxTab,
} from '../../lib/ticket-inbox';

const route = useRoute();
const router = useRouter();

const tabFromQuery = (value: unknown): TicketInboxTab =>
  value === 'history' ? 'history' : 'pending';

const selectedTab = ref<TicketInboxTab>(tabFromQuery(route.query.tab));
const selectedProjectId = ref<string>(
  typeof route.query.projectId === 'string' && route.query.projectId.length > 0
    ? route.query.projectId
    : allRequestInboxClients,
);
const selectedState = ref<TicketState | 'all'>('all');
const pageSize = ref<'10' | '30' | '50'>('10');
const cursor = ref<string | undefined>();
const cursorHistory = ref<(string | undefined)[]>([]);

watch(
  () => route.query.tab,
  (value) => {
    selectedTab.value = tabFromQuery(value);
  },
);

watch(selectedTab, (tab) => {
  void router.replace({
    query: {
      ...route.query,
      tab: tab === 'pending' ? undefined : tab,
    },
  });
  selectedState.value = 'all';
  cursor.value = undefined;
  cursorHistory.value = [];
});

watch([selectedProjectId, pageSize, selectedState], () => {
  cursor.value = undefined;
  cursorHistory.value = [];
});

const { data: enrollments } = await useFetch<{
  items: Enrollment[];
  nextCursor: string | null;
}>('/api/v1/admin/enrollments');

const listUrl = computed(
  () =>
    `/api/v1/admin/tickets?${ticketListSearchParams({
      cursor: cursor.value,
      limit: Number(pageSize.value) as TicketInboxPageSize,
      projectId: requestInboxProjectFilter(selectedProjectId.value),
      state: selectedState.value,
      tab: selectedTab.value,
    })}`,
);

const {
  data: page,
  error,
  refresh,
  status,
} = await useFetch<TicketPage>(() => listUrl.value);

const clientOptions = computed(() =>
  ticketInboxClientOptions(enrollments.value?.items ?? [], page.value?.items ?? []),
);

const stateFilterItems = computed(() => {
  const base =
    selectedTab.value === 'pending'
      ? ([
          { label: 'All pending', value: 'all' },
          { label: 'New', value: 'new' },
          { label: 'In progress', value: 'in_process' },
        ] as const)
      : ([
          { label: 'All history', value: 'all' },
          { label: 'Declined', value: 'declined' },
          { label: 'Closed', value: 'closed' },
        ] as const);
  return [...base];
});

const emptyTitle = computed(() =>
  selectedTab.value === 'pending' ? 'No pending tickets' : 'No history tickets',
);

const emptyDescription = computed(() =>
  selectedTab.value === 'pending'
    ? 'New and in-progress client asks will show up here.'
    : 'Declined and closed tickets will show up here.',
);

const canGoPrevious = computed(() => cursorHistory.value.length > 0);

const loadNext = () => {
  const next = page.value?.nextCursor;
  if (next === null || next === undefined || next === '') return;
  cursorHistory.value = [...cursorHistory.value, cursor.value];
  cursor.value = next;
};

const loadPrevious = () => {
  if (cursorHistory.value.length === 0) return;
  const history = [...cursorHistory.value];
  const previous = history.pop();
  cursorHistory.value = history;
  cursor.value = previous;
};
</script>

<template>
  <main class="mx-auto max-w-6xl px-6 py-8 lg:px-8">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-3xl font-semibold tracking-tight text-white">
          Tickets
        </h1>
        <p class="mt-2 text-muted">
          Out-of-catalog client asks. Pending is new and in progress; history
          is declined and closed.
        </p>
      </div>
      <UButton
        color="neutral"
        variant="soft"
        :loading="status === 'pending'"
        @click="refresh"
      >
        Refresh
      </UButton>
    </div>

    <div class="mt-8 flex flex-wrap items-center gap-3">
      <UButton
        :color="selectedTab === 'pending' ? 'primary' : 'neutral'"
        :variant="selectedTab === 'pending' ? 'solid' : 'soft'"
        @click="selectedTab = 'pending'"
      >
        Pending
        <UBadge
          v-if="(page?.pendingCount ?? 0) > 0"
          class="ml-2"
          color="neutral"
          variant="subtle"
          size="sm"
        >
          {{ page?.pendingCount }}
        </UBadge>
      </UButton>
      <UButton
        :color="selectedTab === 'history' ? 'primary' : 'neutral'"
        :variant="selectedTab === 'history' ? 'solid' : 'soft'"
        @click="selectedTab = 'history'"
      >
        History
      </UButton>
    </div>

    <div class="mt-6 flex flex-wrap items-end gap-3">
      <UFormField label="Client" class="w-44">
        <USelect
          v-model="selectedProjectId"
          class="w-full"
          value-key="value"
          :items="[
            { label: 'All', value: allRequestInboxClients },
            ...clientOptions.map((client) => ({
              label: client.label,
              value: client.projectId,
            })),
          ]"
        />
      </UFormField>
      <UFormField label="Status" class="w-44">
        <USelect
          v-model="selectedState"
          class="w-full"
          value-key="value"
          :items="stateFilterItems"
        />
      </UFormField>
    </div>

    <UAlert
      v-if="status === 'error' && error"
      class="mt-6"
      color="error"
      title="Could not load tickets"
      :description="String(error)"
    />

    <section class="mt-8 min-w-0">
      <p v-if="status === 'pending'" class="text-muted">Loading tickets…</p>
      <div v-else-if="status !== 'error'" class="grid gap-3">
        <UCard
          v-if="(page?.items.length ?? 0) === 0"
          class="binflow-surface !ring-0"
        >
          <p class="font-medium text-white">{{ emptyTitle }}</p>
          <p class="mt-1 text-sm text-muted">
            {{ emptyDescription }}
          </p>
        </UCard>
        <TicketRow
          v-for="item in page?.items ?? []"
          :key="item.id"
          :item="item"
        />
      </div>

      <div
        class="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--binflow-border)] pt-6"
      >
        <UFormField label="Batch size">
          <USelect
            v-model="pageSize"
            value-key="value"
            :items="
              ticketListPageSizes.map((size) => ({
                label: String(size),
                value: String(size),
              }))
            "
          />
        </UFormField>
        <div class="flex flex-wrap gap-2">
          <UButton
            color="neutral"
            variant="soft"
            :disabled="!canGoPrevious"
            @click="loadPrevious"
          >
            Previous batch
          </UButton>
          <UButton
            color="neutral"
            variant="soft"
            :disabled="!page?.nextCursor"
            @click="loadNext"
          >
            Next batch
          </UButton>
        </div>
      </div>
    </section>
  </main>
</template>
