<script setup lang="ts">
import type { RequestDetail } from '@binflow/contracts';
import { labeledRecordFields, requestStateBadgeColor } from '../../lib/request-inbox';
import { createPendingPairingRefresh } from '../../lib/pending-pairing-refresh';

const TERMINAL_STATES = [
  'COMPLETED',
  'FAILED_FINAL',
  'CANCELLED',
  'SUPERSEDED',
] as const;

const route = useRoute();
const requestId = String(route.params.id);
const {
  data: detail,
  error: loadError,
  refresh: loadDetail,
  status,
} = await useFetch<RequestDetail>(`/api/v1/requests/${requestId}`);
const actionError = ref('');
const loading = computed(() => status.value === 'pending');

const inputFields = computed(() =>
  labeledRecordFields(
    detail.value?.interpretedInput as Record<string, unknown> | null,
  ),
);
const planFields = computed(() => labeledRecordFields(detail.value?.plan));
const hasPreviewEvidence = computed(() => {
  const execution = detail.value?.execution;
  if (execution === null || execution === undefined) return false;
  return (
    execution.headCommitSha !== null ||
    Object.keys(execution.previewUrls).length > 0
  );
});
const isTerminal = computed(
  () =>
    detail.value !== undefined &&
    detail.value !== null &&
    TERMINAL_STATES.includes(
      detail.value.state as (typeof TERMINAL_STATES)[number],
    ),
);
const canAct = computed(
  () => detail.value !== undefined && detail.value !== null,
);

let requestRefresh: ReturnType<typeof createPendingPairingRefresh> | undefined;
const onVisibilityChange = () => {
  if (document.visibilityState === 'visible') requestRefresh?.visible();
};

onMounted(() => {
  requestRefresh = createPendingPairingRefresh({
    clearInterval: (timer) => {
      globalThis.clearInterval(timer);
    },
    refresh: loadDetail,
    setInterval: (callback, delay) => globalThis.setInterval(callback, delay),
  });
  requestRefresh.setPending(canAct.value && !isTerminal.value);
  document.addEventListener('visibilitychange', onVisibilityChange);
});

watch(
  () => detail.value?.state,
  () => requestRefresh?.setPending(canAct.value && !isTerminal.value),
);

onBeforeUnmount(() => {
  requestRefresh?.stop();
  document.removeEventListener('visibilitychange', onVisibilityChange);
});

const mutate = async (action: 'approve' | 'reject' | 'cancel') => {
  if (detail.value === undefined || detail.value === null) return;
  actionError.value = '';
  try {
    await $fetch(`/api/v1/requests/${requestId}/${action}`, {
      method: 'POST',
      body: {},
      headers: {
        'Idempotency-Key': crypto.randomUUID(),
        'If-Match': `"${detail.value.revision}"`,
      },
    });
    await loadDetail();
  } catch (error) {
    actionError.value =
      error instanceof Error ? error.message : 'The action failed.';
  }
};

const messageOpen = ref(false);
const canMessageClient = computed(
  () => detail.value?.approvalStatus === 'admin_rejected',
);
</script>

<template>
  <main class="mx-auto max-w-5xl px-6 py-8 lg:px-8">
    <PageHeader :crumbs="['Requests']">
      <template #title>
        <UButton
          to="/requests"
          color="neutral"
          variant="soft"
          icon="i-lucide-arrow-left"
          class="mb-3 mt-2.5 text-[15px]"
          >Back to requests</UButton
        >
        <div class="flex flex-wrap items-start gap-3">
          <div class="min-w-0">
            <p
              v-if="detail?.clientName"
              class="text-xs font-medium tracking-wide text-muted uppercase"
            >
              {{ detail.clientName }}
            </p>
            <h1 class="mt-1 text-3xl font-semibold tracking-tight text-white">
              {{ detail?.topic ?? (loading ? 'Loading request…' : 'Request') }}
            </h1>
            <p
              class="mt-2 font-mono text-sm text-[var(--binflow-accent)]"
            >
              {{ detail?.id ?? requestId }}
            </p>
          </div>
          <UBadge
            v-if="detail"
            :color="requestStateBadgeColor(detail.state)"
            variant="soft"
            >{{ detail.state }}</UBadge
          >
        </div>
      </template>
    </PageHeader>

      <UAlert
        v-if="loadError"
        class="mt-6"
        color="error"
        variant="soft"
        title="Could not load request"
        :description="
          loadError.message || 'The request detail could not be loaded.'
        "
      />
      <UAlert
        v-if="detail?.failure"
        class="mt-6"
        color="error"
        variant="soft"
        :title="
          detail.state === 'FAILED_RETRYABLE'
            ? 'Retrying after a temporary failure'
            : 'Request failed'
        "
        :description="
          [
            `${detail.failure.node}: ${detail.failure.message} (${detail.failure.category})`,
            detail.failure.detail,
          ]
            .filter(Boolean)
            .join(' — ')
        "
      />
      <p v-if="actionError" class="mt-4 text-sm text-error">
        {{ actionError }}
      </p>

      <div v-if="detail" class="mt-2 grid gap-4 md:grid-cols-2">
        <UCard class="binflow-surface !ring-0">
          <p class="text-sm text-muted">Capability</p>
          <p class="mt-2 font-mono font-semibold text-[var(--binflow-accent)]">
            {{ detail.capabilityId }}
          </p>
        </UCard>
        <UCard class="binflow-surface !ring-0">
          <p class="text-sm text-muted">Version</p>
          <p class="mt-2 font-semibold text-white">{{ detail.currentVersion }}</p>
        </UCard>
        <UCard class="binflow-surface !ring-0">
          <p class="text-sm text-muted">Created</p>
          <p class="mt-2 font-mono text-sm text-white">{{ detail.createdAt }}</p>
        </UCard>
        <UCard class="binflow-surface !ring-0">
          <p class="text-sm text-muted">Updated</p>
          <p class="mt-2 font-mono text-sm text-white">{{ detail.updatedAt }}</p>
        </UCard>
        <UCard class="binflow-surface md:col-span-2 !ring-0">
          <p class="font-semibold text-white">Interpreted input</p>
          <dl
            v-if="inputFields.length > 0"
            class="mt-4 grid gap-3 text-sm md:grid-cols-2"
          >
            <div v-for="field in inputFields" :key="field.label">
              <dt class="text-muted">{{ field.label }}</dt>
              <dd class="mt-1 font-medium text-white">{{ field.value }}</dd>
            </div>
          </dl>
          <p v-else class="mt-3 text-sm text-muted">No structured input yet.</p>
        </UCard>
        <UCard class="binflow-surface md:col-span-2 !ring-0">
          <p class="font-semibold text-white">Confirmed plan</p>
          <dl
            v-if="planFields.length > 0"
            class="mt-4 grid gap-3 text-sm md:grid-cols-2"
          >
            <div v-for="field in planFields" :key="field.label">
              <dt class="text-muted">{{ field.label }}</dt>
              <dd class="mt-1 font-medium text-white">{{ field.value }}</dd>
            </div>
          </dl>
          <p v-else class="mt-3 text-sm text-muted">No confirmed plan yet.</p>
        </UCard>
        <UCard
          v-if="detail.stages.length > 0"
          class="binflow-surface md:col-span-2 !ring-0"
        >
          <p class="font-semibold text-white">Stage log</p>
          <ol class="mt-4 space-y-3">
            <li
              v-for="stage in detail.stages"
              :key="stage.sequence"
              class="flex flex-wrap items-baseline gap-3 border-b border-[var(--binflow-border)] pb-3 last:border-b-0 last:pb-0"
            >
              <span
                class="mt-1 size-2.5 shrink-0 rounded-full bg-primary"
                aria-hidden="true"
              />
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-baseline justify-between gap-2">
                  <p class="font-medium text-white">{{ stage.node }}</p>
                  <p class="font-mono text-xs text-muted">
                    {{ stage.createdAt }}
                  </p>
                </div>
                <p class="text-sm text-muted">{{ stage.summary }}</p>
              </div>
            </li>
          </ol>
        </UCard>
        <UCard
          v-if="hasPreviewEvidence"
          class="binflow-surface md:col-span-2 !ring-0"
        >
          <p class="font-semibold text-white">Exact preview evidence</p>
          <dl class="mt-4 grid gap-3 text-sm md:grid-cols-2">
            <div>
              <dt class="text-muted">Approval</dt>
              <dd class="font-medium text-white">
                {{ detail.execution?.approvalStatus }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">Category decision</dt>
              <dd class="font-medium text-white">
                {{ detail.execution?.categoryKind }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">Head commit</dt>
              <dd class="break-all font-mono text-[var(--binflow-accent)]">
                {{ detail.execution?.headCommitSha }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">Branch</dt>
              <dd class="break-all font-mono text-[var(--binflow-accent)]">
                {{ detail.execution?.branch }}
              </dd>
            </div>
          </dl>
          <div class="mt-4 flex flex-wrap gap-2">
            <UButton
              v-for="(url, path) in detail.execution?.previewUrls"
              :key="path"
              :to="url"
              target="_blank"
              color="neutral"
              variant="soft"
              >Open {{ path }}</UButton
            >
            <UButton
              v-if="detail.execution?.pullRequestUrl"
              :to="detail.execution.pullRequestUrl"
              target="_blank"
              color="neutral"
              variant="ghost"
              >Open pull request</UButton
            >
          </div>
        </UCard>
      </div>

      <div
        v-if="detail?.state === 'AWAITING_ADMIN_APPROVAL'"
        class="mt-6 flex gap-3"
      >
        <UButton @click="mutate('approve')">Approve category</UButton>
        <UButton color="error" variant="soft" @click="mutate('reject')"
          >Request revision</UButton
        >
      </div>
      <div v-if="canMessageClient" class="mt-6">
        <UButton color="neutral" variant="soft" @click="messageOpen = true"
          >Message client</UButton
        >
      </div>
      <UButton
        v-if="detail && !isTerminal"
        class="mt-6"
        color="error"
        variant="soft"
        @click="mutate('cancel')"
        >Cancel request</UButton
      >

    <SendClientMessageModal
      v-model:open="messageOpen"
      :request-id="requestId"
      :revision="detail?.revision"
    />
  </main>
</template>
