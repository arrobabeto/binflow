export default defineEventHandler((event) => {
  const baseURL =
    process.env.BINFLOW_INTERNAL_API_URL ?? 'http://localhost:2040';
  return proxyRequest(event, `${baseURL}${event.path}`);
});
