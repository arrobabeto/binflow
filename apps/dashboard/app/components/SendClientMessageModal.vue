<script setup lang="ts">
import {
  ADMIN_CLIENT_MESSAGE_MAX_LENGTH,
  type ClientMessageTarget,
} from '@binflow/contracts';

const open = defineModel<boolean>('open', { required: true });

const props = defineProps<{
  enrollmentId?: string;
  requestId?: string;
  revision?: number;
}>();

const emit = defineEmits<{
  queued: [];
}>();

const message = ref('');
const target = ref<ClientMessageTarget | null>(null);
const loadError = ref('');
const sendError = ref('');
const loadingTarget = ref(false);
const sending = ref(false);

const targetUrl = computed(() => {
  if (props.enrollmentId !== undefined)
    return `/api/v1/admin/enrollments/${props.enrollmentId}/message-target`;
  if (props.requestId !== undefined)
    return `/api/v1/requests/${props.requestId}/message-target`;
  return null;
});

const canSend = computed(
  () =>
    target.value?.paired === true &&
    message.value.trim().length > 0 &&
    message.value.trim().length <= ADMIN_CLIENT_MESSAGE_MAX_LENGTH &&
    !sending.value,
);

const remaining = computed(
  () => ADMIN_CLIENT_MESSAGE_MAX_LENGTH - message.value.trim().length,
);

const loadTarget = async () => {
  if (targetUrl.value === null) return;
  loadingTarget.value = true;
  loadError.value = '';
  target.value = null;
  try {
    target.value = await $fetch<ClientMessageTarget>(targetUrl.value);
  } catch (error) {
    loadError.value =
      error instanceof Error
        ? error.message
        : 'Could not load the message target.';
  } finally {
    loadingTarget.value = false;
  }
};

watch(open, async (isOpen) => {
  if (!isOpen) {
    message.value = '';
    sendError.value = '';
    loadError.value = '';
    target.value = null;
    return;
  }
  await loadTarget();
});

const send = async () => {
  if (!canSend.value) return;
  sendError.value = '';
  sending.value = true;
  try {
    if (props.enrollmentId !== undefined) {
      await $fetch(`/api/v1/admin/enrollments/${props.enrollmentId}/messages`, {
        method: 'POST',
        body: { message: message.value },
        headers: {
          'Idempotency-Key': crypto.randomUUID(),
        },
      });
    } else if (
      props.requestId !== undefined &&
      props.revision !== undefined
    ) {
      await $fetch(`/api/v1/requests/${props.requestId}/messages`, {
        method: 'POST',
        body: { message: message.value },
        headers: {
          'Idempotency-Key': crypto.randomUUID(),
          'If-Match': `"${String(props.revision)}"`,
        },
      });
    } else {
      throw new Error('Message destination is incomplete.');
    }
    open.value = false;
    emit('queued');
  } catch (error) {
    sendError.value =
      error instanceof Error ? error.message : 'Could not queue the message.';
  } finally {
    sending.value = false;
  }
};
</script>

<template>
  <UModal v-model:open="open" title="Message client">
    <template #body>
      <div class="space-y-4">
        <UAlert
          v-if="loadError"
          color="error"
          variant="soft"
          title="Could not load channel"
          :description="loadError"
        />
        <div
          v-else-if="loadingTarget"
          class="binflow-inset px-3 py-2 text-sm text-muted"
        >
          Loading channel…
        </div>
        <div v-else-if="target" class="binflow-inset px-3 py-2 text-sm">
          <p class="text-xs font-medium tracking-wide text-muted uppercase">
            Sending to
          </p>
          <p class="mt-1 font-medium text-white">
            {{ target.clientName }}
            <span class="font-mono text-[var(--binflow-accent)]">
              · {{ target.tenantKey }} / {{ target.projectKey }}
            </span>
          </p>
          <p class="mt-1 text-muted">
            <template v-if="target.paired">
              Telegram
              <span class="font-mono text-[var(--binflow-accent)]">
                {{
                  target.botUsername
                    ? `@${target.botUsername}`
                    : 'paired bot'
                }}
              </span>
            </template>
            <template v-else>Not paired — messaging unavailable</template>
          </p>
        </div>

        <UFormField
          label="Message"
          :hint="`${String(Math.max(0, remaining))} characters left`"
        >
          <UTextarea
            v-model="message"
            :rows="5"
            :maxlength="ADMIN_CLIENT_MESSAGE_MAX_LENGTH"
            :disabled="!target?.paired"
            placeholder="Plain text for the client Telegram chat"
            autoresize
          />
        </UFormField>

        <UAlert
          v-if="sendError"
          color="error"
          variant="soft"
          title="Send failed"
          :description="sendError"
        />
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="open = false"
          >Cancel</UButton
        >
        <UButton :disabled="!canSend" :loading="sending" @click="send"
          >Queue message</UButton
        >
      </div>
    </template>
  </UModal>
</template>
