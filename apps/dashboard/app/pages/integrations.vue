<script setup lang="ts">
import type {
  CredentialSummary,
  IntegrationCandidateInput,
} from '@binflow/contracts';

import {
  allCredentialClients,
  availableCredentialClients,
  credentialCatalogSortOptions,
  credentialClientLabel,
  filterCredentialCatalog,
  type CredentialCatalogSort,
} from '../lib/credential-catalog-filter';

type Kind = IntegrationCandidateInput['kind'];

const kindOptions: { label: string; value: Kind }[] = [
  { label: 'OpenAI', value: 'openai' },
  { label: 'Telegram admin bot', value: 'telegram-admin' },
  { label: 'Telegram client bot', value: 'telegram-client' },
  { label: 'GitHub App', value: 'github-app' },
  { label: 'Vercel', value: 'vercel' },
];
const { data, refresh, status } = await useFetch<{
  items: CredentialSummary[];
  nextCursor: string | null;
}>('/api/v1/admin/integrations');

const query = ref('');
const clientFilter = ref(allCredentialClients);
const sort = ref<CredentialCatalogSort>('client-asc');

const clientOptions = computed(() => [
  { label: 'All clients', value: allCredentialClients },
  ...availableCredentialClients(data.value?.items ?? []).map((client) => ({
    label: credentialClientLabel(client),
    value: client,
  })),
]);

const filteredCredentials = computed(() =>
  filterCredentialCatalog(data.value?.items ?? [], {
    client: clientFilter.value,
    query: query.value,
    sort: sort.value,
  }),
);

const form = reactive({
  alias: '',
  apiKey: '',
  appId: '',
  botToken: '',
  clientId: '',
  expectedUsername: '',
  kind: 'openai' as Kind,
  privateKey: '',
  projectId: '',
  projectKey: 'webbin',
  teamId: '',
  tenantKey: 'webbin',
  token: '',
  webhookSecret: '',
});
const busyId = ref<string>();
const errorMessage = ref('');
const successMessage = ref('');
const saving = ref(false);
const fileInputKey = ref(0);

watch(
  () => form.kind,
  (kind) => {
    const option = kindOptions.find((item) => item.value === kind);
    form.alias = option?.label ?? '';
    errorMessage.value = '';
    successMessage.value = '';
  },
  { immediate: true },
);

const secretPayload = (): IntegrationCandidateInput => {
  if (form.kind === 'openai') {
    return {
      alias: form.alias,
      apiKey: form.apiKey,
      kind: form.kind,
      tenantKey: form.tenantKey,
    };
  }
  if (form.kind === 'telegram-admin') {
    return {
      alias: form.alias,
      botToken: form.botToken,
      expectedUsername: form.expectedUsername,
      kind: form.kind,
    };
  }
  if (form.kind === 'telegram-client') {
    return {
      alias: form.alias,
      botToken: form.botToken,
      expectedUsername: form.expectedUsername,
      kind: form.kind,
      tenantKey: form.tenantKey,
    };
  }
  if (form.kind === 'github-app') {
    return {
      alias: form.alias,
      appId: form.appId,
      clientId: form.clientId,
      kind: form.kind,
      privateKey: form.privateKey,
      projectKey: form.projectKey,
      tenantKey: form.tenantKey,
      webhookSecret: form.webhookSecret,
    };
  }
  return {
    alias: form.alias,
    kind: form.kind,
    projectId: form.projectId,
    projectKey: form.projectKey,
    ...(form.teamId.trim() === '' ? {} : { teamId: form.teamId }),
    tenantKey: form.tenantKey,
    token: form.token,
  };
};

const clearSecrets = () => {
  form.apiKey = '';
  form.botToken = '';
  form.privateKey = '';
  form.token = '';
  form.webhookSecret = '';
  fileInputKey.value += 1;
};

const importPem = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file === undefined) return;
  if (file.size > 64 * 1024) {
    errorMessage.value = 'The PEM file must be 64 KiB or smaller.';
    input.value = '';
    return;
  }
  form.privateKey = await file.text();
};

const createCandidate = async () => {
  saving.value = true;
  errorMessage.value = '';
  successMessage.value = '';
  try {
    await $fetch<CredentialSummary>('/api/v1/admin/integrations', {
      body: secretPayload(),
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      method: 'POST',
    });
    clearSecrets();
    successMessage.value =
      'Credential candidate saved. Verify it before it becomes active.';
    await refresh();
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : 'The credential candidate could not be saved.';
  } finally {
    clearSecrets();
    saving.value = false;
  }
};

const verifyCredential = async (credential: CredentialSummary) => {
  busyId.value = credential.id;
  errorMessage.value = '';
  successMessage.value = '';
  try {
    const result = await $fetch<{
      credential: CredentialSummary;
      errorCategory?: string;
      outcome: 'success' | 'failed';
    }>(`/api/v1/admin/integrations/${credential.id}/verify`, {
      body: {},
      headers: {
        'Idempotency-Key': crypto.randomUUID(),
        'If-Match': `"${credential.revision}"`,
      },
      method: 'POST',
    });
    successMessage.value =
      result.outcome === 'success'
        ? `${credential.alias} is verified and active.`
        : `Verification failed: ${result.errorCategory ?? 'provider error'}.`;
    await refresh();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : 'Verification could not run.';
  } finally {
    busyId.value = undefined;
  }
};

const revoke = async (credential: CredentialSummary) => {
  if (!window.confirm(`Revoke ${credential.alias}? This cannot be undone.`)) {
    return;
  }
  busyId.value = credential.id;
  errorMessage.value = '';
  successMessage.value = '';
  try {
    await $fetch(`/api/v1/admin/integrations/${credential.id}/revoke`, {
      body: {},
      headers: {
        'Idempotency-Key': crypto.randomUUID(),
        'If-Match': `"${credential.revision}"`,
      },
      method: 'POST',
    });
    successMessage.value = `${credential.alias} was revoked.`;
    await refresh();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : 'Revocation could not complete.';
  } finally {
    busyId.value = undefined;
  }
};
</script>

<template>
  <main
    class="mx-auto grid max-w-6xl gap-8 px-6 py-8 lg:grid-cols-[1fr_22rem] lg:px-8"
  >
    <section>
      <PageHeader :crumbs="['System', 'Integrations']">
        <template #title>
          <h1 class="mt-1 text-3xl font-semibold tracking-tight text-white">
            Provider credentials
          </h1>
          <p class="mt-2 text-muted">
            Safe metadata only. Secret values are never shown again.
          </p>
        </template>
        <template #actions>
          <UButton
            color="neutral"
            variant="soft"
            :loading="status === 'pending'"
            @click="refresh"
            >Refresh</UButton
          >
        </template>
      </PageHeader>

        <div class="flex flex-wrap items-end gap-3">
          <UFormField label="Search" class="min-w-48 flex-1">
            <UInput
              v-model="query"
              class="w-full"
              placeholder="Alias, kind, client, or status"
              icon="i-lucide-search"
            />
          </UFormField>
          <UFormField label="Client" class="min-w-40">
            <USelect
              v-model="clientFilter"
              value-key="value"
              :items="clientOptions"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Sort" class="min-w-40">
            <USelect
              v-model="sort"
              value-key="value"
              :items="[...credentialCatalogSortOptions]"
              class="w-full"
            />
          </UFormField>
        </div>

        <div class="mt-6 space-y-3">
          <UAlert
            v-if="errorMessage"
            color="error"
            :description="errorMessage"
          />
          <UAlert
            v-if="successMessage"
            color="success"
            :description="successMessage"
          />
          <UCard v-if="(data?.items.length ?? 0) === 0">
            No credentials have been registered.
          </UCard>
          <UCard v-else-if="filteredCredentials.length === 0">
            <p class="font-medium">No credentials match</p>
            <p class="mt-1 text-sm text-muted">
              Try another client filter or search term.
            </p>
          </UCard>
          <UCard
            v-for="credential in filteredCredentials"
            :key="credential.id"
          >
            <div class="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div class="flex flex-wrap items-center gap-2">
                  <p class="font-semibold">{{ credential.alias }}</p>
                  <UBadge color="neutral" variant="soft">
                    {{ credential.kind }}
                  </UBadge>
                  <UBadge
                    :color="
                      credential.status === 'active' ? 'success' : 'neutral'
                    "
                    variant="soft"
                  >
                    {{ credential.status }}
                  </UBadge>
                </div>
                <p class="mt-2 text-sm text-muted">
                  {{ credential.bindingTenantKey ?? 'platform'
                  }}<template v-if="credential.bindingProjectKey">
                    / {{ credential.bindingProjectKey }}</template
                  >
                  · version {{ credential.version }} · ••••{{
                    credential.maskedSuffix
                  }}
                </p>
                <p class="mt-1 text-xs text-muted">
                  Last verified:
                  {{
                    credential.verifiedAt
                      ? new Date(credential.verifiedAt).toLocaleString()
                      : 'never'
                  }}
                </p>
              </div>
              <div class="flex gap-2">
                <UButton
                  v-if="!['revoked', 'superseded'].includes(credential.status)"
                  color="neutral"
                  variant="outline"
                  :loading="busyId === credential.id"
                  @click="verifyCredential(credential)"
                  >Verify</UButton
                >
                <UButton
                  v-if="credential.status !== 'revoked'"
                  color="error"
                  variant="soft"
                  :loading="busyId === credential.id"
                  @click="revoke(credential)"
                  >Revoke</UButton
                >
              </div>
            </div>
          </UCard>
        </div>
      </section>

      <aside>
        <UCard>
          <template #header>
            <h2 class="text-lg font-semibold">Add or rotate credential</h2>
            <p class="mt-1 text-sm text-muted">
              A new candidate is inactive until verification succeeds.
            </p>
          </template>
          <form
            class="grid gap-4"
            autocomplete="off"
            @submit.prevent="createCandidate"
          >
            <UFormField label="Provider" required>
              <USelect
                v-model="form.kind"
                :items="kindOptions"
                value-key="value"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Alias" required>
              <UInput v-model="form.alias" class="w-full" required />
            </UFormField>
            <UFormField
              v-if="form.kind !== 'telegram-admin'"
              label="Tenant key"
              required
            >
              <UInput v-model="form.tenantKey" class="w-full" required />
            </UFormField>
            <UFormField
              v-if="form.kind === 'github-app' || form.kind === 'vercel'"
              label="Project key"
              required
            >
              <UInput v-model="form.projectKey" class="w-full" required />
            </UFormField>

            <UFormField v-if="form.kind === 'openai'" label="API key" required>
              <UInput
                v-model="form.apiKey"
                type="password"
                class="w-full"
                required
              />
            </UFormField>
            <template
              v-if="
                form.kind === 'telegram-admin' ||
                form.kind === 'telegram-client'
              "
            >
              <UFormField label="Bot token" required>
                <UInput
                  v-model="form.botToken"
                  type="password"
                  class="w-full"
                  required
                />
              </UFormField>
              <UFormField label="Expected username" required>
                <UInput
                  v-model="form.expectedUsername"
                  placeholder="MyBot_bot"
                  class="w-full"
                  required
                />
              </UFormField>
            </template>
            <template v-if="form.kind === 'github-app'">
              <UFormField label="App ID" required>
                <UInput v-model="form.appId" class="w-full" required />
              </UFormField>
              <UFormField label="Client ID" required>
                <UInput v-model="form.clientId" class="w-full" required />
              </UFormField>
              <UFormField label="Private key (.pem)" required>
                <input
                  :key="fileInputKey"
                  type="file"
                  accept=".pem,application/x-pem-file"
                  required
                  class="block w-full text-sm"
                  @change="importPem"
                />
              </UFormField>
              <UFormField label="Webhook secret" required>
                <UInput
                  v-model="form.webhookSecret"
                  type="password"
                  class="w-full"
                  required
                />
              </UFormField>
            </template>
            <template v-if="form.kind === 'vercel'">
              <UFormField label="Access token" required>
                <UInput
                  v-model="form.token"
                  type="password"
                  class="w-full"
                  required
                />
              </UFormField>
              <UFormField label="Vercel project ID" required>
                <UInput v-model="form.projectId" class="w-full" required />
              </UFormField>
              <UFormField label="Team ID (optional)">
                <UInput v-model="form.teamId" class="w-full" />
              </UFormField>
            </template>
            <UButton type="submit" :loading="saving">Save candidate</UButton>
          </form>
        </UCard>
      </aside>
  </main>
</template>
