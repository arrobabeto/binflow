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
          <UButton to="/integrations" color="neutral" variant="soft"
            >Integrations</UButton
          >
          <UButton to="/clients" color="neutral" variant="soft"
            >Clients</UButton
          >
          <UButton to="/requests" color="neutral" variant="soft"
            >Requests</UButton
          >
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
        Manage client enrollment, integration readiness and activation evidence.
      </p>
      <div class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
          <p class="text-sm text-muted">Client onboarding</p>
          <UButton class="mt-3" to="/clients">Open clients</UButton>
        </UCard>
        <UCard>
          <p class="text-sm text-muted">Provider credentials</p>
          <UButton class="mt-3" to="/integrations">Open integrations</UButton>
        </UCard>
        <UCard>
          <p class="text-sm text-muted">Workflow requests</p>
          <UButton class="mt-3" to="/requests">Open requests</UButton>
        </UCard>
      </div>
    </main>
  </div>
</template>
