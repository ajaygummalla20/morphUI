# MorphUI contribution rules

- Source of record: https://github.com/ajaygummalla20/morphUI. Push code only here; do not mirror source to the legacy Sites Git remote.
- Preserve the catalogue-driven query/UI contract. Explicit presentation requests must determine the rendered blocks.
- Production APIs require verified server sessions. Demo mode must be explicit and cannot access a client Gateway.
- Client Gateway policies remain authoritative. Browser metadata cannot grant database access.
- Never commit API keys, environment files, signing keys, database credentials or customer results.
- Saved workspaces contain definitions only. Reopening executes a fresh authorized query.
- Run `npm run check` before publishing. Docker and live-model checks must be reported separately when unavailable.
