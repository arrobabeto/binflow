<script setup lang="ts">
import type {
  CredentialSummary,
  Enrollment,
  HealthResponse,
  RequestSummary,
} from '@binflow/contracts';

import {
  buildAttentionItems,
  buildClientSummaries,
  countPendingApprovals,
  countRequestsOnUtcDay,
  formatApproximateCount,
  pendingApprovalsByProject,
  requestsByProjectOnUtcDay,
  summarizeClientMix,
  summarizeSystemHealth,
  utcTodayKey,
} from '../lib/overview-metrics';
import { requestListSearchParams } from '../lib/request-inbox';

type Readiness = {
  checks: Record<string, 'ready' | 'unavailable' | 'stale' | 'misconfigured'>;
  status: 'ready' | 'not_ready';
  timestamp: string;
};

const todayKey = utcTodayKey();

const { data: health } = await useFetch<HealthResponse>('/api/v1/health');
const { data: readiness } = await useFetch<Readiness>('/api/v1/readiness');
const { data: enrollments } = await useFetch<{
  items: Enrollment[];
  nextCursor: string | null;
}>('/api/v1/admin/enrollments');
const { data: credentials } = await useFetch<{
  items: CredentialSummary[];
  nextCursor: string | null;
}>('/api/v1/admin/integrations');

const approvalUrl = `/api/v1/requests?${requestListSearchParams({
  limit: 50,
  needsAdminApproval: true,
})}`;
const otherUrl = `/api/v1/requests?${requestListSearchParams({
  limit: 50,
  needsAdminApproval: false,
})}`;

const { data: approvalPage } = await useFetch<{
  items: RequestSummary[];
  nextCursor: string | null;
}>(approvalUrl);
const { data: otherPage } = await useFetch<{
  items: RequestSummary[];
  nextCursor: string | null;
}>(otherUrl);

const recentRequests = computed(() => [
  ...(approvalPage.value?.items ?? []),
  ...(otherPage.value?.items ?? []),
]);

const hasMoreRequests = computed(
  () =>
    Boolean(approvalPage.value?.nextCursor) ||
    Boolean(otherPage.value?.nextCursor),
);

const systemHealth = computed(() =>
  summarizeSystemHealth(health.value, readiness.value),
);

const clientMix = computed(() =>
  summarizeClientMix(enrollments.value?.items ?? []),
);

const pendingApprovals = computed(() =>
  countPendingApprovals(
    approvalPage.value?.items ?? [],
    approvalPage.value?.nextCursor,
  ),
);

const requestsToday = computed(() =>
  countRequestsOnUtcDay(
    recentRequests.value,
    todayKey,
    hasMoreRequests.value,
  ),
);

const clientCards = computed(() =>
  buildClientSummaries(
    enrollments.value?.items ?? [],
    requestsByProjectOnUtcDay(recentRequests.value, todayKey),
    pendingApprovalsByProject(approvalPage.value?.items ?? []),
  ),
);

const attentionItems = computed(() =>
  buildAttentionItems({
    credentials: credentials.value?.items ?? [],
    enrollments: enrollments.value?.items ?? [],
    pendingApprovals: pendingApprovals.value,
    readinessStatus: readiness.value?.status,
  }),
);

const messageOpen = ref(false);
const messageEnrollmentId = ref<string | undefined>();

const openMessage = (enrollmentId: string) => {
  messageEnrollmentId.value = enrollmentId;
  messageOpen.value = true;
};
</script>

<template>
  <main class="mx-auto max-w-6xl px-6 py-8 lg:px-8">
    <PageHeader :crumbs="['Home']">
      <template #title>
        <h1 class="mt-1 text-3xl font-semibold tracking-tight text-white">
          Home
        </h1>
        <p class="mt-2 text-muted">
          Client status, daily request volume, and platform readiness.
        </p>
      </template>
      <template #actions>
        <UButton to="/clients/new">Add client</UButton>
      </template>
    </PageHeader>

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatusMetricCard
        label="System"
        :value="systemHealth.status"
        :detail="systemHealth.detail"
        to="/operations"
      />
      <StatusMetricCard
        label="Requests today"
        :value="formatApproximateCount(requestsToday)"
        :detail="
          requestsToday.approximate
            ? 'From recent request batches'
            : 'Created today (UTC)'
        "
        to="/requests"
      />
      <StatusMetricCard
        label="Pending approvals"
        :value="formatApproximateCount(pendingApprovals)"
        detail="Awaiting admin decision"
        to="/requests"
      />
      <StatusMetricCard
        label="Clients"
        :value="`${clientMix.active}/${clientMix.total}`"
        :detail="
          clientMix.attention > 0
            ? `${clientMix.attention} need attention`
            : 'Active / total enrollments'
        "
        to="/clients"
      />
    </div>

    <div class="mt-10">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 class="text-xl font-semibold tracking-tight text-white">
            Clients
          </h2>
          <p class="mt-1 text-sm text-muted">
            Open an enrollment or jump to that client’s requests.
          </p>
        </div>
      </div>
      <div class="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <UCard v-if="clientCards.length === 0" class="binflow-surface !ring-0">
          <p class="font-medium text-white">No clients yet</p>
          <p class="mt-1 text-sm text-muted">
            Create the first enrollment to start operating Binflow.
          </p>
          <UButton class="mt-4" to="/clients/new">Add client</UButton>
        </UCard>
        <ClientSummaryCard
          v-for="client in clientCards"
          :key="client.id"
          :client="client"
          @message="openMessage(client.id)"
        />
      </div>
    </div>

    <div class="mt-10">
      <NeedsAttentionList :items="attentionItems" />
    </div>

    <SendClientMessageModal
      v-model:open="messageOpen"
      :enrollment-id="messageEnrollmentId"
    />
  </main>
</template>
