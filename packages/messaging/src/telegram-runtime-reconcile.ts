export type TelegramRuntimeCredentialKind =
  | 'telegram-admin'
  | 'telegram-client';

export type TelegramRuntimeCandidate = Readonly<{
  botId: string;
  kind: TelegramRuntimeCredentialKind;
}>;

/**
 * Returns Telegram bot identities that are active in the control plane but
 * not yet started in this worker process.
 */
export const selectUnstartedTelegramBots = (
  startedBotIds: ReadonlySet<string>,
  candidates: ReadonlyArray<TelegramRuntimeCandidate>,
): TelegramRuntimeCandidate[] => {
  const selected: TelegramRuntimeCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (startedBotIds.has(candidate.botId) || seen.has(candidate.botId))
      continue;
    seen.add(candidate.botId);
    selected.push(candidate);
  }
  return selected;
};

/**
 * Returns bots that this worker already mounted in send-only mode and that
 * should be promoted to polling when the Redis lock is free (previous holder
 * exited without this process restarting).
 */
export const selectSendOnlyTelegramBotsToPromote = (
  sendOnlyBotIds: ReadonlySet<string>,
  candidates: ReadonlyArray<TelegramRuntimeCandidate>,
): TelegramRuntimeCandidate[] => {
  const selected: TelegramRuntimeCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (
      !sendOnlyBotIds.has(candidate.botId) ||
      seen.has(candidate.botId)
    )
      continue;
    seen.add(candidate.botId);
    selected.push(candidate);
  }
  return selected;
};
