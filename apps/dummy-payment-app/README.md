<div align="center">
<img width="150" alt="saleor-app-template" src="https://github.com/saleor/dummy-payment-app/blob/main/public/logo.png?raw=true">
</div>

<div align="center">
  <h1>Dummy Payment App</h1>
</div>

<div align="center">
  <p>Bare-bones app for testing Saleor's <a href="https://docs.saleor.io/docs/developer/payments#payment-app">Transactions API</a></p>
</div>

<div align="center">
  <a href="https://saleor.io/">Website</a>
  <span> | </span>
  <a href="https://docs.saleor.io/docs/3.x/">Docs</a>
</div>

> [!TIP]
> Questions or issues? Check our [discord](https://discord.gg/H52JTZAtSH) channel for help.

### What is Dummy Payment App?

The Dummy Payment App allows you to test Saleor's payment and checkout features without needing to set up a real payment provider. You can create orders, process payments, issue refunds, and more, all within the Saleor Dashboard.

### App features

- Create new checkouts and orders from the Saleor Dashboard:

![Dummy Payment App has UI in Saleor dashboard for creating new orders from checkouts with Transactions](docs/1_checkout.jpeg)

- Process payments and update transaction statuses:

![Dummy Payment App has UI in Saleor dashboard for updating Transactions](docs/2_event_reporter.jpeg)

> [!TIP]
> Each Transaction has `externalUrl` that links to this page from Order details page in Saleor Dashboard:

- Issue refunds, process charges and cancellations for Transactions

### How does it work?

The Dummy Payment App supports the following webhooks to enable payment flows:

The app implements webhooks to process payments initiated from your storefront:

- `PAYMENT_GATEWAY_INITIALIZE_SESSION`
- `TRANSACTION_INITIALIZE_SESSION`
- `TRANSACTION_PROCESS_SESSION`

It also implements webhooks to allow updating the status of Transactions from the Saleor Dashboard, similar to how a real third-party payment provider would:

- `TRANSACTION_REFUND_REQUESTED`
- `TRANSACTION_CHARGE_REQUESTED`
- `TRANSACTION_CANCELATION_REQUESTED`

### Local development and integration (this repository)

This section documents the **verified local setup** for this repository:
the app runs on the host (Windows) with `pnpm dev:local`; Saleor's API,
workers and Dashboard run in Docker behind Traefik (`saleor-platform` repo).
Deeper references: [`docs/local-development.md`](docs/local-development.md),
[`docs/app-registration-and-auth.md`](docs/app-registration-and-auth.md),
[`docs/troubleshooting.md`](docs/troubleshooting.md).

#### 1. Prerequisites

- Node.js 18.17.0 – 20.x and [pnpm](https://pnpm.io/) (`corepack enable pnpm`)
- The local Saleor stack from `saleor-platform` running (API on
  `http://api.childnest.co.uk:8080/graphql/`, Dashboard on
  `http://dashboard.childnest.co.uk:8080/`)
- Docker Desktop (provides `host.docker.internal`; Linux needs
  `extra_hosts: ["host.docker.internal:host-gateway"]`)
- The `*.childnest.co.uk` domains mapped to `127.0.0.1` in the hosts file

#### 2. Environment variables

Copy the tested example (all values in it already work for this stack):

```sh
cp .env.local.docker.example .env.local
```

| Variable              | Value (local)                      | Purpose                                                                        |
| --------------------- | ---------------------------------- | ------------------------------------------------------------------------------ |
| `APP_IFRAME_BASE_URL` | `http://localhost:3001`            | **Browser → app** (manifest `appUrl`; the Dashboard iframe loads the app here) |
| `APP_API_BASE_URL`    | `http://host.docker.internal:3001` | **Saleor container → app** (registration endpoint and all webhook targets)     |

No secrets are needed: the app token arrives from Saleor at registration
time and is stored in the gitignored `.saleor-app-auth.json` (file APL,
single installation, re-read on every request). All other variables
(`APL`, `ALLOWED_DOMAIN_PATTERN`, DynamoDB, cron) are optional locally — see
the fully commented `.env.local.docker.example`.

#### 3. Running the app locally

```sh
pnpm install
pnpm dev:local        # Next.js dev server on http://localhost:3001 (port 3000 with pnpm dev)
```

Verify: `curl -sI http://localhost:3001/` → 200, and
`curl -s http://localhost:3001/api/manifest` shows `appUrl` on
`localhost:3001` and `tokenTargetUrl`/webhook targets on
`host.docker.internal:3001`.

#### 4. Docker-to-host networking: `localhost` vs `host.docker.internal`

The browser reaches the app at `localhost:3001`; the Saleor **containers**
must reach it at `host.docker.internal:3001` — `localhost` inside a
container is the container itself, not your machine. That is the whole
reason two base-URL variables exist. Wrong `APP_IFRAME_BASE_URL` → broken
iframe; wrong `APP_API_BASE_URL` → installation fails or webhooks silently
stop arriving. Details and a reachability test:
[`docs/local-development.md`](docs/local-development.md),
[`docs/troubleshooting.md`](docs/troubleshooting.md).

#### 5. Installing the app in Saleor Dashboard

Dashboard → Apps → **Add app** → Custom app → manifest URL
`http://localhost:3001/api/manifest` (browser-facing). Saleor then calls
`POST http://host.docker.internal:3001/api/register` with the `saleor-api-url`
header (`http://api.childnest.co.uk:8080/graphql/`, derived from the platform
`PUBLIC_URL`) and the app token; the app re-verifies the token and stores
`{ token, saleorApiUrl, appId, jwks }` in `.saleor-app-auth.json`.

#### 6. Permissions and webhooks

Declared in the manifest (granted/created at installation):

- Permissions: `MANAGE_CHECKOUTS`, `HANDLE_CHECKOUTS`, `HANDLE_PAYMENTS`,
  `MANAGE_ORDERS`
- Webhooks: `PAYMENT_GATEWAY_INITIALIZE_SESSION`,
  `TRANSACTION_INITIALIZE_SESSION`, `TRANSACTION_PROCESS_SESSION`,
  `TRANSACTION_REFUND_REQUESTED`, `TRANSACTION_CHARGE_REQUESTED`,
  `TRANSACTION_CANCELATION_REQUESTED` — targets derived from
  `APP_API_BASE_URL`; check them under Dashboard → Apps → Dummy Payment App →
  Webhooks. Full details and the re-registration procedure (when the stored
  `saleorApiUrl` drifts from `DASHBOARD_API_URL` and tRPC calls fail with
  `401 Missing auth data`):
  [`docs/app-registration-and-auth.md`](docs/app-registration-and-auth.md).

#### 7. Channel and payment gateway configuration

None beyond installing the app: the gateway
`saleor.io.dummy-payment-app` ("Dummy Payment App") appears in
`availablePaymentGateways` for every channel, with `currencies` following
the channel currency (verified: `USD` on `default-channel`, `PLN` on
`channel-pln`), alongside the built-in gift-card gateway.

#### 8. Storefront integration and checkout testing

- **App's own UI** (Dashboard → Dummy Payment App): create checkout → set
  delivery → choose the `TRANSACTION_INITIALIZE_SESSION` response (event
  type, e.g. `CHARGE_SUCCESS`) → initialize transaction → complete checkout.
- **Paper storefront**: checkout calls `transactionInitialize` (no `action`
  arg; channel default strategy applies) then `checkoutComplete`. The
  client-side dummy-gateway filter requires
  `NEXT_PUBLIC_ALLOW_DUMMY_PAYMENT` to be **inlined at image build time** —
  see `docs/troubleshooting.md` for the exact fix and symptom (_No payment
  gateway configured_ despite Saleor returning the gateway).

#### 9. End-to-end payment verification (verified against this stack)

1. `checkoutCreate` returns the dummy gateway in `availablePaymentGateways`
2. `transactionInitialize` → `CHARGE_SUCCESS`, `"Great success!"`, no errors
3. `checkoutComplete` → new order (`UNFULFILLED`)
4. Dashboard → order → Transactions → REFUND → `TRANSACTION_REFUND_REQUESTED`
   webhook updates the transaction

Ready-made raw GraphQL commands for steps 1–2 are in
[`docs/app-registration-and-auth.md`](docs/app-registration-and-auth.md).

#### Generic local development (no Docker / tunnels)

If you develop against a tunnelled (ngrok) URL instead of local Docker, no
environment variables are required at all — leave both base URLs unset and
the app falls back to the request `Host` header. See
[Saleor docs about local app development](https://docs.saleor.io/developer/extending/apps/local-app-development).

### Running the app as a Docker container (production)

The app ships with a multi-stage `Dockerfile` (Node 24 alpine, production
build, non-root runner, health check on `/api/manifest`) and a `compose.yml`
for direct-localhost deployment (Stage 1 — no Traefik labels yet; the
container already joins the shared `saleor-proxy-net` network so Stage 2
routing is a compose/network change, not a rebuild):

- Browser (Dashboard iframe): `http://localhost:3001`
- Saleor (registration + webhooks): `http://host.docker.internal:3001`

```
docker compose up -d --build    # build the image + start the container
docker compose ps               # expect "Up ... (healthy)"
```

The image is `admincareout/kidl:saleor-app-dummy-payment-1.0`; the container
listens on port `3000` internally, mapped to host port `3001`.

#### How the build is assembled: context, Dockerfile and ignore file

Three files in `apps/dummy-payment-app/` work together:

| File                      | Role                                                                              |
| ------------------------- | --------------------------------------------------------------------------------- |
| `Dockerfile`              | Multi-stage build (base → build → runner).                                        |
| `Dockerfile.dockerignore` | Context exclusions for **this** build — see below.                                |
| `compose.yml`             | Sets the build context, build args, ports, env file, auth-file mount and network. |

1. **Build context = the monorepo root** (`context: ../..` in compose, or
   `docker build -f apps/dummy-payment-app/Dockerfile <repo-root>` from the
   CLI). The app uses pnpm `workspace:*` and `catalog:` dependencies that
   only resolve from the root (`pnpm-lock.yaml` + `pnpm-workspace.yaml` +
   `packages/`), so the app directory alone is not a valid context.
2. **The ignore file is selected automatically.** Docker 25+ pairs every
   Dockerfile with an ignore file named after it in the same directory:
   `Dockerfile` → `Dockerfile.dockerignore`. No compose key or CLI flag is
   involved. When that file exists it **replaces** the repository-root
   `.dockerignore` for this build — the two are not merged — which is why
   `Dockerfile.dockerignore` is self-contained.
3. **What it does.** Because the context is the monorepo root, the ignore
   file (patterns relative to the repo root) keeps only what this build
   needs: this app's sources, the shared `packages/` workspace packages and
   the root workspace files. It excludes every other app, all
   `node_modules`/`.next` build output and — critically — every `.env*` and
   `.saleor-app-auth*.json` file, so runtime env values and the app token
   can never end up in image layers. Verified result: ~5 MB context
   instead of ~4 GB.
4. **Ordering constraint inside the ignore file.** Gitignore-style matching
   gives the _last_ matching pattern the win. The app re-inclusion
   (`apps/*/*` followed by `!apps/dummy-payment-app/*`) therefore must stay
   **above** the artifact/secret exclusions; otherwise the negation would
   re-include the app's own `node_modules/`, `.next/`, `.env*` and auth
   files (they are direct children of the app directory). This was verified
   empirically — move the negation below the exclusions and the app's env
   and auth files leak into the context.

#### Runtime configuration

- **`.env.docker`** (gitignored; committed template:
  [`.env.docker.example`](./.env.docker.example)) — runtime env loaded via
  compose `env_file`. The two base URLs follow the same convention as local
  development: browser-facing `APP_IFRAME_BASE_URL=http://localhost:3001`,
  container-facing `APP_API_BASE_URL=http://host.docker.internal:3001`.
- **`.saleor-app-auth.json`** — the app's FileAPL (token, `saleorApiUrl`,
  `appId`, JWKS) is **bind-mounted read-write** into the container. The
  mount is read-write because `/api/register` rewrites the file during
  (re-)registration; the file itself never enters the image (excluded by
  `Dockerfile.dockerignore`).
- **`NEXT_PUBLIC_ALLOW_DUMMY_PAYMENT`** — build-time only (inlined into the
  client bundle by `next build`); set it via a build arg / `.env`
  interpolation and rebuild the image to change it. Defaults to `true`.
- The `--webpack` build flag is required: Next 16.4.1's default turbopack
  production build bakes hash-suffixed external require names into its
  chunks that `next start` cannot resolve in a pnpm layout (see the
  Dockerfile comment for details).

#### Validating the container

```sh
docker compose ps                                   # Up ... (healthy)
curl -sf http://localhost:3001/                      # app UI (200)
curl -sf http://localhost:3001/api/manifest | head   # manifest JSON
```

Check the image layers for leaked secrets (NOT the running container -
its `.saleor-app-auth.json` is the compose bind mount, which hides the
image file at the same path, and the app runs as `node` so a leaked file
would be visible there):

```sh
# 1. env files in the running container (none are mounted - expect failure)
docker exec saleor-app-dummy-payment sh -c 'ls /app/.env*' || echo "clean: no .env* files"
# 2. the FileAPL in the pure image (expect no match)
docker create --name imgcheck admincareout/kidl:saleor-app-dummy-payment-1.0 >/dev/null
docker export imgcheck | grep -c "app/.saleor-app-auth" || true
docker rm -f imgcheck >/dev/null
```

If either check finds a file, a stale or mis-filtered context reached a
build layer — fix the ignore file, then `docker compose build --no-cache`
(BuildKit can reuse cached context layers across ignore-file changes; see
the ignore file's CAUTION comment) and recreate the container.

If the Saleor URL the app is registered against ever changes, re-register
via `POST http://host.docker.internal:3001/api/register` with the
`saleor-api-url` header — see
[`docs/app-registration-and-auth.md`](docs/app-registration-and-auth.md).

### How to use the app?

After installing the app in Saleor, visit the app's Dashboard.

There you can create a [Checkout](https://docs.saleor.io/developer/checkout/overview), a set shipping method on that checkout.
After that step is completed you can initialize a Transaction using [`transactionInitialize`](https://docs.saleor.io/api-reference/payments/mutations/transaction-initialize) mutation. App's response to that mutation can be modified using provided input.

The checkout process in app looks like this:

1. Select channel where you want to create the Checkout
2. Click "Create checkout" to create Checkout in Saleor in your selected channel
3. Click "Set delivery" to set delivery method on that checkout
4. Set response you want the app to return for [`TRANSACTION_INITIALIZE_SESSION`](https://docs.saleor.io/developer/extending/webhooks/synchronous-events/transaction#initialize-transaction-session)
5. Click "Initialize transaction"
6. Wait until response is returned and click "Complete checkout" to send [`checkoutComplete`](https://docs.saleor.io/api-reference/checkout/mutations/checkout-complete) mutation

### Using app with custom storefront

Dummy Payment App provides a built-in storefront for creating Transactions in Saleor. If you want to test your own storefront before integrating a real payment provider or you prefer to make requests manually here is a description of all available Transaction mutations in Saleor supported by app.

#### Modifying response via `data` field

When you send [`transactionInitialize`](https://docs.saleor.io/api-reference/payments/mutations/transaction-initialize) or [`transactionProcess`](https://docs.saleor.io/api-reference/payments/mutations/transaction-process) mutations to Saleor, you can include a `data` field in your mutation variables. This `data` field is passed through to the Dummy Payment App's webhooks. The app uses the content of this `data` field to determine how it should respond.

For this app, the crucial parts of the `data` field you send are:

- `data.event.type`: Specifies the desired outcome of the transaction (e.g., `CHARGE_SUCCESS`, `AUTHORIZATION_FAILURE`). This directly controls the `result` field in the app's response. See [`TransactionEventTypeEnum`](https://docs.saleor.io/api-reference/payments/enums/transaction-event-type-enum) for all possible values.
- `data.event.includePspReference`: A boolean indicating whether the app should generate and return a `pspReference` in its response or if it should return `undefined`.

#### 1. [`transactionInitialize`](https://docs.saleor.io/api-reference/payments/mutations/transaction-initialize) Mutation

Use the [`transactionInitialize`](https://docs.saleor.io/api-reference/payments/mutations/transaction-initialize) mutation to start a new transaction. It can be created on either Checkout or Order objects.

##### GraphQL Mutation

```graphql
mutation TransactionInitialize(
  $id: ID! # Checkout or Order ID
  $action: TransactionFlowStrategyEnum # Override channel default action - e.g., CHARGE, AUTHORIZATION
  $amount: PositiveDecimal # Override default amount (totalBalance)
  $data: JSON! # Data object to control app behavior - required
) {
  transactionInitialize(id: $id, action: $action, amount: $amount, data: $data) {
    transactionEvent {
      pspReference # Populated based on your data.event.includePspReference
      amount {
        amount
        currency
      }
      type # Reflects your data.event.type
    }
    data # The JSON response from this app's webhook (see "App's Webhook Response Structure" below)
    errors {
      field
      message
      code
    }
  }
}
```

##### Example Variables for `transactionInitialize`

Here's how you'd structure the variables, focus on the `data` field which is required by the app:

```json
{
  "id": "Q2hlY2tvdXQ6YWY3MDJkMGQtMzM0NC00NjMxLTlkNmEtMDk4Yzk1ODhlNmMy",
  "action": "CHARGE",
  "amount": 54.24,
  "data": {
    "event": {
      "type": "CHARGE_SUCCESS", // See below for all possible types
      "includePspReference": true // true or false
    }
  }
}
```

When the app receives the `TRANSACTION_INITIALIZE_SESSION` webhook triggered by this mutation:

- If `data.event.includePspReference` from your mutation is `true`, the app's response will contain a `pspReference` (a v7 UUID). Otherwise, `pspReference` will be `undefined` (or `null`).
- The `data.event.type` you send (e.g., `"CHARGE_SUCCESS"`) will become the `result` in the app's JSON response.
- The `actions` array in the app's response (e.g., `["REFUND", "CANCEL"]`) is also determined by the `data.event.type`.

##### Available types

App accepts following types in `data.event.type` (these are taken from the possible responses the app can send to Saleor from the [`TRANSACTION_INITIALIZE_SESSION`](https://docs.saleor.io/developer/extending/webhooks/synchronous-events/transaction#response) webhook, see [Saleor docs](https://docs.saleor.io/developer/extending/webhooks/synchronous-events/transaction#response) for details):

- `CHARGE_REQUEST`
- `CHARGE_ACTION_REQUIRED`
- `CHARGE_FAILURE`
- `CHARGE_SUCCESS`
- `AUTHORIZATION_REQUEST`
- `AUTHORIZATION_ACTION_REQUIRED`
- `AUTHORIZATION_FAILURE`
- `AUTHORIZATION_SUCCESS`

#### 2. [`transactionProcess`](https://docs.saleor.io/api-reference/payments/mutations/transaction-process) Mutation

This mutation is used for subsequent steps in a transaction flow, such as handling 3D Secure authentication or other additional actions required by a payment provider. It is used after payment app returns `CHARGE_ACTION_REQUIRED` or `AUTHORIZATION_ACTION_REQUIRED` event types.

##### GraphQL Mutation

```graphql
mutation TransactionProcess(
  $id: ID! # Transaction ID from the previous step
  $data: JSON! # Data object to control app behavior - required
) {
  transactionProcess(id: $id, data: $data) {
    transaction {
      id
      actions
    }
    transactionEvent {
      message
      type # Reflects your data.event.type
    }
    data # The JSON response from this app's webhook (see "App's Webhook Response Structure" below)
    errors {
      field
      code
      message
    }
  }
}
```

##### Example Variables for `transactionProcess`

```json
{
  "id": "VHJhbnNhY3Rpb25JdGVtOjRhODMxNThkLTU0NTAtNDU2Mi04MDE5LTAzYzY4NjMyZjA1Mg==",
  "data": {
    "event": {
      "type": "CHARGE_SUCCESS",
      "includePspReference": true
    }
  }
}
```

When the app receives the `TRANSACTION_PROCESS_SESSION` webhook:

- The app handles the `data` field (specifically `data.event.type` and `data.event.includePspReference`) similarly to `transactionInitialize` to shape its response. The `result` and `pspReference` in the app's output will be based on these values.

#### App's webhook response structure

When the Dummy Payment App's webhooks are called (triggered by [`transactionInitialize`](https://docs.saleor.io/api-reference/payments/mutations/transaction-initialize) or [`transactionProcess`](https://docs.saleor.io/api-reference/payments/mutations/transaction-process) mutations), the `data` field within Saleor's GraphQL mutation response (i.e., `transactionInitialize.data` or `transactionProcess.data`) will be structured by this app as follows:

##### On Successful Processing (based on your input `data`):

```json
{
  "pspReference": "xxxxxxxx-xxxx-7xxx-xxxx-xxxxxxxxxxxx",
  "result": "CHARGE_SUCCESS",
  "message": "Great success!",
  "actions": ["REFUND", "CANCEL"],
  "amount": null,
  "externalUrl": "https://your-app-deployment-url.com/app/transactions/<transaction_id>"
}
```

##### On Validation Error (if `data` sent to webhook is malformed):

If the `data` field you provide in the mutation doesn't match the app's expected schema (defined in `src/modules/validation/sync-transaction.ts`), the app will return an error structure within the `data` field of the mutation response:

```json
{
  "pspReference": "xxxxxxxx-xxxx-7xxx-xxxx-xxxxxxxxxxxx",
  "result": "CHARGE_FAILURE",
  "message": "Zod validation error message details...",
  "amount": 54.24,
  "actions": [],
  "data": {
    "exception": true
  }
}
```

### Learn more

#### Docs

- [**Apps guide**](https://docs.saleor.io/docs/developer/extending/apps/overview) - learn more how to build your own Saleor app
- [**Transactions API**](https://docs.saleor.io/docs/developer/payments) - learn how to use Transactions API in your store
- [**Payment App webhooks**](https://docs.saleor.io/docs/developer/extending/webhooks/synchronous-events/transaction) - learn how to build your own Payment App

#### Examples

- [**Stripe Payment App**](https://github.com/saleor/saleor-app-payment-stripe)
- [**Stripe Example Storefront**](https://github.com/saleor/example-nextjs-stripe)

## Development

You can find docs about App development in the [Saleor documentation](https://docs.saleor.io/developer/extending/apps/developing-apps/app-examples).

## Support

Please open GitHub issues if you find any problem with this app. PRs are welcome too 😄

You can find help with Saleor in these places:

- [GitHub Discussions](https://github.com/saleor/saleor/discussions)
- [Saleor Discord](https://discord.gg/H52JTZAtSH)

## Credits

- App logo: [Lucide](https://lucide.dev/license)

## PCI DSS compliance

This application is exempted from PCI DSS requirements due to not allowing users to input any credit card number.
