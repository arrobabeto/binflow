<script setup lang="ts">
import type { TicketDetail, TicketState } from '@binflow/contracts';
import {
  ticketStateBadgeColor,
  ticketStateLabel,
} from '../../lib/ticket-inbox';

const route = useRoute();
const ticketId = String(route.params.id);

const {
  data: detail,
  error: loadError,
  refresh: loadDetail,
  status,
} = await useFetch<TicketDetail>(`/api/v1/admin/tickets/${ticketId}`);

const actionError = ref('');
const notesDraft = ref('');
const saving = ref(false);
const messageOpen = ref(false);
const loading = computed(() => status.value === 'pending');

watch(
  detail,
  (value) => {
    if (value !== undefined) notesDraft.value = value.adminNotes;
  },
  { immediate: true },
);

onMounted(async () => {
  try {
    await $fetch(`/api/v1/admin/tickets/${ticketId}/read`, { method: 'POST' });
    await loadDetail();
  } catch {
    // Detail still usable if mark-read fails.
  }
});

const stateItems = [
  { label: 'New', value: 'new' },
  { label: 'In progress', value: 'in_process' },
  { label: 'Declined', value: 'declined' },
  { label: 'Closed', value: 'closed' },
] as const;

const patchTicket = async (body: {
  adminNotes?: string;
  state?: TicketState;
}) => {
  if (detail.value === undefined) return;
  actionError.value = '';
  saving.value = true;
  try {
    detail.value = await $fetch<TicketDetail>(
      `/api/v1/admin/tickets/${ticketId}`,
      {
        method: 'PATCH',
        body,
        headers: {
          'Idempotency-Key': crypto.randomUUID(),
          'If-Match': `"${String(detail.value.revision)}"`,
        },
      },
    );
    notesDraft.value = detail.value.adminNotes;
  } catch (error) {
    actionError.value =
      error instanceof Error ? error.message : 'Could not update the ticket.';
  } finally {
    saving.value = false;
  }
};

const onStateChange = async (value: string) => {
  if (detail.value === undefined || value === detail.value.state) return;
  await patchTicket({ state: value as TicketState });
};

const markResolved = async () => {
  if (detail.value === undefined || detail.value.state === 'closed') return;
  await patchTicket({ state: 'closed' });
};

const saveNotes = async () => {
  if (detail.value === undefined) return;
  if (notesDraft.value === detail.value.adminNotes) return;
  await patchTicket({ adminNotes: notesDraft.value });
};

const submittedLabel = computed(() => {
  if (detail.value === undefined) return '—';
  return new Date(detail.value.createdAt).toLocaleString('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
});
</script>

<template>
  <main class="mx-auto max-w-5xl px-6 py-8 lg:px-8">
    <UButton
      to="/tickets"
      color="neutral"
      variant="soft"
      icon="i-lucide-arrow-left"
      class="mb-3 mt-2.5 text-[15px]"
    >
      Back to tickets
    </UButton>

    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-3">
          <UBadge
            v-if="detail"
            :color="ticketStateBadgeColor(detail.state)"
            variant="soft"
          >
            {{ ticketStateLabel(detail.state) }}
          </UBadge>
          <UButton
            v-if="detail && detail.state !== 'closed'"
            color="primary"
            variant="soft"
            size="sm"
            :loading="saving"
            @click="markResolved"
          >
            Mark as resolved
          </UButton>
        </div>
        <h1 class="mt-3 text-3xl font-semibold tracking-tight text-white">
          {{ detail?.title ?? (loading ? 'Loading ticket…' : 'Ticket') }}
        </h1>
        <p class="mt-2 font-mono text-sm text-[var(--binflow-accent)]">
          {{ detail?.publicId ?? ticketId }}
        </p>
      </div>
      <UFormField v-if="detail" label="Status" class="min-w-44">
        <USelect
          :model-value="detail.state"
          value-key="value"
          :items="[...stateItems]"
          :disabled="saving"
          @update:model-value="onStateChange"
        />
      </UFormField>
    </div>

    <UAlert
      v-if="loadError"
      class="mt-6"
      color="error"
      variant="soft"
      title="Could not load ticket"
      :description="
        loadError.message || 'The ticket detail could not be loaded.'
      "
    />
    <p v-if="actionError" class="mt-4 text-sm text-error">
      {{ actionError }}
    </p>

    <div v-if="detail" class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <UCard class="binflow-surface !ring-0">
        <p class="text-sm text-muted">Client</p>
        <p class="mt-2 font-medium text-white">{{ detail.clientName }}</p>
        <p class="mt-1 font-mono text-xs text-[var(--binflow-accent)]">
          {{ detail.clientKey }}
        </p>
      </UCard>
      <UCard class="binflow-surface !ring-0">
        <p class="text-sm text-muted">Submitted</p>
        <p class="mt-2 font-medium text-white">{{ submittedLabel }}</p>
      </UCard>
      <UCard class="binflow-surface !ring-0">
        <p class="text-sm text-muted">Priority</p>
        <p class="mt-2 font-medium capitalize text-white">
          {{ detail.priority ?? '—' }}
        </p>
      </UCard>
      <UCard class="binflow-surface !ring-0">
        <p class="text-sm text-muted">Category</p>
        <p class="mt-2 font-medium text-white">
          {{ detail.category ?? '—' }}
        </p>
      </UCard>
    </div>

    <section v-if="detail" class="mt-8">
      <h2 class="text-lg font-semibold text-white">Request details</h2>
      <UCard class="binflow-surface mt-3 !ring-0">
        <p class="whitespace-pre-wrap text-sm text-white">{{ detail.body }}</p>
      </UCard>
    </section>

    <section v-if="detail" class="mt-8">
      <h2 class="text-lg font-semibold text-white">Admin notes</h2>
      <UTextarea
        v-model="notesDraft"
        class="mt-3"
        :rows="4"
        placeholder="Internal notes (not sent to the client)"
      />
      <UButton
        class="mt-3"
        color="neutral"
        variant="soft"
        :loading="saving"
        :disabled="notesDraft === detail.adminNotes"
        @click="saveNotes"
      >
        Save notes
      </UButton>
    </section>

    <section v-if="detail" class="mt-8">
      <h2 class="text-lg font-semibold text-white">Activity log</h2>
      <ul class="mt-3 space-y-3">
        <li
          v-for="item in detail.activity"
          :key="item.id"
          class="binflow-inset rounded-lg px-3 py-2 text-sm"
        >
          <p class="text-white">{{ item.summary }}</p>
          <p class="mt-1 text-xs text-muted">
            {{ item.kind }} · {{ item.actorType }} ·
            {{ new Date(item.createdAt).toLocaleString('en') }}
          </p>
        </li>
        <li
          v-if="detail.activity.length === 0"
          class="text-sm text-muted"
        >
          No activity yet.
        </li>
      </ul>
    </section>

    <footer
      v-if="detail"
      class="mt-10 flex flex-wrap gap-3 border-t border-[var(--binflow-border)] pt-6"
    >
      <UButton color="primary" variant="soft" @click="messageOpen = true">
        Message client
      </UButton>
      <UButton
        v-if="detail.state !== 'closed'"
        color="neutral"
        variant="soft"
        :loading="saving"
        @click="markResolved"
      >
        Mark as resolved
      </UButton>
    </footer>

    <SendClientMessageModal
      v-model:open="messageOpen"
      :ticket-id="ticketId"
      @queued="loadDetail"
    />
  </main>
</template>
