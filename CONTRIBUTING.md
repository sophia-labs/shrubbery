# Contributing to Shrubbery

Shrubbery is a pure RDF→UI interpreter and component library from Sophia
Labs, licensed **source-available** under the
[PolyForm Noncommercial License 1.0.0](LICENSE) — not open source / OSS.
See the README's Provenance section for its history.

## Setup

Shrubbery is a pnpm workspace (14 apps + 13 packages).

```bash
pnpm install --frozen-lockfile
```

Always use `pnpm` — never `npm` or `yarn` — so the workspace's
`workspace:*` links and the pinned lockfile stay authoritative.

## Validation — the gates that run publicly

These are the checks CI (`.github/workflows/ci.yml`, the `test` and
`browser` jobs) runs on every PR/push, and that an external contributor can
run and satisfy end to end, no credentials required:

```bash
pnpm lint                              # Biome, whole tree
pnpm -r --no-bail run typecheck        # every workspace member
node scripts/validate-no-mocks.mjs     # no-mocks ratchet — the frozen debt list can only shrink
pnpm test:source                       # source-owned unit/component tests (no gardend needed)
pnpm -r run build                      # builds every app and package
```

The `browser` job additionally drives the organism and Hoja apps in a real
installed Chromium — no mocks, real DOM:

```bash
pnpm --filter @shrubbery/organism test:browser
pnpm --filter @shrubbery/hoja-app test:browser
pnpm test:browser-suites               # generic *.browser.test.ts suites
pnpm --filter @shrubbery/organism test:browser-verified
```

## The integration lane needs a local `gardend`

The `integration` CI job and the repo's `*.integration.test.ts` /
`*.probe.test.ts` suites spawn a real `gardend` binary — there is no mock
backend. That job is `workflow_dispatch`-only (a `GARDEN_BIN` secret must
point at a built binary) and is skipped on every ordinary PR/push, so the
gap is explicit rather than silent.

To run those suites locally, build `gardend` from the public
**`sophia-labs/gardend`** repository (published in a parallel campaign) and
point the `GARDEN_BIN` environment variable at the resulting binary — see
`packages/source/src/node/spawn-gardend.ts` for the exact contract.

## Scope

- The library packages (`packages/*`) stay backend-free: no auth, CRDT,
  HTTP, or Tauri code. All of that lives shell-side, injected behind
  `ShrubberyContract` (`packages/nucleus/src/contract.ts`) — see
  `ARCHITECTURE.md`.
- No mocks. Test real functions against real inputs; a stubbed contract is
  not a substitute. `scripts/validate-no-mocks.mjs` enforces a frozen,
  shrink-only exception list.
- Generalize components lifted from an app into `packages/components`
  (rebound to skin role tokens) rather than leaving them as app one-offs.
