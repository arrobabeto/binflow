export default defineNuxtConfig({
  compatibilityDate: '2026-08-10',
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  modules: ['@nuxt/ui'],
  telemetry: false,
  app: {
    head: {
      htmlAttrs: { class: 'dark' },
      link: [
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap',
        },
      ],
    },
  },
  nitro: {
    esbuild: { options: { target: 'es2024' } },
  },
  runtimeConfig: {
    public: {
      apiBaseUrl: process.env.NUXT_PUBLIC_API_BASE_URL ?? '',
    },
  },
  routeRules: {
    '/**': { headers: { 'cache-control': 'no-store' } },
    '/_nuxt/**': {
      headers: { 'cache-control': 'public, max-age=31536000, immutable' },
    },
  },
  typescript: {
    strict: true,
  },
  ui: {
    colorMode: false,
  },
});
