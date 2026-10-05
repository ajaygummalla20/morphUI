# MorphUI engineering review — 21 September 2026

## Scope and outcomes

Reviewed prompt → validated plan → Gateway → renderer and CSV export. Applied security, debugging, testing, API design, frontend and review workflows from Addy Osmani's MIT-licensed agent-skills, pinned to `dc27a9c2e13721158157632de61b4106c6c2a2a1`. Eight standalone skills were installed with their references and licenses; no upstream hooks or executable tooling were installed in MorphUI.

- Reproduced and fixed demo Gateway filters being approved but ignored. Sorting and limiting now follow filtering; only selected columns leave the adapter.
- Filled missing policy fields in renewal fixtures. Fixtures no longer apply a premature result limit before the approved query is evaluated.
- Bound remote responses to request/connector identity, executed plan, catalogue, selected fields and actual row ceilings. Required remote OIDC verification and masking metadata. This validates the envelope; the client Gateway remains responsible for enforcing identity, policy and masking.
- Disabled redirects on credential-bearing Gateway calls and bounded health checks to ten seconds.
- Neutralized formula-like strings in CSV exports while preserving numeric negative amounts.
- Explained basic-planner fallback next to results, with a retry path. Gemini configuration remains unchanged; tests use controlled provider responses and do not establish current provider availability.
- Patched the React/React DOM/React Server Components family from 19.2.6 to 19.2.8 for [GHSA-wx67-qw84-cm4g](https://github.com/react/react/security/advisories/GHSA-wx67-qw84-cm4g). Only these three locked packages changed; dependency lifecycle scripts were disabled during installation.

## Trust boundaries

User prompts and model proposals are untrusted. A catalogue allowlist constrains plans, and the client-operated Gateway authorizes queries before PostgreSQL access. Remote Gateway responses are untrusted transport data and must match the originating request before rendering. Database text exported to spreadsheets is untrusted formula input. Server-held provider and Gateway credentials must not enter client bundles, result rows, or logs.

## Verification

Regression tests cover pending endorsements (12 records, three groups), filter-before-limit, projection, sorting, malformed remote envelopes, formula exports, table-only/circular layout planning and Gemini structured output. Existing Gateway identity/policy/HTTP tests, PostgreSQL-compatible integration tests, D1 migration tests, TypeScript and production build are release checks. An independent review caught policy ceiling versus requested-limit semantics; the fix and regression fixture preserve the real Gateway contract.

Browser preview uses no provider secret and exercises the explicitly labelled basic planner. It is separate from the deployed Gemini configuration. Docker was not exercised in this pass.

## Dependency findings and follow-up

**Update:** The critical/high follow-up was completed in the [22 September dependency security update](dependency-security-2026-09-22.md). The counts below preserve the original review baseline.

Native npm audit of the root lockfile: 24 findings before, 23 after the React patch (1 critical, 13 high, 8 moderate, 1 low). The independent `gateway` lockfile reports zero known advisories. This is not a clean security audit or production-readiness approval.

The remaining findings are deferred to a dedicated, tested platform update, with review due **28 September 2026**, before any client pilot or audience expansion:

| Packages | Exposure and next action |
| --- | --- |
| `next`, `sharp`, `postcss` | Next/image processing advisories, including critical findings. Hosted routing uses Vinext/Cloudflare rather than the Next Node server; the UI has no `next/image` import. Do not infer universal safety from that. Upgrade the pinned Next/tooling family and verify both hosted and local paths before client use. |
| `vinext`, `image-size` | Image metadata parsing is present in the framework; untrusted uploads are not a product feature. Audit suggests a major/beta Vinext migration. Review its compatibility with Sites before upgrading; do not force an audit fix. |
| `@cloudflare/vite-plugin`, `wrangler`, `miniflare`, `undici`, `ws` | Development/build/deployment tooling graph; not the separately installed client Gateway. Update as a compatible group and test supervised preview, Worker packaging and deployment. |
| `vite` | Development server advisories include Windows path handling. Current managed preview is Linux and hosted output is a Worker; Windows local development still needs the pinned Vite update. |
| `brace-expansion`, `browserslist`, `fast-uri`, `js-yaml`, `nanoid` | Transitive high findings in build/config/development paths. Keep untrusted configuration out of these tools; resolve patched compatible versions and validate the lockfile/build. |
| `@esbuild-kit/core-utils`, `@esbuild-kit/esm-loader`, `drizzle-kit`, `esbuild`, `baseline-browser-mapping`, `fflate`, `@babel/core` | Remaining moderate/low toolchain findings. Do not accept npm's suggested Drizzle downgrade blindly. Upgrade in tested groups and reassess execution-path reachability. |

## Remaining pilot work

Real employee sign-in, tenant-bound control-plane authorization, distributed rate limits, credential rotation, retention/deletion policy, real client Gateway onboarding and operational monitoring still require a dedicated pilot milestone. Keep this deployment owner-private with synthetic data. Saved prompts may contain sensitive user-entered text; do not treat them as automatically non-sensitive metadata. No real client data connection or access expansion was performed by this update.
