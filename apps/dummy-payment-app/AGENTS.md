# Saleor Dummy Payment App

This file provides guidance to coding agents when working with code in this repository.

## Project Overview

This is a Saleor Payment App that implements a dummy payment gateway for testing Saleor's Transactions API. It allows testing payment flows without a real payment provider.

## Development Commands

### Setup

```bash
pnpm install  # Install dependencies
```

### Development

```bash
pnpm dev      # Start dev server with codegen and Node.js inspector on port 3000 (tunnel/ngrok development)
pnpm dev:local  # Start dev server on port 3001 - THE command for local development against Saleor in Docker behind Traefik (matches .env.local.docker.example)
pnpm build    # Build for production (runs codegen first)
pnpm start    # Start production server
```

Note: the SMTP app in this monorepo also uses `pnpm dev:local` but on port
**3002** - both apps run side by side; don't copy ports between them.

### Code Quality

```bash
pnpm lint     # Run ESLint
pnpm test     # Run tests with Vitest
```

### GraphQL

```bash
pnpm generate      # Generate TypeScript types from GraphQL schema and operations
pnpm fetch-schema  # Fetch latest Saleor GraphQL schema (version in package.json)
```

GraphQL operations are defined in `graphql/` directory (mutations, queries, fragments, subscriptions). The codegen generates types in `generated/graphql.ts` using urql and typed-document-node.

## Architecture

### Framework & Stack

- **Next.js** with Pages Router (not App Router)
- **tRPC** for type-safe API routes (server & client communication)
- **urql** for GraphQL client with auth exchange
- **Saleor App SDK** for webhook handling and APL (Auth Persistence Layer)
- **Vitest** for testing with jsdom environment
- **OpenTelemetry** for observability (traces & logs)
- **Sentry** for error tracking

### Key Architectural Components

#### APL (Auth Persistence Layer)

Authentication data storage configured in `src/saleor-app.ts`. Supports:

- `FileAPL` (default) - stores auth in `.auth-data.json`
- `UpstashAPL` - for multi-tenant deployments

#### Webhook System

All webhooks are in `src/pages/api/webhooks/`. Each webhook:

- Uses `SaleorSyncWebhook` from `@saleor/app-sdk`
- Wrapped with `wrapWithLoggerContext` and `withOtel` for observability
- Has `bodyParser: false` in config for signature verification
- Validates incoming data with Zod schemas from `src/modules/validation/`

Supported webhooks:

- `PAYMENT_GATEWAY_INITIALIZE_SESSION`
- `TRANSACTION_INITIALIZE_SESSION`
- `TRANSACTION_PROCESS_SESSION`
- `TRANSACTION_REFUND_REQUESTED`
- `TRANSACTION_CHARGE_REQUESTED`
- `TRANSACTION_CANCELATION_REQUESTED`

#### tRPC Setup

- Server router in `src/server/routers/app-router.ts`
- Context defined in `src/pages/api/trpc/[trpc].ts`
- Client setup in `src/trpc-client.ts`
- Procedures can use `procedureWithGraphqlClient` middleware for Saleor API access

#### GraphQL Client

Created via `createClient` in `src/lib/create-graphql-client.ts`:

- Uses urql with auth exchange
- Custom `Authorization-Bearer` header (note: not standard `Authorization: Bearer`)
- Auth token provided via APL

#### URL Generation

`AppUrlGenerator` in `src/modules/url/app-url-generator.ts` handles:

- External URLs for webhooks (`APP_API_BASE_URL` env var)
- Iframe URLs for dashboard (`APP_IFRAME_BASE_URL` env var)
- Falls back to request host if env vars not set
- Env vars are used for local development with local Saleor instance, tunneling works without setting env vars

#### Transaction Logic

- `transaction-actions.ts` - determines available actions based on event type
- `transaction-psp-finder.ts` - finds PSP reference from transaction events
- `transaction-refund-checker.ts` - validates refund requests
- Response schema validation in `src/modules/validation/sync-transaction.ts`

#### Observability

- Logger with multiple transports (console, Sentry, Vercel) in `src/lib/logger/`
- OpenTelemetry setup in `src/lib/otel/` with traces and logs
- Request context propagation via `logger-context.ts`

### Pages Structure

- `/` - Landing page
- `/app/` - Dashboard pages (must be opened in Saleor Dashboard iframe context):
  - `/app/index.tsx` - Main app page
  - `/app/configuration.tsx` - App configuration
  - `/app/checkout.tsx` - Checkout testing UI
  - `/app/transactions/` - Transaction list and details

### Environment Variables

Optional for generic local development (defaults work without Docker), but
two of them are **required and specific** for the verified local setup in
this repository (Saleor in Docker behind Traefik, app on the Windows host):

- `APP_IFRAME_BASE_URL=http://localhost:3001` - **browser → app** (manifest `appUrl`; the Dashboard iframe)
- `APP_API_BASE_URL=http://host.docker.internal:3001` - **Saleor container → app** (registration endpoint + all webhook targets; `localhost` would be the container itself)
- `APL` - Auth persistence layer type: `file` (default, local), `upstash`, `dynamodb`
- APL-specific vars: `FILE_APL_PATH` (default `.saleor-app-auth.json`), `UPSTASH_URL`, `UPSTASH_TOKEN`

**Local setup workflow**: `cp .env.local.docker.example .env.local` (all
values in the example already work for this stack; no secrets needed). Then
`pnpm dev:local`, install the app in the Dashboard from manifest URL
`http://localhost:3001/api/manifest` (browser-facing). Details:
`docs/local-development.md`.

### APL auth file behavior (file APL, local)

- File: `apps/dummy-payment-app/.saleor-app-auth.json` (gitignored, single
  installation; never commit it or its token)
- Every tRPC call is resolved by **exact string equality** of the
  `saleor-api-url` header against the stored `saleorApiUrl` (trailing slash
  included) - the stored value must equal the platform
  `DASHBOARD_API_URL` byte-for-byte, or calls fail with
  `401 "Missing auth data"`
- The file is re-read per request; re-registration applies without restart
  (procedure: `docs/app-registration-and-auth.md`)

## Testing Payment Flows

The app accepts `data` field in `transactionInitialize` and `transactionProcess` mutations to control behavior:

```json
{
  "data": {
    "event": {
      "type": "CHARGE_SUCCESS", // See TransactionEventTypeEnum
      "includePspReference": true
    }
  }
}
```

Valid event types: `CHARGE_SUCCESS`, `CHARGE_FAILURE`, `CHARGE_REQUEST`, `CHARGE_ACTION_REQUIRED`, `AUTHORIZATION_SUCCESS`, `AUTHORIZATION_FAILURE`, `AUTHORIZATION_REQUEST`, `AUTHORIZATION_ACTION_REQUIRED`

Response includes:

- `pspReference` - UUID v7 (if `includePspReference: true`)
- `result` - mirrors the input `type`
- `actions` - available transaction actions (determined by event type)
- `externalUrl` - link to transaction details page in app
- `message` - success or error message

For more details check Saleor GraphQL schema and docs: docs.saleor.io

## Important Notes

- All webhook handlers must have `bodyParser: false` for signature verification
- GraphQL schema version is pinned to Saleor 3.19 (see `package.json`)
- Node version: 18.17.0 - 20.x required
- Uses ES modules (`"type": "module"` in package.json)
- Transaction external URLs link back to app UI for status updates

### Local integration (verified setup)

- Gateway ID is `saleor.io.dummy-payment-app` (`src/lib/gateway-id.ts`); the manifest declares 4 permissions (`MANAGE_CHECKOUTS`, `HANDLE_CHECKOUTS`, `HANDLE_PAYMENTS`, `MANAGE_ORDERS`) and 6 webhooks - targets come from `APP_API_BASE_URL` at installation time
- The gateway appears per channel with `currencies` following the channel currency (verified USD/PLN); the built-in `saleor.io.gift-card-payment-gateway` appears alongside it and is ignored by the Paper storefront by design
- Storefront checkouts call `transactionInitialize` **without** the `action` arg (channel default strategy; passing `action` needs `HANDLE_PAYMENTS` on the caller), then `checkoutComplete`
- **Storefront-side gotcha**: the Paper storefront filters dummy gateways client-side on `NEXT_PUBLIC_ALLOW_DUMMY_PAYMENT`, which is **inlined at image build time** - a runtime-only `ALLOW_DUMMY_PAYMENT` does not make the gateway show up in the storefront (fixed in storefront-paper `d421e605`; symptom: "No payment gateway configured" while the API returns the gateway)
- Encountered issues and verified fixes: `docs/troubleshooting.md`

## Documentation

- `docs/local-development.md` - local URLs/ports, env, Docker + Traefik networking, platform env interplay
- `docs/app-registration-and-auth.md` - FileAPL, installation/registration, permissions, webhooks, channel/gateway config, storefront integration, end-to-end verification with raw GraphQL
- `docs/troubleshooting.md` - gateway filtered client-side, URL/networking mistakes, `Missing auth data` 401, webhook and payment initialization failures, build-time vs runtime env
- `.env.local.docker.example` - fully commented, tested local env (copy to `.env.local`)
