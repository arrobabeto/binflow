export const DASHBOARD_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export type DashboardAuthSession = Readonly<{
  session: Readonly<{ updatedAt: Date | string | number }>;
  user: Readonly<{ twoFactorEnabled?: boolean | null }>;
}>;

export const isSessionIdle = (
  updatedAt: Date | string | number | undefined,
  now = Date.now(),
): boolean => {
  if (updatedAt === undefined) return true;
  const timestamp = new Date(updatedAt).getTime();
  return (
    !Number.isFinite(timestamp) || now - timestamp > DASHBOARD_IDLE_TIMEOUT_MS
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const asDashboardSessionCandidate = (
  value: unknown,
): {
  session?: { updatedAt?: Date | string | number };
  user?: { twoFactorEnabled?: boolean | null };
} | null => {
  if (!isRecord(value)) return null;
  const nested = value.session;
  const user = value.user;
  const updatedAt = isRecord(nested) ? nested.updatedAt : undefined;
  const twoFactorEnabled = isRecord(user) ? user.twoFactorEnabled : undefined;
  return {
    session:
      updatedAt instanceof Date ||
      typeof updatedAt === 'string' ||
      typeof updatedAt === 'number'
        ? { updatedAt }
        : undefined,
    user:
      typeof twoFactorEnabled === 'boolean' || twoFactorEnabled === null
        ? { twoFactorEnabled }
        : undefined,
  };
};

export const isCurrentDashboardSession = (
  session:
    | {
        session?: { updatedAt?: Date | string | number };
        user?: { twoFactorEnabled?: boolean | null };
      }
    | null
    | undefined,
  now = Date.now(),
): session is DashboardAuthSession =>
  session?.session !== undefined &&
  !isSessionIdle(session.session.updatedAt, now);

export type IdleSessionGuard = Readonly<{
  activity: () => void;
  start: () => void;
  stop: () => void;
}>;

export const createIdleSessionGuard = (
  input: Readonly<{
    clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
    expire: () => void;
    setTimer: (
      callback: () => void,
      delay: number,
    ) => ReturnType<typeof setTimeout>;
    timeoutMs?: number;
  }>,
): IdleSessionGuard => {
  const timeoutMs = input.timeoutMs ?? DASHBOARD_IDLE_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (): void => {
    if (timer !== undefined) input.clearTimer(timer);
    timer = input.setTimer(input.expire, timeoutMs);
  };
  return {
    activity: schedule,
    start: schedule,
    stop: () => {
      if (timer !== undefined) input.clearTimer(timer);
      timer = undefined;
    },
  };
};
