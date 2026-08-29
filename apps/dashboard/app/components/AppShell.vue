<script setup lang="ts">
import { authClient } from '../lib/auth-client';

const route = useRoute();
const { data: session } = await authClient.useSession(useFetch);

const primaryLinks = [
  { label: 'Home', to: '/' },
  { label: 'Clients', to: '/clients' },
  { label: 'Requests', to: '/requests' },
] as const;

const toolsItems = [
  [
    { label: 'Catalog', to: '/tools' },
    { label: 'Customizations', to: '/customizations' },
  ],
];

const systemItems = [
  [
    { label: 'Integrations', to: '/integrations' },
    { label: 'Operations', to: '/operations' },
  ],
];

const isActive = (path: string): boolean => {
  if (path === '/') return route.path === '/';
  return route.path === path || route.path.startsWith(`${path}/`);
};

const toolsActive = computed(
  () => isActive('/tools') || isActive('/customizations'),
);

const systemActive = computed(
  () => isActive('/integrations') || isActive('/operations'),
);

const signOut = async () => {
  await authClient.signOut();
  await navigateTo('/login');
};
</script>

<template>
  <div class="min-h-dvh">
    <header class="border-b border-default bg-white">
      <div
        class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4"
      >
        <div class="min-w-0">
          <p class="eyebrow">Binflow</p>
          <p class="font-semibold">Administrative control plane</p>
        </div>
        <nav class="flex flex-wrap items-center gap-2" aria-label="Primary">
          <UButton
            v-for="link in primaryLinks"
            :key="link.to"
            :to="link.to"
            color="neutral"
            :variant="isActive(link.to) ? 'soft' : 'ghost'"
            >{{ link.label }}</UButton
          >
          <span
            class="mx-1 hidden h-5 w-px bg-default sm:inline-block"
            aria-hidden="true"
          />
          <UDropdownMenu :items="toolsItems">
            <UButton
              color="neutral"
              :variant="toolsActive ? 'soft' : 'ghost'"
              trailing-icon="i-lucide-chevron-down"
              >Tools</UButton
            >
          </UDropdownMenu>
          <UDropdownMenu :items="systemItems">
            <UButton
              color="neutral"
              :variant="systemActive ? 'soft' : 'ghost'"
              trailing-icon="i-lucide-chevron-down"
              >System</UButton
            >
          </UDropdownMenu>
          <span class="text-sm text-muted">{{ session?.user.email }}</span>
          <UButton color="neutral" variant="ghost" @click="signOut"
            >Sign out</UButton
          >
        </nav>
      </div>
    </header>
    <slot />
  </div>
</template>
