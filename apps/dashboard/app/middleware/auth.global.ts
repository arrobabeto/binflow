import { authClient } from '../lib/auth-client';
import {
  asDashboardSessionCandidate,
  isCurrentDashboardSession,
} from '../lib/session-idle';

export default defineNuxtRouteMiddleware(async (to) => {
  const publicRoute = to.path === '/login' || to.path === '/two-factor';
  const session = asDashboardSessionCandidate(
    import.meta.server
      ? (useRequestEvent()?.context.dashboardSession ?? null)
      : (
          await authClient
            .getSession({
              query: { disableCookieCache: true },
            })
            .catch(() => ({ data: null }))
        ).data,
  );
  const current = isCurrentDashboardSession(session);
  if (!current && !publicRoute) {
    if (import.meta.client) await authClient.signOut();
    return navigateTo({ path: '/login', query: { redirect: to.fullPath } });
  }
  if (
    current &&
    session.user.twoFactorEnabled !== true &&
    to.path !== '/security'
  ) {
    return navigateTo('/security');
  }
  if (current && to.path === '/login') {
    return navigateTo(session.user.twoFactorEnabled ? '/' : '/security');
  }
});
