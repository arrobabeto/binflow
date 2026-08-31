import { createHash } from 'node:crypto';

import {
  projectBudgetPolicySchema,
  projectManifestSchema,
  webbinPilotBinding,
  type EnrollmentConfiguration,
  type GlobalProfileSummary,
  type ProjectManifest,
} from '@binflow/contracts';
import { DomainError } from '@binflow/domain';
import {
  resolveProjectCapabilityBindings,
} from '@binflow/policies';

export const astroRepoGlobalProfile = {
  id: 'astro_repo',
  supportedLocales: ['en', 'es', 'de'],
  version: 'astro_repo@1',
} as const satisfies GlobalProfileSummary;

export const astroOrbitypeGlobalProfile = {
  id: 'astro_orbitype',
  supportedLocales: ['en', 'es', 'de'],
  version: 'astro_orbitype@1',
} as const satisfies GlobalProfileSummary;

export const webbinBudgetDefaults = {
  maxEstimatedCostCentsPerDay: 2_000,
  maxEstimatedCostCentsPerRequest: 500,
  maxModelCallsPerRequest: 12,
  maxRequestsPerDay: 10,
  maxTokensPerRequest: 120_000,
} as const;

/** Normalize enrollment productionDomain to a stable origin (no trailing slash). */
export const normalizeProductionOrigin = (value: string): string => {
  const url = new URL(value);
  if (url.protocol !== 'https:')
    throw new DomainError(
      'validation_error',
      'Production origin must use HTTPS.',
      { code: 'production_origin_invalid' },
    );
  return `https://${url.host}`;
};

export const resolveManifestProductionOrigin = (
  configuration: EnrollmentConfiguration,
  profile: 'astro_repo' | 'astro_orbitype',
): string => {
  if (
    configuration.productionDomain !== undefined &&
    configuration.productionDomain.trim().length > 0
  )
    return normalizeProductionOrigin(configuration.productionDomain);
  if (profile === 'astro_repo')
    return normalizeProductionOrigin(webbinPilotBinding.productionOrigin);
  throw new DomainError(
    'validation_error',
    'Enrollment productionDomain is required for this profile.',
    { code: 'production_domain_required' },
  );
};

export type VerifiedManifestBindings = Readonly<{
  github: Readonly<{
    defaultBranch: string;
    installationId: string;
    repository: string;
  }>;
  vercel: Readonly<{
    productionBranch: string;
    projectId: string;
    repository: string;
    teamId?: string;
  }>;
}>;

export type BuildManifestInput = Readonly<{
  configuration: EnrollmentConfiguration;
  id: string;
  profile: 'astro_repo' | 'astro_orbitype';
  projectId: string;
  projectKey: string;
  tenantKey: string;
  validatedAt: Date;
  verifiedBindings: VerifiedManifestBindings;
  version: number;
}>;

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  return value;
};

export const manifestFingerprint = (value: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');

const sameLocales = (
  actual: readonly string[] | undefined,
  expected: readonly string[],
): boolean =>
  actual?.length === expected.length &&
  expected.every((locale) => actual.includes(locale));

function assertWebbinConfiguration(
  configuration: EnrollmentConfiguration,
): asserts configuration is EnrollmentConfiguration &
  Required<
    Pick<
      EnrollmentConfiguration,
      | 'budgetPolicy'
      | 'clientConversationLocale'
      | 'contentLocales'
      | 'defaultContentLocale'
      | 'requiredLocales'
      | 'slugLocale'
      | 'translationPolicy'
    >
  > {
  if (!sameLocales(configuration.contentLocales, ['es', 'en']))
    throw new DomainError(
      'policy_denied',
      'Webbin content locales must be exactly Spanish and English.',
      { code: 'webbin_content_locales' },
    );
  if (!sameLocales(configuration.requiredLocales, ['es', 'en']))
    throw new DomainError(
      'policy_denied',
      'Webbin required locales must be exactly Spanish and English.',
      { code: 'webbin_required_locales' },
    );
  if (
    configuration.defaultContentLocale !== 'es' ||
    configuration.slugLocale !== 'es'
  )
    throw new DomainError(
      'policy_denied',
      'Webbin source and slug locale must be Spanish.',
      { code: 'webbin_source_slug_locale' },
    );
  if (configuration.translationPolicy !== 'always_translate')
    throw new DomainError(
      'policy_denied',
      'Webbin must always translate content.',
      { code: 'webbin_translation_policy' },
    );
  if (
    configuration.clientConversationLocale === undefined ||
    configuration.budgetPolicy === undefined
  )
    throw new DomainError(
      'validation_error',
      'Conversation locale and budget policy are required.',
      { code: 'manifest_configuration_incomplete' },
    );
  projectBudgetPolicySchema.parse(configuration.budgetPolicy);
}

const assertVerifiedBindings = (bindings: VerifiedManifestBindings): void => {
  if (
    bindings.github.repository !== 'arrobabeto/webbin' ||
    bindings.github.defaultBranch !== 'main' ||
    bindings.vercel.repository !== 'arrobabeto/webbin' ||
    bindings.vercel.productionBranch !== 'main'
  )
    throw new DomainError(
      'policy_denied',
      'Verified provider bindings do not match the Webbin pilot.',
      { code: 'webbin_provider_binding' },
    );
};

export const buildProjectManifest = (
  input: BuildManifestInput,
): ProjectManifest => {
  if (input.profile === 'astro_orbitype')
    return buildAstroOrbitypeManifest(input);
  if (input.tenantKey !== 'webbin' || input.projectKey !== 'webbin')
    throw new DomainError(
      'policy_denied',
      'Only the Webbin pilot manifest is supported for astro_repo.',
      { code: 'project_manifest_not_supported' },
    );
  assertWebbinConfiguration(input.configuration);
  assertVerifiedBindings(input.verifiedBindings);
  const productionOrigin = resolveManifestProductionOrigin(
    input.configuration,
    'astro_repo',
  );

  const enabledCapabilities = resolveProjectCapabilityBindings(
    input.configuration,
  );

  const contentEditablePaths = [
    'src/content/articulos/*.md',
    'src/content/articulos-es/*.md',
    'public/images/articles/*.avif',
    'public/_redirects',
    'src/content/proyectos/*.md',
    'src/content/proyectos-es/*.md',
    'public/images/projects/*.jpg',
    'public/images/projects/*.avif',
  ] as const;
  const portfolioEditablePaths = [
    'src/content/proyectos/*.md',
    'src/content/proyectos-es/*.md',
    'public/images/projects/*.jpg',
    'public/images/projects/*.avif',
  ] as const;

  const dependencyDocument = {
    budgetPolicy: input.configuration.budgetPolicy,
    clientConversationLocale: input.configuration.clientConversationLocale,
    contentEditablePaths: [...contentEditablePaths],
    contentLocales: ['es', 'en'],
    defaultContentLocale: 'es',
    globalProfileVersion: astroRepoGlobalProfile.version,
    enabledCapabilities: [...enabledCapabilities],
    portfolioEditablePaths: [...portfolioEditablePaths],
    productionOrigin,
    projectId: input.projectId,
    requiredContentLocales: ['es', 'en'],
    slugLocale: 'es',
    translationPolicy: 'always_translate',
    verifiedBindings: input.verifiedBindings,
  };
  const fingerprint = manifestFingerprint(dependencyDocument);
  const [owner, name] = input.verifiedBindings.github.repository.split('/');
  if (owner === undefined || name === undefined)
    throw new DomainError(
      'validation_error',
      'Verified GitHub repository identity is malformed.',
      { code: 'repository_identity_invalid' },
    );

  return projectManifestSchema.parse({
    budgetPolicy: input.configuration.budgetPolicy,
    content: {
      blockedPaths: [
        '.github/**',
        'astro.config.mjs',
        'package.json',
        'pnpm-lock.yaml',
        'src/components/**',
        'src/layouts/**',
        'src/pages/**',
        'src/scripts/**',
        'src/styles/**',
      ],
      collections: {
        en: {
          directory: 'src/content/articulos',
          routePrefix: '/articulos',
        },
        es: {
          directory: 'src/content/articulos-es',
          routePrefix: '/es/articulos',
        },
      },
      editablePaths: [...contentEditablePaths],
      frontmatterFields: [
        'titulo',
        'seoTitulo',
        'descripcion',
        'categoria',
        'fechaPublicacion',
        'fechaActualizacion',
        'tiempoLectura',
        'imagen',
        'imagenAlt',
        'keywords',
        'faq',
      ],
      imageDirectory: 'public/images/articles',
      portfolio: {
        collections: {
          en: {
            directory: 'src/content/proyectos',
            routePrefix: '/proyectos',
          },
          es: {
            directory: 'src/content/proyectos-es',
            routePrefix: '/es/proyectos',
          },
        },
        editablePaths: [...portfolioEditablePaths],
        enumFields: {
          estado: ['Publicado', 'En progreso', 'Concepto'],
          tipo: ['Sitio web', 'Landing page', 'Aplicacion web', 'Ecommerce'],
        },
        frontmatterFields: [
          'descriptor',
          'clienteTipo',
          'industria',
          'rol',
          'tipo',
          'estado',
          'fecha',
          'resumen',
          'impacto',
          'stack',
          'url',
          'imagen',
          'confidencial',
          'destacada',
        ],
        imageDirectory: 'public/images/projects',
        requiredFrontmatter: [
          'descriptor',
          'clienteTipo',
          'industria',
          'rol',
          'tipo',
          'estado',
          'fecha',
          'resumen',
          'impacto',
          'stack',
          'confidencial',
          'destacada',
        ],
        sectionHeadings: {
          en: {
            challenge: 'Challenge',
            outcome: 'Outcome',
            solution: 'Solution',
          },
          es: {
            challenge: 'Reto',
            outcome: 'Resultado',
            solution: 'Solución',
          },
        },
      },
      source: 'github',
    },
    contentLocales: ['es', 'en'],
    conversationLocale: input.configuration.clientConversationLocale,
    defaultContentLocale: 'es',
    deployment: {
      previewMode: 'git_integration',
      productionOrigin,
      projectId: input.verifiedBindings.vercel.projectId,
      protectionMode: 'vercel_auth',
      provider: 'vercel',
      ...(input.verifiedBindings.vercel.teamId === undefined
        ? {}
        : { teamId: input.verifiedBindings.vercel.teamId }),
    },
    enabledCapabilities: [...enabledCapabilities],
    fingerprint,
    globalProfileVersion: astroRepoGlobalProfile.version,
    graphVersion: 'stacks/astro-repo/create-blog@1',
    id: input.id,
    profile: 'astro_repo',
    projectId: input.projectId,
    repository: {
      branchPattern: 'bot/webbin/{capability}/{request-id}-{slug}',
      githubInstallationId: input.verifiedBindings.github.installationId,
      name,
      owner,
      productionBranch: 'main',
    },
    requiredContentLocales: ['es', 'en'],
    rulesVersion: 'webbin-editorial@1',
    slugLocale: 'es',
    status: 'validated',
    translationPolicy: 'always_translate',
    validatedAt: input.validatedAt.toISOString(),
    validationProfileId: 'webbin-astro-repo@1',
    version: input.version,
  });
};

const buildAstroOrbitypeManifest = (
  input: BuildManifestInput,
): ProjectManifest => {
  if (
    input.configuration.budgetPolicy === undefined ||
    input.configuration.clientConversationLocale === undefined ||
    input.configuration.contentLocales === undefined ||
    input.configuration.defaultContentLocale === undefined ||
    input.configuration.requiredLocales === undefined ||
    input.configuration.slugLocale === undefined ||
    input.configuration.translationPolicy === undefined
  ) {
    throw new DomainError(
      'validation_error',
      'astro_orbitype enrollment configuration is incomplete.',
      { code: 'configuration_incomplete' },
    );
  }

  const enabledCapabilities = resolveProjectCapabilityBindings(
    input.configuration,
    { allowEmpty: true },
  );
  const contentLocales = [...input.configuration.contentLocales];
  const requiredContentLocales = [...input.configuration.requiredLocales];
  if (
    !contentLocales.includes(input.configuration.defaultContentLocale) ||
    !contentLocales.includes(input.configuration.slugLocale) ||
    requiredContentLocales.some((locale) => !contentLocales.includes(locale))
  ) {
    throw new DomainError(
      'validation_error',
      'astro_orbitype locale configuration is inconsistent.',
      { code: 'locale_contract_invalid' },
    );
  }
  if (
    contentLocales.length === 1 &&
    input.configuration.translationPolicy !== 'none'
  ) {
    throw new DomainError(
      'policy_denied',
      'Monolingual projects require translation policy none.',
      { code: 'translation_policy_monolingual' },
    );
  }
  if (
    contentLocales.length > 1 &&
    input.configuration.translationPolicy === 'none'
  ) {
    throw new DomainError(
      'policy_denied',
      'Multilingual projects cannot use translation policy none.',
      { code: 'translation_policy_multilingual' },
    );
  }
  const collections = Object.fromEntries(
    contentLocales.map((locale) => [
      locale,
      {
        directory: `src/content/blog-${locale}`,
        // Bistro-style Astro+Orbitype sites render posts at /posts/{id}/{slug}.
        routePrefix: '/posts',
      },
    ]),
  );
  const productionOrigin = resolveManifestProductionOrigin(
    input.configuration,
    'astro_orbitype',
  );

  const dependencyDocument = {
    budgetPolicy: input.configuration.budgetPolicy,
    clientConversationLocale: input.configuration.clientConversationLocale,
    contentLocales,
    defaultContentLocale: input.configuration.defaultContentLocale,
    enabledCapabilities: [...enabledCapabilities],
    globalProfileVersion: astroOrbitypeGlobalProfile.version,
    productionOrigin,
    projectId: input.projectId,
    requiredContentLocales,
    slugLocale: input.configuration.slugLocale,
    translationPolicy: input.configuration.translationPolicy,
    verifiedBindings: input.verifiedBindings,
  };
  const fingerprint = manifestFingerprint(dependencyDocument);
  const [owner, name] = input.verifiedBindings.github.repository.split('/');
  if (owner === undefined || name === undefined)
    throw new DomainError(
      'validation_error',
      'Verified GitHub repository identity is malformed.',
      { code: 'repository_identity_invalid' },
    );

  return projectManifestSchema.parse({
    budgetPolicy: input.configuration.budgetPolicy,
    content: {
      blockedPaths: ['cms/system/**', '.github/**', 'astro.config.mjs', 'package.json'],
      collections,
      editablePaths: [
        'cms/collections/**',
        'src/content/blog-en/*.md',
        'src/content/blog-es/*.md',
        'src/content/blog-de/*.md',
        'public/images/blog/*.avif',
        'public/images/blog/*.jpg',
      ],
      frontmatterFields: ['title', 'titulo', 'description', 'descripcion'],
      imageDirectory: 'public/images/blog',
      publicationTargets: ['github', 'orbitype'],
      source: 'orbitype',
    },
    contentLocales,
    conversationLocale: input.configuration.clientConversationLocale,
    defaultContentLocale: input.configuration.defaultContentLocale,
    deployment: {
      previewMode: 'git_integration',
      productionOrigin,
      projectId: input.verifiedBindings.vercel.projectId,
      protectionMode: 'vercel_auth',
      provider: 'vercel',
      ...(input.verifiedBindings.vercel.teamId === undefined
        ? {}
        : { teamId: input.verifiedBindings.vercel.teamId }),
    },
    enabledCapabilities: [...enabledCapabilities],
    fingerprint,
    globalProfileVersion: astroOrbitypeGlobalProfile.version,
    graphVersion: 'stacks/astro-orbitype@0',
    id: input.id,
    profile: 'astro_orbitype',
    projectId: input.projectId,
    repository: {
      branchPattern: `bot/${input.projectKey}/{capability}/{request-id}-{slug}`,
      githubInstallationId: input.verifiedBindings.github.installationId,
      name,
      owner,
      productionBranch: input.verifiedBindings.github.defaultBranch,
    },
    requiredContentLocales,
    rulesVersion: 'astro-orbitype-content@0',
    slugLocale: input.configuration.slugLocale,
    status: 'validated',
    translationPolicy: input.configuration.translationPolicy,
    validatedAt: input.validatedAt.toISOString(),
    validationProfileId: 'astro-orbitype@1',
    version: input.version,
  });
};
