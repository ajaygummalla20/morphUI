# Morph Gateway

Morph Gateway is the client-installed data plane for MorphUI. It runs inside
the client's network and is the only Morph component that knows the PostgreSQL
connection string or authoritative data policy.

This first adapter supports the insurance reference schema in this repository:
policies, claims and endorsements. Additional industries will use separate
catalog adapters; the Gateway deliberately has no generic raw-SQL endpoint.

## Security properties

- accepts only the strict Morph query-plan protocol v1.3;
- authenticates every request with a scoped service token;
- verifies an RS256 OIDC assertion against the client's HTTPS JWKS endpoint;
- requires verified email, issuer, audience, organization, expiry and token age;
- rejects expired, invalid and replayed identity assertions before database access;
- accepts no caller-supplied groups and resolves groups from client policy;
- permits only hard-coded entities, joins, fields, filters and ordering;
- rejects plans created from a stale semantic catalogue version;
- places every value in a PostgreSQL parameter—never SQL text;
- executes inside a read-only transaction with a five-second timeout;
- uses a dedicated PostgreSQL role with `default_transaction_read_only=on`;
- masks configured result fields before they leave the Gateway;
- limits responses to 200 rows;
- emits JSON audit events without query values, result rows or plain user IDs;
- exposes policy-scoped catalog discovery using zero-row schema probes;
- runs as a non-root, capability-free, read-only Docker container.

## Local reference installation

From the repository root:

```bash
cp .env.example .env
npm run db:setup
npm run gateway:up
```

Check the container with:

```bash
curl -H "Authorization: Bearer morph-local-gateway-token-change-me" \
  http://127.0.0.1:8788/v1/health
```

The local values are deliberately obvious development credentials. Never use
them for a client installation.

## Client installation

1. Create a PostgreSQL login that has `CONNECT`, schema `USAGE` and `SELECT`
   only on the approved tables or views. Set `default_transaction_read_only`
   and a short `statement_timeout` on the role.
2. Copy `config/policy.example.json` to a client-controlled path. Change the
   organization, connector, identities, groups, entities, fields, filters and
   masking rules. Set `onboardingAdminGroups` to groups allowed to run catalog
   discovery. Mount the file read-only at `/app/gateway/config/policy.json`.
3. Generate two independent secrets:

   ```bash
   openssl rand -hex 32  # Morph service token
   openssl rand -hex 32  # audit subject-hash salt
   ```

4. Run the container inside the private database network. Supply:

   - `DATABASE_URL` for the read-only PostgreSQL role;
   - `MORPH_GATEWAY_SERVICE_TOKEN`;
   - `MORPH_GATEWAY_AUDIT_HASH_SALT`;
   - `MORPH_GATEWAY_ID`;
   - `MORPH_GATEWAY_POLICY_PATH=/app/gateway/config/policy.json`;
   - `MORPH_GATEWAY_OIDC_ISSUER` for the exact client token issuer;
   - `MORPH_GATEWAY_OIDC_AUDIENCE` for the Gateway audience;
   - `MORPH_GATEWAY_OIDC_JWKS_URL` for the client's HTTPS signing-key set.

5. Do not expose the container's plain HTTP port directly to the internet. Put
   it behind the client's TLS reverse proxy, private ingress or mutual-TLS
   gateway. MorphUI rejects non-HTTPS production endpoints.
6. Configure the client IdP or token exchange to issue short-lived RS256 tokens
   with `sub`, `email`, `email_verified=true`, `org_id`, `jti`, `iat`, `exp`, the
   configured issuer and the Gateway audience. Keep the lifetime at five
   minutes or less.
7. Configure the authenticated MorphUI host to forward that token to its
   server-side workspace route as `X-Morph-Client-Identity-Assertion`. The
   browser's unsigned identity fields are never accepted as proof.
8. Configure MorphUI with the public/private HTTPS Gateway URL and the same
   scoped service token. Database credentials, signing keys and policy files
   are never added to MorphUI.

The Gateway accepts each assertion once. A retry must obtain a new assertion
with a new `jti`.

## Audit output

Audit events are JSON lines written to standard output for collection by the
client's SIEM. They include the decision, policy version, entity, counts,
duration and a salted subject hash. They exclude prompts, filters values,
returned rows, database credentials and plain user identifiers.

Analytics require explicit `aggregateMetricIds` approval in each entity policy.
The example opts in to catalogue count/sum/average measures. Existing policies
without this setting keep record queries and deny analytical queries. Approved
measures, date fields and category fields must be unmasked. Calendar analysis
uses UTC days; results aggregate the entire authorized selection before result
group limits. An extra result group triggers an audited denial, not truncation.
