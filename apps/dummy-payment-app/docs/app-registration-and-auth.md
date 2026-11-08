# App installation, registration, and configuration

How the Dummy Payment App is installed in the local Saleor Dashboard, how it
authenticates, which permissions and webhooks it needs, and how the payment
gateway shows up on channels.

## App identity

| Property       | Value                                        |
| -------------- | -------------------------------------------- |
| Name           | `Dummy Payment App`                          |
| Gateway ID     | `saleor.io.dummy-payment-app` (`src/lib/gateway-id.ts`) |
| Version        | `1.3.2` (`package.json`)                     |
| Manifest       | `GET /api/manifest`                          |
| Register       | `POST /api/register` (`tokenTargetUrl`)      |

## Required permissions (declared in the manifest)

- `MANAGE_CHECKOUTS` — create/update checkouts from the app's Dashboard UI
- `HANDLE_CHECKOUTS` — set delivery on checkouts from the app UI
- `HANDLE_PAYMENTS` — initialize/process transactions
- `MANAGE_ORDERS` — order-level transaction actions (refunds, charges)

The Dashboard user opening the app must be staff; the app's tRPC layer only
needs the app token (unlike the SMTP app, this app does not verify the
Dashboard user JWT).

## Webhooks (declared in the manifest, created at installation)

All six are declared in `src/pages/api/manifest.ts` and created by Saleor
during installation, with `targetUrl` derived from `APP_API_BASE_URL`:

| Webhook                              | Purpose                                              |
| ------------------------------------ | ---------------------------------------------------- |
| `PAYMENT_GATEWAY_INITIALIZE_SESSION` | advertise the gateway to `availablePaymentGateways`  |
| `TRANSACTION_INITIALIZE_SESSION`     | respond to `transactionInitialize` (sync)            |
| `TRANSACTION_PROCESS_SESSION`        | respond to `transactionProcess` (sync)               |
| `TRANSACTION_REFUND_REQUESTED`       | handle `REFUND` from the Dashboard (async)           |
| `TRANSACTION_CHARGE_REQUESTED`       | handle `CHARGE` from the Dashboard (async)           |
| `TRANSACTION_CANCELATION_REQUESTED`  | handle `CANCEL` from the Dashboard (async)           |

Check their target URLs any time in Dashboard → Apps → Dummy Payment App →
Webhooks — they must all start with `http://host.docker.internal:3001` in
this setup. If you change the app port, re-install the app (or edit the
targets) so the manifest-declared URLs track it.

## Registration and authentication

### Two different tokens

| Token            | Who holds it                                              | Where it is used                                                     |
| ---------------- | --------------------------------------------------------- | -------------------------------------------------------------------- |
| **App token**    | Stored by the app in the APL (`.saleor-app-auth.json`)    | The app calls the Saleor API _as the app_: webhooks, app Dashboard UI |
| **Dashboard user JWT** | Passed by the Dashboard in `authorization-bearer`    | Forwarded to tRPC; this app does not re-verify it (relies on the app token) |

### FileAPL

- File: `apps/dummy-payment-app/.saleor-app-auth.json` (gitignored;
  `APL=file` is the default, `src/saleor-app.ts`).
- **Single installation only**: the APL lookup on every tRPC call is an
  **exact string equality** match of the `saleor-api-url` header against the
  stored `saleorApiUrl` — trailing slash included. Any mismatch fails with
  `401 "Missing auth data"` before anything else is checked.
- Stores: `token` (app token), `saleorApiUrl`, `appId`, `jwks`.
- The file is re-read on every request, so edits/re-registration apply
  without a server restart.
- Never commit this file or copy its contents into docs/env files.

### Installation flow (verified in this setup)

1. Start the app: `pnpm dev:local` (port 3001).
2. Dashboard → Apps → **Add app** → Custom app → manifest URL:
   `http://localhost:3001/api/manifest` (browser-facing — the Dashboard
   fetches the manifest from your browser, so it must be a `localhost` URL,
   not `host.docker.internal`).
3. Saleor calls `POST http://host.docker.internal:3001/api/register` with
   headers `saleor-api-url: http://api.childnest.co.uk:8080/graphql/`
   (the platform `PUBLIC_URL` + `graphql/`) and body
   `{"auth_token": "<app token>"}`. The handler re-verifies the token
   against the API and writes the APL file.
4. Saleor creates the six webhooks with `host.docker.internal:3001` targets
   and grants the four permissions.
5. Result in `.saleor-app-auth.json` (verified values):
   `saleorApiUrl: http://api.childnest.co.uk:8080/graphql/`,
   `appId: QXBwOjEw`.

### Re-registration procedure

Use when the stored `saleorApiUrl` no longer matches the instance the
Dashboard talks to (e.g. `DASHBOARD_API_URL` changed). This replays the
normal install handshake with the app's own still-valid token — it is **not**
an auth bypass: the token is re-verified against the API.

1. Back up `apps/dummy-payment-app/.saleor-app-auth.json`.
2. Read the current app token from the file's `token` field (Dashboard →
   Apps → Dummy Payment App → Tokens works too).
3. Send the registration request:

   ```
   POST http://localhost:3001/api/register
   Content-Type: application/json
   saleor-api-url: http://api.childnest.co.uk:8080/graphql/
   ```

   Body (raw JSON):

   ```json
   { "auth_token": "<app token from .saleor-app-auth.json>" }
   ```

   The `saleor-api-url` must be the URL the **Dashboard** uses (the platform
   `DASHBOARD_API_URL`), because that is the value the APL is matched against
   on every subsequent tRPC call.
4. Expected: `200` and the APL file rewritten. No restart needed.

## Channel and payment gateway configuration

No extra channel setup is needed: once the app is installed, Saleor's
webhook plugin advertises the gateway automatically. Verified in this setup:

- Channel `default-channel` (USD): `availablePaymentGateways` includes
  `{ id: "saleor.io.dummy-payment-app", name: "Dummy Payment App",
  currencies: ["USD"] }` plus the built-in
  `saleor.io.gift-card-payment-gateway`.
- Channel `channel-pln` (PLN): same, with `currencies: ["PLN"]` — the
  gateway's currency follows the channel currency.

The gateway only appears for channels where the app's webhooks are active;
if it vanishes from `availablePaymentGateways`, check webhook `isActive` and
target reachability (see [troubleshooting.md](troubleshooting.md)).

## Storefront integration and checkout testing

### From the app's own Dashboard UI

The app ships a built-in checkout tester (Dashboard → Dummy Payment App):

1. Select a channel → **Create checkout**
2. **Set delivery** (shipping method)
3. Choose the response the app should return for
   `TRANSACTION_INITIALIZE_SESSION` (event type, e.g. `CHARGE_SUCCESS`,
   `includePspReference`)
4. **Initialize transaction** → wait for the response
5. **Complete checkout** → `checkoutComplete` creates the order

### From a real storefront (Saleor Paper)

The Paper storefront calls, in order:

1. `transactionInitialize(checkoutId, paymentGateway, amount)` — no `action`
   arg (the channel's default `TransactionFlowStrategy` applies; passing
   `action` explicitly requires `HANDLE_PAYMENTS` on the caller)
2. `checkoutComplete(checkoutId)` — only after the transaction is approved

The storefront's dummy-gateway client code is gated on
`isDummyPaymentAllowed()` — see
[troubleshooting.md → "No payment gateway configured"](troubleshooting.md#no-payment-gateway-configured-despite-saleor-returning-the-dummy-gateway)
for the build-time env requirement.

## End-to-end payment verification

Verified against this local stack (all steps below succeeded):

1. **Gateway advertised** — `checkoutCreate` on `default-channel` returns
   `availablePaymentGateways` containing `saleor.io.dummy-payment-app`.
2. **Transaction initialized** — unauthenticated
   `transactionInitialize` (no `action`) returns
   `transactionEvent.type: "CHARGE_SUCCESS"`,
   `message: "Great success!"`, `actions: ["REFUND"]`, no errors.
3. **Order created** — after setting shipping + billing addresses
   (`AddressInput` for US requires `countryArea`, e.g. `"NY"`) and shipping
   method, `checkoutComplete` returns a new order (`status: UNFULFILLED`).
4. **Refund from Dashboard** — Dashboard → Orders → order → Transactions →
   REFUND: the app's `TRANSACTION_REFUND_REQUESTED` webhook runs and the
   transaction state updates in the order.

A minimal raw check you can run any time (no storefront involved):

```sh
# 1) create a checkout (variantId from Dashboard → Products)
curl -s http://api.childnest.co.uk:8080/graphql/ -H 'Content-Type: application/json' -d '{
  "query": "mutation { checkoutCreate(input: { lines: [{quantity: 1, variantId: \"UHJvZHVjdFZhcmlhbnQ6MzU4\"}], email: \"pay-test@example.com\", channel: \"default-channel\" }) { checkout { id } errors { message } } }"
}'

# 2) initialize the transaction on that checkout token/id
curl -s http://api.childnest.co.uk:8080/graphql/ -H 'Content-Type: application/json' -d '{
  "query": "mutation($id: ID!) { transactionInitialize(id: $id, paymentGateway: {id: \"saleor.io.dummy-payment-app\", data: {event: {includePspReference: true, type: \"CHARGE_SUCCESS\"}}}) { transactionEvent { type message } errors { message } }",
  "variables": { "id": "<checkout id from step 1>" }
}'
```

Expected: `CHARGE_SUCCESS` / `Great success!` and an empty `errors` array.
