<script setup lang="ts">
import type {
  CapabilityCatalogResponse,
  Enrollment,
  EnrollmentValidationAttempt,
  ProjectManifestResponse,
} from '@binflow/contracts';

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
const form = reactive({
  clientContactEmail: '',
  clientConversationLocale: 'en',
  contentLocales: 'en, es',
  defaultContentLocale: 'es',
  editorialAudience: '',
  editorialVoice: '',
  previewDomain: '',
  productionDomain: '',
  prohibitedClaims: '',
  requiredLocales: 'en, es',
  researchPolicy: '',
  slugLocale: 'es',
  timezone: 'America/Mexico_City',
  translationPolicy: 'always_translate',
  maxEstimatedCostCentsPerDay: 2000,
  maxEstimatedCostCentsPerRequest: 500,
  maxModelCallsPerRequest: 12,
  maxRequestsPerDay: 10,
  maxTokensPerRequest: 120000,
});
const attempts = ref<EnrollmentValidationAttempt[]>([]);
const pairingUrl = ref('');
const message = ref('');
const busy = ref(false);

watchEffect(() => {
  const config = enrollment.value?.configuration;
  if (!config) return;
  form.clientContactEmail = config.clientContactEmail ?? '';
  form.clientConversationLocale = config.clientConversationLocale ?? 'en';
  form.contentLocales = 'es, en';
  form.defaultContentLocale = 'es';
  form.editorialAudience = config.editorialAudience ?? '';
  form.editorialVoice = config.editorialVoice ?? '';
  form.previewDomain = config.previewDomain ?? '';
  form.productionDomain = config.productionDomain ?? '';
  form.prohibitedClaims = (config.prohibitedClaims ?? []).join('\n');
  form.requiredLocales = 'es, en';
  form.researchPolicy = config.researchPolicy ?? '';
  form.slugLocale = 'es';
  form.timezone = config.timezone ?? 'America/Mexico_City';
  form.translationPolicy = 'always_translate';
  form.maxEstimatedCostCentsPerDay =
    config.budgetPolicy?.maxEstimatedCostCentsPerDay ?? 2000;
  form.maxEstimatedCostCentsPerRequest =
    config.budgetPolicy?.maxEstimatedCostCentsPerRequest ?? 500;
  form.maxModelCallsPerRequest =
    config.budgetPolicy?.maxModelCallsPerRequest ?? 12;
  form.maxRequestsPerDay = config.budgetPolicy?.maxRequestsPerDay ?? 10;
  form.maxTokensPerRequest = config.budgetPolicy?.maxTokensPerRequest ?? 120000;
});

const locales = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
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
  contentLocales: locales(form.contentLocales),
  defaultContentLocale: form.defaultContentLocale,
  editorialAudience: form.editorialAudience,
  editorialVoice: form.editorialVoice,
  ...(form.previewDomain ? { previewDomain: form.previewDomain } : {}),
  productionDomain: form.productionDomain,
  prohibitedClaims: form.prohibitedClaims
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean),
  requiredLocales: locales(form.requiredLocales),
  researchPolicy: form.researchPolicy,
  slugLocale: form.slugLocale,
  timezone: form.timezone,
  translationPolicy: form.translationPolicy,
});
const mutationHeaders = () => ({
  'Idempotency-Key': crypto.randomUUID(),
  'If-Match': `"${enrollment.value?.version ?? 0}"`,
});
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
    enrollment.value = await $fetch<Enrollment>(
      `/api/v1/admin/enrollments/${id}`,
      {
        body: { configuration: configuration(), currentStep: 3 },
        headers: mutationHeaders(),
        method: 'PATCH',
      },
    );
    message.value = 'Draft saved.';
  });
const validate = () =>
  run(async () => {
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
    await refreshManifest();
    await refreshCapabilities();
    message.value =
      result.enrollment.state === 'ready_for_pairing'
        ? 'Validation passed.'
        : 'Validation found blockers.';
  });
const createPairing = () =>
  run(async () => {
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
</script>

<template>
  <main class="mx-auto max-w-5xl px-6 py-10">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <UButton to="/clients" color="neutral" variant="ghost"
          >Back to clients</UButton
        >
        <h1 class="mt-4 text-3xl font-semibold">
          {{ enrollment?.tenantKey ?? 'Enrollment' }}
        </h1>
      </div>
      <div class="flex gap-2">
        <UBadge color="neutral" variant="soft">{{ enrollment?.state }}</UBadge
        ><UBadge color="neutral" variant="outline"
          >Version {{ enrollment?.version }}</UBadge
        >
      </div>
    </div>
    <UAlert
      class="mt-6"
      color="warning"
      title="Activation remains fail-closed"
      description="Mutable GitHub, Vercel, Telegram, catalog and pairing evidence must be completed by later modules. No Webbin mutation is performed here."
    />
    <div class="mt-8 grid gap-6 lg:grid-cols-[1fr_20rem]">
      <UCard>
        <template #header
          ><div>
            <p class="font-semibold">Client and content contract</p>
            <p class="text-sm text-muted">
              English, Spanish and German are the supported client locales.
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
              :items="['en', 'es', 'de']"
          /></UFormField>
          <UFormField label="Translation policy"
            ><USelect
              v-model="form.translationPolicy"
              class="w-full"
              :items="['always_translate']"
          /></UFormField>
          <UFormField label="Content locales"
            ><UInput v-model="form.contentLocales" class="w-full" disabled
          /></UFormField>
          <UFormField label="Required locales"
            ><UInput v-model="form.requiredLocales" class="w-full" disabled
          /></UFormField>
          <UFormField label="Source locale"
            ><USelect
              v-model="form.defaultContentLocale"
              class="w-full"
              :items="['es']"
          /></UFormField>
          <UFormField label="Slug locale"
            ><USelect v-model="form.slugLocale" class="w-full" :items="['es']"
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
          <UButton type="submit" :loading="busy">Save draft</UButton>
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
          <div
            v-for="capability in capabilityState?.items ?? []"
            :key="`${capability.id}@${capability.version}`"
            class="mt-3 rounded-lg border border-default p-3 text-sm"
          >
            <div class="flex items-center justify-between gap-3">
              <p class="font-medium">{{ capability.displayName }}</p>
              <UBadge color="success" variant="soft">Enabled</UBadge>
            </div>
            <p class="mt-1 text-muted">
              {{ capability.id }}@{{ capability.version }} ·
              {{ capability.command }} · {{ capability.access }}
            </p>
            <p class="mt-1 text-muted">
              Medium risk · exact preview and client approval required
            </p>
          </div>
          <p
            v-if="(capabilityState?.items.length ?? 0) === 0"
            class="mt-2 text-sm text-muted"
          >
            Validate the enrollment to bind the code-owned tool catalog.
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
