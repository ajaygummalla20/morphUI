# Dependency audit policy — 2026-10-06

The release updates Next.js to 16.3.8, its ESLint config to 16.3.8, Cloudflare's
Vite plugin to 1.62.5, Wrangler to 4.147.0 and Workers types to 5.20261006.1.
It updates the vulnerable source-map-js dependency to the patched 1.2.2 line.
Authentication uses jose 6.2.12 with RS256, fixed issuer/audience and nonce checks.
Sharp is pinned to 0.35.5 through a root override for the newly reported
[GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w).
Miniflare currently pins the vulnerable 0.35.4 release; the override applies the
compatible security patch without downgrading the Cloudflare toolchain.
Geist 1.7.2 supplies local font files, so builds and page rendering do not depend
on a Google Fonts download. The rendered-page test verifies both emitted assets.

`npm run audit:security` prints the full root and Gateway audit. It fails for
every high/critical advisory except one identified, development-only exception:
**GHSA-vfj7-8cjw-p6xm**, braces stack exhaustion on deeply nested glob patterns.
As of this check, npm has no patched braces release. Affected root packages are
build/lint glob tooling, not production dependencies; the exception checks every
reported package path against the lockfile's development flag and expires on
**2026-11-06**. Unrelated advisories or a production path fail the check.

Do not process user-supplied glob patterns in build tools or expose development
servers. Update the tooling when a compatible fix is published. Four moderate
findings in Drizzle's legacy development loader remain tracked by the full audit.
Do not downgrade Drizzle or Vinext based solely on npm's suggested major-version
replacement; that can break the supported build stack without fixing the actual
runtime risk.

The Gateway audit has no findings at this checkpoint. A passing gate is not a
claim that the complete root audit has zero findings; the exact output remains
visible in CI.
The root production-only audit also reports zero findings at this checkpoint.
