# Notices

Shrubbery is developed by Sophia Labs. It was extracted from `garden/frontend`
on 2026-06-19 (read-only — Garden was never modified) and now lives in its
own repository at https://github.com/sophia-labs/shrubbery. The name and
idea descend from the 2025 Python prototype at `sophia-labs/shrubbery-2025`
(`rhizome` / `mdttl`); see the README's Provenance section for the full
history.

Shrubbery is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE).
The license permits non-commercial use, modification, and redistribution
under those same terms. Commercial use requires a separate agreement with
the maintainers.

Required Notice (per the PolyForm Noncommercial license):

> Copyright Veronica Chambers (https://github.com/sophia-labs/shrubbery)

## Third-Party Software

Shrubbery depends on a number of third-party npm packages, declared in each
workspace member's `package.json` and pinned in `pnpm-lock.yaml`. Each
retains its own license and notices.

A full third-party attribution inventory (a per-dependency license-text
compilation) has not been assembled yet. This is a known follow-up before a
first tagged release, matching Garden's practice of completing that review
before its first public release.

An off-main Rust/loom subsystem (a wasm-bindgen projector plus several
`loom-*` crates, plus a Rust `prebuild` step for `apps/organism`) currently
declares `MIT OR Apache-2.0` in its Cargo metadata. It exists only on agent
branches and is not part of any build on `main` today. When it lands on
`main`, its license metadata must be reconciled to this repository's
PolyForm Noncommercial license (or carved out under a clearly scoped
exception) before it ships as part of Shrubbery.
