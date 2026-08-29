export type PendingPairingRefresh = Readonly<{
  setPending: (pending: boolean) => void;
  stop: () => void;
  visible: () => void;
}>;

export const createPendingPairingRefresh = (
  input: Readonly<{
    clearInterval: (timer: ReturnType<typeof setInterval>) => void;
    intervalMs?: number;
    refresh: () => Promise<unknown>;
    setInterval: (
      callback: () => void,
      delay: number,
    ) => ReturnType<typeof setInterval>;
  }>,
): PendingPairingRefresh => {
  let pending = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = (): void => {
    if (timer !== undefined) input.clearInterval(timer);
    timer = undefined;
  };
  return {
    setPending: (next) => {
      pending = next;
      stop();
      if (pending)
        timer = input.setInterval(() => {
          void input.refresh();
        }, input.intervalMs ?? 3000);
    },
    stop,
    visible: () => {
      if (pending) void input.refresh();
    },
  };
};
