import { DomainError } from '@binflow/domain';

export const WORDPRESS_REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_SAME_ORIGIN_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Routes Binflow may read from a WordPress site (ADR-0066). Plugins, themes,
 * users (other than `users/me`), settings and menus are never callable,
 * regardless of the WordPress role behind the Application Password.
 */
export const WORDPRESS_ALLOWED_READ_ROUTES: ReadonlySet<string> = new Set([
  'wp/v2/categories',
  'wp/v2/posts',
  'wp/v2/users/me',
]);

const FORBIDDEN_ROUTE_PATTERN =
  /^(?:wp\/v2\/(?:plugins|themes|settings|menus|menu-items|menu-locations|navigation|users(?!\/me$))|wp-site-health|wp-block-editor)(?:\/|$)/u;

export const allowInsecureWordpressLocalhost = (
  env: NodeJS.ProcessEnv = process.env,
): boolean =>
  env.BINFLOW_WORDPRESS_ALLOW_INSECURE_LOCALHOST === 'true' &&
  env.NODE_ENV !== 'production';

/** Normalize an operator-entered WordPress site URL to a bare origin. */
export const normalizeWordpressSiteOrigin = (
  value: string,
  options: Readonly<{ allowInsecureLocalhost?: boolean }> = {},
): string => {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new DomainError(
      'validation_error',
      'WordPress site URL is invalid.',
      { code: 'wordpress_origin_invalid' },
    );
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '')
    throw new DomainError(
      'validation_error',
      'WordPress site URL must not include credentials, query or fragment.',
      { code: 'wordpress_origin_invalid' },
    );
  if (url.pathname !== '/' && url.pathname !== '')
    throw new DomainError(
      'validation_error',
      'WordPress site URL must be the site origin (subdirectory installs are not supported).',
      { code: 'wordpress_origin_invalid' },
    );
  if (url.protocol === 'https:') return `https://${url.host}`;
  if (
    url.protocol === 'http:' &&
    options.allowInsecureLocalhost === true &&
    LOCAL_HOSTNAMES.has(url.hostname)
  )
    return `http://${url.host}`;
  throw new DomainError(
    'validation_error',
    'WordPress site URL must use HTTPS.',
    { code: 'wordpress_origin_insecure' },
  );
};

export type WordpressHttpMethod = 'DELETE' | 'GET' | 'POST';

export type WordpressRouteRule = Readonly<{
  method: WordpressHttpMethod;
  pattern: RegExp;
}>;

const readRouteRules: readonly WordpressRouteRule[] = [
  ...WORDPRESS_ALLOWED_READ_ROUTES,
].map((route) => ({
  method: 'GET' as const,
  pattern: new RegExp(`^${route.replace(/\//gu, '\\/')}$`, 'u'),
}));

const routeDenied = (method: WordpressHttpMethod, route: string): DomainError =>
  new DomainError(
    'policy_denied',
    `WordPress route ${method} ${route} is not allowlisted for Binflow.`,
    { code: 'wordpress_route_denied' },
  );

export const assertAllowedRoute = (
  rules: readonly WordpressRouteRule[],
  method: WordpressHttpMethod,
  route: string,
  query: Readonly<Record<string, string>>,
): void => {
  if (FORBIDDEN_ROUTE_PATTERN.test(route)) throw routeDenied(method, route);
  if (!rules.some((rule) => rule.method === method && rule.pattern.test(route)))
    throw routeDenied(method, route);
  if (method === 'DELETE' && 'force' in query) throw routeDenied(method, route);
};

export type WordpressJsonResponse = Readonly<{
  headers: Headers;
  json: unknown;
  status: number;
}>;

type FetchLike = typeof globalThis.fetch;

const readBoundedBytes = async (
  response: Response,
  maxBytes: number = MAX_RESPONSE_BYTES,
): Promise<Uint8Array> => {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes)
    throw new DomainError(
      'provider_final',
      'WordPress response is too large.',
      { code: 'wordpress_response_too_large' },
    );
  if (response.body === null) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  // Leaving the loop early cancels the underlying stream.
  for await (const value of response.body as unknown as AsyncIterable<Uint8Array>) {
    total += value.byteLength;
    if (total > maxBytes) {
      throw new DomainError(
        'provider_final',
        'WordPress response is too large.',
        { code: 'wordpress_response_too_large' },
      );
    }
    chunks.push(value);
  }
  return new Uint8Array(Buffer.concat(chunks));
};

const readBoundedText = async (response: Response): Promise<string> =>
  Buffer.from(await readBoundedBytes(response)).toString('utf8');

const mapStatus = (status: number): DomainError => {
  if (status === 401 || status === 403)
    return new DomainError(
      'authentication_error',
      'WordPress rejected the username or Application Password.',
      { code: 'wordpress_auth_failed', status: String(status) },
    );
  if (status === 404)
    return new DomainError(
      'provider_final',
      'WordPress REST route was not found.',
      { code: 'wordpress_route_not_found', status: String(status) },
    );
  if (status === 429 || status >= 500)
    return new DomainError(
      'provider_retryable',
      'WordPress is temporarily unavailable.',
      { code: 'wordpress_unavailable', status: String(status) },
    );
  return new DomainError(
    'provider_final',
    'WordPress returned an unexpected status.',
    { code: 'wordpress_unexpected_status', status: String(status) },
  );
};

export type WordpressRestClientOptions = Readonly<{
  /**
   * Method + route rules this client may call. Defaults to the enrollment
   * read set; capabilities pass their own declared allowlist. The forbidden
   * route pattern applies regardless.
   */
  allowedRoutes?: readonly WordpressRouteRule[];
  /** Basic-auth credentials; omitted for unauthenticated discovery. */
  auth?: Readonly<{ applicationPassword: string; username: string }>;
  fetch?: FetchLike;
  requestTimeoutMs?: number;
  signal?: AbortSignal;
  siteOrigin: string;
}>;

export type WordpressSendBody =
  | Readonly<{ json: unknown; kind: 'json' }>
  | Readonly<{
      bytes: Uint8Array;
      filename: string;
      kind: 'binary';
      mime: string;
    }>;

export type WordpressPublicResponse = Readonly<{
  bytes: Uint8Array;
  contentType: string;
  status: number;
}>;

const PUBLIC_RESPONSE_MAX_BYTES = 12 * 1024 * 1024;

/**
 * WordPress REST client: same-origin only (cross-host redirects are refused
 * so the Application Password never leaves the site), method + route
 * allowlist, bounded bodies, per-request timeout and one retry on transient
 * failures of idempotent reads. Writes are never retried here; callers make
 * them idempotent with lookups.
 */
export const createWordpressRestClient = (options: WordpressRestClientOptions) => {
  const fetch = options.fetch ?? globalThis.fetch;
  const requestTimeoutMs = options.requestTimeoutMs ?? WORDPRESS_REQUEST_TIMEOUT_MS;
  const origin = new URL(options.siteOrigin);
  const rules = options.allowedRoutes ?? readRouteRules;
  const authorization =
    options.auth === undefined
      ? undefined
      : `Basic ${Buffer.from(
          `${options.auth.username}:${options.auth.applicationPassword}`,
          'utf8',
        ).toString('base64')}`;

  type Attempt = Readonly<{
    authenticated: boolean;
    body?: WordpressSendBody;
    method: WordpressHttpMethod;
  }>;

  const fetchSameOrigin = async (
    url: URL,
    attempt: Attempt,
  ): Promise<Response> => {
    const timeout = AbortSignal.timeout(requestTimeoutMs);
    const signal =
      options.signal === undefined
        ? timeout
        : AbortSignal.any([timeout, options.signal]);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (attempt.authenticated && authorization !== undefined)
      headers.Authorization = authorization;
    let body: string | Uint8Array | undefined;
    if (attempt.body?.kind === 'json') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(attempt.body.json);
    } else if (attempt.body?.kind === 'binary') {
      headers['Content-Type'] = attempt.body.mime;
      headers['Content-Disposition'] =
        `attachment; filename="${attempt.body.filename.replace(/["\\\r\n]/gu, '')}"`;
      body = attempt.body.bytes;
    }
    let current = url;
    for (let hop = 0; ; hop += 1) {
      if (current.protocol !== origin.protocol || current.host !== origin.host)
        throw new DomainError(
          'policy_denied',
          'WordPress redirected to another host; Binflow does not follow it.',
          { code: 'wordpress_redirect_cross_host' },
        );
      let response: Response;
      try {
        response = await fetch(current, {
          ...(body === undefined ? {} : { body }),
          headers,
          method: attempt.method,
          redirect: 'manual',
          signal,
        });
      } catch {
        if (timeout.aborted)
          throw new DomainError(
            'provider_retryable',
            `WordPress did not respond within ${String(Math.round(requestTimeoutMs / 1000))} s.`,
            { code: 'wordpress_timeout' },
          );
        throw new DomainError(
          'provider_retryable',
          'WordPress could not be reached.',
          { code: 'wordpress_unreachable' },
        );
      }
      if (REDIRECT_STATUSES.has(response.status)) {
        await response.body?.cancel().catch(() => undefined);
        const location = response.headers.get('location');
        if (
          location === null ||
          hop >= MAX_SAME_ORIGIN_REDIRECTS ||
          attempt.method !== 'GET'
        )
          throw new DomainError(
            'provider_final',
            'WordPress returned an unusable redirect.',
            { code: 'wordpress_redirect_invalid' },
          );
        current = new URL(location, current);
        continue;
      }
      return response;
    }
  };

  const requestJsonOnce = async (
    url: URL,
    attempt: Attempt,
  ): Promise<WordpressJsonResponse> => {
    const response = await fetchSameOrigin(url, attempt);
    if (response.status < 200 || response.status >= 300) {
      await response.body?.cancel().catch(() => undefined);
      throw mapStatus(response.status);
    }
    const text = await readBoundedText(response);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new DomainError(
        'provider_final',
        'WordPress returned a non-JSON response (REST API disabled or blocked?).',
        { code: 'wordpress_rest_unavailable' },
      );
    }
    return { headers: response.headers, json, status: response.status };
  };

  const requestJson = async (
    url: URL,
    attempt: Attempt,
  ): Promise<WordpressJsonResponse> => {
    try {
      return await requestJsonOnce(url, attempt);
    } catch (error) {
      if (
        attempt.method === 'GET' &&
        error instanceof DomainError &&
        error.category === 'provider_retryable' &&
        options.signal?.aborted !== true
      )
        return requestJsonOnce(url, attempt);
      throw error;
    }
  };

  const routeUrl = (
    restBase: string,
    route: string,
    query: Readonly<Record<string, string>>,
  ): URL => {
    const base = new URL(restBase);
    if (base.protocol !== origin.protocol || base.host !== origin.host)
      throw new DomainError(
        'policy_denied',
        'WordPress REST base is not on the enrolled site origin.',
        { code: 'wordpress_rest_base_cross_host' },
      );
    let url: URL;
    if (base.searchParams.has('rest_route')) {
      url = new URL(base.href);
      url.searchParams.set('rest_route', `/${route}`);
    } else {
      url = new URL(route, base.href.endsWith('/') ? base.href : `${base.href}/`);
    }
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    return url;
  };

  return {
    /** REST discovery: `/wp-json/`, falling back to `?rest_route=/` (plain permalinks). */
    async discover(): Promise<Readonly<{ namespaces: readonly string[]; restBase: string }>> {
      const candidates = [
        new URL('/wp-json/', origin),
        new URL('/?rest_route=/', origin),
      ];
      let lastError: unknown;
      for (const candidate of candidates) {
        try {
          const { json } = await requestJson(candidate, {
            authenticated: true,
            method: 'GET',
          });
          const namespaces =
            json !== null &&
            typeof json === 'object' &&
            Array.isArray((json as { namespaces?: unknown }).namespaces)
              ? ((json as { namespaces: unknown[] }).namespaces.filter(
                  (item): item is string => typeof item === 'string',
                ))
              : undefined;
          if (namespaces === undefined) {
            lastError = new DomainError(
              'provider_final',
              'WordPress REST discovery returned an unexpected shape.',
              { code: 'wordpress_rest_unavailable' },
            );
            continue;
          }
          return { namespaces, restBase: candidate.href };
        } catch (error) {
          if (
            error instanceof DomainError &&
            (error.metadata.code === 'wordpress_route_not_found' ||
              error.metadata.code === 'wordpress_rest_unavailable')
          ) {
            lastError = error;
            continue;
          }
          throw error;
        }
      }
      if (lastError instanceof DomainError && lastError.metadata.code === 'wordpress_rest_unavailable')
        throw lastError;
      throw new DomainError(
        'provider_final',
        'WordPress REST API is unavailable (disabled or blocked by a plugin/firewall).',
        { code: 'wordpress_rest_unavailable' },
      );
    },
    async get(
      restBase: string,
      route: string,
      query: Readonly<Record<string, string>> = {},
    ): Promise<WordpressJsonResponse> {
      assertAllowedRoute(rules, 'GET', route, query);
      return requestJson(routeUrl(restBase, route, query), {
        authenticated: true,
        method: 'GET',
      });
    },
    /** Unauthenticated allowlisted REST read (what a visitor sees). */
    async getAnonymous(
      restBase: string,
      route: string,
      query: Readonly<Record<string, string>> = {},
    ): Promise<WordpressJsonResponse> {
      assertAllowedRoute(rules, 'GET', route, query);
      return requestJson(routeUrl(restBase, route, query), {
        authenticated: false,
        method: 'GET',
      });
    },
    async send(
      method: Exclude<WordpressHttpMethod, 'GET'>,
      restBase: string,
      route: string,
      input: Readonly<{
        body?: WordpressSendBody;
        query?: Readonly<Record<string, string>>;
      }> = {},
    ): Promise<WordpressJsonResponse> {
      const query = input.query ?? {};
      assertAllowedRoute(rules, method, route, query);
      return requestJson(routeUrl(restBase, route, query), {
        authenticated: true,
        ...(input.body === undefined ? {} : { body: input.body }),
        method,
      });
    },
    /**
     * Unauthenticated GET of a public URL on the enrolled origin (post pages,
     * uploaded images). Never sends the Application Password.
     */
    async fetchPublic(
      url: string,
      maxBytes: number = PUBLIC_RESPONSE_MAX_BYTES,
    ): Promise<WordpressPublicResponse> {
      let target: URL;
      try {
        target = new URL(url);
      } catch {
        throw new DomainError('validation_error', 'URL is invalid.', {
          code: 'wordpress_url_invalid',
        });
      }
      if (target.protocol !== origin.protocol || target.host !== origin.host)
        throw new DomainError(
          'policy_denied',
          'URL is not on the enrolled WordPress site.',
          { code: 'wordpress_url_cross_host' },
        );
      const response = await fetchSameOrigin(target, {
        authenticated: false,
        method: 'GET',
      });
      if (response.status < 200 || response.status >= 300) {
        await response.body?.cancel().catch(() => undefined);
        return {
          bytes: new Uint8Array(),
          contentType: response.headers.get('content-type') ?? '',
          status: response.status,
        };
      }
      return {
        bytes: await readBoundedBytes(response, maxBytes),
        contentType: response.headers.get('content-type') ?? '',
        status: response.status,
      };
    },
  };
};

export type WordpressRestClient = ReturnType<typeof createWordpressRestClient>;
