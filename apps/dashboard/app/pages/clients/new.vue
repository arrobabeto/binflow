<script setup lang="ts">
import type { Enrollment } from '@binflow/contracts';

const form = reactive({
  projectDisplayName: 'Webbin',
  projectKey: 'webbin',
  tenantDisplayName: 'Webbin',
  tenantKey: 'webbin',
});
const errorMessage = ref('');
const saving = ref(false);

const submit = async () => {
  saving.value = true;
  errorMessage.value = '';
  try {
    const enrollment = await $fetch<Enrollment>('/api/v1/admin/enrollments', {
      body: form,
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      method: 'POST',
    });
    await navigateTo(`/clients/${enrollment.id}`);
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : 'Enrollment could not be created.';
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <main class="mx-auto max-w-2xl px-6 py-10">
    <UButton to="/clients" color="neutral" variant="ghost"
      >Back to clients</UButton
    >
    <h1 class="mt-6 text-3xl font-semibold">Add client</h1>
    <p class="mt-2 text-muted">
      This adopts a matching Phase 0 draft scope when one already exists.
    </p>
    <UCard class="mt-8">
      <form class="grid gap-5" @submit.prevent="submit">
        <UFormField label="Client display name"
          ><UInput v-model="form.tenantDisplayName" class="w-full" required
        /></UFormField>
        <UFormField label="Client key"
          ><UInput v-model="form.tenantKey" class="w-full" required
        /></UFormField>
        <UFormField label="Project display name"
          ><UInput v-model="form.projectDisplayName" class="w-full" required
        /></UFormField>
        <UFormField label="Project key"
          ><UInput v-model="form.projectKey" class="w-full" required
        /></UFormField>
        <UAlert v-if="errorMessage" color="error" :description="errorMessage" />
        <UButton type="submit" :loading="saving">Create enrollment</UButton>
      </form>
    </UCard>
  </main>
</template>
