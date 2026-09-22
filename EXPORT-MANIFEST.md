# Export Manifest — Public Source-Available Boundary

This is the explicit boundary definition for Shrubbery's public export: a
**fresh-history publication** of the whole repository as it stands at the
tip of `main`, minus exactly two directories. It is licensed
**source-available** under the [PolyForm Noncommercial License 1.0.0](LICENSE)
— never described as OSS/open source — matching Garden's publication.

Unlike a narrow, engine-scoped export, Shrubbery's boundary is
**inverted**: the default is INCLUDE, and this document exists to enumerate
the exceptions. If a path is not named below, it ships.

This manifest assumes a **fresh history** publication (a new initial commit
or squashed history), not a filtered export of the existing `main` history.

## INCLUDE

**Everything at `main`**, with no other curation — all workspace apps and
packages, the legal HTML pages (Shrubbery's own product text), demo-persona
screenshots, and the hardcoded canary tenant identifiers used by the
browser-side config (a public-by-design deployment detail, pinned by
publication but not a secret). None of these required a judgment call; the
two exclusions below are the only cuts.

## EXCLUDE (with reasons)

### `apps/flow/`

A verbatim vendor of a third party's application (Mithras Flow), including
board-rendering source, its own test suite, and four *evaluation-only*
Grilli Type trial webfonts that are not redistributable. No license grant
for republishing this vendor drop has been recorded, and the directory also
carries deploy scripts specific to a partner playground rather than a
Shrubbery product surface. Excluding it removes the directory and its own
`package.json` (workspace member `@shrubbery/flow-app`) wholesale.

- **Nothing outside `apps/flow/` depends on it.** No other workspace
  member's `package.json` lists `@shrubbery/flow-app` as a dependency.
  Three source comments elsewhere (in `packages/render/` and
  `packages/runtime/`) mention "apps/flow" in prose describing shared
  contracts those packages independently satisfy — they do not import
  anything from the excluded directory, so no code reference breaks.

### `packages/atelier/fixtures/vrm/`

Two real third-party VRM avatar binaries (`seed-san.vrm`, ~10.4MB;
`avatar-sample-a.vrm`, ~14.4MB; ~25MB together) used as deterministic test
fixtures for the atelier package's GLB/VRM-dissection oracle. Their own
`PROVENANCE.md` (excluded along with them) states plainly: "Neither file is
redistributed as part of any Sophia product build." Both carry a
`creditNotation: required` / equivalent obligation from their respective
upstream licenses (VRM Public License 1.0 and the VRoid sample-avatar
terms); excluding them avoids taking on that credit-notation obligation in
a published repository, on top of matching their own provenance doc's
stated intent.

## Deviations from a plain "everything minus two directories" export

A plain path-level cut has two mechanical consequences beyond the file
tree. Both were verified empirically against the actual export set (see
"Stripped-tree proof" below) rather than assumed.

### 1. `apps/flow/` is a pnpm workspace member — no accommodation needed

`pnpm-workspace.yaml` declares members by glob (`apps/*`, `packages/*`), so
removing the `apps/flow` directory removes it from the workspace
automatically; no edit to `pnpm-workspace.yaml` is required.

The remaining question was whether `pnpm-lock.yaml` — which records a
per-project "importer" block for every workspace member, including
`apps/flow` — would make `pnpm install --frozen-lockfile` fail once that
directory (and its importer's on-disk counterpart) is gone. **Tested
directly: it does not.** `pnpm install --frozen-lockfile` succeeds
unmodified against the exported tree, because pnpm's frozen-lockfile
consistency check is one-directional: it verifies that every workspace
project *present on disk* has a satisfying entry in the lockfile. It does
not require the reverse — that every importer *recorded in the lockfile*
still have a directory on disk. The orphaned `apps/flow` importer block
left behind in `pnpm-lock.yaml` is inert dead weight in the published repo,
not a blocker. **No `pnpm-workspace.yaml` or `pnpm-lock.yaml` edit was
made** for this reason; forcing one would be an unnecessary deviation from
the plain cut. (Verified against pnpm 9.0.0, the version pinned in this
repo's own `package.json#packageManager`.)

### 2. `packages/atelier/fixtures/vrm/` is read by three test files — skip guard added

Three Vitest suites in `packages/atelier/src/__tests__/` (`glb-inspect.test.ts`,
`ingest-base.test.ts`, `ingest-garment.test.ts`) read the two VRM binaries
directly inside their top-level `describe()` bodies — i.e. at
test-*collection* time, before any individual `it()` runs. Without a guard,
a tree missing `fixtures/vrm/` does not fail a handful of assertions; it
crashes collection for all three files outright (`ENOENT` thrown during
`describe()` evaluation, before Vitest's own `describe.skipIf` can even
register the tests it would mark skipped — `skipIf`'s factory still runs
during collection, it just marks the *resulting* tests skipped, so it does
not prevent the crash on its own).

**Accommodation added:** a shared existence guard,
`packages/atelier/src/__tests__/support/vrm-fixtures.ts`, exporting
`hasVrmFixtures: boolean`. Each of the three test files now wraps its
existing `describe(...)` blocks in a plain `if (hasVrmFixtures) { ... }
else { describe(..., () => it.skip(...)) }` — ordinary JS control flow,
not a Vitest-level skip — so the fixture reads are never reached when the
files are absent. When the fixtures **are** present (the ordinary case in
Sophia's own tree), every test still runs exactly as before; nothing about
the assertions or fixture-reading logic changed.

The guard also prints the skip reason via `console.warn` at module-load
time and gives each stub test a descriptive name
(`SKIPPED (fixtures/vrm/*.vrm not found — excluded from Shrubbery's public
export; see EXPORT-MANIFEST.md and packages/atelier/fixtures/vrm/PROVENANCE.md
for sources)`), so a `vitest run --reporter=verbose` makes the reason
visible in plain output, not just a silent gap in the test count.

No other automated build or test script reads `fixtures/vrm/`. One piece of
**manual, non-automated dev tooling** — `apps/atelier/.atelier-demo/`, a
standalone Vite demo meant to be pointed at a `.vrm` file by hand — also
references the fixtures path (`vite.config.ts`, `main.ts`), but it is not
invoked by `build`, `test`, `test:run`, or CI; a contributor running the
ordinary install/build/test lanes never touches it. No guard was added
there, since it already requires the operator to supply their own model
file to be useful at all.

## Other changes carried on this branch

- **`.gitignore`:** the seven individually-enumerated
  `apps/<name>/.gardend-loopback.json` entries were replaced with a single
  `**/.gardend-loopback.json` glob (a previously-ruled hygiene fix,
  independent of the export-boundary decision above, carried on this same
  branch because it touches a root file this work also touches). The
  enumerated list had already missed one app directory in practice, which
  is how a loopback session token was committed on an unrelated branch.
  Verified with `git check-ignore` against that app and a sample of the
  original seven.

## Stripped-tree proof

Verified by copying the export set (the tree at this branch's tip, minus
`apps/flow/` and `packages/atelier/fixtures/vrm/` — no other paths touched,
no accommodation files added or removed beyond what's described above)
into a directory outside this repository, then running, in order, against
a warm local pnpm store:

```bash
pnpm install --frozen-lockfile
pnpm --filter @shrubbery/organism build
pnpm --filter @shrubbery/atelier-vtuber exec vitest run --reporter=verbose \
  --exclude '**/*.integration.test.ts' \
  --exclude '**/*.browser.test.ts' \
  --exclude '**/*.probe.test.ts'
```

(The gardend-dependent integration lane — suites that spawn a real
headless engine binary — is deliberately excluded from this proof; its
suites are unaffected by either exclusion above and are not part of the
"install → build → test" contributor path this manifest is about.)

**Results, pnpm 9.0.0:**

| Step | Result | Wall time |
|---|---|---|
| `pnpm install --frozen-lockfile` | Succeeded, unmodified lockfile, no accommodation needed | 8s |
| `pnpm --filter @shrubbery/organism build` | Succeeded (`vite build`, 4827 modules, exit 0) | 24s |
| `@shrubbery/atelier-vtuber` source test lane | 2 files passed (5 tests), 3 files skipped via the guard (visible in `--reporter=verbose` output), exit 0 | 4s |

Total: well under a minute on a warm store, none of the three steps
required any `--no-frozen-lockfile` fallback or lockfile regeneration.
