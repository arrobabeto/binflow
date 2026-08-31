<script setup lang="ts">
import type {
  CredentialSummary,
  Enrollment,
  HealthResponse,
  RequestSummary,
  TicketPage,
} from '@binflow/contracts';

import { fetchAllRequestSummaries } from '../lib/analytics-metrics';
import {
  buildAttentionItems,
  buildClientSummaries,
  countAwaitingAdminApproval,
  countRequestsOnUtcDay,
  formatApproximateCount,
  pendingApprovalsByProject,
  requestsByProjectOnUtcDay,
  summarizeSystemHealth,
  utcTodayKey,
} from '../lib/overview-metrics';
import { analyticsRequestListSearchParams } from '../lib/request-inbox';
import { ticketListSearchParams } from '../lib/ticket-inbox';

type Readiness = {
  checks: Record<string, 'ready' | 'unavailable' | 'stale' | 'misconfigured'>;
  status: 'ready' | 'not_ready';
  timestamp: string;
};

const requestFetch = useRequestFetch();
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

const {
  data: requestCatalog,
  status: requestsStatus,
  error: requestsError,
  refresh: refreshRequests,
} = await useAsyncData('home-all-requests', () =>
  fetchAllRequestSummaries(async ({ cursor, limit }) =>
    requestFetch<{ items: RequestSummary[]; nextCursor: string | null }>(
      `/api/v1/requests?${analyticsRequestListSearchParams({
        ...(cursor === undefined ? {} : { cursor }),
        limit,
      })}`,
    ),
  ),
);

const {
  data: ticketsPage,
  status: ticketsStatus,
  refresh: refreshTickets,
} = await useFetch<TicketPage>(
  `/api/v1/admin/tickets?${ticketListSearchParams({
    limit: 10,
    tab: 'pending',
  })}`,
);

const allRequests = computed(() => requestCatalog.value?.items ?? []);
const requestsTruncated = computed(
  () => requestCatalog.value?.truncated === true,
);

const systemHealth = computed(() =>
  summarizeSystemHealth(health.value, readiness.value),
);

const pendingApprovals = computed(() =>
  countAwaitingAdminApproval(allRequests.value, requestsTruncated.value),
);

const requestsToday = computed(() =>
  countRequestsOnUtcDay(
    allRequests.value,
    todayKey,
    requestsTruncated.value,
  ),
);

const openTickets = computed(() => ticketsPage.value?.pendingCount ?? 0);
const totalTickets = computed(() => ticketsPage.value?.totalCount ?? 0);

const systemAccent = computed(() =>
  systemHealth.value.ready ? 'success' : 'error',
);

const pendingApprovalsAccent = computed(() =>
  pendingApprovals.value.value > 0 ? 'warning' : 'neutral',
);

const openTicketsAccent = computed(() =>
  openTickets.value > 0 ? 'warning' : 'neutral',
);

const clientCards = computed(() =>
  buildClientSummaries(
    enrollments.value?.items ?? [],
    requestsByProjectOnUtcDay(allRequests.value, todayKey),
    pendingApprovalsByProject(
      allRequests.value.filter(
        (item) => item.state === 'AWAITING_ADMIN_APPROVAL',
      ),
    ),
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

const now = ref(new Date());
let clockTimer: ReturnType<typeof setInterval> | undefined;
let ticketsPollTimer: ReturnType<typeof setInterval> | undefined;

const pad2 = (value: number): string => String(value).padStart(2, '0');

const clockDate = computed(() => {
  const d = now.value;
  return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${String(d.getFullYear()).slice(-2)}`;
});

const clockTime = computed(() => {
  const d = now.value;
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
});

const metricsPending = computed(
  () => requestsStatus.value === 'pending' && !requestCatalog.value,
);

const onVisibility = () => {
  if (document.visibilityState !== 'visible') return;
  void refreshTickets();
  void refreshRequests();
};

onMounted(() => {
  clockTimer = setInterval(() => {
    now.value = new Date();
  }, 1000);
  ticketsPollTimer = setInterval(() => {
    void refreshTickets();
  }, 5000);
  document.addEventListener('visibilitychange', onVisibility);
});

onBeforeUnmount(() => {
  if (clockTimer !== undefined) globalThis.clearInterval(clockTimer);
  if (ticketsPollTimer !== undefined)
    globalThis.clearInterval(ticketsPollTimer);
  document.removeEventListener('visibilitychange', onVisibility);
});
</script>

<template>
  <main class="mx-auto max-w-6xl px-6 py-8 lg:px-8">
    <PageHeader :crumbs="['Home']">
      <template #title>
        <h1 class="mt-1 text-3xl font-semibold tracking-tight text-white">
          Home
        </h1>
        <p class="mt-2 text-muted">
          Client status, daily request volume, open tickets, and platform
          readiness.
        </p>
      </template>
      <template #actions>
        <div class="flex flex-col items-end gap-2">
          <div
            class="inline-flex items-center gap-2 rounded-lg border border-[var(--binflow-border)] bg-[var(--binflow-elevated)] px-3 py-2 font-mono text-sm text-white shadow-sm"
            role="status"
            aria-live="polite"
            :aria-label="`Local time ${clockDate} ${clockTime}`"
          >
            <UIcon
              name="i-lucide-clock"
              class="size-4 shrink-0 text-[var(--binflow-accent)]"
            />
            <span>{{ clockDate }}</span>
            <span class="text-muted">·</span>
            <span>{{ clockTime }}</span>
          </div>
          <UButton to="/clients/new">Add client</UButton>
        </div>
      </template>
    </PageHeader>

    <UAlert
      v-if="requestsError"
      class="mb-6"
      color="error"
      variant="soft"
      title="Could not load request metrics"
      :description="String(requestsError)"
    />

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatusMetricCard
        label="System"
        :value="systemHealth.status"
        :detail="systemHealth.detail"
        :accent="systemAccent"
        to="/operations"
      />
      <StatusMetricCard
        label="Requests today"
        :value="
          metricsPending ? '…' : formatApproximateCount(requestsToday)
        "
        :detail="
          requestsToday.approximate
            ? 'From full request catalog (truncated)'
            : 'Created today (UTC)'
        "
        to="/requests"
      />
      <StatusMetricCard
        label="Pending approvals"
        :value="
          metricsPending ? '…' : formatApproximateCount(pendingApprovals)
        "
        detail="All awaiting admin decision"
        :accent="pendingApprovalsAccent"
        to="/requests"
      />
      <StatusMetricCard
        label="Open tickets"
        :value="
          ticketsStatus === 'pending' && !ticketsPage
            ? '…'
            : String(openTickets)
        "
        :detail="`${String(totalTickets)} tickets in total`"
        :accent="openTicketsAccent"
        to="/tickets"
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
