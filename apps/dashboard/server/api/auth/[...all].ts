import { requirePlatformOwnerSession } from '@binflow/auth';
import { DomainError } from '@binflow/domain';

export default defineEventHandler(async (event) => {
  const runtime = await getAuthRuntime();
  const request = toWebRequest(event);
  const path = new URL(request.url).pathname.replace('/api/auth', '');
  const freshTwoFactorPaths = new Set([
    '/revoke-session',
    '/revoke-sessions',
    '/two-factor/disable',
    '/two-factor/generate-backup-codes',
  ]);
  try {
    if (freshTwoFactorPaths.has(path)) {
      await requirePlatformOwnerSession(runtime.auth, request.headers, {
        fresh: true,
      });
    } else if (path === '/two-factor/enable') {
      await requirePlatformOwnerSession(runtime.auth, request.headers, {
        fresh: true,
        twoFactor: false,
      });
    }
  } catch (error) {
    if (error instanceof DomainError) {
      throw createError({
        message: error.message,
        statusCode: error.category === 'authentication_error' ? 401 : 403,
        statusMessage: error.metadata.code ?? error.category,
      });
    }
    throw error;
  }
  return runtime.auth.handler(request);
});
