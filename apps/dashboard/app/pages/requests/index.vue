<script setup lang="ts">
import type { Enrollment, RequestSummary } from '@binflow/contracts';
import { requestListPageSizes } from '@binflow/contracts';
import {
  allRequestInboxClients,
  requestCardTone,
  requestCardToneClass,
  requestInboxClientOptions,
  requestInboxProjectFilter,
  requestListSearchParams,
  type RequestInboxPageSize,
} from '../../lib/request-inbox';

const route = useRoute();
const queryProjectId = computed(() => {
  const value = route.query.projectId;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
});

const selectedProjectId = ref<string>(
  queryProjectId.value ?? allRequestInboxClients,
);
const pageSize = ref<'10' | '30' | '50'>('10');
const otherCursor = ref<string | undefined>();
/** Cursors for pages before the current Requests batch (enables Previous). */
const otherCursorHistory = ref<(string | undefined)[]>([]);

watch(
  queryProjectId,
  (projectId) => {
    selectedProjectId.value = projectId ?? allRequestInboxClients;
  },
  { immediate: true },
);

const { data: enrollments } = await useFetch<{
  items: Enrollment[];
  nextCursor: string | null;
}>('/api/v1/admin/enrollments');

const clientOptions = computed(() =>
  requestInboxClientOptions(enrollments.value?.items ?? [], [
    ...(approvalPage.value?.items ?? []),
    ...(otherPage.value?.items ?? []),
  ]),
);

const listUrl = (needsAdminApproval: boolean, cursor?: string) =>
  `/api/v1/requests?${requestListSearchParams({
    cursor,
    limit: Number(pageSize.value) as RequestInboxPageSize,
    needsAdminApproval,
    projectId: requestInboxProjectFilter(selectedProjectId.value),
  })}`;

const {
  data: approvalPage,
  error: approvalError,
  refresh: refreshApproval,
  status: approvalFetchStatus,
} = await useFetch<{ items: RequestSummary[]; nextCursor: string | null }>(() =>
  listUrl(true),
);

const {
  data: otherPage,
  error: otherError,
  refresh: refreshOther,
  status: otherFetchStatus,
} = await useFetch<{ items: RequestSummary[]; nextCursor: string | null }>(() =>
  listUrl(false, otherCursor.value),
);

const refreshInbox = async () => {
  await Promise.all([refreshApproval(), refreshOther()]);
};

const resetRequestsPaging = () => {
  otherCursor.value = undefined;
  otherCursorHistory.value = [];
};

watch([selectedProjectId, pageSize], () => {
  resetRequestsPaging();
});

const canGoPreviousRequests = computed(
  () => otherCursorHistory.value.length > 0,
);

const loadNextRequests = () => {
  const next = otherPage.value?.nextCursor;
  if (next === null || next === undefined || next === '') return;
  otherCursorHistory.value = [...otherCursorHistory.value, otherCursor.value];
  otherCursor.value = next;
};

const loadPreviousRequests = () => {
  if (otherCursorHistory.value.length === 0) return;
  const history = [...otherCursorHistory.value];
  const previous = history.pop();
  otherCursorHistory.value = history;
  otherCursor.value = previous;
};

const cardClass = (item: RequestSummary): string =>
  requestCardToneClass(requestCardTone(item));

const inboxLoading = computed(
  () =>
    approvalFetchStatus.value === 'pending' ||
    otherFetchStatus.value === 'pending',
);
</script>

<template>
  <main class="mx-auto max-w-6xl px-6 py-8 lg:px-8">
    <PageHeader :crumbs="['Requests']">
      <template #title>
        <h1 class="mt-1 text-3xl font-semibold tracking-tight text-white">
          Workflow requests
        </h1>
        <p class="mt-2 text-muted">
          Needs admin approval on top. All other requests below — green after
          admin approval, red after admin rejection.
        </p>
      </template>
      <template #actions>
        <UButton
          color="neutral"
          variant="soft"
          :loading="inboxLoading"
          @click="refreshInbox"
          >Refresh</UButton
        >
      </template>
    </PageHeader>
    <div class="flex flex-wrap items-end gap-4">
      <UFormField label="Client" class="min-w-56">
        <USelect
          v-model="selectedProjectId"
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
    </div>

    <UAlert
      v-if="approvalError || otherError"
      class="mt-6"
      color="error"
      title="Could not load requests"
      :description="
        String(approvalError ?? otherError ?? 'Request list failed.')
      "
    />

    <section class="mt-8 min-w-0">
      <h2 class="text-lg font-semibold text-white">Needs admin approval</h2>
      <p v-if="approvalFetchStatus === 'pending'" class="mt-4 text-muted">
        Loading approval queue…
      </p>
      <div v-else class="mt-4 grid gap-4">
        <UCard
          v-if="!approvalError && (approvalPage?.items.length ?? 0) === 0"
          class="binflow-surface !ring-0"
        >
          <p class="font-medium text-white">No approval queue</p>
          <p class="mt-1 text-sm text-muted">
            New-category blogs appear here until you decide.
          </p>
        </UCard>
        <UCard
          v-for="item in approvalPage?.items ?? []"
          :key="item.id"
          class="binflow-surface !ring-0"
        >
          <p class="text-xs font-medium tracking-wide text-muted uppercase">
            {{ item.clientName }}
          </p>
          <div class="mt-1 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div class="flex items-center gap-2">
                <p class="font-semibold text-white">
                  {{ item.topic ?? 'No topic' }}
                </p>
                <UBadge color="warning" variant="soft">{{ item.state }}</UBadge>
              </div>
              <p class="mt-1 font-mono text-sm text-[var(--binflow-accent)]">
                {{ item.capabilityId }} · version {{ item.currentVersion }}
              </p>
            </div>
            <UButton
              :to="`/requests/${item.id}`"
              color="neutral"
              variant="soft"
              >Open request</UButton
            >
          </div>
        </UCard>
      </div>
    </section>

    <section class="mt-10 min-w-0 border-t border-[var(--binflow-border)] pt-10">
      <h2 class="text-lg font-semibold text-white">Requests</h2>
      <p v-if="otherFetchStatus === 'pending'" class="mt-4 text-muted">
        Loading requests…
      </p>
      <div v-else class="mt-4 grid gap-4">
        <UCard
          v-if="!otherError && (otherPage?.items.length ?? 0) === 0"
          class="binflow-surface !ring-0"
        >
          <p class="font-medium text-white">No other requests</p>
          <p class="mt-1 text-sm text-muted">
            Paired clients can begin with /create_blog.
          </p>
        </UCard>
        <UCard
          v-for="item in otherPage?.items ?? []"
          :key="item.id"
          class="binflow-surface !ring-0"
          :class="cardClass(item)"
        >
          <p class="text-xs font-medium tracking-wide text-muted uppercase">
            {{ item.clientName }}
          </p>
          <div class="mt-1 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div class="flex items-center gap-2">
                <p class="font-semibold text-white">
                  {{ item.topic ?? 'No topic' }}
                </p>
                <UBadge color="neutral" variant="soft">{{ item.state }}</UBadge>
              </div>
              <p class="mt-1 font-mono text-sm text-[var(--binflow-accent)]">
                {{ item.capabilityId }} · version {{ item.currentVersion }}
              </p>
            </div>
            <UButton
              :to="`/requests/${item.id}`"
              color="neutral"
              variant="soft"
              >Open request</UButton
            >
          </div>
        </UCard>
      </div>
      <div
        class="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--binflow-border)] pt-6"
      >
        <UFormField label="Batch size">
          <USelect
            v-model="pageSize"
            value-key="value"
            :items="
              requestListPageSizes.map((size) => ({
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
            :disabled="!canGoPreviousRequests"
            @click="loadPreviousRequests"
            >Previous requests batch</UButton
          >
          <UButton
            color="neutral"
            variant="soft"
            :disabled="!otherPage?.nextCursor"
            @click="loadNextRequests"
            >Next requests batch</UButton
          >
        </div>
      </div>
    </section>
  </main>
</template>
