<script setup lang="ts">
import type {
  Enrollment,
  ToolCatalogResponse,
  ToolCustomizationDetail,
} from '@binflow/contracts';

const { data: enrollments } = await useFetch<{ items: Enrollment[] }>(
  '/api/v1/admin/enrollments',
);
const { data: tools } = await useFetch<ToolCatalogResponse>('/api/v1/tools');

const selectedProjectId = ref<string>('');
const selectedCapabilityId = ref('create_blog_draft');
const uploadBody = ref('');
const message = ref('');
const current = ref<ToolCustomizationDetail | null>(null);

watch(
  enrollments,
  (value) => {
    const first = value?.items?.[0];
    if (first?.projectId && !selectedProjectId.value)
      selectedProjectId.value = first.projectId;
  },
  { immediate: true },
);

const projectOptions = computed(() =>
  (enrollments.value?.items ?? [])
    .filter((item) => item.projectId)
    .map((item) => ({
      label: item.projectKey,
      value: item.projectId,
    })),
);

const refreshCurrent = async () => {
  if (!selectedProjectId.value || !selectedCapabilityId.value) {
    current.value = null;
    return;
  }
  current.value = await $fetch<ToolCustomizationDetail | null>(
    '/api/v1/tool-customizations/current',
    {
      query: {
        capabilityId: selectedCapabilityId.value,
        projectId: selectedProjectId.value,
      },
    },
  );
};

watch([selectedProjectId, selectedCapabilityId], () => {
  void refreshCurrent();
});

const downloadTemplate = async () => {
  const template = await $fetch<string>(
    `/api/v1/tools/${selectedCapabilityId.value}/customization-template`,
  );
  const blob = new Blob([template], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${selectedCapabilityId.value}-template.md`;
  anchor.click();
  URL.revokeObjectURL(url);
};

const downloadCurrent = () => {
  if (current.value === null) return;
  const blob = new Blob([current.value.body], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${selectedCapabilityId.value}-v${current.value.version}.md`;
  anchor.click();
  URL.revokeObjectURL(url);
};

const upload = async () => {
  message.value = '';
  await $fetch('/api/v1/tool-customizations', {
    body: {
      body: uploadBody.value,
      capabilityId: selectedCapabilityId.value,
      projectId: selectedProjectId.value,
    },
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    method: 'POST',
  });
  uploadBody.value = '';
  message.value = 'Customization uploaded.';
  await refreshCurrent();
};

onMounted(() => {
  void refreshCurrent();
});
</script>

<template>
  <main class="mx-auto max-w-6xl px-6 py-10">
    <h1 class="text-3xl font-semibold tracking-tight">
      Client tool customizations
    </h1>
    <p class="mt-2 text-muted">
      Download the native template, edit style guidance, and upload a new
      version. Customization cannot change models, paths or approvals.
    </p>
      <div class="mt-8 grid gap-4 md:grid-cols-2">
        <UFormField label="Client project">
          <USelect
            v-model="selectedProjectId"
            :items="projectOptions"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Tool">
          <USelect
            v-model="selectedCapabilityId"
            :items="
              (tools?.items ?? []).map((item) => ({
                label: item.displayName,
                value: item.id,
              }))
            "
            class="w-full"
          />
        </UFormField>
      </div>
      <div class="mt-6 flex flex-wrap gap-3">
        <UButton color="neutral" variant="soft" @click="downloadTemplate"
          >Download template</UButton
        >
        <UButton
          color="neutral"
          variant="soft"
          :disabled="current === null"
          @click="downloadCurrent"
          >Download current</UButton
        >
      </div>
      <UCard v-if="current" class="mt-6">
        <p class="font-semibold">Current version {{ current.version }}</p>
        <p class="mt-1 text-sm text-muted">
          {{ current.createdAt }} · {{ current.createdBy }} ·
          {{ current.sha256.slice(0, 12) }}…
        </p>
      </UCard>
      <UCard class="mt-6">
        <p class="font-semibold">Upload customization</p>
        <UTextarea v-model="uploadBody" class="mt-3 w-full" :rows="16" />
        <UButton class="mt-4" :disabled="!uploadBody.trim()" @click="upload"
          >Upload</UButton
        >
        <p v-if="message" class="mt-3 text-sm text-muted">{{ message }}</p>
      </UCard>
  </main>
</template>
