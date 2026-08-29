import { describe, expect, it, vi } from 'vitest';

import { createPendingPairingRefresh } from '../app/lib/pending-pairing-refresh';

describe('pending pairing dashboard refresh', () => {
  it('polls only while pending and refreshes when the tab becomes visible', async () => {
    vi.useFakeTimers();
    try {
      const refresh = vi.fn(async () => undefined);
      const controller = createPendingPairingRefresh({
        clearInterval,
        intervalMs: 3000,
        refresh,
        setInterval,
      });
      controller.setPending(true);
      vi.advanceTimersByTime(3000);
      controller.visible();
      await Promise.resolve();
      expect(refresh).toHaveBeenCalledTimes(2);
      controller.setPending(false);
      vi.advanceTimersByTime(6000);
      controller.visible();
      expect(refresh).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
