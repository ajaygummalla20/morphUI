# October 23 dependency security checkpoint

The release gate found new Next.js advisories affecting the previously pinned
16.3.8 release. This update pins Next.js and its matching ESLint configuration
to 16.4.1, the vendor's October security release. Other direct dependencies stay
at their existing versions.

The vendor identifies fixes for these three advisories:

- [GHSA-673q-mjm6-r5xr](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr): typed-array handling in `use cache` functions.
- [GHSA-2464-fhr4-w9xw](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw): upstream image optimization vulnerability. The existing Sharp 0.35.5 override is retained.
- [GHSA-p3m5-59mp-jv5r](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r): Server Action resource exhaustion.

Reference: [Next.js October 14 security update](https://nextjs.org/blog/nextjs-security-update-october-14-2026).

MorphUI uses Vinext routing on Cloudflare Workers and currently has no
`next/image` import or `use cache` function. These observations limit known
reachability; they are not a reason to keep a dependency with critical findings.
The update uses disabled install scripts and preserves exact lockfile integrity
pins. Type checks, application/Gateway/database tests, rendering, the production
build and the audit gate must pass before publication. Live model requests and
Docker execution are separate verification activities.

The audit policy remains fail-closed for unexcepted high/critical findings.
Existing moderate Drizzle development-loader findings remain tracked by
[the dependency audit policy](dependency-audit.md); no forced downgrade or
blanket advisory exception is introduced.
