# Iteration 5 Log — Deepen the Emporium Pack-Detail to Full Golden-Contract Anatomy

**Date:** 2026-06-20
**Commits:** `ea4962d` (iter-5a, DOM + read-model) · `1e87a06` (iter-5b, curl faces)
**Headline:** The Emporium pack-detail view went from a flat list of classes+predicates to the **full golden-contract anatomy** — required-vs-optional predicate grouping, datatypes, closed enums, class→class relationships, CRDT wire rules, and minting rules — rendered identically across **all four faces** (DOM, markdown, Turtle, JSON-LD) from **one shell-side read-model**, proven against a **live gardend cell**.

---

## What was deepened

Iteration 5 took two passes over the same target: 5a deepened the **DOM view + the shell-side read-model that feeds it**; 5b deepened the **three curl/text faces** so they carry the identical anatomy and stay isomorphic.

### 5a — Read-model + DOM (commit `ea4962d`)

**(A) Read-model — `apps/organism/src/cell/emporium-client.ts`**
The shell-side `mapPack` parse was deepened to extract, from the live golden contract:

- **WIRE rules** — CRDT doc-connection rules (from_kind, to_kind, predicate/wireName, source comment).
- **Class→class RELATIONSHIPS** — object-property predicates (`datatype:'uri'`) whose range resolves to another pack class. Inferred **generically** (`inferRelatesTo`): leading word of the source note, then longest pack-class-name suffix against the predicate local-name. Only resolves to classes that actually exist in the pack; unresolvable inferences are **honestly omitted, never faked**. No per-vocab hardcoding.
- **CLOSED ENUMS** — parsed from the golden free-text source convention `enum: a|b|c` / `enum (N): a|b|c` (via `parseEnumValues`, with trailing ` - ` prose handling).
- **Per-predicate `multi` + `required`** flags.
- **Per-class `subject_rule`**; pack-level `slug_rule` + `uri_rules` + `doc_id_rules` (minting).
- **Derived STATS** — class / predicate / relationship counts.

These were exposed as **pure-data, OPTIONAL** fields on the render-package `VocabPack` shape (`packages/render/src/target.ts`: `VocabEnum`, `VocabRelationship`, `VocabMinting`, plus `relatesTo` / `enumValues` / `subjectRule` / `relationships` / `minting` / `predicateCount` / `relationshipCount`) so the shape stays congruent and backend-free.

**(B) DOM view — `apps/organism/src/cell/vocab-views.ts`**
Pack-detail now renders:
- per-class card with **REQUIRED-vs-OPTIONAL predicate grouping** (datatype + `multi` as `mn-chip`, `required` as `mn-badge`, closed-enum values as dashed `mn-chip` sets, the subject-minting rule);
- a **RELATIONSHIPS** section (predicate-range edges + CRDT wire edges, from→pred→to);
- the **namespace** table;
- a **MINTING** card (slug strip + uri/doc-id rule tables);
- a pack **STATS** strip (class/predicate/relationship chips + sparkline + sha badge).

Emporium skin (accent purple-400) comes for free via the skin-aware primitives.

**(C) New general component — `packages/components/src/mn-relations.ts`**
A skin-aware directed `FROM →(predicate)→ TO` edge list (socket-style class-link view). Predicate edges = solid connector, wire edges = dashed via a **structural** `.wire` class (not a color swap). Accent-token colored, optional interactive `mn-relation-select` event. Generalized — **explicitly NOT a port of garden's `wf` graph viz**. Catalogued in `catalog-model.ts` `BUILT_PRIMITIVES` + a `catalog.stories.ts` CSF export, and island-clean (lit + nucleus only).

### 5b — Curl faces (commit `1e87a06`)

Deepened the markdown (hypertext), Turtle, and JSON-LD faces in `@shrubbery/render` so they match the iter-5a DOM anatomy exactly — pure library, backend-free:

- **`render-hypertext.ts`** `vocabPackMarkdown` now renders pack STATS, the prefix→namespace table, MINTING (slug rule + uri/doc-id rule tables), RELATIONSHIPS (predicate ranges + CRDT wires) with **curl-followable Navigate class-anchor links**, and per-class required-vs-optional predicate grouping with datatype/multi, closed-enum value sets, object-property range, and the subject-minting rule.
- **`resource-triples.ts`** emits the SAME anatomy as triples (`emp:enumValue`, `emp:relatesTo`, `emp:subjectRule`, relationship edges, namespace rows, slug/uri/doc-id minting, derived stats) so Turtle + JSON-LD are isomorphic.
- **`context.ts`** added the deepened `emp:` terms to `SHARED_CONTEXT` for lossless JSON-LD round-trip.
- **Tooling — `apps/storybook/conneg/emporium.ts`** dropped its second, shallow local `mapPack` and now reuses the shell-side DEEP parse (`organism` `emporium-client` `mapPack`). The curl faces and the live shell read of the same contract therefore produce the **IDENTICAL `VocabPack` — single source, no drift.**

---

## Honest test counts

**Full suite: 469 tests green** across 7 packages (baseline at start of iter-5 was 442; iter-5a → 461; iter-5b → 469). Confirmed by running `pnpm -r test:run` at close.

| Package | Tests | Notes |
|---|---:|---|
| nucleus | 166 | core engine |
| components | 129 | primitives (incl. +16 `mn-relations` unit tests from 5a) |
| storybook | 62 | conneg/catalog tooling (+5 conneg tests in 5b) |
| render | 43 | faces (+3 in 5b: markdown full anatomy, turtle/json-ld carry same triples, json-ld isomorphic round-trip) |
| runtime | 28 | DOM render host |
| tokens | 23 | design system |
| organism | 18 | shell — includes 4 **real** integration files (18 tests) that spawn a live gardend |

### The live integration test (the load-bearing one)

`apps/organism/tests/emporium-pack-anatomy.integration.test.ts` — **3 tests, no mocks.** It:
1. spawns a **current release gardend** (`GARDEN_BIN=/Users/vera/dev/sophia/garden/src-tauri/target/release/examples/gardend`, the release `examples/gardend` binary);
2. reads the `workflow` and `sophia-memory-core` packs **live** off `/emporium`;
3. renders the deepened pack-detail to **real DOM** (happy-dom);
4. asserts the anatomy in **both** the parsed read-model and the rendered output:
   - `AgentNode →wf:partOfWorkflow→ Workflow` predicate relationship (read-model + rendered `mn-relations`);
   - the `flowsInto` CRDT **wire** edge;
   - a required-predicate badge + required/optional grouping + the `wf:phase` multi chip;
   - the pack stats strip + sparkline;
   - the minting slug/uri rules;
   - `sophia-memory-core`'s closed enums — `mem:sourceKind` (8 values) and `mem:contentOrientation` (6 values) — rendering their allowed-value chip sets.

The other organism integration files (`gardend-liveread` 6, `emporium-catalogue-view` 5, `emporium-liveread` 4) likewise spawn a real cell. `tsc --noEmit` clean across all packages; `vite build` of organism clean.

---

## How to view / curl it

```bash
# All 469 tests (includes the real live-gardend integration suites):
cd /Users/vera/dev/sophia/shrubbery
pnpm -r test:run

# Just the deepened pack-detail integration test:
export GARDEN_BIN=/Users/vera/dev/sophia/garden/src-tauri/target/release/examples/gardend
pnpm exec vitest run tests/emporium-pack-anatomy.integration.test.ts   # run from apps/organism

# View live in the browser (spawns a cell + Vite dev server, pick "Emporium catalogue (live)"):
pnpm --dir apps/organism dev

# Re-capture the conneg snapshot from a live cell (byte-identical SHA-256 = proof of real data):
GARDEN_BIN=$GARDEN_BIN pnpm --dir apps/storybook curl-emporium:snapshot

# Serve the curl faces and curl them (conneg server; port shown for examples below):
PORT=8799 pnpm --dir apps/storybook conneg
```

### The curl faces (workflow pack, captured live)

```bash
# (1) BARE -> markdown (full anatomy + Navigate block):
curl -s http://localhost:8799/emporium/workflow
#   => # `workflow` — Mnemosyne Workflow Vocabulary
#      ## Facts ... **Stats** — 9 classes · 75 predicates · 14 relationships
#      ## Namespaces (prefix->URI table) ## Minting (slug rule + uri/doc-id rule tables)
#      ## Relationships — 14 links (predicate ranges + CRDT wires)
#      ## Classes — each with Subject rule + Required(N)/Optional(N) grouped tables
#      ## Navigate (fenced curl block: this page, up, collection, Accept-header curls)

# (2) Accept: text/turtle -> deepened triples present:
curl -s -H "Accept: text/turtle" http://localhost:8799/emporium/workflow \
  | grep -E "emp:Relationship|flowsInto|emp:relatesTo|emp:slugPattern|emp:subjectRule|emp:relationshipCount"

# (3) Accept: application/ld+json -> isomorphic JSON-LD:
curl -s -H "Accept: application/ld+json" http://localhost:8799/emporium/workflow

# Closed enums (these live on sophia-memory-core, NOT workflow):
curl -s http://localhost:8799/emporium/sophia-memory-core | grep "enum:"
#   => `mem:sourceKind` enum: `ConversationTurn` | ... | `CodeChangeEvent`   (8 values)
#      `mem:contentOrientation` enum: `knowledge` | ... | `policy`           (6 values)

# Followable relationship link (HATEOAS): the AgentNode -wf:partOfWorkflow-> Workflow
# row links .../emporium/workflow#workflow ; curl drops the #fragment, lands HTTP 200 on
# the pack page containing the "### `Workflow`" class section.
```

**Isomorphic proof (on the live-curled bytes):** `parseTurtle(wf.ttl)` = 687 triples; `jsonld.toRDF(wf.jsonld)` = 687 triples; equal ⇒ same graph, **no face drift**. Pinned in-suite by the render unit test + the conneg no-drift test (run from `packages/render`, where `jsonld` is a dep).

---

## Verdicts

### No-mock
**PASS.** Every fact is read live from a real cell. The integration tests spawn a current release gardend and read `/emporium` contracts directly. The conneg snapshot was re-captured from a live cell and came back **byte-identical (unchanged SHA-256)** — proof of real, current data, not fabrication. Unresolvable relationship inferences are **omitted, never faked**; honest-absence sections simply don't render.

### Boundary
**HELD.** `@shrubbery/nucleus` and `@shrubbery/render` stayed network/file/DOM-free — iter-5 only added **optional pure-data fields** to the render `VocabPack` shape. All HTTP/CRDT/auth + the deep contract parse live shell-side (`apps/organism`). The components island-guard (lit + nucleus only) stayed green; `mn-relations` is island-clean. The conneg tooling reuses the shell-side parse instead of duplicating it ⇒ single source, no drift between curl faces and the shell view.

### Generality
**PASS — built from primitives, no one-offs.** The deepened pack-detail is composed entirely from general primitives (`mn-card` / `mn-chip` / `mn-badge` / `mn-sparkline` / `mn-ribbon` / `mn-relations`); the only new component, `mn-relations`, is a generic `MnRelation[]` edge list with no Sophia/Emporium hardcoding, skin-aware via the mixin, token-driven, with structural (not color) discrimination of wire vs predicate edges. Enum parsing and range inference are **contract-agnostic** — no per-vocab class lists. The view branches only on data (`required` vs `optional`), never on skin.

---

## Frictions overcome

1. **happy-dom collapses adjacent Lit template parts** at a slot/template boundary (the documented `mn-card`/`mn-ribbon` gotcha). The deepened class card put `renderPredGroup('required')` and `('optional')` as adjacent `${}` parts and they vanished. Fixed by wrapping each multi-part region (pred groups, relationship groups, minting body) in a single stable parent `<div>` and removing whitespace between adjacent parts. Adjacent parts inside a `<td>` (stable parent) render fine, so the enum chips were unaffected.
2. **happy-dom shares ONE `CustomElementRegistry` across test files** under single-fork vitest (required so spawned gardend cells don't race for ports/rocksdb locks) while re-evaluating the module graph per file ⇒ a second test file importing `@shrubbery/components` threw `mn-top-bar has already been used`. Fixed with a test-only `tests/setup.ts` that makes `customElements.define` idempotent (no-op on already-registered tags) — does not touch the island-clean shipped components.
3. **A second, shallow `mapPack` in conneg `emporium.ts`** (classes/predicates only) would have silently drifted from the deep parser. Deleted; now reuses the organism deep parse via the same relative-import pattern the snapshot script uses.
4. **First-draft conneg test** asserted `emp:enumValue` on `workflow`, which has no closed enums — corrected to assert enums against `sophia-memory-core` and relationships/minting against `workflow`.
5. **Ad-hoc tsx/node couldn't resolve `@shrubbery` workspace packages or `jsonld`** for a `/tmp` isomorphic check — moved the count check inside `packages/render` and pinned it in-suite.

---

## Recommendation — Iteration 6

The read path is now complete, general, and live-proven across all four faces. Three candidates:

- **(A) S3/CloudFront deploy of the curl catalogue — RECOMMENDED P0.** The conneg server is ephemeral (test-only localhost). All four faces are already correct, isomorphic, and followable; deploying the conneg-generated four-face layout (`index.{html,md,ttl,jsonld}` per pack — the `build-static` test already produces this object layout) to S3 behind CloudFront on a stable URL moves the Emporium catalogue from a test artifact to a **live coordination surface** agents/tools/docs can reference. Lowest effort, unblocks downstream (agent discovery, schema validation, curl-driven workflows). **Caveat to reconcile during deploy:** the gated static-build edge where a gateway graph-prefix (`/g/emporium`) plus the `/emporium` resource path produces doubled paths — localhost + live conneg are correct, but a real CloudFront/gateway deploy must reconcile the prefix.
- **(B) Relationships graph view — P1.** A force-directed/hierarchical visual mode atop the existing `mn-relations` component to make pack topology visually traversable (nodes=classes, edges=predicates/wires, click to focus a class card). Natural extension of the deepened anatomy; pairs with (A).
- **(C) Write path / pack editor — DEFER.** Read-write UI to mutate predicates/enums/relationships/minting persisted back to the cell. Highest effort and the first write to the catalogue surface — defer until the read path is stable on a real URL and users ask to edit in-shell.

**Decision should be recorded in the `sophia-code-lab` living map at the next convergence checkpoint.**

---

## Artifact status

Both passes committed on `main` (`ea4962d`, `1e87a06`). Working tree clean except pre-existing untracked iteration-log `.md` files (`CURL-CATALOG-SPIKE.md`, `ITERATION-3-LOG.md`, `ITERATION-4-LOG.md`) that predate this session. The re-captured emporium snapshot was byte-identical, so it produced no diff.
