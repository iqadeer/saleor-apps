---
name: dockerize-saleor-app
description: Use when adding or fixing Docker deployment (Dockerfile, Dockerfile.dockerignore, compose.yml) for an app in this pnpm monorepo, or when a Docker build context is too large or leaking env/auth files.
---

# Dockerize a Saleor app in this monorepo

Ship an app as a production container: one multi-stage `Dockerfile`, one
`Dockerfile.dockerignore`, one `compose.yml`, one gitignored `.env.docker`
+ committed `.env.docker.example` — all next to the app in
`apps/<app>/`. Working reference: `apps/smtp/` and
`apps/dummy-payment-app/`.

## 1. The three build files and how they work together

| File | Role |
| ---- | ---- |
| `apps/<app>/Dockerfile` | Multi-stage build: `base` (node:24-alpine + corepack/pnpm) → `build` (install, `next build`, `pnpm deploy`) → `runner` (non-root, `next start` exec-form CMD, healthcheck on `/api/manifest`). |
| `apps/<app>/Dockerfile.dockerignore` | Context exclusions for THIS build. Auto-selected by Docker (25+): an ignore file named `<Dockerfile>.dockerignore` in the same directory as the Dockerfile is used instead of the context-root `.dockerignore` (replaced, NOT merged → must be self-contained). No compose key or CLI flag needed. |
| `apps/<app>/compose.yml` | `build.context: ../..` (monorepo root), `dockerfile: apps/<app>/Dockerfile`, build args, ports, `env_file`, auth-file volume, network. |

**Why the context is the monorepo root (not the app dir):** the apps use
pnpm `workspace:*` and `catalog:` dependency specs that only resolve from
the root (`pnpm-lock.yaml` + `pnpm-workspace.yaml` + `packages/`).

**Ignore-file path semantics:** even though the file lives in
`apps/<app>/`, its patterns are relative to the CONTEXT ROOT (the monorepo
root). A pattern like `apps/smtp/src` means "under the repo root".

## 2. What each app's ignore file must do

Keep (build needs them): this app's sources, `packages/**`, root workspace
files (`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`,
`turbo.json`, lint/cspell configs the build touches).

Exclude (verified recipe, in this ORDER — see below):

```
apps/*/*                    # other apps' contents (two-level form, see below)
!apps/<app>/*               # re-include THIS app's contents
.git
.cursor
.claude
**/node_modules
**/.next
**/.turbo
**/*.tsbuildinfo
**/.env
**/.env.*                   # no exception for *.example - builds get values via ARG/ENV
**/.saleor-app-auth*.json   # the FileAPL (token/jwks) - never in layers
**/*.log
.DS_Store
Thumbs.db
```

Verified result in this repo: ~5 MB context instead of ~4 GB, zero
`node_modules`/`.next`/env/auth entries.

### ORDERING CONSTRAINT (empirically verified — do not reorder)

Matching is gitignore-style: the LAST matching pattern wins. The app
re-inclusion negation MUST come ABOVE the artifact/secret exclusions.
`node_modules/`, `.next/`, `.env*` and `.saleor-app-auth*.json` are direct
children of the app directory, so if `!apps/<app>/*` came after them it
would re-include all of them and silently defeat every exclusion (secrets
into the build context). With the negation first, the later exclusions
re-exclude those directories/files.

Also note the two-level `apps/*/*` + `!apps/<app>/*` form: gitignore cannot
re-include a path whose PARENT directory was excluded, so exclude at the
children level (`apps/*/*`), where the negation can win. `apps/*` +
`!apps/<app>` does NOT work.

## 3. Build recipe (per app)

```dockerfile
# syntax=docker/dockerfile:1
FROM node:24-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

FROM base AS build
ENV HUSKY=0          # root prepare:husky hook; no .git in context
COPY . .
RUN pnpm install --frozen-lockfile --filter "<app-package-name>..."

# build-time-only values:
ARG NEXT_PUBLIC_FLAG=false            # NEXT_PUBLIC_* is inlined at build time
ENV NEXT_PUBLIC_FLAG="${NEXT_PUBLIC_FLAG}"
ENV NODE_ENV=production
ARG SECRET_KEY=                       # (SMTP) env schema parses it at module load
ENV SECRET_KEY="${SECRET_KEY}"

# ONE atomic step so the deploy dir is complete under cache reuse:
RUN pnpm --filter <app-package-name> build --webpack \
    && pnpm --filter <app-package-name> deploy --legacy --prod /deploy/<app> \
    && cp -r apps/<app>/.next /deploy/<app>/.next \
    && cp -r apps/<app>/public /deploy/<app>/public

FROM node:24-alpine AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /deploy/<app> /app
EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/manifest >/dev/null 2>&1 || exit 1
CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
```

Non-obvious flags (all verified in this repo, Next 16.4.1 + pnpm 10):

- `--webpack` — the default turbopack production build bakes hash-suffixed
  external require names (`@opentelemetry/api-<hash>`) into chunks that
  `next start` cannot resolve against pnpm's symlinked node_modules; every
  API route 500s.
- `deploy --legacy` — the workspace does not set
  `inject-workspace-packages=true`; pnpm 10's default deploy refuses,
  legacy mode copies workspace packages into the deployment.
- internal port is 3000 in every app; host port mapping (3001/3002/…)
  happens in compose only.

## 4. Saleor-app specifics (Stage 1: direct localhost)

- Two base URLs, same convention as local dev:
  `APP_IFRAME_BASE_URL=http://localhost:<host-port>` (browser → app,
  manifest appUrl) and `APP_API_BASE_URL=http://host.docker.internal:<host-port>`
  (Saleor containers → app: registration + webhooks).
- `.saleor-app-auth.json` (FileAPL) is bind-mounted **read-write** —
  `/api/register` rewrites it during (re-)registration. It is never baked
  into the image (ignore file).
- SMTP: `SECRET_KEY` is a build ARG AND runtime env — keep both identical.
  `NEW_SECRET_KEY` must be ABSENT, not empty (zod
  `z.string().min(1).optional()` rejects `""` → crash loop).
- `extra_hosts`: `api.childnest.co.uk:host-gateway` (the APL's saleorApiUrl
  hostname only exists in the Windows hosts file) and
  `host.docker.internal:host-gateway` (Linux compat). SMTP also needs
  `mailpit.childnest.co.uk:host-gateway`.
- Compose joins the external `saleor-proxy-net` (created by the
  saleor-platform project) with a stable alias — Stage 2 (Traefik file
  routing) then needs no rebuild.

## 5. Verifying the ignore file (context probe recipe)

Do not trust the transfer size in build logs; verify the ACTUAL context:

1. Back up the app's real Dockerfile.
2. Write a minimal one to the SAME path (so the same
   `Dockerfile.dockerignore` is auto-selected):
   `FROM scratch` / `CMD ["true"]` / `COPY . /repo`
3. `docker build -f apps/<app>/Dockerfile -t ctxprobe <repo-root>`
4. `docker create --name z ctxprobe && docker export z > p.tar && docker rm -f z`
   (scratch images need the CMD for `docker create` to work)
5. `tar -tf p.tar` and assert: 0 `node_modules/`, 0 `.next/`, 0 `.env*` /
   `.saleor-app-auth*`, other apps present as empty dirs only, this app's
   `src/` present, `packages/shared/src/` present, root `pnpm-lock.yaml`
   present. Context tar should be ~5 MB.
6. Restore the real Dockerfile.

## 6. Commands

```sh
docker compose up -d --build   # from apps/<app>/
docker compose ps              # expect "Up ... (healthy)"
curl -sf http://localhost:<port>/            # UI 200
curl -sf http://localhost:<port>/api/manifest  # manifest JSON
```

## 7. Gotchas log (each cost debugging time — verified empirically)

- `Dockerfile.dockerignore` REPLACES the root `.dockerignore`; if you move
  a pattern to the per-app file, do not assume the root one still applies.
- **BuildKit can reuse cached context layers across ignore-file changes**
  (the context cache key may not account for the ignore file's content).
  After changing it: `docker compose build --no-cache`, then verify the
  PURE IMAGE, not the running container — the container's
  `.saleor-app-auth.json` is the compose bind mount and hides any image
  file at the same path:
  `docker create --name t <image> && docker export t | grep -c
  "app/\.saleor-app-auth"` (expect 0) and `docker exec <container> sh -c
  'ls /app/.env*'` (expect failure — env files are never mounted).
  (Today's debugging: the "leak" visible in the running container was the
  mount all along; only `docker export` of a created container shows the
  truth.)
- Negation-last ordering leaks the app's own `.env*`/auth/artifacts (see §2).
- `NEW_SECRET_KEY=` (empty) crash-loops the SMTP container; omit it.
- Parallel `docker build` from the same Windows context can hit a transient
  `GetFileAttributesEx` context error — retry serially.
- `docker create`/`docker export` on `FROM scratch` images fails without a
  `CMD`.
- Next `NEXT_PUBLIC_*` build args are baked in — changing them requires a
  rebuild, not a restart.
