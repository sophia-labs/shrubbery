# Contributing to Shrubbery

Shrubbery is a pure RDF→UI interpreter and component library from Sophia
Labs, licensed **source-available** under the
[PolyForm Noncommercial License 1.0.0](LICENSE) — not open source / OSS.
This repository is the canonical Shrubbery source: pull requests here are
what ships, and there is no private copy behind it. See the README's
Provenance section for its history.

## Setup

Shrubbery is a pnpm workspace (14 apps + 13 packages).

```bash
pnpm install --frozen-lockfile
```

Always use `pnpm` — never `npm` or `yarn` — so the workspace's
`workspace:*` links and the pinned lockfile stay authoritative.

## Run these locally before opening a PR

CI runs exactly these. Run them first; a green run here is a green run there.

```bash
pnpm install --frozen-lockfile
pnpm lint                              # Biome, whole tree
pnpm -r --no-bail run typecheck        # every workspace member
node scripts/validate-no-mocks.mjs     # no-mocks ratchet: the frozen debt list can only shrink
pnpm test:source                       # source-owned unit and component tests (no gardend needed)
pnpm -r run build                      # builds every app and package
pnpm test:real                         # real gardend, real browsers: Chromium and WebKit
```

All of them are gating: a red one blocks the merge, and a merge to `main` ships the hosted app.

### `pnpm test:real`

One command runs the suites that need a real gardend in a real browser. It finds a gardend by itself:

1. `GARDEN_BIN=/path/to/gardend`, if you set it;
2. otherwise the prebuilt binary for the sha pinned in `scripts/gardend.pin` (or, without a pin, the newest one), which
   GitHub builds for every commit on `sophia-labs/gardend` `main` and which the script downloads once into
   `.gardend-cache/`. No Rust toolchain needed;
3. otherwise a build beside this checkout: `../gardend/src-tauri/target/release/examples/gardend`.

Each suite starts its own gardend on a scratch profile and a random port, and removes it afterwards; nothing touches a
gardend you already run. Useful options: `--engine webkit`, `--only find`, `--list`, `--all` (adds the long browser
harnesses), `--no-install` (skip the Playwright download). WebKit matters: the desktop app runs in WKWebView, and
`test:app-csp-built` serves the built app under the exact Content Security Policy that app ships with.

If your change needs a gardend that has not been built yet, build it yourself with the local build service described
in `sophia-labs/gardend`'s CONTRIBUTING.md and pass it as `GARDEN_BIN`.

The browser suites are also runnable one at a time, for example
`SHRUBBERY_BROWSER_ENGINE=webkit pnpm --filter @shrubbery/organism test:editor-find`.

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
