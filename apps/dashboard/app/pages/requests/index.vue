<script setup lang="ts">
import type { Enrollment, RequestSummary } from '@binflow/contracts';
import { requestListPageSizes } from '@binflow/contracts';
import {
  allRequestInboxClients,
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
const approvalCursor = ref<string | undefined>();
const otherCursor = ref<string | undefined>();

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
  refresh: refreshApproval,
  status: approvalStatus,
} = await useFetch<{ items: RequestSummary[]; nextCursor: string | null }>(() =>
  listUrl(true, approvalCursor.value),
);

const {
  data: otherPage,
  refresh: refreshOther,
  status: otherStatus,
} = await useFetch<{ items: RequestSummary[]; nextCursor: string | null }>(() =>
  listUrl(false, otherCursor.value),
);

const refreshInbox = async () => {
  await Promise.all([refreshApproval(), refreshOther()]);
};

watch([selectedProjectId, pageSize], () => {
  approvalCursor.value = undefined;
  otherCursor.value = undefined;
});

const loadNext = (column: 'approval' | 'other') => {
  if (column === 'approval') {
    approvalCursor.value = approvalPage.value?.nextCursor ?? undefined;
    return;
  }
  otherCursor.value = otherPage.value?.nextCursor ?? undefined;
};
</script>

<template>
  <main class="mx-auto max-w-6xl px-6 py-10">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-3xl font-semibold tracking-tight">Workflow requests</h1>
        <p class="mt-2 text-muted">
          Admin-approval queue on the left. Everything else on the right.
        </p>
      </div>
      <UButton
        color="neutral"
        variant="soft"
        :loading="approvalStatus === 'pending' || otherStatus === 'pending'"
        @click="refreshInbox"
        >Refresh</UButton
      >
    </div>
    <div class="mt-6 flex flex-wrap items-end gap-4">
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
      <div
        class="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] lg:gap-8"
      >
        <section class="min-w-0">
          <h2 class="text-lg font-semibold">Needs admin approval</h2>
          <div class="mt-4 grid gap-4">
            <UCard v-if="(approvalPage?.items.length ?? 0) === 0">
              <p class="font-medium">No approval queue</p>
              <p class="mt-1 text-sm text-muted">
                New-category blogs appear here until you decide.
              </p>
            </UCard>
            <UCard v-for="item in approvalPage?.items ?? []" :key="item.id">
              <p class="text-xs font-medium tracking-wide text-muted uppercase">
                {{ item.clientName }}
              </p>
              <div
                class="mt-1 flex flex-wrap items-center justify-between gap-4"
              >
                <div>
                  <div class="flex items-center gap-2">
                    <p class="font-semibold">{{ item.topic ?? 'No topic' }}</p>
                    <UBadge color="neutral" variant="soft">{{
                      item.state
                    }}</UBadge>
                  </div>
                  <p class="mt-1 text-sm text-muted">
                    {{ item.capabilityId }} · version {{ item.currentVersion }}
                  </p>
                </div>
                <a
                  class="inline-flex items-center rounded-md border border-default px-2.5 py-1.5 text-sm font-medium hover:bg-elevated"
                  :href="`/requests/${item.id}`"
                  >Open request</a
                >
              </div>
            </UCard>
          </div>
        </section>
        <div class="hidden bg-default lg:block" aria-hidden="true" />
        <section class="min-w-0">
          <h2 class="text-lg font-semibold">Other requests</h2>
          <div class="mt-4 grid gap-4">
            <UCard v-if="(otherPage?.items.length ?? 0) === 0">
              <p class="font-medium">No other requests</p>
              <p class="mt-1 text-sm text-muted">
                Paired clients can begin with /create_blog.
              </p>
            </UCard>
            <UCard v-for="item in otherPage?.items ?? []" :key="item.id">
              <p class="text-xs font-medium tracking-wide text-muted uppercase">
                {{ item.clientName }}
              </p>
              <div
                class="mt-1 flex flex-wrap items-center justify-between gap-4"
              >
                <div>
                  <div class="flex items-center gap-2">
                    <p class="font-semibold">{{ item.topic ?? 'No topic' }}</p>
                    <UBadge color="neutral" variant="soft">{{
                      item.state
                    }}</UBadge>
                  </div>
                  <p class="mt-1 text-sm text-muted">
                    {{ item.capabilityId }} · version {{ item.currentVersion }}
                  </p>
                </div>
                <a
                  class="inline-flex items-center rounded-md border border-default px-2.5 py-1.5 text-sm font-medium hover:bg-elevated"
                  :href="`/requests/${item.id}`"
                  >Open request</a
                >
              </div>
            </UCard>
          </div>
        </section>
      </div>
      <div
        class="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-default pt-6"
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
            :disabled="!approvalPage?.nextCursor"
            @click="loadNext('approval')"
            >Next approval batch</UButton
          >
          <UButton
            color="neutral"
            variant="soft"
            :disabled="!otherPage?.nextCursor"
            @click="loadNext('other')"
            >Next other batch</UButton
          >
        </div>
      </div>
  </main>
</template>
