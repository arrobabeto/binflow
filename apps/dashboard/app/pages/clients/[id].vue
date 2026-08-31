<script setup lang="ts">
import type {
  CapabilityCatalogResponse,
  Enrollment,
  EnrollmentValidationAttempt,
  ProjectManifestResponse,
  ToolCatalogResponse,
} from '@binflow/contracts';
import {
  buildCapabilityBindings,
  capabilityKey,
  enabledCapabilityKeys,
} from '../../lib/capability-bindings';
import { createPendingPairingRefresh } from '../../lib/pending-pairing-refresh';

const route = useRoute();
const id = String(route.params.id);
const { data: enrollment, refresh } = await useFetch<Enrollment>(
  `/api/v1/admin/enrollments/${id}`,
);
const { data: manifestState, refresh: refreshManifest } =
  await useFetch<ProjectManifestResponse>(
    `/api/v1/admin/enrollments/${id}/manifest`,
  );
const capabilityUrl = computed(() =>
  enrollment.value?.projectId
    ? `/api/v1/projects/${enrollment.value.projectId}/capabilities`
    : null,
);
const { data: capabilityState, refresh: refreshCapabilities } =
  await useFetch<CapabilityCatalogResponse>(capabilityUrl);
const { data: toolCatalog } = await useFetch<ToolCatalogResponse>(
  '/api/v1/tools',
);
const enabledToolKeys = ref<Set<string>>(new Set());
const capabilityMessage = ref('');
const attempts = ref<EnrollmentValidationAttempt[]>([]);
const pairingUrl = ref('');
const message = ref('');
const busy = ref(false);

watch(
  capabilityState,
  (value) => {
    enabledToolKeys.value = enabledCapabilityKeys(value);
  },
  { immediate: true },
);

const canAssignTools = computed(
  () =>
    manifestState.value?.manifest !== null &&
    manifestState.value?.manifest !== undefined &&
    enrollment.value?.projectId !== undefined,
);
const assignableTools = computed(() => {
  const profile = enrollment.value?.projectProfile;
  return (toolCatalog.value?.items ?? []).filter(
    (tool) => profile === undefined || tool.profile === profile,
  );
});
const allowsEmptyTools = computed(
  () => enrollment.value?.projectProfile === 'astro_orbitype',
);
const platformLocales = ['en', 'es', 'de'] as const;
const isWebbinLocaleOverlay = computed(
  () =>
    enrollment.value?.projectProfile === 'astro_repo' ||
    (enrollment.value?.tenantKey === 'webbin' &&
      enrollment.value?.projectKey === 'webbin'),
);
const form = reactive({
  clientContactEmail: '',
  clientConversationLocale: 'en',
  contentLocales: ['de'] as Array<(typeof platformLocales)[number]>,
  defaultContentLocale: 'de' as (typeof platformLocales)[number],
  editorialAudience: '',
  editorialVoice: '',
  previewDomain: '',
  productionDomain: '',
  prohibitedClaims: '',
  researchPolicy: '',
  slugLocale: 'de' as (typeof platformLocales)[number],
  timezone: 'America/Mexico_City',
  translationPolicy: 'none' as 'always_translate' | 'ask_each_action' | 'none',
  maxEstimatedCostCentsPerDay: 2000,
  maxEstimatedCostCentsPerRequest: 500,
  maxModelCallsPerRequest: 12,
  maxRequestsPerDay: 10,
  maxTokensPerRequest: 120000,
});
const translationPolicyOptions = computed(() => {
  if (isWebbinLocaleOverlay.value) return ['always_translate'];
  return form.contentLocales.length <= 1
    ? ['none']
    : ['always_translate', 'ask_each_action'];
});
const sourceLocaleOptions = computed(() =>
  isWebbinLocaleOverlay.value ? ['es'] : [...form.contentLocales],
);

const syncLocalePolicy = () => {
  if (isWebbinLocaleOverlay.value) {
    form.contentLocales = ['es', 'en'];
    form.defaultContentLocale = 'es';
    form.slugLocale = 'es';
    form.translationPolicy = 'always_translate';
    return;
  }
  if (form.contentLocales.length === 0) {
    form.contentLocales = ['de'];
  }
  if (!form.contentLocales.includes(form.defaultContentLocale)) {
    form.defaultContentLocale = form.contentLocales[0]!;
  }
  if (!form.contentLocales.includes(form.slugLocale)) {
    form.slugLocale = form.contentLocales[0]!;
  }
  form.translationPolicy =
    form.contentLocales.length === 1 ? 'none' : 'always_translate';
};

const toggleContentLocale = (locale: (typeof platformLocales)[number]) => {
  if (isWebbinLocaleOverlay.value) return;
  const next = new Set(form.contentLocales);
  if (next.has(locale)) {
    if (next.size === 1) return;
    next.delete(locale);
  } else {
    next.add(locale);
  }
  form.contentLocales = platformLocales.filter((item) => next.has(item));
  syncLocalePolicy();
};
const isEditableEnrollment = computed(() => {
  const state = enrollment.value?.state;
  return (
    state === 'draft' ||
    state === 'configuring' ||
    state === 'validation_failed' ||
    state === 'ready_for_pairing' ||
    state === 'pairing_pending' ||
    state === 'active' ||
    state === 'revalidation_required'
  );
});
const isLiveEnrollment = computed(
  () =>
    enrollment.value?.state === 'active' ||
    enrollment.value?.state === 'pairing_pending' ||
    enrollment.value?.state === 'revalidation_required',
);
const saveLabel = computed(() =>
  isLiveEnrollment.value ? 'Save profile' : 'Save draft',
);

let pairingRefresh: ReturnType<typeof createPendingPairingRefresh> | undefined;
const onVisibilityChange = () => {
  if (document.visibilityState === 'visible') pairingRefresh?.visible();
};
onMounted(() => {
  pairingRefresh = createPendingPairingRefresh({
    clearInterval: (timer) => {
      globalThis.clearInterval(timer);
    },
    refresh,
    setInterval: (callback, delay) => globalThis.setInterval(callback, delay),
  });
  pairingRefresh.setPending(enrollment.value?.state === 'pairing_pending');
  document.addEventListener('visibilitychange', onVisibilityChange);
});
watch(
  () => enrollment.value?.state,
  (state) => pairingRefresh?.setPending(state === 'pairing_pending'),
);
onBeforeUnmount(() => {
  pairingRefresh?.stop();
  document.removeEventListener('visibilitychange', onVisibilityChange);
});

watchEffect(() => {
  const config = enrollment.value?.configuration;
  if (!config) return;
  form.clientContactEmail = config.clientContactEmail ?? '';
  form.clientConversationLocale = config.clientConversationLocale ?? 'en';
  form.editorialAudience = config.editorialAudience ?? '';
  form.editorialVoice = config.editorialVoice ?? '';
  form.previewDomain = config.previewDomain ?? '';
  form.productionDomain = config.productionDomain ?? '';
  form.prohibitedClaims = (config.prohibitedClaims ?? []).join('\n');
  form.researchPolicy = config.researchPolicy ?? '';
  form.timezone = config.timezone ?? 'America/Mexico_City';
  form.maxEstimatedCostCentsPerDay =
    config.budgetPolicy?.maxEstimatedCostCentsPerDay ?? 2000;
  form.maxEstimatedCostCentsPerRequest =
    config.budgetPolicy?.maxEstimatedCostCentsPerRequest ?? 500;
  form.maxModelCallsPerRequest =
    config.budgetPolicy?.maxModelCallsPerRequest ?? 12;
  form.maxRequestsPerDay = config.budgetPolicy?.maxRequestsPerDay ?? 10;
  form.maxTokensPerRequest = config.budgetPolicy?.maxTokensPerRequest ?? 120000;

  if (isWebbinLocaleOverlay.value) {
    form.contentLocales = ['es', 'en'];
    form.defaultContentLocale = 'es';
    form.slugLocale = 'es';
    form.translationPolicy = 'always_translate';
    return;
  }

  const savedLocales = (config.contentLocales ?? []).filter(
    (locale): locale is (typeof platformLocales)[number] =>
      platformLocales.includes(locale as (typeof platformLocales)[number]),
  );
  form.contentLocales =
    savedLocales.length > 0 ? savedLocales : (['de'] as typeof form.contentLocales);
  form.defaultContentLocale =
    config.defaultContentLocale &&
    form.contentLocales.includes(config.defaultContentLocale)
      ? config.defaultContentLocale
      : form.contentLocales[0]!;
  form.slugLocale =
    config.slugLocale && form.contentLocales.includes(config.slugLocale)
      ? config.slugLocale
      : form.contentLocales[0]!;
  form.translationPolicy =
    config.translationPolicy ??
    (form.contentLocales.length === 1 ? 'none' : 'always_translate');
  if (form.contentLocales.length === 1) form.translationPolicy = 'none';
  if (form.contentLocales.length > 1 && form.translationPolicy === 'none') {
    form.translationPolicy = 'always_translate';
  }
});

const configuration = () => ({
  budgetPolicy: {
    maxEstimatedCostCentsPerDay: Number(form.maxEstimatedCostCentsPerDay),
    maxEstimatedCostCentsPerRequest: Number(
      form.maxEstimatedCostCentsPerRequest,
    ),
    maxModelCallsPerRequest: Number(form.maxModelCallsPerRequest),
    maxRequestsPerDay: Number(form.maxRequestsPerDay),
    maxTokensPerRequest: Number(form.maxTokensPerRequest),
  },
  clientContactEmail: form.clientContactEmail,
  clientConversationLocale: form.clientConversationLocale,
  contentLocales: [...form.contentLocales],
  defaultContentLocale: form.defaultContentLocale,
  editorialAudience: form.editorialAudience,
  editorialVoice: form.editorialVoice,
  ...(form.previewDomain ? { previewDomain: form.previewDomain } : {}),
  productionDomain: form.productionDomain,
  prohibitedClaims: form.prohibitedClaims
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean),
  requiredLocales: [...form.contentLocales],
  researchPolicy: form.researchPolicy,
  slugLocale: form.slugLocale,
  timezone: form.timezone,
  translationPolicy: form.translationPolicy,
});
const mutationHeaders = () => ({
  'Idempotency-Key': crypto.randomUUID(),
  'If-Match': `"${enrollment.value?.version ?? 0}"`,
});
const conflictStatus = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const record = error as { status?: unknown; statusCode?: unknown };
  return record.statusCode === 409 || record.status === 409;
};
const runMutation = async (action: () => Promise<void>) => {
  try {
    await action();
  } catch (error) {
    if (!conflictStatus(error)) throw error;
    await refresh();
    await action();
  }
};
const run = async (action: () => Promise<void>) => {
  busy.value = true;
  message.value = '';
  try {
    await action();
  } catch (error) {
    message.value =
      error instanceof Error ? error.message : 'The action failed.';
  } finally {
    busy.value = false;
  }
};
const save = () =>
  run(async () => {
    await runMutation(async () => {
      enrollment.value = await $fetch<Enrollment>(
        `/api/v1/admin/enrollments/${id}`,
        {
          body: { configuration: configuration(), currentStep: 3 },
          headers: mutationHeaders(),
          method: 'PATCH',
        },
      );
    });
    message.value = isLiveEnrollment.value
      ? 'Profile saved. Active manifest rematerialized when needed.'
      : 'Draft saved.';
  });
const validate = () =>
  run(async () => {
    await runMutation(async () => {
      const result = await $fetch<{
        attempts: EnrollmentValidationAttempt[];
        enrollment: Enrollment;
      }>(`/api/v1/admin/enrollments/${id}/validate`, {
        body: {},
        headers: mutationHeaders(),
        method: 'POST',
      });
      enrollment.value = result.enrollment;
      attempts.value = result.attempts;
    });
    await refreshManifest();
    await refreshCapabilities();
    message.value =
      enrollment.value?.state === 'ready_for_pairing'
        ? 'Validation passed.'
        : 'Validation found blockers.';
  });
const createPairing = () =>
  run(async () => {
    await runMutation(async () => {
      const result = await $fetch<{
        enrollment: Enrollment;
        expiresAt: string;
        pairingUrl: string;
      }>(`/api/v1/admin/enrollments/${id}/pairing-link`, {
        body: {},
        headers: mutationHeaders(),
        method: 'POST',
      });
      enrollment.value = result.enrollment;
      pairingUrl.value = result.pairingUrl;
      message.value = `Pairing link expires at ${result.expiresAt}. Copy it now; it will not be shown again.`;
    });
  });
const toggleTool = (toolId: string, version: number, enabled: boolean) => {
  const key = capabilityKey(toolId, version);
  const next = new Set(enabledToolKeys.value);
  if (enabled) next.add(key);
  else next.delete(key);
  enabledToolKeys.value = next;
};
const saveCapabilities = () =>
  run(async () => {
    if (enrollment.value?.projectId === undefined) return;
    const bindings = buildCapabilityBindings(
      assignableTools.value,
      enabledToolKeys.value,
    );
    if (bindings.length === 0 && !allowsEmptyTools.value) {
      capabilityMessage.value = 'At least one tool must stay enabled.';
      return;
    }
    capabilityState.value = await $fetch<CapabilityCatalogResponse>(
      `/api/v1/projects/${enrollment.value.projectId}/capabilities`,
      {
        body: { bindings },
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        method: 'PUT',
      },
    );
    enabledToolKeys.value = enabledCapabilityKeys(capabilityState.value);
    capabilityMessage.value = 'Tool assignment saved.';
  });
</script>

<template>
  <main class="mx-auto max-w-5xl px-6 py-8 lg:px-8">
    <PageHeader
      :crumbs="['Clients', enrollment?.tenantKey ?? 'Enrollment']"
    >
      <template #title>
        <UButton
          to="/clients"
          color="neutral"
          variant="soft"
          size="sm"
          icon="i-lucide-arrow-left"
          class="mb-3"
          >Back to clients</UButton
        >
        <h1 class="text-3xl font-semibold tracking-tight text-white">
          {{ enrollment?.tenantKey ?? 'Enrollment' }}
        </h1>
        <p
          v-if="enrollment?.projectKey"
          class="mt-1 font-mono text-sm text-[var(--binflow-accent)]"
        >
          Project {{ enrollment.projectKey }}
          <span v-if="enrollment.projectProfile">
            · {{ enrollment.projectProfile }}
          </span>
        </p>
      </template>
      <template #actions>
        <UBadge color="neutral" variant="soft">{{ enrollment?.state }}</UBadge>
        <UBadge color="neutral" variant="outline"
          >Version {{ enrollment?.version }}</UBadge
        >
      </template>
    </PageHeader>
    <UAlert
      color="warning"
      title="Activation remains fail-closed"
      description="Mutable GitHub, Vercel, Telegram, catalog and pairing evidence must be completed by later modules. No Webbin mutation is performed here."
    />
    <div class="mt-8 grid gap-6 lg:grid-cols-[1fr_20rem]">
      <UCard class="binflow-surface !ring-0">
        <template #header
          ><div>
            <p class="font-semibold">Client and content contract</p>
            <p class="text-sm text-muted">
              Platform locales are English, Spanish and German. Enable one or
              more for this project; a single locale means no translation.
            </p>
            <p
              v-if="isLiveEnrollment"
              class="mt-2 text-sm text-[var(--binflow-accent)]"
            >
              Active clients can edit production URL, locales, editorial and
              budgets here. Saving rematerializes the frozen project manifest
              when those fields change.
            </p>
          </div></template
        >
        <form class="grid gap-5 sm:grid-cols-2" @submit.prevent="save">
          <UFormField label="Contact email"
            ><UInput
              v-model="form.clientContactEmail"
              class="w-full"
              type="email"
          /></UFormField>
          <UFormField label="Timezone"
            ><UInput v-model="form.timezone" class="w-full"
          /></UFormField>
          <UFormField label="Conversation locale"
            ><USelect
              v-model="form.clientConversationLocale"
              class="w-full"
              :items="[...platformLocales]"
          /></UFormField>
          <UFormField label="Translation policy"
            ><USelect
              v-model="form.translationPolicy"
              class="w-full"
              :items="translationPolicyOptions"
              :disabled="isWebbinLocaleOverlay || form.contentLocales.length <= 1"
          /></UFormField>
          <UFormField class="sm:col-span-2" label="Content locales">
            <div class="flex flex-wrap gap-4">
              <label
                v-for="locale in platformLocales"
                :key="locale"
                class="flex items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  class="size-4"
                  :checked="form.contentLocales.includes(locale)"
                  :disabled="isWebbinLocaleOverlay"
                  @change="toggleContentLocale(locale)"
                />
                <span class="uppercase">{{ locale }}</span>
              </label>
            </div>
            <p v-if="isWebbinLocaleOverlay" class="mt-2 text-xs text-muted">
              Webbin pilot locks content to Spanish + English.
            </p>
            <p v-else-if="form.contentLocales.length === 1" class="mt-2 text-xs text-muted">
              Monolingual project — translation policy is none.
            </p>
          </UFormField>
          <UFormField label="Source locale"
            ><USelect
              v-model="form.defaultContentLocale"
              class="w-full"
              :items="sourceLocaleOptions"
              :disabled="isWebbinLocaleOverlay"
          /></UFormField>
          <UFormField label="Slug locale"
            ><USelect
              v-model="form.slugLocale"
              class="w-full"
              :items="sourceLocaleOptions"
              :disabled="isWebbinLocaleOverlay"
          /></UFormField>
          <UFormField label="Production URL"
            ><UInput
              v-model="form.productionDomain"
              class="w-full"
              placeholder="https://example.com"
          /></UFormField>
          <UFormField label="Preview URL (optional)"
            ><UInput
              v-model="form.previewDomain"
              class="w-full"
              placeholder="https://preview.example.com"
          /></UFormField>
          <UFormField class="sm:col-span-2" label="Editorial voice"
            ><UTextarea v-model="form.editorialVoice" class="w-full"
          /></UFormField>
          <UFormField class="sm:col-span-2" label="Audience"
            ><UTextarea v-model="form.editorialAudience" class="w-full"
          /></UFormField>
          <div class="md:col-span-2">
            <UButton to="/customizations" color="neutral" variant="soft"
              >Customize tools</UButton
            >
          </div>
          <UFormField class="sm:col-span-2" label="Research policy"
            ><UTextarea v-model="form.researchPolicy" class="w-full"
          /></UFormField>
          <UFormField
            class="sm:col-span-2"
            label="Prohibited claims (one per line)"
            ><UTextarea v-model="form.prohibitedClaims" class="w-full"
          /></UFormField>
          <div class="sm:col-span-2 border-t border-default pt-5">
            <p class="font-semibold">Budget policy</p>
            <p class="text-sm text-muted">
              Cost values are stored as USD cents and frozen with the manifest.
            </p>
          </div>
          <UFormField label="Requests per day"
            ><UInput
              v-model="form.maxRequestsPerDay"
              class="w-full"
              min="1"
              type="number"
          /></UFormField>
          <UFormField label="Model calls per request"
            ><UInput
              v-model="form.maxModelCallsPerRequest"
              class="w-full"
              min="1"
              type="number"
          /></UFormField>
          <UFormField label="Tokens per request"
            ><UInput
              v-model="form.maxTokensPerRequest"
              class="w-full"
              min="1000"
              type="number"
          /></UFormField>
          <UFormField label="Estimated cents per request"
            ><UInput
              v-model="form.maxEstimatedCostCentsPerRequest"
              class="w-full"
              min="1"
              type="number"
          /></UFormField>
          <UFormField label="Estimated cents per day"
            ><UInput
              v-model="form.maxEstimatedCostCentsPerDay"
              class="w-full"
              min="1"
              type="number"
          /></UFormField>
          <UButton
            type="submit"
            :loading="busy"
            :disabled="!isEditableEnrollment"
            >{{ saveLabel }}</UButton
          >
        </form>
      </UCard>
      <div class="grid content-start gap-4">
        <UCard
          ><p class="font-semibold">Readiness</p>
          <p class="mt-1 text-sm text-muted">
            Run deterministic configuration and credential checks.
          </p>
          <UButton
            class="mt-4 w-full"
            color="neutral"
            variant="outline"
            :loading="busy"
            @click="validate"
            >Validate</UButton
          ></UCard
        >
        <UCard
          ><p class="font-semibold">Client pairing</p>
          <p class="mt-1 text-sm text-muted">
            Available after current checks pass.
          </p>
          <UButton
            class="mt-4 w-full"
            :disabled="enrollment?.state !== 'ready_for_pairing'"
            :loading="busy"
            @click="createPairing"
            >Create 24-hour link</UButton
          ></UCard
        >
        <UCard>
          <p class="font-semibold">Project manifest</p>
          <template v-if="manifestState?.manifest">
            <div class="mt-3 grid gap-2 text-sm">
              <p>
                Version {{ manifestState.manifest.version }} ·
                {{ manifestState.manifest.status }}
              </p>
              <p class="text-muted">
                {{ manifestState.manifest.globalProfileVersion }} ·
                {{ manifestState.manifest.repository.owner }}/{{
                  manifestState.manifest.repository.name
                }}
              </p>
              <p class="text-muted">
                {{ manifestState.manifest.contentLocales.join(' + ') }} · source
                {{ manifestState.manifest.defaultContentLocale }}
              </p>
              <p class="text-muted">
                {{ manifestState.manifest.budgetPolicy.maxRequestsPerDay }}
                requests/day · USD
                {{
                  (
                    manifestState.manifest.budgetPolicy
                      .maxEstimatedCostCentsPerDay / 100
                  ).toFixed(2)
                }}/day
              </p>
              <details>
                <summary class="cursor-pointer">Effective paths</summary>
                <ul class="mt-2 list-disc pl-5 text-muted">
                  <li
                    v-for="path in manifestState.manifest.content.editablePaths"
                    :key="path"
                  >
                    {{ path }}
                  </li>
                </ul>
              </details>
            </div>
          </template>
          <p v-else class="mt-2 text-sm text-muted">
            Validate the complete draft to create version 1.
          </p>
        </UCard>
        <UCard>
          <p class="font-semibold">Enabled tools</p>
          <p class="mt-1 text-sm text-muted">
            Assign code-owned capabilities after validation. Each change creates a
            new manifest revision.
            <span v-if="allowsEmptyTools">
              This profile may stay active with zero tools until Orbitype content
              capabilities are assigned.
            </span>
          </p>
          <div
            v-for="tool in assignableTools"
            :key="`${tool.id}@${tool.version}`"
            class="mt-3 flex items-start justify-between gap-3 rounded-lg border border-default p-3 text-sm"
          >
            <div>
              <p class="font-medium">{{ tool.displayName }}</p>
              <p class="mt-1 font-mono text-muted">
                {{ tool.id }}@{{ tool.version }} · {{ tool.command }}
              </p>
            </div>
            <USwitch
              :disabled="!canAssignTools || busy"
              :model-value="
                enabledToolKeys.has(capabilityKey(tool.id, tool.version))
              "
              @update:model-value="toggleTool(tool.id, tool.version, $event)"
            />
          </div>
          <p v-if="!canAssignTools" class="mt-3 text-sm text-muted">
            Validate the enrollment to bind the code-owned tool catalog.
          </p>
          <UButton
            v-else
            class="mt-4 w-full"
            color="neutral"
            variant="outline"
            :loading="busy"
            @click="saveCapabilities"
            >Save tool assignment</UButton
          >
          <p v-if="capabilityMessage" class="mt-3 text-sm text-muted">
            {{ capabilityMessage }}
          </p>
        </UCard>
        <UAlert v-if="message" :description="message" />
        <UCard v-if="pairingUrl"
          ><p class="text-sm font-semibold">One-time pairing URL</p>
          <UInput class="mt-3 w-full" :model-value="pairingUrl" readonly
        /></UCard>
        <UCard v-if="attempts.length"
          ><p class="font-semibold">Latest validation</p>
          <div class="mt-3 grid gap-2">
            <div
              v-for="attempt in attempts"
              :key="attempt.checkName"
              class="flex items-center justify-between gap-2 text-sm"
            >
              <span>{{ attempt.checkName }}</span
              ><UBadge
                :color="attempt.result === 'success' ? 'success' : 'error'"
                variant="soft"
                >{{ attempt.result }}</UBadge
              >
            </div>
          </div></UCard
        >
      </div>
    </div>
  </main>
</template>
