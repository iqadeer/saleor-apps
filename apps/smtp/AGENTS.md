# Saleor App SMTP

## Project Overview

This is a Saleor SMTP Application that handles email notifications for e-commerce events. It integrates with Saleor API via webhooks and sends transactional emails using SMTP configuration.

## Key Commands

### Development

- `pnpm install` - Install dependencies
- `pnpm dev` - Start development server with node inspector (http://localhost:3000; use for tunnel/ngrok-based development)
- `pnpm dev:local` - Start development server on **port 3002** - the command for local development against Saleor running in Docker behind Traefik (matches `.env.local.docker.example`)
- `pnpm build` - Build the application
- `pnpm start` - Start production server

### Code Quality

- `pnpm lint` - Run ESLint
- `pnpm lint:fix` - Auto-fix linting issues
- `pnpm check-types` - Type checking with TypeScript

### Testing

- `pnpm test` - Run tests with Vitest in watch mode
- `pnpm test:ci` - Run tests once with coverage
- To run a single test file: `pnpm test <filename>`

### GraphQL

- `pnpm fetch-schema` - Update GraphQL schema from Saleor
- `pnpm generate` - Generate TypeScript for GraphQL, after changing queries, mutations, schema

## Architecture

### Tech Stack

- **Framework**: Next.js with TypeScript
- **API Layer**: tRPC for type-safe APIs
- **GraphQL**: URQL client with code generation
- **Database**: DynamoDB (with support for multiple APL storages - used when installing app)
- **Email Processing**: MJML for responsive email templates, Handlebars and `handlebars-helpers` for templating
- **Testing**: Vitest with React Testing Library
- **Monitoring**: Sentry and OpenTelemetry

### Directory Structure

- `/src/pages` - Next.js pages and API routes
- `/src/modules` - Feature modules with business logic
  - `smtp/` - Email configuration and sending logic
  - `trpc/` - tRPC setup and procedures
  - `webhook-management/` - Webhook handling
  - `dynamodb/` - Database client
  - `event-handlers/` - Event processing logic
- `/src/lib` - Shared utilities and helpers
- `/graphql` - GraphQL schema and operations
- `/generated` - Auto-generated GraphQL types

### Key Architectural Patterns

#### tRPC Router Pattern

All API endpoints use tRPC routers defined in `*.router.ts` files. Protected procedures require authentication via `protectedClientProcedure` (valid Saleor token).

#### Event-Driven Architecture

The app responds to Saleor events through webhooks:

- Order events (created, confirmed, cancelled, fulfilled, etc.)
- Invoice events
- Gift card events
  Each event type has its own handler in `/src/pages/api/webhooks/`

#### SMTP Configuration Service

Located in `/src/modules/smtp/configuration/`, manages email templates and SMTP settings per event type. Configurations are stored in DynamoDB/APL.

#### Email Compilation Pipeline

1. HandlebarsTemplateCompiler - Process Handlebars variables
2. MjmlCompiler - Convert MJML to HTML
3. HtmlToTextCompiler - Generate text version
4. SmtpEmailSender - Send via Nodemailer

### Environment Configuration

The app supports multiple APL (Auth Persistence Layer) options, set via `APL` in `.env.local`:

- `file` - Local development (default here); auth state in `apps/smtp/.saleor-app-auth.json` (gitignored, single installation, exact `saleorApiUrl` match - see `docs/app-registration-and-auth.md`)
- `upstash` - Production with Redis
- `dynamodb` - AWS DynamoDB

For local development (Saleor in Docker behind Traefik) copy `.env.local.docker.example` to `.env.local` and fill in `SECRET_KEY`. The two base-URL variables are the most important:

- `APP_IFRAME_BASE_URL=http://localhost:3002` - the app **from the browser** (manifest `appUrl`)
- `APP_API_BASE_URL=http://host.docker.internal:3002` - the app **from the Saleor containers** (registration endpoint, webhook targets, tRPC context `baseUrl` since `7863b3da`)

Full local setup (ports, Traefik URLs, platform env interplay): `docs/local-development.md`.

### Testing Approach

- Unit tests use Vitest with mocked dependencies
- Tests are colocated with source files (`.test.ts`)
- Use `describe`, `it`, `expect` from Vitest
- Mock external services and APIs
- Tests run with shuffled order to prevent side effects

### Important Notes

- Always commit the `/generated` folder after GraphQL changes
- The app requires Saleor version `>=3.22 <3.24` (`REQUIRED_SALEOR_VERSION` in `src/saleor-app.ts`); registration rejects other versions
- For local Docker development Saleor reaches the app via `host.docker.internal` (`APP_API_BASE_URL`) - no ngrok needed; ngrok is only for tunnel-based development
- The registered `saleorApiUrl` in `.saleor-app-auth.json` must equal the platform's `DASHBOARD_API_URL` byte-for-byte, or every tRPC call fails with `401 Missing auth data` - fix by re-registering (procedure in `docs/app-registration-and-auth.md`)
- MJML templates support Handlebars variables for dynamic content
- All webhook handlers are in `/src/pages/api/webhooks/`

### Documentation

- `docs/local-development.md` - local URLs/ports, env, Docker + Traefik networking
- `docs/app-registration-and-auth.md` - FileAPL, registration/re-registration, app token vs Dashboard user JWT
- `docs/troubleshooting.md` - `Missing auth data` 401, secure-context workaround, webhook delivery
- `docs/email-templates-analysis.md` - template structure and local preview
