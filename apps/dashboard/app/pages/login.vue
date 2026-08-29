<script setup lang="ts">
import { authClient } from '../lib/auth-client';
import { authenticatedDestination } from '../lib/session-navigation';

definePageMeta({ layout: 'auth' });

const route = useRoute();

const email = ref('');
const password = ref('');
const pending = ref(false);
const message = ref<string>();

const submit = async () => {
  pending.value = true;
  message.value = undefined;
  const result = await authClient.signIn.email({
    email: email.value,
    password: password.value,
  });
  pending.value = false;
  if (result.error) {
    message.value = 'The email, password or account state is not valid.';
    return;
  }
  if ('twoFactorRedirect' in result.data && result.data.twoFactorRedirect) {
    await navigateTo({
      path: '/two-factor',
      query: {
        redirect: authenticatedDestination(route.query.redirect),
      },
    });
    return;
  }
  await navigateTo('/security');
};
</script>

<template>
  <main class="auth-shell">
    <UCard class="auth-card">
      <template #header>
        <p class="eyebrow">Binflow control plane</p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight">Sign in</h1>
        <p class="mt-2 text-sm text-muted">Platform-owner access only.</p>
      </template>
      <UForm class="space-y-5" :state="{ email, password }" @submit="submit">
        <UFormField label="Email" name="email" required>
          <UInput
            v-model="email"
            type="email"
            autocomplete="username"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Password" name="password" required>
          <UInput
            v-model="password"
            type="password"
            autocomplete="current-password"
            class="w-full"
          />
        </UFormField>
        <UAlert
          v-if="message"
          color="error"
          variant="soft"
          :description="message"
        />
        <UButton type="submit" block :loading="pending">Continue</UButton>
      </UForm>
    </UCard>
  </main>
</template>
