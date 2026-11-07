# Local development

Running the SMTP app against the local Saleor stack (Docker + Traefik, project
`saleor-platform`). The app runs **on the host** (Windows) via `pnpm dev:local`;
Saleor's API, Dashboard and workers run **in Docker** behind Traefik.

## Topology

```
Browser ──> http://dashboard.childnest.co.uk:8080   (Dashboard, in Docker, via Traefik)
              └─ iframe ──> http://localhost:3002   (SMTP app, on host)

Saleor api/worker (in Docker) ──> http://host.docker.internal:3002   (same SMTP app, on host)
```

Two paths, one app: the browser reaches the app at `localhost:3002`, while the
Saleor containers reach it via `host.docker.internal:3002`. That is why the
config has two base-URL variables (below) — they point at the same port from
different network vantage points.

## Ports and URLs

| Service              | URL                                                            | Notes                                                       |
| -------------------- | -------------------------------------------------------------- | ----------------------------------------------------------- |
| SMTP app (dev)       | `http://localhost:3002`                                        | `pnpm dev:local` (Next.js on the host)                      |
| Saleor API (GraphQL) | `http://api.childnest.co.uk:8080/graphql/`                     | via Traefik; must match the platform's `PUBLIC_URL`         |
| Dashboard            | `http://dashboard.childnest.co.uk:8080/`                       | via Traefik; embeds the app iframe at `APP_IFRAME_BASE_URL` |
| Mailpit (SMTP sink)  | `http://mailpit.childnest.co.uk:8080/`                         | verify test emails land here                                |
| Traefik              | `:8080` → `:80`, `:8443` → `:443`, `:8081` → Traefik dashboard | all app routing currently runs on HTTP `:8080`              |

The Windows hosts file maps the `*.childnest.co.uk` domains to `127.0.0.1`
(see `saleor-platform/docs/production-traefik.md` for setup).

## Environment

Copy `apps/smtp/.env.local.docker.example` to `apps/smtp/.env.local` and fill
in `SECRET_KEY`. Key variables:

| Variable                 | Value (local)                      | Purpose                                                                                                                                      |
| ------------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `APL`                    | `file`                             | auth state stored in `.saleor-app-auth.json` (single installation, gitignored)                                                               |
| `APP_IFRAME_BASE_URL`    | `http://localhost:3002`            | **Browser → app.** Manifest `appUrl`: where the Dashboard iframe loads the app                                                               |
| `APP_API_BASE_URL`       | `http://host.docker.internal:3002` | **Saleor container → app.** Manifest `tokenTargetUrl` (registration), webhook target URLs, and the tRPC context `baseUrl` (since `7863b3da`) |
| `ALLOWED_DOMAIN_PATTERN` | `/*/`                              | regex the `saleor-api-url` registration header must match                                                                                    |

Getting one of the two base URLs wrong is the most common local breakage:

- wrong `APP_IFRAME_BASE_URL` → the Dashboard cannot load the app iframe at all;
- wrong `APP_API_BASE_URL` → Saleor cannot call `/api/register` and webhooks
  never arrive (emails silently stop).

When either is unset the app falls back to the request `Host` header (the
manifest's `appBaseUrl`). That is correct for tunnel-based (ngrok) development
against a cloud instance, but **wrong** for Docker, because the `Host` the
browser sends is not reachable from the containers.

## Platform side (`saleor-platform` repo)

The values the app depends on are set in the platform's `.env`:

- `PUBLIC_URL=http://api.childnest.co.uk:8080/` — Saleor's own URL. At
  installation Saleor calls the app's `tokenTargetUrl` with
  `saleor-api-url` = `PUBLIC_URL` + `graphql/`.
- `DASHBOARD_API_URL=http://api.childnest.co.uk:8080/graphql/` — baked into
  the Dashboard image. This is the exact string the Dashboard sends in
  `saleor-api-url` on every tRPC call. It must equal the `saleorApiUrl` stored
  in the app's APL, or every call 401s with `Missing auth data`
  (see [troubleshooting.md](troubleshooting.md)).
- `HTTP_IP_FILTER_ENABLED=False` (platform `common.env`) — otherwise the app's server-side GraphQL
  calls from the host would be rejected by the API.
