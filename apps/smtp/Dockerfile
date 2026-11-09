# syntax=docker/dockerfile:1
# ============================================================================
# SMTP App - production image
#
# Image:   admincareout/kidl:saleor-app-smtp-1.0
# Container port: 3000 (mapped to host port 3002 by compose.yml)
#
# IMPORTANT - build context, Dockerfile and ignore file work together:
#
#   1. CONTEXT = the monorepo ROOT (two levels above this Dockerfile), NOT
#      the app directory. The app uses pnpm `workspace:*` and `catalog:`
#      dependency specs that only resolve from the root (they need
#      pnpm-lock.yaml + pnpm-workspace.yaml + packages/). compose.yml sets
#      this for you:
#
#        docker compose up -d --build
#
#      Plain docker CLI equivalent (run from the app directory):
#
#        docker build -f Dockerfile \
#          -t admincareout/kidl:saleor-app-smtp-1.0 ../..
#
#   2. IGNORE FILE = apps/smtp/Dockerfile.dockerignore. Docker (25+)
#      automatically pairs a Dockerfile with an ignore file named after it
#      in the same directory - no compose/CLI flag needed. Because it
#      exists, it REPLACES the repository-root .dockerignore for this build
#      (they are not merged), so it is self-contained: it excludes every
#      other app, all node_modules/.next build output, and every env and
#      app-authentication file, keeping the context ~5 MB and secrets out
#      of image layers. Its patterns are relative to the context root (the
#      monorepo root), not to the app directory.
#
#      Note the ordering constraint inside that file: the app re-inclusion
#      negation must stay ABOVE the artifact/secret exclusions (last
#      matching gitignore pattern wins), or it would leak the app's own
#      node_modules/.next/.env*/auth file into the context.
# Build-time environment:
#   SECRET_KEY - the app's env schema (src/env.ts) parses SECRET_KEY at
#     module load, so `next build` needs the variable to be present in the
#     build stage. Server code reads process.env at request time, so the
#     RUNTIME value from .env.docker is the one actually used to decrypt the
#     SMTP configuration stored in Saleor app metadata. The build value
#     only needs to be present (env validation); keep it identical to the
#     runtime value from .env.docker.
#     If you ever rotate/set a real SECRET_KEY, pass it to BOTH the build
#     (--build-arg SECRET_KEY=...) and the runtime env file.
# ============================================================================

ARG NODE_VERSION=24

# ----------------------------------------------------------------------------
# Base: Node + pnpm (version pinned by packageManager in package.json)
# ----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

# ----------------------------------------------------------------------------
# Build: install the app's workspace deps, run the production build, then
# `pnpm deploy` a self-contained production copy (prod deps only).
# ----------------------------------------------------------------------------
FROM base AS build

# HUSKY=0: the root package has a `prepare: husky` hook; there is no .git in
# the context (excluded by Dockerfile.dockerignore), so the hook must be
# skipped.
ENV HUSKY=0

COPY . .

# Filter to this app + its workspace dependencies (monorepo stays lean).
# `--frozen-lockfile` guarantees reproducible installs from pnpm-lock.yaml.
RUN pnpm install --frozen-lockfile --filter "saleor-app-smtp..."

# Must be present for `next build` to pass env validation (see header).
ARG SECRET_KEY=
ENV SECRET_KEY="${SECRET_KEY}"
ENV NODE_ENV=production

# Build, then `pnpm deploy` a self-contained production copy (prod deps
# only), then bring in the build output and public assets - one atomic step
# so the deployment directory is complete even under cache reuse.
# `pnpm deploy` packages the published files; .next (build output) and
# public/ are copied explicitly so the runner has everything.
# `--legacy`: this workspace does not set `inject-workspace-packages=true`,
# so pnpm 10's default deploy refuses; legacy mode copies the workspace
# packages into the deployment instead (no repo config change needed).
RUN pnpm --filter saleor-app-smtp build \
    && pnpm --filter saleor-app-smtp deploy --legacy --prod /deploy/smtp \
    && cp -r apps/smtp/.next /deploy/smtp/.next \
    && cp -r apps/smtp/public /deploy/smtp/public

# ----------------------------------------------------------------------------
# Runner: minimal production runtime, non-root, health check, clean signals.
# `next start` is the production server; running node directly (exec form)
# keeps it PID 1 so SIGTERM triggers Next.js graceful shutdown.
# ----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runner

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

WORKDIR /app

COPY --from=build --chown=node:node /deploy/smtp /app

EXPOSE 3000

USER node

# Lightweight always-available endpoint (manifest), used for health checks.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/manifest >/dev/null 2>&1 || exit 1

CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
