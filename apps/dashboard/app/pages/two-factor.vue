<script setup lang="ts">
import { authClient } from '../lib/auth-client';
import { revalidateAndReplaceAuthenticatedDocument } from '../lib/session-navigation';

definePageMeta({ layout: 'auth' });

const route = useRoute();

const method = ref<'totp' | 'backup'>('totp');
const code = ref('');
const pending = ref(false);
const message = ref<string>();

const verify = async () => {
  pending.value = true;
  message.value = undefined;
  const result =
    method.value === 'totp'
      ? await authClient.twoFactor.verifyTotp({
          code: code.value,
          trustDevice: false,
        })
      : await authClient.twoFactor.verifyBackupCode({
          code: code.value,
          trustDevice: false,
        });
  if (result.error) {
    pending.value = false;
    message.value = 'The verification code is invalid, used or expired.';
    return;
  }
  try {
    await revalidateAndReplaceAuthenticatedDocument(
      authClient,
      route.query.redirect,
    );
  } catch {
    pending.value = false;
    message.value =
      'Your code was accepted, but the session could not be refreshed. Please try signing in again.';
  }
};
</script>

<template>
  <main class="auth-shell">
    <UCard class="auth-card">
      <template #header>
        <p class="eyebrow">Second factor</p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight">
          Verify your sign-in
        </h1>
      </template>
      <div class="mb-5 grid grid-cols-2 gap-2">
        <UButton
          :variant="method === 'totp' ? 'solid' : 'soft'"
          @click="method = 'totp'"
          >Authenticator</UButton
        >
        <UButton
          :variant="method === 'backup' ? 'solid' : 'soft'"
          @click="method = 'backup'"
          >Backup code</UButton
        >
      </div>
      <UForm class="space-y-5" :state="{ code }" @submit="verify">
        <UFormField
          :label="method === 'totp' ? 'Six-digit code' : 'Backup code'"
          name="code"
          required
        >
          <UInput
            v-model="code"
            inputmode="numeric"
            autocomplete="one-time-code"
            class="w-full"
          />
        </UFormField>
        <UAlert
          v-if="message"
          color="error"
          variant="soft"
          :description="message"
        />
        <UButton type="submit" block :loading="pending">Verify</UButton>
      </UForm>
    </UCard>
  </main>
</template>
