import { authClient } from '../lib/auth-client';
import {
  createIdleSessionGuard,
  isCurrentDashboardSession,
} from '../lib/session-idle';

const SESSION_REFRESH_INTERVAL_MS = 60 * 1000;

export default defineNuxtPlugin(async (nuxtApp) => {
  const current = await authClient
    .getSession({
      query: { disableCookieCache: true },
    })
    .catch(() => undefined);
  const currentSession = current?.data ?? null;
  if (
    currentSession?.user.twoFactorEnabled !== true ||
    !isCurrentDashboardSession(currentSession)
  )
    return;

  let expiring = false;
  let lastServerRefreshAt = Date.now();
  let serverRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  const expire = (): void => {
    if (expiring) return;
    expiring = true;
    void authClient.signOut().finally(() => {
      globalThis.location.replace('/login?reason=inactive');
    });
  };
  const guard = createIdleSessionGuard({
    clearTimer: (timer) => {
      globalThis.clearTimeout(timer);
    },
    expire,
    setTimer: (callback, delay) => globalThis.setTimeout(callback, delay),
  });
  const revalidate = async (resetIdleTimer: boolean): Promise<void> => {
    const result = await authClient
      .getSession({
        query: { disableCookieCache: true },
      })
      .catch(() => undefined);
    const data = result?.data ?? null;
    if (
      data?.user.twoFactorEnabled !== true ||
      !isCurrentDashboardSession(data)
    ) {
      expire();
      return;
    }
    lastServerRefreshAt = Date.now();
    if (resetIdleTimer) guard.activity();
  };
  const scheduleServerRefresh = (): void => {
    if (serverRefreshTimer !== undefined || expiring) return;
    const delay = Math.max(
      0,
      lastServerRefreshAt + SESSION_REFRESH_INTERVAL_MS - Date.now(),
    );
    serverRefreshTimer = globalThis.setTimeout(() => {
      serverRefreshTimer = undefined;
      void revalidate(false);
    }, delay);
  };
  const activity = (): void => {
    guard.activity();
    scheduleServerRefresh();
  };
  const onPageShow = (event: PageTransitionEvent): void => {
    if (event.persisted) void revalidate(true);
  };
  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') void revalidate(true);
  };
  const onPopState = (): void => void revalidate(true);

  for (const event of ['keydown', 'pointerdown', 'touchstart'] as const)
    globalThis.addEventListener(event, activity, { passive: true });
  globalThis.addEventListener('pageshow', onPageShow);
  globalThis.addEventListener('popstate', onPopState);
  document.addEventListener('visibilitychange', onVisibility);
  guard.start();

  nuxtApp.hook('app:beforeUnmount', () => {
    guard.stop();
    if (serverRefreshTimer !== undefined)
      globalThis.clearTimeout(serverRefreshTimer);
    for (const event of ['keydown', 'pointerdown', 'touchstart'] as const)
      globalThis.removeEventListener(event, activity);
    globalThis.removeEventListener('pageshow', onPageShow);
    globalThis.removeEventListener('popstate', onPopState);
    document.removeEventListener('visibilitychange', onVisibility);
  });
});
