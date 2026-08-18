<script setup lang="ts">
import { authClient } from '../lib/auth-client';

const { data: session } = await authClient.useSession(useFetch);
const { data: health } = await useFetch('/api/v1/health');

const signOut = async () => {
  await authClient.signOut();
  await navigateTo('/login');
};
</script>

<template>
  <div class="min-h-dvh">
    <header class="border-b border-default bg-white">
      <div
        class="mx-auto flex max-w-6xl items-center justify-between px-6 py-4"
      >
        <div>
          <p class="eyebrow">Binflow</p>
          <p class="font-semibold">Administrative control plane</p>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-sm text-muted">{{ session?.user.email }}</span>
          <UButton color="neutral" variant="ghost" @click="signOut"
            >Sign out</UButton
          >
        </div>
      </div>
    </header>
    <main class="mx-auto max-w-6xl px-6 py-10">
      <h1 class="text-3xl font-semibold tracking-tight">System overview</h1>
      <p class="mt-2 text-muted">
        The authenticated Phase 1 control plane is ready for onboarding modules.
      </p>
      <div class="mt-8 grid gap-4 sm:grid-cols-3">
        <UCard>
          <p class="text-sm text-muted">API</p>
          <p class="mt-2 text-xl font-semibold">
            {{ health?.status ?? 'Checking' }}
          </p>
        </UCard>
        <UCard>
          <p class="text-sm text-muted">Authentication</p>
          <p class="mt-2 text-xl font-semibold">TOTP verified</p>
        </UCard>
        <UCard>
          <p class="text-sm text-muted">Role</p>
          <p class="mt-2 text-xl font-semibold">Platform owner</p>
        </UCard>
      </div>
    </main>
  </div>
</template>
