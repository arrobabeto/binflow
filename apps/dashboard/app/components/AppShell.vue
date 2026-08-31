<script setup lang="ts">
import { authClient } from '../lib/auth-client';

const route = useRoute();
const { data: session } = await authClient.useSession(useFetch);

type NavItem = Readonly<{
  icon: string;
  label: string;
  to: string;
}>;

const mainLinks: readonly NavItem[] = [
  { icon: 'i-lucide-house', label: 'Home', to: '/' },
  { icon: 'i-lucide-users', label: 'Clients', to: '/clients' },
  { icon: 'i-lucide-list-todo', label: 'Requests', to: '/requests' },
];

const toolsLinks: readonly NavItem[] = [
  { icon: 'i-lucide-book-open', label: 'Catalog', to: '/tools' },
  { icon: 'i-lucide-sliders-horizontal', label: 'Customizations', to: '/customizations' },
];

const systemLinks: readonly NavItem[] = [
  { icon: 'i-lucide-cable', label: 'Integrations', to: '/integrations' },
  { icon: 'i-lucide-activity', label: 'Operations', to: '/operations' },
  { icon: 'i-lucide-chart-column', label: 'Analytics', to: '/analytics' },
];

const isActive = (path: string): boolean => {
  if (path === '/') return route.path === '/';
  return route.path === path || route.path.startsWith(`${path}/`);
};

const initials = computed(() => {
  const email = session.value?.user.email ?? 'OP';
  const local = email.split('@')[0] ?? 'OP';
  return local.slice(0, 2).toUpperCase();
});

const signOut = async () => {
  await authClient.signOut();
  await navigateTo('/login');
};
</script>

<template>
  <div class="binflow-shell">
    <aside class="binflow-sidebar px-4 py-5" aria-label="Primary">
      <div class="flex items-center gap-2.5 px-1">
        <div
          class="flex size-8 items-center justify-center rounded-lg bg-primary/20 text-primary"
        >
          <UIcon name="i-lucide-circuit-board" class="size-4" />
        </div>
        <div class="min-w-0">
          <p class="text-sm font-semibold tracking-tight">Binflow</p>
          <p class="eyebrow !text-[0.65rem]">Control plane</p>
        </div>
      </div>

      <nav class="mt-8 flex flex-1 flex-col gap-6">
        <div>
          <p
            class="mb-2 px-2 text-[0.65rem] font-semibold tracking-[0.14em] text-muted uppercase"
          >
            Main
          </p>
          <div class="space-y-1">
            <UButton
              v-for="link in mainLinks"
              :key="link.to"
              :to="link.to"
              :icon="link.icon"
              color="neutral"
              :variant="isActive(link.to) ? 'soft' : 'ghost'"
              class="w-full justify-start"
              :class="
                isActive(link.to)
                  ? 'bg-[var(--binflow-elevated)] text-white ring-1 ring-primary/40'
                  : 'text-muted hover:text-white'
              "
              >{{ link.label }}</UButton
            >
          </div>
        </div>
        <div>
          <p
            class="mb-2 px-2 text-[0.65rem] font-semibold tracking-[0.14em] text-muted uppercase"
          >
            Tools
          </p>
          <div class="space-y-1">
            <UButton
              v-for="link in toolsLinks"
              :key="link.to"
              :to="link.to"
              :icon="link.icon"
              color="neutral"
              :variant="isActive(link.to) ? 'soft' : 'ghost'"
              class="w-full justify-start"
              :class="
                isActive(link.to)
                  ? 'bg-[var(--binflow-elevated)] text-white ring-1 ring-primary/40'
                  : 'text-muted hover:text-white'
              "
              >{{ link.label }}</UButton
            >
          </div>
        </div>
        <div>
          <p
            class="mb-2 px-2 text-[0.65rem] font-semibold tracking-[0.14em] text-muted uppercase"
          >
            System
          </p>
          <div class="space-y-1">
            <UButton
              v-for="link in systemLinks"
              :key="link.to"
              :to="link.to"
              :icon="link.icon"
              color="neutral"
              :variant="isActive(link.to) ? 'soft' : 'ghost'"
              class="w-full justify-start"
              :class="
                isActive(link.to)
                  ? 'bg-[var(--binflow-elevated)] text-white ring-1 ring-primary/40'
                  : 'text-muted hover:text-white'
              "
              >{{ link.label }}</UButton
            >
          </div>
        </div>
      </nav>

      <div class="mt-auto border-t border-[var(--binflow-border)] pt-4">
        <div class="flex items-center gap-3 px-1">
          <div
            class="flex size-8 items-center justify-center rounded-full bg-primary/25 text-xs font-semibold text-primary"
          >
            {{ initials }}
          </div>
          <div class="min-w-0">
            <p class="truncate text-sm font-medium">
              {{ session?.user.email ?? 'Platform owner' }}
            </p>
            <p class="text-[0.65rem] tracking-wide text-muted uppercase">
              Operator role
            </p>
          </div>
        </div>
        <UButton
          class="mt-3 w-full justify-start"
          color="error"
          variant="ghost"
          icon="i-lucide-log-out"
          @click="signOut"
          >Sign out</UButton
        >
      </div>
    </aside>
    <div class="binflow-main">
      <slot />
    </div>
  </div>
</template>
