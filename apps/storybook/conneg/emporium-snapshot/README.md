# Emporium vocab-catalogue snapshot (REAL cell capture — not a mock)

These three JSON files are **verbatim captures** of a CURRENT gardend cell's
`/emporium` routes (the Jun-19 release build, which serves the routes — the debug
build is stale). They are NOT hand-written mock packs: each is the exact response
body the live cell returned.

| File | Route captured |
|------|----------------|
| `vocabs.json` | `GET /emporium/vocabs` |
| `vocab.workflow.1.0.0.json` | `GET /emporium/vocab/workflow/1.0.0` |
| `vocab.sophia-memory-core.1.0.0.json` | `GET /emporium/vocab/sophia-memory-core/1.0.0` |

## Why a snapshot here

The conneg dev server + static builder run in **plain node with no live cell**
(the same boundary the curl-catalog spike drew: the conneg server is a faithful
LOCAL simulation of CloudFront+S3, not the prod transport). So the curl-able
`/emporium` faces are rendered from this captured-real registry.

The **LIVE read** path — spawning a current cell and reading `/emporium` over the
wire through the shell-side `EmporiumClient` — is fully exercised, with NO
snapshot, by `apps/organism/tests/emporium-liveread.integration.test.ts`.

## Regenerating

Re-capture against a fresh release cell:

```bash
pnpm --dir apps/storybook curl-emporium:snapshot
```

(`apps/storybook/conneg/snapshot-emporium.mts` — spawns the release gardend via
the organism's `spawnGardend`, curls the three routes, rewrites these files.)
