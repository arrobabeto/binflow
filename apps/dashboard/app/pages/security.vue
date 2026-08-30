<script setup lang="ts">
import QRCode from 'qrcode';

import { authClient } from '../lib/auth-client';

definePageMeta({ layout: 'auth' });

const { data: session } = await authClient.useSession(useFetch);
const password = ref('');
const code = ref('');
const pending = ref(false);
const message = ref<string>();
const qrDataUrl = ref<string>();
const backupCodes = ref<string[]>([]);
const enrollmentComplete = ref(false);
const backupCodesStored = ref(false);
const sessions = ref<
  Array<{
    createdAt: Date;
    id: string;
    ipAddress?: string | null;
    token: string;
    userAgent?: string | null;
  }>
>([]);

const loadSessions = async () => {
  if (session.value?.user.twoFactorEnabled !== true) return;
  const result = await authClient.listSessions();
  if (result.data) sessions.value = result.data;
};

await loadSessions();

const beginEnrollment = async () => {
  pending.value = true;
  message.value = undefined;
  const result = await authClient.twoFactor.enable({
    method: 'totp',
    password: password.value,
  });
  pending.value = false;
  if (result.error || result.data?.method !== 'totp') {
    message.value = 'TOTP enrollment could not be started.';
    return;
  }
  qrDataUrl.value = await QRCode.toDataURL(result.data.totpURI, {
    margin: 1,
    width: 240,
  });
  backupCodes.value = result.data.backupCodes;
  backupCodesStored.value = false;
  password.value = '';
};

const finishEnrollment = async () => {
  pending.value = true;
  message.value = undefined;
  const result = await authClient.twoFactor.verifyTotp({
    code: code.value,
    trustDevice: false,
  });
  pending.value = false;
  if (result.error) {
    message.value = 'The authenticator code is invalid.';
    return;
  }
  enrollmentComplete.value = true;
  message.value =
    'Two-factor authentication is enabled. Store the backup codes now.';
};

const regenerateBackupCodes = async () => {
  pending.value = true;
  message.value = undefined;
  const result = await authClient.twoFactor.generateBackupCodes({
    password: password.value,
  });
  pending.value = false;
  password.value = '';
  if (result.error) {
    message.value =
      'Backup codes could not be regenerated. Sign in again if the session is no longer fresh.';
    return;
  }
  backupCodes.value = result.data.backupCodes;
  backupCodesStored.value = false;
  message.value = 'Previous backup codes are now invalid.';
};

const revokeSession = async (token: string) => {
  pending.value = true;
  const result = await authClient.revokeSession({ token });
  pending.value = false;
  if (result.error) {
    message.value = 'The session could not be revoked.';
    return;
  }
  const active = await authClient.getSession();
  if (!active.data) {
    await navigateTo('/login');
    return;
  }
  await loadSessions();
};

const signOut = async () => {
  await authClient.signOut();
  await navigateTo('/login');
};
</script>

<template>
  <main class="auth-shell">
    <UCard class="auth-card">
      <template #header>
        <p class="eyebrow">Account security</p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight text-white">
          Secure Binflow
        </h1>
        <p class="mt-2 text-sm text-muted">
          TOTP is required before business access.
        </p>
      </template>
      <div
        v-if="session?.user.twoFactorEnabled && !enrollmentComplete"
        class="space-y-6"
      >
        <UAlert
          color="success"
          variant="soft"
          title="Two-factor authentication enabled"
        />
        <section class="space-y-3">
          <h2 class="text-lg font-semibold">Regenerate backup codes</h2>
          <p class="text-sm text-muted">
            This invalidates every previous unused backup code.
          </p>
          <UFormField label="Confirm your password" required>
            <UInput
              v-model="password"
              type="password"
              autocomplete="current-password"
              class="w-full"
            />
          </UFormField>
          <UButton :loading="pending" @click="regenerateBackupCodes"
            >Generate new codes</UButton
          >
        </section>
        <section class="space-y-3">
          <h2 class="text-lg font-semibold">Active sessions</h2>
          <div
            v-for="item in sessions"
            :key="item.id"
            class="flex items-center justify-between gap-4 rounded-xl border border-default p-3"
          >
            <div class="min-w-0 text-sm">
              <p class="truncate font-medium">
                {{ item.userAgent || 'Unknown device' }}
              </p>
              <p class="text-muted">
                {{ item.ipAddress || 'Unknown IP' }} ·
                {{ new Date(item.createdAt).toLocaleString() }}
              </p>
            </div>
            <UButton
              color="error"
              variant="soft"
              :loading="pending"
              @click="revokeSession(item.token)"
              >Revoke</UButton
            >
          </div>
        </section>
        <UButton to="/" block>Open dashboard</UButton>
      </div>
      <div v-else-if="!qrDataUrl" class="space-y-5">
        <UFormField label="Confirm your password" required>
          <UInput
            v-model="password"
            type="password"
            autocomplete="current-password"
            class="w-full"
          />
        </UFormField>
        <UButton block :loading="pending" @click="beginEnrollment"
          >Set up authenticator</UButton
        >
      </div>
      <div v-else class="space-y-5">
        <div class="flex justify-center">
          <img
            :src="qrDataUrl"
            alt="Binflow TOTP enrollment QR code"
            width="240"
            height="240"
          />
        </div>
        <UFormField label="Authenticator code" required>
          <UInput
            v-model="code"
            inputmode="numeric"
            autocomplete="one-time-code"
            class="w-full"
          />
        </UFormField>
        <UButton
          v-if="!enrollmentComplete"
          block
          :loading="pending"
          @click="finishEnrollment"
          >Verify and enable</UButton
        >
        <div
          v-if="backupCodes.length && enrollmentComplete"
          class="rounded-xl border border-warning/40 bg-warning/5 p-4"
        >
          <p class="font-semibold">Save these backup codes now</p>
          <ul class="mt-3 grid grid-cols-2 gap-2 font-mono text-sm">
            <li v-for="item in backupCodes" :key="item">{{ item }}</li>
          </ul>
          <UCheckbox
            v-model="backupCodesStored"
            class="mt-4"
            label="I stored these codes securely"
          />
        </div>
        <UButton
          v-if="enrollmentComplete"
          to="/"
          block
          :disabled="!backupCodesStored"
          >Open dashboard</UButton
        >
      </div>
      <div
        v-if="backupCodes.length && session?.user.twoFactorEnabled"
        class="mt-5 rounded-xl border border-warning/40 bg-warning/5 p-4"
      >
        <p class="font-semibold">Save these new backup codes now</p>
        <ul class="mt-3 grid grid-cols-2 gap-2 font-mono text-sm">
          <li v-for="item in backupCodes" :key="item">{{ item }}</li>
        </ul>
        <UCheckbox
          v-model="backupCodesStored"
          class="mt-4"
          label="I stored these codes securely"
        />
        <UButton
          class="mt-4"
          block
          :disabled="!backupCodesStored"
          @click="backupCodes = []"
          >Hide codes</UButton
        >
      </div>
      <UAlert
        v-if="message"
        class="mt-5"
        variant="soft"
        :description="message"
      />
      <template #footer>
        <UButton color="neutral" variant="ghost" @click="signOut"
          >Sign out</UButton
        >
      </template>
    </UCard>
  </main>
</template>
