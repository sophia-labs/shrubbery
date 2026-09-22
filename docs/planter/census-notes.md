# Census note — FID-004, for the census owner

`docs/acceptance/` (the garden→shrubbery live-fidelity census,
`LIVE_FIDELITY_CENSUS_20260710.md` + the acceptance manifest/schemas/spec) is
**NO-TOUCH** for this campaign — nothing in `docs/acceptance/**` is edited by
this unit or any other unit in the PLANTER slice. This file is a
freestanding note, addressed to whoever owns the census's next revision, so
this campaign's own FID-004 work doesn't get silently conflated with the
census's FID-004 finding.

## The census's FID-004 (unchanged, unresolved by this campaign)

`LIVE_FIDELITY_CENSUS_20260710.md`, row `FID-004` ("Backend contract", High,
**Open**, `ACC-CAP-EDIT-001`/`ACC-CAP-EDIT-006`/`ACC-CAP-COLLAB-002` /
`ACC-J200`/`ACC-J220`/`ACC-J800`): *"The workspace and live CRDT projections
expose the same document, title, block ID and text, but `read_document`,
`read_blocks`, `query_blocks`, `document_digest`, history and
`search_documents` all report it missing or return zero hits. `rdfTripleCount`
is zero; cold title recovery can fall back to `Untitled`."* Its structural
contract: *"Collaborative Y.Doc authority, workspace catalog authority,
document snapshot authority, search index and RDF projection do not converge
on create/update."* Its required closure proof: full document/block/
search/history convergence, before AND after restart, across the editor's
document/collaboration surface.

**This campaign does not close, narrow, or otherwise touch that finding.**
Its status stays exactly `Open` as far as this campaign is concerned; nothing
here should be read into the census document, and nothing in the census
document should be edited on the strength of this note.

## What PLANTER's own "FID-004" probe actually proves (a narrower, adjacent claim)

The build campaign that produced this slice internally names its own
live-read acceptance gate "FID-004" (design §3.4/D11,
`packages/source/tests/fid004-convergence.probe.test.ts`, "THE WF-D LIVE-READ
GATE (FID-004, R10)") — the SAME short label, a **different and narrower**
claim:

- **Census FID-004** is about the editor/collaboration surface: whether a
  document written through the live UI converges across `read_document`,
  `read_blocks`, `query_blocks`, `document_digest`, history, and
  `search_documents` — five distinct authorities, all document/block-shaped.
- **Planter's probe** is about ONE narrower thing: whether `:ux:config`
  named-graph **triples**, written through gardend's real API (`rdf_load` and
  `sparql_update`), are visible to a **cold** `sparql_query`/`rdf_dump` read —
  both before and after a full process restart on the same on-disk profile.
  It says nothing about documents, blocks, search, or history convergence;
  it is scoped entirely to the RDF triple-store read/write path for one
  named graph shape.

**Result, as of this campaign:** planter's narrower probe is GREEN (see
`README.md`'s FID-004 gate record — binary sha
`59cb506c47ccb3ec1289c568182f6215d6482c1de8d5bdbdc23acc7d950bb430`, first
recorded 2026-07-11, re-confirmed 2026-07-12). This means: **for `:ux:config`
specifically**, the narrower convergence claim holds against the current
gardend binary. It does NOT mean the census's FID-004 (the much broader
document/block/search/history convergence claim) is resolved, narrowed, or
even directly informed — they exercise different authorities
(`:ux:config` RDF triples vs. document/block/CRDT projections) and different
write paths (direct `rdf_load`/`sparql_update` vs. live-UI document edits).

## Recommendation for the census's next revision

If the census is ever revised to disambiguate finding IDs across campaigns,
consider renaming this campaign's internal gate to something that doesn't
collide with the census's own FID-004 (e.g. "the WF-D live-read gate" is
already its full name in the test file and design doc — the short "FID-004"
label is convenient shorthand within the planter build but reads as a claim
about the census finding to anyone who doesn't already know the two are
different scopes). No action is taken on this recommendation by this
campaign; it is offered for whoever next edits the census.
