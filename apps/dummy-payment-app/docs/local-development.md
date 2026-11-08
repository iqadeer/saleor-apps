# Local development

Running the Dummy Payment App against the local Saleor stack (Docker +
Traefik, project `saleor-platform`). The app runs **on the host** (Windows)
via `pnpm dev:local`; Saleor's API, Dashboard and workers run **in Docker**
behind Traefik.

## Topology

```
Browser ──> http://dashboard.childnest.co.uk:8080   (Dashboard, in Docker, via Traefik)
              └─ iframe ──> http://localhost:3001   (Dummy Payment App, on host)

Saleor api/worker (in Docker) ──> http://host.docker.internal:3001   (same app, on host)
```

Two paths, one app: the browser reaches the app at `localhost:3001`, while
the Saleor containers reach it via `host.docker.internal:3001`. That is why
the config has two base-URL variables — they point at the same port from
different network vantage points.

## Ports and URLs

| Service              | URL                                            | Notes                                                        |
| -------------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| Dummy Payment App    | `http://localhost:3001`                        | `pnpm dev:local` (Next.js on the host)                       |
| Saleor API (GraphQL) | `http://api.childnest.co.uk:8080/graphql/`     | via Traefik; must match the platform's `PUBLIC_URL`          |
| Dashboard            | `http://dashboard.childnest.co.uk:8080/`       | via Traefik; embeds the app iframe at `APP_IFRAME_BASE_URL`  |
| Traefik              | `:8080` → `:80`, `:8443` → `:443`              | all local routing runs on HTTP `:8080`                       |

The Windows hosts file maps the `*.childnest.co.uk` domains to `127.0.0.1`
(see the `saleor-platform` repo docs for setup).

> [!NOTE]
> The SMTP app in this monorepo runs on port **3002** (`pnpm dev:local`
> there) so both apps can run side by side. Don't mix the ports up when
> copying configuration between the two apps.

## Running the app

```sh
pnpm install
cp .env.local.docker.example .env.local   # once; already committed values work as-is
pnpm dev:local                            # Next.js dev server on http://localhost:3001
```

Sanity checks once it is up:

```sh
curl -sI http://localhost:3001/                 # 200
curl -s  http://localhost:3001/api/manifest     # manifest JSON: appUrl/tokenTargetUrl must use the right base URLs
```

In the manifest response, confirm:

- `appUrl` = `http://localhost:3001` (browser-facing),
- `tokenTargetUrl` = `http://host.docker.internal:3001/api/register`,
- every webhook `targetUrl` starts with `http://host.docker.internal:3001`.

## Environment

The full commented reference is
[`.env.local.docker.example`](../.env.local.docker.example) — copy it to
`.env.local`. The only two settings that matter for this setup:

| Variable              | Value (local)                      | Purpose                                                                                     |
| --------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `APP_IFRAME_BASE_URL` | `http://localhost:3001`            | **Browser → app.** Manifest `appUrl`: where the Dashboard iframe loads the app UI           |
| `APP_API_BASE_URL`    | `http://host.docker.internal:3001` | **Saleor container → app.** Manifest `tokenTargetUrl` (registration) and webhook target URLs |

Getting one of the two base URLs wrong is the most common local breakage:

- wrong `APP_IFRAME_BASE_URL` → the Dashboard cannot load the app iframe at
  all;
- wrong `APP_API_BASE_URL` → Saleor cannot call `/api/register` and webhooks
  never arrive (payments silently stop working).

When either is unset the app falls back to the request `Host` header (the
manifest's `appBaseUrl`). That is correct for tunnel-based (ngrok)
development against a cloud instance, but **wrong** for Docker, because the
`Host` the browser sends is not reachable from the containers.

All other variables (`APL`, `ALLOWED_DOMAIN_PATTERN`, DynamoDB, cron,
logging) are optional for local development — the working setup uses only
the two base URLs and the default file APL.

## Platform side (`saleor-platform` repo)

The values the app depends on are set in the platform's `.env`:

- `PUBLIC_URL=http://api.childnest.co.uk:8080/` — Saleor's own URL. At
  installation Saleor calls the app's `tokenTargetUrl` with
  `saleor-api-url` = `PUBLIC_URL` + `graphql/`.
- `DASHBOARD_API_URL=http://api.childnest.co.uk:8080/graphql/` — baked into
  the Dashboard image. This is the exact string the Dashboard sends in
  `saleor-api-url` on every tRPC call. It must equal the `saleorApiUrl`
  stored in the app's APL, or every call 401s with `Missing auth data`
  (see [troubleshooting.md](troubleshooting.md)).
- `HTTP_IP_FILTER_ENABLED=False` (platform `common.env`) — otherwise the
  app's server-side GraphQL calls from the host would be rejected by the API.
