export default defineNuxtConfig({
  compatibilityDate: '2026-08-10',
  devtools: { enabled: false },
  runtimeConfig: {
    public: {
      apiBaseUrl:
        process.env.NUXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8080',
    },
  },
  typescript: {
    strict: true,
  },
});
