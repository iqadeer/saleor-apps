<div style="text-align: center">
  <img width="150" alt="" src="./public/logo.png">
</div>

<div style="text-align: center">
  <h1>Saleor App SMTP</h1>

  <p>The SMTP application is responsible for sending emails and messages to customers. It is connected to the Saleor API via webhooks, which notify the application about events. The messages are delivered by the SMTP protocol configured in the application.</p>
</div>

<div style="text-align: center">
  <a target="_blank" rel="noopener noreferrer" href="https://docs.saleor.io/developer/app-store/apps/smtp/overview">Docs</a>
<br><br>
</div>

> [!WARNING]
> This app is **deprecated**. It has been replaced by the Customer Emails app, which sends
> order, account, and fulfillment emails through your own SMTP server. Install it from
> **Extensions → Explore** in the Dashboard. SMTP still works, but is no longer developed.
> Email templates are not migrated — set the new app up alongside this one, then uninstall this one.

### How to use this project

#### Requirements

- [node v22](https://nodejs.org)
- [pnpm](https://pnpm.io/)
- [ngrok](https://ngrok.com/)
- [docker](https://www.docker.com/)
- Saleor Cloud account (free!) or local instance
- SMTP server - e.g [Mailpit](https://mailpit.axllent.org/)

#### Running app locally in development containers

> [!IMPORTANT]
> You can use the devcontainer Dockerfile and docker-compose.yaml directly - but remember to run `pnpm install` manually

The easiest way to run Saleor for local development is to use [development containers](https://containers.dev/).
If you have Visual Studio Code, follow their [guide](https://code.visualstudio.com/docs/devcontainers/containers#_quick-start-open-an-existing-folder-in-a-container) on how to open an existing folder in a container.

The development container only creates a container; you still need to start the server.

The development container will have a port opened:

1. `3000` - where the app dev server will listen for requests

#### Running app in development mode

1. Install the dependencies by running the following command in the shell:

```shell
pnpm install
```

2. Create a file named `.env` and use the contents of the [`.env.example`](./.env.example) file as a reference.

3. Start the development server by running the following command in the shell:

```shell
pnpm dev
```

4. SMTP app will be available under `http://localhost:3000`

5. Tunnel the app by running:

```shell
ngrok http localhost:3000
```

> [!NOTE]
> See [How to tunnel an app](https://docs.saleor.io/developer/extending/apps/developing-with-tunnels) for more info.

6. Go to Dashboard, open the `Apps` tab and click `Install external app`, provide your tunnel URL with the path for the manifest file. For example `${YOUR_TUNNEL_URL}/api/manifest`

#### Running the app as a Docker container (production)

The app ships with a multi-stage `Dockerfile` (Node 24 alpine, production
build, non-root runner, health check on `/api/manifest`) and a `compose.yml`
for direct-localhost deployment (Stage 1 — no Traefik labels yet; the
container already joins the shared `saleor-proxy-net` network so Stage 2
routing is a compose/network change, not a rebuild):

- Browser (Dashboard iframe): `http://localhost:3002`
- Saleor (registration + webhooks): `http://host.docker.internal:3002`

```sh
docker compose up -d --build    # build the image + start the container
docker compose ps               # expect "Up ... (healthy)"
```

The image is `admincareout/kidl:saleor-app-smtp-1.0`; the container listens
on port `3000` internally, mapped to host port `3002`. (This is separate
from the pre-existing `docker-compose.yml` next to it, which only runs the
Mailpit email sink for local development.)

##### How the build is assembled: context, Dockerfile and ignore file

Three files in `apps/smtp/` work together:

| File                      | Role                                                                              |
| ------------------------- | --------------------------------------------------------------------------------- |
| `Dockerfile`              | Multi-stage build (base → build → runner).                                        |
| `Dockerfile.dockerignore` | Context exclusions for **this** build — see below.                                |
| `compose.yml`             | Sets the build context, build args, ports, env file, auth-file mount and network. |

1. **Build context = the monorepo root** (`context: ../..` in compose, or
   `docker build -f apps/smtp/Dockerfile <repo-root>` from the CLI). The
   app uses pnpm `workspace:*` and `catalog:` dependencies that only
   resolve from the root (`pnpm-lock.yaml` + `pnpm-workspace.yaml` +
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
   (`apps/*/*` followed by `!apps/smtp/*`) therefore must stay **above**
   the artifact/secret exclusions; otherwise the negation would re-include
   the app's own `node_modules/`, `.next/`, `.env*` and auth files (they
   are direct children of the app directory). This was verified
   empirically — move the negation below the exclusions and the app's env
   and auth files leak into the context.

##### Runtime configuration

- **`.env.docker`** (gitignored) — runtime env loaded via compose
  `env_file`: `SECRET_KEY`, `CRON_SECRET`, the two base URLs (browser-facing
  `APP_IFRAME_BASE_URL=http://localhost:3002`, container-facing
  `APP_API_BASE_URL=http://host.docker.internal:3002`), `APL=file` and so
  on. `SECRET_KEY` must also be available at build time (build arg) so
  `next build` passes env validation; keep both values identical. `NEW_SECRET_KEY`
  must be **absent**, not empty (the zod schema is
  `z.string().min(1).optional()` and rejects `""`).
- **`.saleor-app-auth.json`** — the app's FileAPL (token, `saleorApiUrl`,
  `appId`, JWKS) is **bind-mounted read-write** into the container. The
  mount is read-write because `/api/register` rewrites the file during
  (re-)registration; the file itself never enters the image (excluded by
  `Dockerfile.dockerignore`).

##### Validating the container

```sh
docker compose ps                                   # Up ... (healthy)
curl -sf http://localhost:3002/                      # app UI (200)
curl -sf http://localhost:3002/api/manifest | head   # manifest JSON
```

Check the image layers for leaked secrets (NOT the running container -
its `.saleor-app-auth.json` is the compose bind mount, which hides the
image file at the same path, and the app runs as `node` so a leaked file
would be visible there):

```sh
# 1. env files in the running container (none are mounted - expect failure)
docker exec saleor-app-smtp sh -c 'ls /app/.env*' || echo "clean: no .env* files"
# 2. the FileAPL in the pure image (expect no match)
docker create --name imgcheck admincareout/kidl:saleor-app-smtp-1.0 >/dev/null
docker export imgcheck | grep -c "app/.saleor-app-auth" || true
docker rm -f imgcheck >/dev/null
```

If either check finds a file, a stale or mis-filtered context reached a
build layer — fix the ignore file, then `docker compose build --no-cache`
(BuildKit can reuse cached context layers across ignore-file changes; see
the ignore file's CAUTION comment) and recreate the container.

Protected tRPC procedures require a Dashboard-issued client JWT (they
verify the staff user, not the app token) — exercise them through the
app's UI in the Dashboard. If the Saleor URL the app is registered against
ever changes, re-register via `POST http://host.docker.internal:3002/api/register`
with the `saleor-api-url` header — see
[`docs/app-registration-and-auth.md`](docs/app-registration-and-auth.md).

### How to configure the SMTP app

To configure the app you need an SMTP server. You can run it locally using Docker.

1. In the terminal navigate to [devcontainer for the app](../../.devcontainer/smtp/) and run `docker-compose up mailpit`
2. The Mailpit server is now running, here are the server details that you need to configure the app:

- Host: localhost
- Port: 1025
- User: test
- Password: test

3. Go to the app and click the `Add configuration` button
4. Now in the `Status and name` section provide the configuration name and save
5. Go to the `Connect SMTP server` section and fill `Host`, `Port`, `User` and `Password` fields with data from point 2, save the config
6. Go to the `Sender` section and provide the sender email and name, save the config
7. Go to `Events` and select which event you want to send email to, for example, `Order created` and save config

## How to test the configuration

1. If you selected `Order created` as an event go to the `Order` tab and create a new order
2. After order creation, the app should send the email
3. Open `http://localhost:8025/` and you should see the new email

### Generated schema and typings

Commands `build` and `dev` would generate schema and typed functions using Saleor's GraphQL endpoint. Commit a `generated` folder to your repo as they are necessary for queries and keeping track of the schema changes.

[Learn more](https://www.graphql-code-generator.com/) about GraphQL code generation.

### Storing registration data - APL

During the registration process, Saleor API passes the auth token to the app. With this token, the app can query Saleor API with privileged access (depending on permissions requested during installation).
To store this data, the app-template uses a different [APL interface](https://docs.saleor.io/developer/extending/apps/developing-apps/app-sdk/apl).

The choice of the APL is done using the `APL` environment variable. If the value is not set, FileAPL is used. Available choices:

- `file`: no additional setup is required. Good choice for local development. Can't be used for multi tenant-apps or be deployed (not intended for production)
- `upstash`: use [Upstash](https://upstash.com/) Redis as storage method. Free account required. Can be used for development and production and supports multi-tenancy. Requires `UPSTASH_URL` and `UPSTASH_TOKEN` environment variables to be set

If you want to use your own database, you can implement your own APL. [Check the documentation to read more.](https://docs.saleor.io/developer/extending/apps/developing-apps/app-sdk/apl)

### Learn more about Saleor Apps

[Apps guide](https://docs.saleor.io/developer/extending/apps/overview)

## OTEL

Visit `@saleor/apps-otel` [README](../../packages/otel/README.md) to learn how to run app with OTEL locally.
