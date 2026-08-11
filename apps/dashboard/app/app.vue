<script setup lang="ts">
const config = useRuntimeConfig();
const { data: health, error } = await useFetch('/api/v1/health', {
  baseURL: config.public.apiBaseUrl,
});
</script>

<template>
  <main>
    <p class="eyebrow">Binflow control plane</p>
    <h1>System foundation</h1>
    <p>The Phase 0 dashboard shell is running.</p>
    <dl>
      <dt>API</dt>
      <dd>{{ error ? 'Unavailable' : (health?.status ?? 'Checking') }}</dd>
    </dl>
  </main>
</template>

<style>
:root {
  color: #18221e;
  background: #eef2ed;
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
}

body {
  margin: 0;
}

main {
  box-sizing: border-box;
  width: min(720px, calc(100% - 48px));
  margin: 12vh auto;
  padding: 48px;
  border: 1px solid #ccd5cf;
  border-radius: 20px;
  background: #fff;
  box-shadow: 0 20px 60px rgb(25 52 38 / 8%);
}

.eyebrow {
  color: #347a55;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

h1 {
  margin: 8px 0;
  font-size: clamp(2rem, 8vw, 4rem);
  letter-spacing: -0.04em;
}

dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 12px 24px;
  margin-top: 40px;
}

dt {
  color: #63736a;
}

dd {
  margin: 0;
  font-weight: 700;
}
</style>
