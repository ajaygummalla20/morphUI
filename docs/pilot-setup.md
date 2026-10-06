# MorphUI pilot setup and acceptance

Source of record: https://github.com/ajaygummalla20/morphUI.
The legacy Sites deployment does not automatically receive GitHub commits.
No source is pushed to its internal Git repository. The GitHub deployment
workflow targets a separately configured Cloudflare pilot Worker.

## Local demonstration

Use Node 24 and install the locked dependencies without lifecycle scripts:

```bash
npm ci --ignore-scripts
npm ci --prefix gateway --ignore-scripts
cp .env.example .env
npm run app:db:migrate:local
npm run dev
```

The example environment explicitly selects synthetic demo authentication and
leaves the remote Gateway URL blank. Demo access is visibly labelled. Production
does not default to demo, accept identity headers or automatically assign admin.
If you configure a remote Gateway, use OIDC authentication; demo access cannot
be combined with client data. The default connector is seeded only in demo mode.

## Client identity

Register a confidential OIDC web application in the client's identity provider.
Register exactly `https://YOUR-MORPH-DOMAIN/api/auth/callback`. Enable authorization
code flow, S256 PKCE and RS256 signed ID tokens. The verified email claim must
be present. Set these runtime settings using the hosting secret/configuration
interface, not Git or browser JavaScript:

| Setting | Purpose |
|---|---|
| `MORPH_AUTH_MODE=oidc` | Enable production sign-in |
| `MORPH_APP_ORIGIN` | Exact HTTPS origin used for callback and CSRF checks |
| `MORPH_OIDC_ISSUER` | Expected ID-token issuer |
| `MORPH_OIDC_AUTHORIZATION_URL` | Configured authorization endpoint |
| `MORPH_OIDC_TOKEN_URL` | Configured token exchange endpoint |
| `MORPH_OIDC_JWKS_URL` | Configured signing-key endpoint |
| `MORPH_OIDC_CLIENT_ID` | Registered application audience |
| `MORPH_OIDC_CLIENT_SECRET` | Confidential application secret |
| `MORPH_AUTH_MEMBERSHIPS` | Server-owned issuer/subject-to-tenant/role mappings |

Example membership, using placeholder identities:

```json
[
  {
    "issuer": "https://identity.client.example",
    "subject": "employee-subject-from-verified-id-token",
    "organizationId": "org_client",
    "organizationName": "Client organization",
    "role": "member"
  }
]
```

Provision an explicit admin mapping for connector administration. A verified
email or a caller-supplied group never grants product administration. Mapping
removal, tenant changes and role downgrades apply on the next API request.
Sessions last eight hours and store only a digest of the browser's random
cookie. OIDC ID/access tokens are not persisted. Logout revokes the session.

## Gateway identity bridge

MorphUI mints a distinct 60-second RS256 assertion per discovery/execution
request after verifying the application session. It includes subject, verified
email, organization, request ID and unique token ID. It never forwards an
identity assertion supplied by the browser.

Configure `MORPH_ASSERTION_ISSUER`, `MORPH_ASSERTION_AUDIENCE` and a private RSA JWK
including `kid` in `MORPH_ASSERTION_PRIVATE_JWK`. Publish only the public JWK at
the HTTPS JWKS endpoint the client approves. Configure the Gateway to trust
this issuer, audience and JWKS. This is a deliberate client trust decision;
it is separate from the employee's OIDC ID token and its lifetime.

Set `MORPH_GATEWAY_URL`, `MORPH_GATEWAY_SERVICE_TOKEN`, `MORPH_ORGANIZATION_ID` and
`MORPH_GATEWAY_CONNECTOR_ID`. The Gateway keeps its own database credentials
and authoritative user/entity/field/masking policy. The application dataset
selection can narrow that policy, never widen it. Runtime catalogue discovery
returns only permitted metadata without running onboarding schema probes;
onboarding remains administrator-only and performs zero-row probes.

This pilot deployment supports **one configured client Gateway and organization**.
Product-state storage enforces tenant boundaries, but Gateway URL/routing is not
yet a multi-client provisioning service. The Gateway replay cache is process-local:
run one instance for this pilot; distributed replay persistence and key-rotation
automation must be added before a multi-instance rollout.

## GitHub checks and activation

- `Validate MorphUI` runs on main and pull requests. It tests, builds and audits
  the web app and Gateway. A separate job starts Docker PostgreSQL/Gateway,
  then verifies signed HTTP execution against real PostgreSQL.
- The smoke script starts an in-process Gateway with an ephemeral JWKS fixture;
  container startup/health is a separate check. It does not establish that signed
  execution traversed the container itself.
- `Verify configured AI planner` is manual and uses the `pilot` environment's
  `GOOGLE_GENERATIVE_AI_API_KEY` secret. It sends synthetic prompts/catalogue
  only and fails if AI falls back or returns the wrong layout/filter/grouping.
- `Deploy configured Cloudflare pilot` is manual and runs all checks before D1
  migrations/deployment. It requires environment secrets `CLOUDFLARE_ACCOUNT_ID`
  and a scoped `CLOUDFLARE_API_TOKEN`, plus variables `MORPH_DEPLOY_WORKER_NAME`
  and `MORPH_DEPLOY_DATABASE_ID`. Create the Worker and D1 database first, then
  configure runtime OIDC/Gateway/AI secrets. Deployment preserves existing vars.

No secret can be recovered from the legacy hosting secret store. Supply a
rotated provider key through GitHub/Cloudflare secret settings to activate the
live AI check. Never paste a production key into a commit or documentation.

## Pilot acceptance

1. Admin and member sign in through the client's real IdP; unknown subjects fail.
2. Admin activates an approved connector; a member cannot configure it.
3. Member generates only Gateway-permitted datasets. Invalid identity, replay,
   forbidden fields and excessive rows are rejected before database access.
4. “Pending endorsements grouped by type, table only” produces a grouped table
   with pending statuses; the circular-graph policy prompt produces a donut
   and preserves the date/premium/manager constraints.
5. Save, rename, pin, delete and organization-share a workspace definition.
   Opening it fetches fresh data under the opening user's permissions.
6. Tenant B cannot see Tenant A's connector, saved view or audit events.
7. Logout/session expiry clears the application view. Failed writes never claim
   to have saved locally or retain customer results in localStorage.

Database results are transient; saved workspaces contain title/prompt and
ownership/sharing metadata, not rows, chart values or KPI values. Prompts and
filter values may still contain information entered by a user. Establish client
retention and prompt-handling rules before using sensitive prompts.

## Operations

Shared D1 rate limits cap generation at 12 requests/minute per user and
organization, administration at 12/minute, health at 30/minute and state at
60/minute. Limits fail closed if storage is unavailable. JSON bodies have byte
limits; Gateway queries have a five-second statement timeout and 200-row cap.
Structured application logs contain operation/request/outcome/duration only.
Server-side run records contain policy decisions and result counts, not results.

Watch provider authentication/quota/timeout fallback rates, Gateway failures,
rate-limit rejections and request latency. Export Worker logs to the client's
chosen monitoring system and configure alerts there. External log drains,
alert recipients, backup schedules and production IdP configuration have not
been activated by the source change.

Run `npm run check` locally. Docker and live-provider checks require their own
configured environments and must be reported separately from unit tests.
