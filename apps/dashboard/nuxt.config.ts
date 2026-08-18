export default defineNuxtConfig({
  compatibilityDate: '2026-08-10',
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  modules: ['@nuxt/ui'],
  nitro: {
    esbuild: { options: { target: 'es2024' } },
  },
  runtimeConfig: {
    public: {
      apiBaseUrl: process.env.NUXT_PUBLIC_API_BASE_URL ?? '',
    },
  },
  typescript: {
    strict: true,
  },
  ui: {
    colorMode: false,
  },
});
