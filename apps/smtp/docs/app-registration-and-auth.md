# App registration and authentication

## Two different tokens

| Token                                       | Who holds it                                                                  | Where it is used                                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **App token** (`token { name: "Default" }`) | Stored by the app in the APL (`.saleor-app-auth.json`)                        | The app calls the Saleor API _as the app_: webhook sync, configuration, `app { ... }` queries |
| **Dashboard user JWT**                      | Passed by the Dashboard in the `authorization-bearer` header of every request | Verified by the tRPC auth middleware (JWKS signature, expiry, `app` claim, permissions)       |

They are independent. Which one fails is told directly by the 401 message.

## tRPC auth pipeline

Middleware order in `src/modules/trpc/`:

1. **`attachAppToken`** — looks up the APL by **exact match of the `saleor-api-url` header** (string equality). Failure: `401 "Missing auth data"`.
2. **`validateClientToken`** — verifies the Dashboard user JWT: JWKS signature, `exp`, the `app` claim must equal the app ID from step 1, and `user_permissions` must contain `MANAGE_APPS` (`REQUIRED_SALEOR_PERMISSIONS` in `packages/shared/src/permissions.ts`). Failure: `401 "JWT verification failed"`.
3. **Configuration services** — load the SMTP configuration (`protected-client-procedure-with-services.ts`), which also syncs webhook status.

## FileAPL

- File: `apps/smtp/.saleor-app-auth.json` (gitignored; `APL=file`, see `src/saleor-app.ts`).
- **Single installation only**: `get(saleorApiUrl)` returns the stored data only on
  **exact string equality** with the stored `saleorApiUrl` — trailing slash included.
  Any other URL resolves to `undefined`.
- Stores: `token` (app token), `saleorApiUrl`, `appId`, `jwks`.
- The file is re-read on every request, so edits/re-registration apply without a
  server restart.

## Registration

Saleor calls the manifest's `tokenTargetUrl` (`POST ${APP_API_BASE_URL}/api/register`)
during installation:

- header `saleor-api-url` — the instance URL **from Saleor's perspective**
  (`PUBLIC_URL` + `graphql/`), validated against `ALLOWED_DOMAIN_PATTERN`;
- body: `{"auth_token": "<app token>"}`.

The handler (`src/pages/api/register.ts`) then:

1. validates the `saleor-api-url` against `ALLOWED_DOMAIN_PATTERN`;
2. verifies the token against the API (resolves `appId`);
3. fetches JWKS from `${origin}/.well-known/jwks.json`;
4. checks the live Saleor version against `REQUIRED_SALEOR_VERSION`
   (`>=3.22 <3.24`, in `src/saleor-app.ts`);
5. saves `{ token, saleorApiUrl, appId, jwks }` to the APL.

Success response: `200 {"success": true}`.

## Re-registration procedure

Use when the stored `saleorApiUrl` no longer matches the instance the Dashboard
talking to (e.g. the instance moved behind Traefik, or `DASHBOARD_API_URL`
changed). This replays the normal install handshake with the app's own still-valid
token — it is **not** an auth bypass: the token is re-verified against the API.

1. Back up `apps/smtp/.saleor-app-auth.json`.
2. Read the current app token from the file's `token` field (Dashboard
   → Apps → SMTP → Tokens works too).
3. Send the registration request (Postman, curl, or any HTTP client):

   Request:

   ```
   POST http://localhost:3002/api/register
   Content-Type: application/json
   saleor-api-url: http://api.childnest.co.uk:8080/graphql/
   saleor-schema-version: 3.23
   ```

   Body (raw JSON):

   ```json
   { "auth_token": "<app token from .saleor-app-auth.json>" }
   ```

   - `saleor-api-url` must be the URL the **Dashboard** uses (the platform's
     `DASHBOARD_API_URL`), because that is the value the APL is matched against
     on every subsequent tRPC call. It must also match `ALLOWED_DOMAIN_PATTERN`.
   - `saleor-schema-version` is optional (used for version reporting only).

4. Expected: `200 {"success": true}`.
5. Check `.saleor-app-auth.json`: `saleorApiUrl` now equals the header value and
   `jwks` is refreshed. No restart needed.
6. Verify end-to-end with the probes in [troubleshooting.md](troubleshooting.md).

## HTTP headers quick reference

| Header                              | Sent by                             | Meaning                                             |
| ----------------------------------- | ----------------------------------- | --------------------------------------------------- |
| `saleor-api-url`                    | Saleor (register), Dashboard (tRPC) | exact GraphQL endpoint string                       |
| `authorization-bearer`              | Dashboard (tRPC)                    | user JWT scoped to this app                         |
| `saleor-schema-version`             | Saleor, Dashboard                   | Saleor schema version as string, e.g. `3.23`        |
| `saleor-event` / `saleor-signature` | Saleor (webhooks)                   | event type + JWT signature for webhook verification |
