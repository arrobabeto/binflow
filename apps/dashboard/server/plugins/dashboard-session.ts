export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('request', async (event) => {
    const path = event.path;
    if (
      path.startsWith('/api/') ||
      path.startsWith('/_nuxt') ||
      path.startsWith('/__nuxt')
    ) {
      event.context.dashboardSession = null;
      return;
    }
    try {
      const runtime = await getAuthRuntime();
      const request = toWebRequest(event);
      event.context.dashboardSession =
        (await runtime.auth.api.getSession({ headers: request.headers })) ??
        null;
    } catch {
      event.context.dashboardSession = null;
    }
  });
});
