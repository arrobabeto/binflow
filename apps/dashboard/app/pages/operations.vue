<script setup lang="ts">
type AdminTarget = {
  botId: string;
  botUsername: string;
  chatId: string;
  externalUserId: string;
  pairedAt: string;
  status: 'active';
};
type Readiness = {
  checks: Record<string, 'ready' | 'unavailable' | 'stale' | 'misconfigured'>;
  status: 'ready' | 'not_ready';
  timestamp: string;
};

const { data: target, refresh } = await useFetch<AdminTarget | null>(
  '/api/v1/admin/telegram/target',
);
const { data: readiness, refresh: refreshReadiness } =
  await useFetch<Readiness>('/api/v1/readiness');
const pairing = ref<{ expiresAt: string; pairingUrl: string } | null>(null);
const errorMessage = ref('');

const createPairingLink = async () => {
  errorMessage.value = '';
  try {
    pairing.value = await $fetch('/api/v1/admin/telegram/pairing-link', {
      method: 'POST',
      body: {},
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : 'Pairing link creation failed.';
  }
};
</script>

<template>
  <main class="mx-auto max-w-5xl px-6 py-10">
    <h1 class="text-3xl font-semibold tracking-tight">Admin notifications</h1>
    <p class="mt-2 text-muted">
      Pair the verified global admin bot to receive client activity and
      approval alerts.
    </p>
      <p v-if="errorMessage" class="mt-4 text-sm text-error">
        {{ errorMessage }}
      </p>
      <UCard class="mt-8">
        <template v-if="target">
          <p class="font-semibold">Active target</p>
          <dl class="mt-4 grid gap-3 text-sm md:grid-cols-2">
            <div>
              <dt class="text-muted">Bot</dt>
              <dd>@{{ target.botUsername }}</dd>
            </div>
            <div>
              <dt class="text-muted">Telegram user</dt>
              <dd>{{ target.externalUserId }}</dd>
            </div>
            <div>
              <dt class="text-muted">Chat</dt>
              <dd>{{ target.chatId }}</dd>
            </div>
            <div>
              <dt class="text-muted">Paired</dt>
              <dd>{{ target.pairedAt }}</dd>
            </div>
          </dl>
        </template>
        <p v-else class="text-muted">No admin notification target is paired.</p>
        <div class="mt-6 flex gap-3">
          <UButton @click="createPairingLink"
            >Create one-time pairing link</UButton
          >
          <UButton color="neutral" variant="soft" @click="refresh"
            >Refresh</UButton
          >
        </div>
      </UCard>
      <UCard class="mt-4">
        <div class="flex items-center justify-between gap-4">
          <div>
            <p class="font-semibold">Runtime readiness</p>
            <p class="mt-1 text-sm text-muted">
              {{ readiness?.status ?? 'not_ready' }} ·
              {{ readiness?.timestamp ?? 'not checked' }}
            </p>
          </div>
          <UButton color="neutral" variant="soft" @click="refreshReadiness"
            >Refresh</UButton
          >
        </div>
        <dl class="mt-4 grid gap-3 text-sm md:grid-cols-2">
          <div
            v-for="(status, dependency) in readiness?.checks ?? {}"
            :key="dependency"
          >
            <dt class="text-muted">{{ dependency }}</dt>
            <dd class="font-medium">{{ status }}</dd>
          </div>
        </dl>
      </UCard>
      <UCard v-if="pairing" class="mt-4">
        <p class="font-semibold">Shown once</p>
        <p class="mt-2 text-sm text-muted">
          Open before {{ pairing.expiresAt }}.
        </p>
        <UButton class="mt-4" :to="pairing.pairingUrl" target="_blank"
          >Pair in Telegram</UButton
        >
      </UCard>
  </main>
</template>
