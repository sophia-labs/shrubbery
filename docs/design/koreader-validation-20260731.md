# KOReader output mode — integration validation (2026-07-31)

## Scope

This record covers the fold of `sophia-koreader-spike.zip` into an isolated
Shrubbery worktree, its validation against a real local Gardend document
projection, and a visible integration proof in KOReader's official Linux
emulator release.

## Provenance

- Bundle SHA-256:
  `97a318671f26462b3a9b045d26596723c4ee560f6abaf78b4a9e2e26f498a9cc`.
- Every one of the 39 entries declared by the bundle's `SHA256SUMS` verified.
- Shrubbery integration base:
  `242dc705abccacae0dba2931760ff1ff4d5c511c` (`origin/main`).
- Garden checkout at validation:
  `5ae47cceb4e9c4e055c28c91fe1f74cc7db6f15a`.
- Gardend debug binary SHA-256:
  `f53fcc94f01ded32a4f56b7f32222dfb7eedd49fa08f3164b99ab5caeb60f2ef`.

## Repository gates

- `pnpm install --frozen-lockfile`: passed for all 22 workspace projects.
- Scoped Biome check over `packages/koreader` and `apps/sophia-koreader`:
  passed with no diagnostics.
- `@shrubbery/koreader` strict typecheck: passed.
- `@shrubbery/koreader`: 14 tests passed across envelope normalization,
  canonical XML projection and active-input refusal, UTF-16 mark bounds, stable
  paths, semantic XHTML, URL neutralization and multi-file artifact generation.
- `@shrubbery/sophia-koreader` strict typecheck: passed.
- `@shrubbery/sophia-koreader`: three hosted/XML/filtering unit tests passed;
  the live integration test skips honestly unless a manifest and graph are
  supplied.
- The full `pnpm test:source` regression suite passed across all 22 workspace
  projects. Existing environment-gated live suites reported their normal
  explicit skips; no test failed.

## Fixture artifact and server

The committed two-document fixture produced:

- one manifest and library index;
- two semantic XHTML documents;
- two semantic JSON sidecars;
- the complete `sophia.koplugin` runtime, including its native home and sprout
  resource;
- an installation guide.

All XHTML parsed with `xmllint`. Every manifest reference resolved. All Lua
sources parsed and byte-compiled with LuaJIT. The local server proved GET and
HEAD behavior, XHTML content type, ETag revalidation to HTTP 304, encoded
traversal refusal, and HTTP 405 for POST.

## Live Gardend gate

The app discovered Gardend through the per-run camelCase loopback manifest and
used its bearer token without placing the secret in process arguments or
generated files. The committed live test passed against `organism-dev`.

The on-disk live build read four authoritative hosted document envelopes and
produced a four-document feed. It preserved the observed identities and
revisions, including `doc-hello-9fa33022a052` at revision 22. The generated
artifact passed XML, manifest-reference and Lua parse checks. Serving that
artifact then proved the graph ID, document ID and revision in both the JSON
sidecar and semantic XHTML, plus ETag revalidation.

No Garden graph or document mutation was issued by the validation.

## Official KOReader emulator gate

The official KOReader Linux x86_64 `v2026.07` archive was verified at SHA-256
`3b1b8d6cce6e53ed0062a7a6a2e58c4f28e8cfe04a429ff79fe690bdcbc6b386`
and run at 800×1200 in the Docker/noVNC harness. The live `organism-dev` feed
loaded four documents into the correct offline cache root. The native Sophia
home opened at startup, synchronized the live feed, remembered the last
document, opened cached XHTML through KOReader, and reopened from KOReader's
More tools menu.

Visual inspection covered the monochrome Sophia home, an intentional empty
manuscript and a non-empty live manuscript. A projection-version migration
forced all four cached XHTML files to refresh even though their Garden
revisions were unchanged. KOReader reported no plugin or Lua runtime errors.

No cross-document link existed in the four live Garden documents, so that
interaction remains covered by deterministic renderer tests and the fixture
rather than this live graph. A physical e-ink device remains a subsequent
hardware gate, not a blocker for the emulator-validated foundation.

## Canonical TipTap XML corpus gate

The follow-on projection was exercised against the live local graph
`local-local-workspace-1778615758274`. Each document envelope supplied identity
and revision metadata; each `/export?format=xml` response supplied the canonical
TipTap fragment. A 200-character presentation threshold omitted two diagram
records and one empty record without mutating Garden, producing seven readable
documents.

The seven semantic models contain 14–36 stable blocks and 795–1,602 text
characters each. The generated XHTML passed XML parsing and visibly preserved
headings, paragraphs, bullets, numbered lists, quotes, emphasis and rules in
KOReader. A repeated leading level-one heading matching the envelope title is
suppressed in XHTML only; it remains present in the semantic sidecar. The live
XML integration test and projection-version-4 cache refresh passed. Ornamental
emoji without glyph coverage fall back in the emulator, so custom font
packaging remains an explicit fidelity follow-up rather than hidden behavior.

## Manuscript navigation gate

Projection version 5 adds an explicit reader navigation rule derived from the
mobile shell's root-versus-detail model. Every manuscript exposes Library,
shelf position and Next at its beginning, plus Previous/boundary state,
position and Next at its end. The renderer test proves that adjacent links use
different stable cached filenames in the same order as the library index.

The native shelf was traced independently: selecting “Minutes from the
Invisible Meeting” opened
`doc-ab1faa9eaf4a4be2b8450bd73cf578e9.xhtml`, while selecting “Protocol 47-B”
opened `doc-87e580c2f1da4779aef714197cc9b9f5.xhtml`; visual inspection confirmed
different titles and bodies. The apparent same-document behavior came from
tapping bold document names inside “A Message from Sophia.” Those source spans
are prose, not Garden wiki links. The new explicit `Next` link crossed from
“A Message from Sophia” to “Minutes from the Invisible Meeting” in the live
emulator. KOReader displayed its standard local-document confirmation before
switching, then showed the second manuscript as position 2 / 7.
