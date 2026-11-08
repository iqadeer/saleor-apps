# Troubleshooting

Problems hit and fixed while setting up this integration are marked
**[encountered]**; the rest are general guidance for the same symptom space.

## "No payment gateway configured" despite Saleor returning the dummy gateway

**[encountered]**

**Symptom**: the storefront checkout shows the amber alert *No payment
gateway configured*, yet a direct `checkoutCreate` query against Saleor
returns `availablePaymentGateways` including `saleor.io.dummy-payment-app`.
The backend is fine — the problem is **client-side filtering in the
storefront** (verified end-to-end: transaction initialized, order created,
while the storefront still showed the alert).

### Root cause (Paper storefront, fixed in commit `d421e605`)

- `isDummyPaymentAllowed()` runs in the **client bundle**. Client code can
  only see `NEXT_PUBLIC_*` variables.
- `NEXT_PUBLIC_*` variables are **inlined at build time** by Next.js — the
  value baked into the image is fixed forever after the build; changing a
  runtime env var later has no effect on already-built client code.
- The storefront Dockerfile only declared runtime env, so
  `NEXT_PUBLIC_ALLOW_DUMMY_PAYMENT` was `undefined` in the client bundle and
  the dummy gateways were filtered out. The only remaining gateway was the
  built-in gift-card one, which the storefront deliberately ignores
  (`IGNORABLE_GATEWAY_IDS`), leaving zero substantive gateways.
- Setting only the **runtime** `ALLOW_DUMMY_PAYMENT=true` is **not
  sufficient**: it covers the server-side payment action guard, but the
  client-side gateway filter only sees `NEXT_PUBLIC_ALLOW_DUMMY_PAYMENT`
  (inlined at build) or `NODE_ENV === "development"`.

### The fix (storefront-paper repo)

- The Dockerfile must declare the build argument **and** expose it in the
  builder stage:

  ```dockerfile
  ARG NEXT_PUBLIC_ALLOW_DUMMY_PAYMENT
  ENV NEXT_PUBLIC_ALLOW_DUMMY_PAYMENT=${NEXT_PUBLIC_ALLOW_DUMMY_PAYMENT}
  ```

- Compose must pass the value from `.env`:

  ```yaml
  build:
    args:
      NEXT_PUBLIC_ALLOW_DUMMY_PAYMENT: ${NEXT_PUBLIC_ALLOW_DUMMY_PAYMENT}
  ```

- Then **rebuild the image** — no amount of `docker compose restart` re-runs
  the client inlining. Verify the flag made it into the client bundle:

  ```sh
  docker compose exec storefront sh -c \
    'grep -rl "ALLOW_DUMMY_PAYMENT" .next/static/chunks | head -1' | \
    xargs -I{} docker compose exec storefront sh -c \
    'grep -o "ALLOW_DUMMY_PAYMENT||[^;]\{1,12\}" {}'
  ```

  `!0` (minified `true`) after the `||` means the flag is inlined.

### Troubleshooting steps for this symptom

1. Confirm the API side first — `checkoutCreate` and read
   `availablePaymentGateways`. If the gateway is **absent here**, this is a
   Saleor/app problem (webhooks, see below), not a storefront problem.
2. If the gateway **is present** but filtered out, the client flag is the
   cause:
   - dev server (`pnpm dev`) → the flag defaults to allowed
     (`NODE_ENV === "development"`); the problem only exists in production
     images;
   - production image → check the inlined bundle (command above);
   - if missing from the bundle → the build didn't receive
     `NEXT_PUBLIC_ALLOW_DUMMY_PAYMENT` → fix Dockerfile/compose and
     **rebuild**.
3. After the rebuild, reload the checkout — the dummy gateway and Pay button
   appear, and the server-side guard (runtime `ALLOW_DUMMY_PAYMENT=true`)
   already passes.

## Wrong manifest, iframe, or app API URLs

**[encountered]** (class of problem; the working values are documented)

Three different URLs are involved and they are easy to cross:

| URL                      | Consumed by            | Must be reachable from        | Working local value                |
| ------------------------ | ---------------------- | ----------------------------- | ---------------------------------- |
| Manifest URL             | Dashboard (browser)    | the **browser**               | `http://localhost:3001/api/manifest` |
| `APP_IFRAME_BASE_URL`    | Dashboard iframe (browser) | the **browser**           | `http://localhost:3001`            |
| `APP_API_BASE_URL`       | Saleor containers      | **inside the Saleor containers** | `http://host.docker.internal:3001` |

Symptoms per mistake:

- manifest URL uses `host.docker.internal` and the browser can't resolve it
  → "Add app" fails to fetch the manifest (on Docker Desktop for Windows the
  hostname often resolves on the host too, so it can *accidentally* work —
  still use `localhost` in the browser);
- `APP_IFRAME_BASE_URL` wrong → empty/broken iframe, app UI never loads,
  but installation and webhooks all work;
- `APP_API_BASE_URL` wrong (e.g. `localhost:3001`) → installation fails at
  `tokenTargetUrl`, or (if the app was registered earlier) **all webhooks
  silently stop arriving** — `transactionInitialize` errors out with a
  timeout/no-response and payments fail while everything looks configured.

Check the manifest response any time:

```sh
curl -s http://localhost:3001/api/manifest | grep -o '"\(appUrl\|tokenTargetUrl\)":"[^"]*"'
```

## `localhost` vs `host.docker.internal` networking

**[encountered]**

- From the **host and the browser**: use `localhost:3001`.
- From **inside a Saleor container**: `localhost` is the container itself —
  always use `host.docker.internal:3001`.
- Docker Desktop (Windows/macOS) provides `host.docker.internal` by default.
  Linux needs `extra_hosts: ["host.docker.internal:host-gateway"]` in
  `docker-compose`.
- Quick reachability test from inside the containers:

  ```sh
  docker exec saleor-platform-api-1 python -c \
    "import urllib.request;print(urllib.request.urlopen('http://host.docker.internal:3001/').status)"
  ```

  Expected: `200`.

## App registration and authentication failures

**[encountered]** (same mechanism as the SMTP app)

### `401 "Missing auth data"` on tRPC calls from the app UI

The tRPC `attachAppToken` middleware looks up the APL by **exact string
match** of the `saleor-api-url` header against the stored `saleorApiUrl`.
Any difference — different domain, changed `DASHBOARD_API_URL`, missing
trailing slash — makes the lookup return `undefined` and the call 401s.

1. Compare `saleorApiUrl` in `apps/dummy-payment-app/.saleor-app-auth.json`
   with the platform's `DASHBOARD_API_URL` (`saleor-platform/.env`) —
   they must be **byte-for-byte** equal.
2. If they differ → re-register per
   [app-registration-and-auth.md → Re-registration procedure](app-registration-and-auth.md#re-registration-procedure).
   No code change; only the gitignored APL file is rewritten.
3. Sanity check the app is up: `curl -sI http://localhost:3001/` → 200.

### Installation rejected at `POST /api/register`

- `ALLOWED_DOMAIN_PATTERN` set to a regex the `saleor-api-url` doesn't match
  (the working local setup leaves it unset = allow all).
- The app isn't reachable at `APP_API_BASE_URL` from the containers (see
  networking above).
- Token invalid — the app re-verifies it against the API at registration;
  a deleted/rotated app token must be regenerated and the app re-registered.

## Webhook connectivity and payment initialization failures

**[encountered]** (gateway listing) / **[general]** (the rest)

- Gateway **missing** from `availablePaymentGateways` → the
  `PAYMENT_GATEWAY_INITIALIZE_SESSION` / `TRANSACTION_INITIALIZE_SESSION`
  webhooks aren't answering:
  1. Dashboard → Apps → Dummy Payment App → Webhooks: all six `isActive`?
     Target URLs `http://host.docker.internal:3001/...`?
  2. Is the app dev server actually running? (`curl -sI http://localhost:3001/`)
  3. Re-install the app if the port ever changed (webhooks are created from
     the manifest at installation).
- `transactionInitialize` returns `errors` with a network/timeout message →
  the `TRANSACTION_INITIALIZE_SESSION` webhook target is unreachable from
  the Saleor containers (same two checks as above).
- `transactionInitialize` errors `PERMISSION_DENIED` mentioning the `action`
  argument → passing `action` explicitly requires `HANDLE_PAYMENTS` on the
  **caller**; storefront checkouts don't pass `action` and use the channel's
  default `TransactionFlowStrategy` (verified working unauthenticated).
- App responds but the event is `CHARGE_FAILURE`/validation error → the
  `data` field shape is wrong; expected:
  `data: { event: { includePspReference: boolean, type: "<TransactionEventTypeEnum>" } }`
  (see the README "Modifying response via `data` field").
- Turn up app logging (`APP_LOG_LEVEL=debug`, or
  `LOG_SALEOR_OPERATIONS=true` for Saleor GraphQL calls) to see signature or
  processing errors in the dev server console.

## Channel / payment gateway configuration

- The gateway appears per channel automatically; the reported `currencies`
  follow the **channel currency** (verified: `["USD"]` on `default-channel`,
  `["PLN"]` on `channel-pln`).
- An inactive channel listing or a channel without products won't produce a
  checkout to test with — but neither hides the gateway from a channel that
  has the app installed.
- The built-in `saleor.io.gift-card-payment-gateway` also appears on
  channels; the Paper storefront ignores it by design (see the
  "No payment gateway configured" section) — don't read its presence as the
  dummy app being broken.

## Build-time vs runtime environment variables

**[encountered]** (storefront side — the full story is in the first
section)

- `NEXT_PUBLIC_*` vars: inlined into client bundles **at build time**.
  Runtime changes after the image exists do nothing until rebuild.
- Non-prefixed vars (e.g. `ALLOW_DUMMY_PAYMENT`): visible to **server-side
  code at request time** only — fine for guards, invisible to client code.
- For this Saleor app itself, both base-URL vars are read **at request time**
  on the server (the manifest is generated per request), so env changes
  apply after a dev-server restart without any rebuild.
- Rule of thumb: if a flag controls **client-rendered behavior**, it must be
  `NEXT_PUBLIC_*` **and** present at build time; otherwise runtime env is
  enough.
