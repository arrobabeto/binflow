type SessionResult = Readonly<{
  data: Readonly<{ user: Readonly<{ twoFactorEnabled?: boolean }> }> | null;
  error: unknown;
}>;

export type SessionRevalidator = Readonly<{
  getSession: (input: {
    query: { disableCookieCache: true };
  }) => Promise<SessionResult>;
}>;

export const authenticatedDestination = (candidate: unknown): string => {
  if (
    typeof candidate !== 'string' ||
    !candidate.startsWith('/') ||
    candidate.startsWith('//')
  )
    return '/';
  return candidate;
};

export const revalidateAndReplaceAuthenticatedDocument = async (
  auth: SessionRevalidator,
  destination: unknown,
  replace: (destination: string) => void = (value) =>
    globalThis.location.replace(value),
): Promise<void> => {
  const session = await auth.getSession({
    query: { disableCookieCache: true },
  });
  if (session.error !== null || session.data?.user.twoFactorEnabled !== true)
    throw new Error('The authenticated session could not be revalidated.');
  replace(authenticatedDestination(destination));
};
