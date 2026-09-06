import type { ProjectManifest } from '@binflow/contracts';

const basename = (path: string): string => {
  const normalized = path.replace(/^\//, '').trim();
  const parts = normalized.split('/');
  return parts.at(-1) ?? normalized;
};

/** Escape for use inside a RegExp character class / literal match. */
const escapeRegExp = (value: string): string =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/**
 * Find a live CDN (or other absolute HTTPS) URL in storefront HTML that
 * references the theme asset basename (e.g. story-discovery-1.jpg).
 */
export const findThemeAssetUrlInHtml = (
  html: string,
  assetPath: string,
): string | undefined => {
  const name = basename(assetPath);
  if (name.length === 0) return undefined;
  const pattern = new RegExp(
    `https:\\/\\/[^"'\\s<>]+${escapeRegExp(name)}[^"'\\s<>]*`,
    'iu',
  );
  const match = pattern.exec(html);
  const url = match?.[0]?.trim();
  if (url === undefined || url.length === 0) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
};

export const buildGitHubRawThemeAssetUrl = (input: Readonly<{
  assetPath: string;
  owner: string;
  productionBranch: string;
  repo: string;
}>): string => {
  const path = input.assetPath.replace(/^\//, '').trim();
  const branch = encodeURIComponent(input.productionBranch);
  const segments = path
    .split('/')
    .filter((part) => part.length > 0)
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `https://raw.githubusercontent.com/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/${branch}/${segments}`;
};

const originHostAllowed = (
  enrolledOrigin: string,
  responseUrl: string,
): boolean => {
  try {
    const enrolled = new URL(enrolledOrigin);
    const actual = new URL(responseUrl);
    return (
      enrolled.protocol === 'https:' &&
      actual.protocol === 'https:' &&
      enrolled.host === actual.host
    );
  } catch {
    return false;
  }
};

export type ResolveThemeAssetPreviewUrlInput = Readonly<{
  assetPath: string;
  fetchImpl?: typeof fetch;
  productionOrigin: string;
  repository: Readonly<{
    name: string;
    owner: string;
    productionBranch: string;
  }>;
}>;

/**
 * Prefer a live storefront CDN URL for the inventory sample asset; fall back
 * to GitHub raw on the production branch (SoT in the theme repo).
 */
export const resolveThemeAssetPreviewUrl = async (
  input: ResolveThemeAssetPreviewUrlInput,
): Promise<string> => {
  const assetPath = input.assetPath.replace(/^\//, '').trim();
  const fallback = buildGitHubRawThemeAssetUrl({
    assetPath,
    owner: input.repository.owner,
    productionBranch: input.repository.productionBranch,
    repo: input.repository.name,
  });
  const origin = input.productionOrigin.replace(/\/$/, '');
  let enrolled: URL;
  try {
    enrolled = new URL(origin);
  } catch {
    return fallback;
  }
  if (enrolled.protocol !== 'https:') return fallback;

  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(origin, {
      headers: { accept: 'text/html,application/xhtml+xml' },
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return fallback;
    if (!originHostAllowed(origin, response.url)) return fallback;
    const html = await response.text();
    return findThemeAssetUrlInHtml(html, assetPath) ?? fallback;
  } catch {
    return fallback;
  }
};

export const resolveThemeAssetPreviewUrlFromManifest = async (
  manifest: Pick<ProjectManifest, 'deployment' | 'repository'>,
  assetPath: string,
  fetchImpl?: typeof fetch,
): Promise<string | undefined> => {
  const origin = manifest.deployment?.productionOrigin?.trim();
  if (origin === undefined || origin.length === 0) {
    return buildGitHubRawThemeAssetUrl({
      assetPath,
      owner: manifest.repository.owner,
      productionBranch: manifest.repository.productionBranch,
      repo: manifest.repository.name,
    });
  }
  return resolveThemeAssetPreviewUrl({
    assetPath,
    productionOrigin: origin,
    repository: {
      name: manifest.repository.name,
      owner: manifest.repository.owner,
      productionBranch: manifest.repository.productionBranch,
    },
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
  });
};
