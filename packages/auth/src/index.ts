import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { count } from 'drizzle-orm';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor } from 'better-auth/plugins';
import { Pool } from 'pg';
import { v7 as uuidv7 } from 'uuid';

import {
  createDatabase,
  schema,
  withPlatformOwnerScope,
  type Database,
} from '@binflow/db';
import { DomainError } from '@binflow/domain';
import { loadSecureSecretFile } from '@binflow/secrets';

export const AUTH_SESSION_EXPIRES_SECONDS = 60 * 60 * 12;
export const AUTH_SESSION_FRESH_SECONDS = 60 * 5;
export const AUTH_SESSION_UPDATE_SECONDS = 60 * 60;
export const AUTH_SECRET_MIN_CHARACTERS = 32;

export const defaultAuthSecretPath = (): string =>
  join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
    'binflow',
    'auth-secret-v1.key',
  );

const assertOutsideRepository = async (
  secretPath: string,
  repositoryPath: string,
): Promise<void> => {
  const repository = await realpath(repositoryPath);
  const candidate = await realpath(secretPath).catch(() => resolve(secretPath));
  const pathFromRepository = relative(repository, candidate);
  if (
    pathFromRepository === '' ||
    (!pathFromRepository.startsWith('..') && !isAbsolute(pathFromRepository))
  ) {
    throw new Error('The Better Auth secret must be outside the repository.');
  }
};

export const createAuthSecretFile = async (
  secretPath: string,
  repositoryPath: string,
): Promise<void> => {
  await assertOutsideRepository(secretPath, repositoryPath);
  await mkdir(dirname(secretPath), { mode: 0o700, recursive: true });
  const handle = await open(secretPath, 'wx', 0o600);
  try {
    await handle.writeFile(`${randomBytes(32).toString('base64url')}\n`);
  } finally {
    await handle.close();
  }
};

export const loadLocalAuthSecretFile = async (
  secretPath: string,
  repositoryPath: string,
): Promise<string> => {
  const value = await loadSecureSecretFile(secretPath, repositoryPath);
  try {
    return await loadAuthSecret({ direct: value.toString('utf8').trim() });
  } finally {
    value.fill(0);
  }
};

export const loadAuthSecret = async (
  input: Readonly<{
    direct?: string;
    file?: string;
  }>,
): Promise<string> => {
  if (input.direct !== undefined && input.file !== undefined) {
    throw new Error('Configure only one Better Auth secret source.');
  }
  const value =
    input.direct ??
    (input.file === undefined
      ? undefined
      : (await readFile(input.file, 'utf8')).trim());
  if (value === undefined || value.length < AUTH_SECRET_MIN_CHARACTERS) {
    throw new Error(
      'The Better Auth secret must contain at least 32 characters.',
    );
  }
  if (value.length > 4096) {
    throw new Error('The Better Auth secret exceeds the supported size.');
  }
  return value;
};

export const createBinflowAuth = (
  input: Readonly<{
    allowBootstrapSignUp?: boolean;
    baseURL: string;
    database: Database;
    production: boolean;
    secret: string;
    trustedOrigins: readonly string[];
  }>,
) => {
  if (input.secret.length < AUTH_SECRET_MIN_CHARACTERS) {
    throw new Error(
      'The Better Auth secret must contain at least 32 characters.',
    );
  }
  const trustedOriginSet = new Set(
    input.trustedOrigins.map((origin) => new URL(origin).origin),
  );
  return betterAuth({
    advanced: {
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: input.production,
      },
      useSecureCookies: input.production,
    },
    appName: 'Binflow',
    baseURL: input.baseURL,
    database: drizzleAdapter(input.database, {
      provider: 'pg',
      schema: {
        account: schema.authAccounts,
        rateLimit: schema.authRateLimits,
        session: schema.authSessions,
        twoFactor: schema.authTwoFactors,
        user: schema.authUsers,
        verification: schema.authVerifications,
      },
    }),
    emailAndPassword: {
      autoSignIn: false,
      disableSignUp: input.allowBootstrapSignUp !== true,
      enabled: true,
      maxPasswordLength: 128,
      minPasswordLength: 12,
    },
    hooks: {
      before: createAuthMiddleware((context) => {
        if (
          context.request !== undefined &&
          !['GET', 'HEAD', 'OPTIONS'].includes(context.request.method)
        ) {
          const requestOrigin = context.request.headers.get('origin');
          let normalizedRequestOrigin: string | undefined;
          try {
            normalizedRequestOrigin =
              requestOrigin === null
                ? undefined
                : new URL(requestOrigin).origin;
          } catch {
            normalizedRequestOrigin = undefined;
          }
          if (
            normalizedRequestOrigin === undefined ||
            !trustedOriginSet.has(normalizedRequestOrigin)
          ) {
            throw new APIError('FORBIDDEN', {
              message: 'The request origin is not trusted.',
            });
          }
        }
        const body: unknown = context.body;
        if (
          (context.path === '/two-factor/verify-totp' ||
            context.path === '/two-factor/verify-backup-code') &&
          typeof body === 'object' &&
          body !== null &&
          'trustDevice' in body &&
          body.trustDevice === true
        ) {
          throw new APIError('BAD_REQUEST', {
            message: 'Trusted devices are disabled for Binflow.',
          });
        }
        return Promise.resolve();
      }),
    },
    plugins: [
      twoFactor({ issuer: 'Binflow', skipVerificationOnEnable: false }),
    ],
    rateLimit: {
      customRules: {
        '/sign-in/email': { max: 5, window: 60 },
        '/two-factor/verify-backup-code': { max: 5, window: 60 },
        '/two-factor/verify-totp': { max: 5, window: 60 },
      },
      enabled: true,
      storage: 'database',
    },
    secret: input.secret,
    session: {
      expiresIn: AUTH_SESSION_EXPIRES_SECONDS,
      freshAge: AUTH_SESSION_FRESH_SECONDS,
      updateAge: AUTH_SESSION_UPDATE_SECONDS,
    },
    trustedOrigins: [...input.trustedOrigins],
  });
};

export type BinflowAuth = ReturnType<typeof createBinflowAuth>;

export type BinflowAuthRuntime = Readonly<{
  auth: BinflowAuth;
  close: () => Promise<void>;
  database: Database;
}>;

export const createBinflowAuthRuntime = async (
  input: Readonly<{
    baseURL: string;
    databaseUrl: string;
    production: boolean;
    secret?: string;
    secretFile?: string;
    trustedOrigins: readonly string[];
  }>,
): Promise<BinflowAuthRuntime> => {
  const database = createDatabase(input.databaseUrl);
  try {
    const secret = await loadAuthSecret({
      ...(input.secret === undefined ? {} : { direct: input.secret }),
      ...(input.secretFile === undefined ? {} : { file: input.secretFile }),
    });
    return {
      auth: createBinflowAuth({
        baseURL: input.baseURL,
        database: database.db,
        production: input.production,
        secret,
        trustedOrigins: input.trustedOrigins,
      }),
      database: database.db,
      close: async (): Promise<void> => database.pool.end(),
    };
  } catch (error) {
    await database.pool.end();
    throw error;
  }
};

export type PlatformOwnerSession = Readonly<{
  actorId: string;
  email: string;
  fresh: boolean;
  sessionId: string;
}>;

export const requirePlatformOwnerSession = async (
  auth: BinflowAuth,
  headers: Headers,
  options: Readonly<{ fresh?: boolean; twoFactor?: boolean }> = {},
): Promise<PlatformOwnerSession> => {
  const resolved = await auth.api.getSession({ headers });
  if (resolved === null) {
    throw new DomainError(
      'authentication_error',
      'Authentication is required.',
    );
  }
  if (options.twoFactor !== false && resolved.user.twoFactorEnabled !== true) {
    throw new DomainError(
      'authorization_error',
      'Two-factor enrollment is required.',
    );
  }
  const createdAt = new Date(resolved.session.createdAt);
  const fresh =
    Date.now() - createdAt.getTime() <= AUTH_SESSION_FRESH_SECONDS * 1000;
  if (options.fresh === true && !fresh) {
    throw new DomainError(
      'authorization_error',
      'A fresh session is required.',
      { code: 'fresh_session_required' },
    );
  }
  return {
    actorId: resolved.user.id,
    email: resolved.user.email,
    fresh,
    sessionId: resolved.session.id,
  };
};

export const bootstrapPlatformOwner = async (
  input: Readonly<{
    baseURL: string;
    correlationId?: string;
    databaseUrl: string;
    email: string;
    name: string;
    password: string;
    secret: string;
  }>,
): Promise<Readonly<{ email: string; userId: string }>> => {
  const lockPool = new Pool({ connectionString: input.databaseUrl, max: 1 });
  const lockClient = await lockPool.connect();
  const { db, pool } = createDatabase(input.databaseUrl);
  try {
    await lockClient.query(
      "select pg_advisory_lock(hashtext('binflow_admin_bootstrap'))",
    );
    const existing = await db.select({ value: count() }).from(schema.authUsers);
    if ((existing[0]?.value ?? 0) !== 0) {
      throw new DomainError(
        'conflict_error',
        'The platform owner has already been bootstrapped.',
      );
    }
    const auth = createBinflowAuth({
      allowBootstrapSignUp: true,
      baseURL: input.baseURL,
      database: db,
      production: false,
      secret: input.secret,
      trustedOrigins: [input.baseURL],
    });
    const created = await auth.api.signUpEmail({
      body: {
        email: input.email.trim().toLowerCase(),
        name: input.name.trim(),
        password: input.password,
      },
    });
    const correlationId = input.correlationId ?? uuidv7();
    await withPlatformOwnerScope(
      db,
      {
        actorId: created.user.id,
        correlationId,
        reason: 'Initial platform-owner bootstrap',
      },
      async (database) => {
        await database.insert(schema.auditEvents).values({
          action: 'auth.platform_owner_bootstrapped',
          actorId: created.user.id,
          actorType: 'platform_owner',
          correlationId,
          id: uuidv7(),
          metadata: { email: created.user.email },
          objectId: created.user.id,
          objectType: 'auth_user',
          reason: 'Initial platform-owner bootstrap',
        });
      },
    );
    return { email: created.user.email, userId: created.user.id };
  } finally {
    try {
      await lockClient.query(
        "select pg_advisory_unlock(hashtext('binflow_admin_bootstrap'))",
      );
    } finally {
      lockClient.release();
      await Promise.all([lockPool.end(), pool.end()]);
    }
  }
};
