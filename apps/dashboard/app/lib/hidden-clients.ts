import type { Enrollment } from '@binflow/contracts';

/**
 * Tenant keys hidden from Clients, Home, and Analytics client lists only.
 * Data and APIs are unchanged. To show again, remove the key from this list.
 */
export const HIDDEN_DASHBOARD_TENANT_KEYS = [] as const;

const hiddenTenantKeys = new Set(
  HIDDEN_DASHBOARD_TENANT_KEYS.map((key) => key.toLowerCase()),
);

export const isHiddenDashboardClient = (
  enrollment: Pick<Enrollment, 'tenantKey'>,
): boolean => hiddenTenantKeys.has(enrollment.tenantKey.toLowerCase());

export const visibleDashboardEnrollments = <T extends Pick<Enrollment, 'tenantKey'>>(
  items: readonly T[],
): T[] => items.filter((item) => !isHiddenDashboardClient(item));
