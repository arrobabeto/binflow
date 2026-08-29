import { describe, expect, it, vi } from 'vitest';

import {
  DASHBOARD_IDLE_TIMEOUT_MS,
  asDashboardSessionCandidate,
  createIdleSessionGuard,
  isCurrentDashboardSession,
  isSessionIdle,
} from '../app/lib/session-idle';

describe('dashboard idle session guard', () => {
  it('uses a 30-minute inactivity boundary', () => {
    expect(DASHBOARD_IDLE_TIMEOUT_MS).toBe(30 * 60 * 1000);
    const now = Date.parse('2026-08-19T12:30:00.000Z');
    expect(isSessionIdle('2026-08-19T12:00:00.001Z', now)).toBe(false);
    expect(isSessionIdle('2026-08-19T11:59:59.999Z', now)).toBe(true);
  });

  it('treats missing or incomplete session payloads as idle', () => {
    const now = Date.parse('2026-08-19T12:30:00.000Z');
    expect(isCurrentDashboardSession(undefined, now)).toBe(false);
    expect(isCurrentDashboardSession(null, now)).toBe(false);
    expect(
      isCurrentDashboardSession({ user: { twoFactorEnabled: true } }, now),
    ).toBe(false);
    expect(
      isCurrentDashboardSession(
        asDashboardSessionCandidate({
          session: { updatedAt: '2026-08-19T12:00:00.001Z' },
          user: { twoFactorEnabled: true },
        }),
        now,
      ),
    ).toBe(true);
    expect(asDashboardSessionCandidate(undefined)).toBeNull();
    expect(
      asDashboardSessionCandidate({ user: { twoFactorEnabled: true } }),
    ).toEqual({ session: undefined, user: { twoFactorEnabled: true } });
  });

  it('resets expiry on deliberate activity and stops cleanly', () => {
    vi.useFakeTimers();
    try {
      const expire = vi.fn();
      const owner = {
        clearTimeout: function (
          this: unknown,
          timer: ReturnType<typeof setTimeout>,
        ) {
          if (this !== owner) throw new TypeError('Illegal invocation');
          clearTimeout(timer);
        },
        setTimeout: function (
          this: unknown,
          callback: () => void,
          delay: number,
        ) {
          if (this !== owner) throw new TypeError('Illegal invocation');
          return setTimeout(callback, delay);
        },
      };
      const guard = createIdleSessionGuard({
        clearTimer: (timer) => {
          owner.clearTimeout(timer);
        },
        expire,
        setTimer: (callback, delay) => owner.setTimeout(callback, delay),
      });
      guard.start();
      vi.advanceTimersByTime(DASHBOARD_IDLE_TIMEOUT_MS - 1);
      guard.activity();
      vi.advanceTimersByTime(2);
      expect(expire).not.toHaveBeenCalled();
      vi.advanceTimersByTime(DASHBOARD_IDLE_TIMEOUT_MS - 2);
      expect(expire).toHaveBeenCalledOnce();
      guard.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
