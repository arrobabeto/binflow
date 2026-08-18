<script setup lang="ts">
import type { RequestDetail } from '@binflow/contracts';

const route = useRoute();
const requestId = computed(() => String(route.params.id));
const { data, refresh } = await useFetch<RequestDetail>(
  () => `/api/v1/requests/${requestId.value}`,
);
const errorMessage = ref('');

const decideRequest = async (decision: 'approve' | 'reject') => {
  if (data.value === undefined) return;
  errorMessage.value = '';
  try {
    await $fetch(`/api/v1/requests/${requestId.value}/${decision}`, {
      method: 'POST',
      body: {},
      headers: {
        'Idempotency-Key': crypto.randomUUID(),
        'If-Match': `"${data.value.revision}"`,
      },
    });
    await refresh();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : 'Approval decision failed.';
  }
};

const cancelRequest = async () => {
  if (data.value === undefined) return;
  errorMessage.value = '';
  try {
    await $fetch(`/api/v1/requests/${requestId.value}/cancel`, {
      method: 'POST',
      body: {},
      headers: {
        'Idempotency-Key': crypto.randomUUID(),
        'If-Match': `"${data.value.revision}"`,
      },
    });
    await refresh();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : 'Cancellation failed.';
  }
};
</script>

<template>
  <div class="min-h-dvh">
    <header class="border-b border-default bg-white">
      <div
        class="mx-auto flex max-w-5xl items-center justify-between px-6 py-4"
      >
        <div>
          <p class="eyebrow">Binflow</p>
          <p class="font-semibold">Request detail</p>
        </div>
        <UButton color="neutral" variant="ghost" to="/requests"
          >Back to requests</UButton
        >
      </div>
    </header>
    <main class="mx-auto max-w-5xl px-6 py-10">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="text-3xl font-semibold tracking-tight">
            {{ data?.topic ?? 'Request' }}
          </h1>
          <p class="mt-2 font-mono text-sm text-muted">{{ data?.id }}</p>
        </div>
        <UBadge color="neutral" variant="soft">{{ data?.state }}</UBadge>
      </div>
      <p v-if="errorMessage" class="mt-4 text-sm text-error">
        {{ errorMessage }}
      </p>
      <div class="mt-8 grid gap-4 md:grid-cols-2">
        <UCard
          ><p class="text-sm text-muted">Capability</p>
          <p class="mt-2 font-semibold">{{ data?.capabilityId }}</p></UCard
        >
        <UCard
          ><p class="text-sm text-muted">Version</p>
          <p class="mt-2 font-semibold">{{ data?.currentVersion }}</p></UCard
        >
        <UCard class="md:col-span-2">
          <p class="font-semibold">Confirmed plan</p>
          <pre
            class="mt-3 overflow-auto whitespace-pre-wrap text-sm text-muted"
            >{{ JSON.stringify(data?.plan ?? {}, null, 2) }}</pre>
        </UCard>
        <UCard v-if="data?.execution" class="md:col-span-2">
          <p class="font-semibold">Exact preview evidence</p>
          <dl class="mt-4 grid gap-3 text-sm md:grid-cols-2">
            <div>
              <dt class="text-muted">Approval</dt>
              <dd class="font-medium">{{ data.execution.approvalStatus }}</dd>
            </div>
            <div>
              <dt class="text-muted">Category decision</dt>
              <dd class="font-medium">{{ data.execution.categoryKind }}</dd>
            </div>
            <div>
              <dt class="text-muted">Head commit</dt>
              <dd class="break-all font-mono">
                {{ data.execution.headCommitSha }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">Branch</dt>
              <dd class="break-all font-mono">{{ data.execution.branch }}</dd>
            </div>
          </dl>
          <div class="mt-4 flex flex-wrap gap-2">
            <UButton
              v-for="(url, path) in data.execution.previewUrls"
              :key="path"
              :to="url"
              target="_blank"
              color="neutral"
              variant="soft"
              >Open {{ path }}</UButton
            >
            <UButton
              v-if="data.execution.pullRequestUrl"
              :to="data.execution.pullRequestUrl"
              target="_blank"
              color="neutral"
              variant="soft"
              >Open pull request</UButton
            >
          </div>
        </UCard>
      </div>
      <div
        v-if="data?.state === 'AWAITING_ADMIN_APPROVAL'"
        class="mt-6 flex gap-3"
      >
        <UButton @click="decideRequest('approve')">Approve category</UButton>
        <UButton color="error" variant="soft" @click="decideRequest('reject')"
          >Request revision</UButton
        >
      </div>
      <UButton
        v-if="
          data &&
          !['COMPLETED', 'FAILED_FINAL', 'CANCELLED', 'SUPERSEDED'].includes(
            data.state,
          )
        "
        class="mt-6"
        color="error"
        variant="soft"
        @click="cancelRequest"
        >Cancel request</UButton
      >
    </main>
  </div>
</template>
