# Troubleshooting

## `401 "Missing auth data"` on every tRPC call

**Symptom**: the app iframe loads, but every configuration call fails in the
Dashboard with `UNAUTHORIZED: Missing auth data` (HTTP 401).

### Root cause

The tRPC `attachAppToken` middleware looks up the APL by **exact string match**
of the `saleor-api-url` header. The Dashboard sends the URL baked into its build
(`DASHBOARD_API_URL` from the platform `.env`); the FileAPL compares it to the
`saleorApiUrl` stored at registration time. Any mismatch —
`localhost:8001/graphql/` vs `api.childnest.co.uk:8080/graphql/`, a changed
domain, even a missing trailing slash — makes the lookup return `undefined` and
the call 401s **before the user JWT is ever examined**.

Typical triggers:

- the Saleor instance moved behind Traefik / to a new domain after the app was
  registered;
- `PUBLIC_URL` / `DASHBOARD_API_URL` in the platform `.env` were changed;
- the app was registered against a different local URL than the Dashboard uses.

Note: the `authorization-bearer` header being present does **not** mean
authentication is progressing — it is consumed by the _second_ middleware
(`validateClientToken`), which never runs while step 1 fails.

### Diagnosis

1. `saleorApiUrl` in `apps/smtp/.saleor-app-auth.json`.
2. The `saleor-api-url` the Dashboard sends: platform `.env` →
   `DASHBOARD_API_URL`, or DevTools → Network → any tRPC request → Request
   Headers.
3. If the two differ → that is the cause.
4. Sanity check the app itself is up: `GET http://localhost:3002/` → 200.

### Fix

Re-register per [app-registration-and-auth.md → Re-registration procedure](app-registration-and-auth.md#re-registration-procedure).
No code change is involved; only the gitignored APL file is rewritten.

### Verification

1. `.saleor-app-auth.json`'s `saleorApiUrl` now equals `DASHBOARD_API_URL`
   byte-for-byte.
2. Probe a tRPC route with a dummy user JWT. The error must **move to the second
   middleware** — that is the expected failure for a fake token:

   ```bash
   curl -s "http://localhost:3002/api/trpc/smtpConfiguration.isFallbackSmtpConfigured" \
     -H "saleor-api-url: http://api.childnest.co.uk:8080/graphql/" \
     -H "authorization-bearer: dummy-token"
   ```

   - `Missing auth data` → APL lookup still failing (URL mismatch or stale file).
   - `JWT verification failed` → expected at this stage; with a real Dashboard
     session the JWT passes and data is returned.

3. Reload the SMTP app in the Dashboard with a real login — the configuration
   UI loads without 401s.

## AppBridge "secure context" errors (HTTP Dashboard)

**Symptom**: opening the app from the Dashboard throws AppBridge /
`crypto.randomUUID` console errors; the app UI cannot fetch its configuration.
`http://dashboard.childnest.co.uk:8080` is plain HTTP on a non-localhost
origin, so the browser does not treat it as a secure context and blocks the
WebCrypto APIs AppBridge relies on.

- **Temporary workaround** — launch Chrome with the flag (fine for a local
  machine; do not put on shared systems):

  ```
  chrome.exe --unsafely-treat-insecure-origin-as-secure=http://dashboard.childnest.co.uk:8080
  ```

- **Proper fix** — serve the Dashboard over HTTPS through Traefik. The platform
  repo's local mode is already prepared for it (mkcert certificate covering the
  `*.childnest.co.uk` domains, TLS dynamic config — see
  `saleor-platform/docs/production-traefik.md`). Once the Dashboard is on HTTPS,
  update the platform `PUBLIC_URL` / `DASHBOARD_API_URL` to the HTTPS URLs and
  **re-register the app once** (the stored `saleorApiUrl` changes with them).

## Webhooks registered but no email arrives

1. Check the webhook `targetUrl`s (Dashboard → Apps → SMTP → Webhooks). They
   must be reachable **from inside the Saleor container**:
   `http://host.docker.internal:3002/api/webhooks/...` — not
   `http://localhost:3002/...`, which only works from the browser.
   - Webhooks created via the Dashboard UI derive the target from the tRPC
     context `baseUrl` — `APP_API_BASE_URL` when set, otherwise the browser's
     `Host` header (wrong for Docker; fixed in `7863b3da`).
   - Manifest-declared webhooks use `APP_API_BASE_URL` (falling back to the request `Host` when unset).
2. Check Mailpit (`http://mailpit.childnest.co.uk:8080/`) for rejected or
   undelivered mail — bad SMTP host/credentials show up there.
3. Turn up app logging (`APP_LOG_LEVEL=debug`) to see webhook signature and
   processing errors.

## `401 "JWT verification failed"` (auth data itself is fine)

Step 1 passed; the user JWT did not:

- expired → log out/in again in the Dashboard;
- `app` claim mismatch → the token belongs to a different installation;
  re-register (see above);
- missing permission → the Dashboard user must have `MANAGE_APPS` (staff).
