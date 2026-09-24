# MorphUI

MorphUI turns plain-language business requests into safe, task-specific
workspaces. It separates the Morph control plane from customer data through a
client-hosted Morph Gateway.

## Prerequisites

- Node.js 22.13 or newer
- Docker Desktop with Docker Compose
- npm

## Start the web app

```bash
npm install
npm run dev
```

The terminal prints the local address for the application.

## Create the reference PostgreSQL database

Copy `.env.example` to `.env`, then run:

```bash
npm run db:setup
npm run db:verify
```

`db:setup` starts PostgreSQL, waits for it to become healthy, applies the
versioned Drizzle migration and loads deterministic synthetic insurance data.
The database listens on port `5434` so it is less likely to conflict with an
existing PostgreSQL installation.

Database connection:

```text
postgresql://morphui:morphui_dev@localhost:5434/morphui
```

Useful commands:

```bash
npm run db:up       # Start PostgreSQL
npm run db:down     # Stop PostgreSQL without deleting its volume
npm run db:logs     # Follow PostgreSQL logs
npm run db:migrate  # Apply pending migrations
npm run db:seed     # Seed only when the database is empty
npm run db:verify   # Run representative read-only insurance queries
npm run db:studio   # Explore data through Drizzle Studio
```

To intentionally replace existing local synthetic data:

```bash
RESET_SEED=true npm run db:seed
```

The seeder refuses non-local targets and will not replace existing data unless
`RESET_SEED=true` is supplied.

## Insurance model

This synthetic model is used to develop and test a client-side Gateway. The
MorphUI workspace API does not connect to it directly. The model contains:

- customers, branches and relationship managers
- motor insurance products, policies and insured vehicles
- claims and settlement information
- renewal pipelines and follow-up information
- policy endorsements and premium changes

The default seed produces approximately 3,000 customers, 8,000 policies, 1,400
claims, 2,500 renewals and 900 endorsements. Set `SEED_SCALE=0.1` in `.env` for
a smaller dataset.

All generated identities and contact details are synthetic. Emails use reserved
testing domains, and the data must not be treated as real customer information.

## Project structure

```text
app/                  MorphUI React application
app/api/workspaces/   Validated dynamic workspace APIs
app/api/gateway/      Gateway health surface
db/schema.ts          PostgreSQL schema, constraints and indexes
db/app-state-schema.ts Morph control-plane persistence model
db/migrations/        Versioned SQL migrations
db/seed.ts            Deterministic synthetic insurance data generator
db/queries.ts         Read-only queries for dynamic workspaces
db/verify.ts          Database smoke test and sample output
docker-compose.yml    Local PostgreSQL 16 service
lib/workspaces/       Prompt planner and safe UI-spec builders
lib/gateway/          Versioned Gateway contract, client and demo enforcement
docs/gateway-protocol.md Client Gateway trust boundary and endpoint contract
```

## Dynamic workspace API

The main interface sends a natural-language request to
`POST /api/workspaces/generate`. MorphUI converts it into an allowlisted,
read-only JSON query plan and sends that plan to the client-hosted Gateway. The
Gateway verifies the user, enforces authoritative entities and fields, compiles
parameterized SQL internally, masks sensitive fields and returns only approved
results. Raw SQL and database credentials never enter MorphUI.

The Data sources page includes a five-step PostgreSQL onboarding flow. It
checks Gateway health, verifies an administrator identity, performs `LIMIT 0`
probes against policy-approved joins, lets the administrator request datasets,
and stores only connector metadata and permissions in Morph's control plane.

The current planner supports policies, claims, renewals and endorsements. Set
`MORPH_GATEWAY_URL` and the scoped `MORPH_GATEWAY_SERVICE_TOKEN` to use a real
client Gateway. When no Gateway URL is configured, local and hosted prototypes
use a deterministic demonstration Gateway with the same strict policy checks.
A configured Gateway failure never falls back to demo data and no partial
results are displayed.

Morph's D1 application database stores control-plane state such as users,
workspace definitions, connector metadata, preferences and audit identifiers.
Table and rule edits in MorphUI are non-authoritative policy requests. Only the
client Gateway can grant data access. Database credentials, customer data,
client policy files and identity-provider credentials remain client-side.

Run the planner/API and PostgreSQL contract tests with:

```bash
npm run test:workspace
npm run test:gateway
npm run test:app-state
npm run test:db
```

See `docs/gateway-protocol.md` for the Gateway v1.2 endpoint and trust model.

The v1.2 workspace engine is catalogue-driven. Gateway discovery returns the
approved business vocabulary. A structured AI planner interprets each request
into a typed data-and-presentation plan, and a deterministic validator rejects
any entity, field, value, filter, grouping, metric or UI block outside that
catalogue before the Gateway is called. The model receives the prompt and
sanitized catalogue only; it never receives database credentials or customer
result rows. When the model provider is unavailable, MorphUI uses a clearly
identified deterministic fallback.

Presentation instructions are part of the model-generated workspace plan rather
than a fixed screen mapping. The planner may compose metrics, filters, charts,
record tables or grouped summary tables according to the user's request. Every
proposed block is schema validated before rendering.

Enable model planning by setting `MORPH_AI_PLANNER_ENABLED=true`. For Gemini testing,
set `MORPH_PLANNER_PROVIDER=google`, `MORPH_PLANNER_MODEL=gemini-flash-latest`, and
store `GOOGLE_GENERATIVE_AI_API_KEY` as a server-side secret. To switch back to
OpenAI, select `MORPH_PLANNER_PROVIDER=openai`, an OpenAI model ID, and
`OPENAI_API_KEY`. Only the selected provider is called; failures never trigger a
paid-provider switch. Keys are never exposed to the browser or committed to Git.
Google free-tier testing should use synthetic prompts and catalogue metadata only.
Requests have a 30-second deadline and at most one retry; quota or provider failures
retain the explicitly identified deterministic fallback.

## Run the client Gateway locally

The first installable PostgreSQL insurance Gateway is in `gateway/`. It is a
separate Docker service; MorphUI never imports its database executor.

```bash
cp .env.example .env
npm run db:setup
npm run gateway:up
```

The local stack provisions a dedicated read-only PostgreSQL role, mounts the
client policy read-only and exposes the Gateway only on loopback port `8788`.
The values in `.env.example` are development credentials and must be replaced
for every client installation. Health checks do not require an end-user token;
query execution requires a signed assertion from the configured OIDC issuer.

Gateway validation commands:

```bash
npm run gateway:typecheck
npm run test:gateway-service
npm run test:gateway-postgres
npm run gateway:build
```

See `gateway/README.md` for the client installation and production hardening
checklist. This first adapter supports the repository's insurance schema;
additional industries will require explicit catalog adapters rather than raw
SQL access.
