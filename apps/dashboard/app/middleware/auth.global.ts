import { authClient } from '../lib/auth-client';

export default defineNuxtRouteMiddleware(async (to) => {
  const publicRoute = to.path === '/login' || to.path === '/two-factor';
  const { data: session } = await authClient.useSession(useFetch);
  if (!session.value && !publicRoute) {
    return navigateTo({ path: '/login', query: { redirect: to.fullPath } });
  }
  if (
    session.value &&
    session.value.user.twoFactorEnabled !== true &&
    to.path !== '/security'
  ) {
    return navigateTo('/security');
  }
  if (session.value && to.path === '/login') {
    return navigateTo(session.value.user.twoFactorEnabled ? '/' : '/security');
  }
});
