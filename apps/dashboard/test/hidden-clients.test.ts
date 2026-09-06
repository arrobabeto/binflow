import { describe, expect, it } from 'vitest';

import {
  HIDDEN_DASHBOARD_TENANT_KEYS,
  isHiddenDashboardClient,
  visibleDashboardEnrollments,
} from '../app/lib/hidden-clients';

describe('hidden dashboard clients', () => {
  it('shows all clients when the hide list is empty', () => {
    expect(HIDDEN_DASHBOARD_TENANT_KEYS).toEqual([]);
    expect(isHiddenDashboardClient({ tenantKey: 'webbin' })).toBe(false);
    expect(isHiddenDashboardClient({ tenantKey: 'acme' })).toBe(false);

    const visible = visibleDashboardEnrollments([
      { tenantKey: 'webbin' },
      { tenantKey: 'acme' },
      { tenantKey: 'elayva' },
    ]);
    expect(visible.map((item) => item.tenantKey)).toEqual([
      'webbin',
      'acme',
      'elayva',
    ]);
  });
});
