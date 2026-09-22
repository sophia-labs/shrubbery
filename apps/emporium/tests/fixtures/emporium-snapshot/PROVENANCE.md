# Emporium vocab-catalogue snapshot (REAL cell capture — not a mock)

These three JSON files are **verbatim captures** of a CURRENT gardend cell's
`/emporium` routes (the Jun-19 release build). They are NOT hand-written mock
packs: each is the exact response body the live cell returned — the same shape
`EmporiumClient` (`@shrubbery/source/emporium`) reads live over the wire.

| File | Route captured |
|------|----------------|
| `vocabs.json` | `GET /emporium/vocabs` |
| `vocab.workflow.1.0.0.json` | `GET /emporium/vocab/workflow/1.0.0` |
| `vocab.sophia-memory-core.1.0.0.json` | `GET /emporium/vocab/sophia-memory-core/1.0.0` |

## Why they live here

The no-infra CI lane (`pnpm test:source`) runs in plain node with NO live cell.
These captured-real bodies let the no-infra behavioral tests
(`*-noinfra.test.ts` / the `vocab-*` / `router-*` files) drive the REAL parse →
map → render path — the same `EmporiumClient` / `mapPack` / view code the live
shell runs — without a gardend binary. The LIVE-read path (spawning a real cell)
stays fully exercised by the `*.integration.test.ts` files, which need infra.

Mirrored verbatim from `apps/storybook/conneg/emporium-snapshot/` (the shared
real capture). Regenerate both from a fresh release cell with
`pnpm --dir apps/storybook curl-emporium:snapshot`.
