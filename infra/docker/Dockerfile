FROM node:24.13.0-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.28.1 --activate
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/cli/package.json apps/cli/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY apps/maintenance/package.json apps/maintenance/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/github/package.json packages/github/package.json
COPY packages/integration-admin/package.json packages/integration-admin/package.json
COPY packages/integrations/package.json packages/integrations/package.json
COPY packages/messaging/package.json packages/messaging/package.json
COPY packages/manifests/package.json packages/manifests/package.json
COPY packages/onboarding/package.json packages/onboarding/package.json
COPY packages/policies/package.json packages/policies/package.json
COPY packages/secrets/package.json packages/secrets/package.json
COPY packages/vercel/package.json packages/vercel/package.json
COPY packages/workflows/package.json packages/workflows/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production
RUN groupadd --system --gid 10001 binflow \
  && useradd --system --uid 10001 --gid binflow --home-dir /app binflow
COPY --from=build --chown=binflow:binflow /app /app
USER binflow
CMD ["node", "apps/api/dist/server.js"]
