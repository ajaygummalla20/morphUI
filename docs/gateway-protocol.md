# Morph Gateway protocol v1.3

The Morph Gateway is installed and operated inside the client environment. It
is the only component allowed to hold database credentials, cryptographically
verify client identity, resolve client identity mappings, evaluate authoritative
data policies, and execute queries.

## Trust boundary

MorphUI sends a structured `select` plan to the Gateway. It never sends raw SQL
and never receives database credentials. The request contains a short-lived
signed OIDC assertion, not editable user or group fields. The Gateway validates
the assertion against the client's JWKS endpoint and resolves groups from its
client-owned identity mapping.

The Gateway must reject any request that contains:

- a non-`select` operation;
- an entity, field, filter, or grouping outside the client policy;
- more than 200 requested rows;
- an unverified identity;
- an invalid, expired, incorrectly issued or replayed identity assertion; or
- a stale catalogue version or unapproved sort field; or
- a protocol payload outside the strict v1.3 schema.

## Required endpoints

### `GET /v1/health`

Returns the supported protocol and active policy version. It must not expose
credentials, hostnames, schemas, or customer data.

### `POST /v1/query-plans/execute`

Accepts the versioned request defined in `lib/gateway/contract.ts`. The Gateway
performs these operations in order:

1. Authenticate the Morph service connection.
2. Verify the OIDC signature, issuer, audience, email, organization and time claims.
3. Reject a reused `jti` before database execution.
4. Map the verified email using the client-owned identity map.
5. Resolve the user's client-owned groups and data role.
6. Validate the complete plan against the active policy.
7. Compile the approved plan to parameterized SQL internally.
8. Execute with a read-only database account and statement timeout.
9. Mask sensitive fields and enforce the row cap.
10. Return either an `allow` result or a deterministic `deny` decision.

The returned `decisionId`, `policyVersion` and `catalogVersion` are safe audit identifiers.
Returned rows must match the approved result schema. MorphUI rejects malformed
Gateway responses and displays no partial data.

The installable reference implementation lives in `gateway/`. It uses a
client-owned JSON policy, a hard-coded insurance query catalog, a dedicated
read-only PostgreSQL transaction and output masking. Authorization uses only
the verified assertion and client-owned group mappings.

### `POST /v1/catalog/discover`

Supports connector onboarding without exposing unrestricted database metadata.
The Gateway performs these checks in order:

1. Authenticate the Morph service connection.
2. Verify the one-time OIDC identity assertion.
3. Require membership in a client-configured onboarding administrator group.
4. Match the organization and connector to the client policy.
5. Compile each policy-approved entity into a fixed `LIMIT 0` catalog probe.
6. Verify approved tables, joins and fields through the read-only database role.
7. Return versioned logical entities, field meaning, sensitivity, masking,
   filter/sort/group capabilities, safe metrics, relationships and row limits.

Catalog discovery never returns database credentials, arbitrary schemas, raw
SQL, filter values or customer rows. The same replay protection and privacy-safe
audit rules used for query execution apply to onboarding.

## Deployment configuration

MorphUI requires only the Gateway HTTPS endpoint and, for the first production
integration, a scoped service token supplied as a hosted secret. Database
passwords, certificates, encryption keys, policy files, and identity-provider
credentials remain exclusively in the client environment.

For enterprise production, replace the scoped token with mutual TLS or a
private network tunnel and rotate credentials through the client's secret
manager.

Protocol v1.3 accepts RS256 identity assertions with a maximum configured age of
five minutes. The request carries the organization and assertion only; subject,
email and group values used for authorization come from the verified token and
the client-owned policy.

## Complete analytic answers

Protocol 1.3 adds an optional `analysis` definition: one catalogue metric, optional
approved date/grain/range, and `none` or `previous_bucket` comparison. The client
policy must opt in with `aggregateMetricIds`; omitted settings deny analysis.
Measures, dates and groupings must be unmasked and approved, with the date's
`between` operator authorized. Growth requires complete calendar periods.

The compiler aggregates all matching business records before limiting result
buckets/groups. It retrieves one extra aggregate row to detect overflow; the
Gateway denies incomplete results rather than showing a misleading partial total.
Analytic rows are `{bucket, group, value, record_count}` and the response declares
`resultScope: all_matching_records`. Record responses use `returned_records`.
The UI plan separately selects `chartValue`: metric levels, absolute period change,
or percentage period change. This display choice cannot change the authorized
query or introduce a new database calculation. No customer records are sent to the model. Policy premium trends currently use
coverage start date, not an unapproved issuance-date field. Install the updated
Gateway and app together; earlier protocol versions fail closed.
