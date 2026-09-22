# Garden → Shrubbery live fidelity census — 2026-07-10

Status: **open census; not a release verdict**

- Garden oracle: `cf0cb9600ba25ee49f7268301bcf3d949ed48f3b`
- Integration target at audit start: `8654cfb`
- Live headed target at first observation: `3a43c19`
- Live headed candidate: `3a43c19` plus an uncommitted pane-layout patch
- Acceptance catalog: 80 capabilities / 38 journeys

This register exists to prevent a passing test count from becoming a broader
claim than the behavior actually exercised. A finding is not closed until its
Garden behavior, user reproduction, structural contract, fix and focused
browser/backend rerun are all named.

## Observed and known findings

| ID | Kind | Severity | Status | Capability / journey | Finding | Structural contract | Required closure proof |
|---|---|---:|---|---|---|---|---|
| FID-001 | Product | High | Candidate verified; unintegrated | `ACC-CAP-CHROME-003` / `ACC-J110:chrome` | The integrated shell's divider property changed while physical geometry stayed fixed. The isolated candidate restores Shoelace grid layout: a real left drag moved divider/start/end by exactly `+70/+70/-70px`, and a right free drag moved by `-56.14px`. | Shell CSS replaced `sl-split-panel`'s required grid host layout with flex, invalidating the Web Component's layout protocol. | Integrate the grid fix; rerun left/right physical geometry on the integrated SHA and ensure inner events cannot overwrite left state. |
| FID-002 | Product / policy | High | Candidate works physically; policy unresolved | `ACC-CAP-CHROME-003` / `ACC-J110:chrome` | Collapse/expand/restore, editor identity and reload persistence were absent. The candidate adds them plus percentage snap stops. However the pinned Garden oracle persists **per-tab pixel widths** and clamps left `180–500px`, right `240–500px`, with a `≥400px` center; it does not declare the candidate's `20/35/50/70` and `50/62.5/75/85` snap sets. The candidate stores one global session percentage and can therefore admit widths Garden clamps away. | The port omitted the controller/event/session-state seam. The repair must settle whether requested discrete snapping is a ratified target extension or exact Garden behavior, then place state at the correct per-tab authority. | Ratify the mode policy; prove clamp/snap at small and large viewports, per-tab isolation, collapse/expanded restoration, editor identity and reload/restart behavior. |
| FID-003 | Product | Medium | Candidate untested; unintegrated | `ACC-CAP-EDIT-004` / `ACC-J220:outline` | Paragraph and heading node/outliner bullets are absent in the integrated and live headed builds. Live Chromium reports paragraph `::before` as `content:none`, `width:auto`, `position:static`. A CSS/state candidate exists but has not had browser or pointer validation. | The gutter hit zones survived, but their visible semantic affordance did not cross the port boundary. | Chromium pseudo-element geometry/color for paragraph and heading; no duplicate list marker; hover/focus/wired state; real leaf-wire and parent-fold gutter actions. |
| FID-004 | Backend contract | High | Open | `ACC-CAP-EDIT-001`, `ACC-CAP-EDIT-006`, `ACC-CAP-COLLAB-002` / `ACC-J200`, `ACC-J220`, `ACC-J800` | The workspace and live CRDT projections expose the same document, title, block ID and text, but `read_document`, `read_blocks`, `query_blocks`, `document_digest`, history and `search_documents` all report it missing or return zero hits. `rdfTripleCount` is zero; cold title recovery can fall back to `Untitled`. | Collaborative Y.Doc authority, workspace catalog authority, document snapshot authority, search index and RDF projection do not converge on create/update. | Create/edit through UI; every authoritative document/block/search/history read resolves the same ID and content before and after restart; projection hashes agree. |
| FID-005 | Acceptance infrastructure | High | Open; runner unintegrated | Production evidence currently declares `ACC-J430` | The seven-step production runner tests cold boot, create/open, edit, search, reload, restart and two-context convergence, but labels the run as the import/original-file journey. The runner itself is not present on the integration branch. | Verdict identity is not derived from the manifest journey/capability map. Useful evidence is therefore over-claimed and not coverage-accountable. | Integrate the runner, give the slice its correct journey/claim mapping, or implement actual `ACC-J430` import/reader steps; schema validation rejects mismatched step sets. |
| FID-006 | Acceptance coverage | High | Open | All required claims | The exhaustive program and manifest are valid, but the program explicitly says its runner implementation is a follow-up. Only a partial subset has been executed. | Source inventory, journey specification and executable behavioral coverage are separate artifacts. | Every claimed `(capability, mode, role, target SHA)` receives a terminal verdict with the tier-required evidence; no aggregate pass substitutes for missing journeys. |
| FID-007 | Product | High | Open | `ACC-CAP-CHROME-001`, `ACC-CAP-CHROME-003`, `ACC-CAP-KEYBOARD-001` / `ACC-J110`, `ACC-J720` | Shrubbery's live command palette exposes nine context-valid actions. Garden's active command/shortcut surface additionally includes New Document, Rename/F2, back/forward, focus mode, wire-from-anchor, comment resolution and block insertion. In live Chromium, `Mod+Alt+N`, `F2`, `F6` and `Mod+\` cause no state or focus change. Shrubbery has only global handlers for the document switcher and shortcuts dialog; several underlying actions exist elsewhere but are not routed through the shared command surface. | The command registry was ported as a type/component, not as the complete shell-owned action spine and global keybinding map. | Build an oracle/target command-ID concordance; execute each shortcut and palette action in Chromium, including focus restoration and Escape precedence. Treat document split separately because Garden's interpreter mode intentionally disables that command. |
| FID-008 | Product / adapter | High | Open | `ACC-CAP-COLLAB-001` / `ACC-J800` | Vehicle's production prompt-editor provider supplies `awareness: {}`. Enabling the shared live editor makes `yCursorPlugin` call missing `awareness.on`, producing two unhandled rejections; 21 assertions print as passed but the package exits red. | `CrdtAwareness = unknown` hides a load-bearing event-emitter protocol at the adapter boundary. A truthy shape is not a valid Awareness implementation. | Bind a real Awareness instance or explicitly omit cursor support; prove prompt-editor mount and teardown without unhandled errors, then run two-client presence where claimed. |
| FID-009 | Oracle / acceptance infrastructure | High | Open | Garden API oracle | Garden's pinned source is not internally green under `pnpm parity:inventory`: the OpenAPI snapshot is stale; surface inventory reports 29 unknown local tools, 28 missing MCP schema snapshots, 36 undeclared routes and one missing OpenAPI route; storage discipline flags three direct writes. The security gate passes. | Source behavior and contract-of-record snapshots have drifted, so “match Garden” must name which oracle wins for each disagreement. | Reconcile or explicitly version the OpenAPI/surface/storage inventories; pin a green oracle commit or record accepted oracle defects separately from Shrubbery defects. |
| FID-010 | Product / state authority | Medium | Open | `ACC-CAP-HOME-002` / `ACC-J110:home` | The live workspace and sidebar contain `Fixture Search Anchor`, but a fresh Shrubbery browser says `No documents yet`. Garden derives Newly Created from authoritative document `createdAt/order`; Shrubbery drops those fields and projects new/recent/pinned solely from browser-local activity recorded after that browser performed an action. | A browser-local cache was substituted for Garden's workspace + CRDT session preference authorities, so preexisting, remote-created and fresh-context documents disappear from Home. | Seed/create a document outside the current browser; a fresh context must show an honest nonempty/new projection, while pinned/recent state remains graph-scoped and cross-context according to the ratified authority. |

## Initial Garden ↔ Shrubbery comparison

| Domain | Garden oracle | Shrubbery integrated target | Current assessment |
|---|---|---|---|
| Desktop layout | Recursive Shoelace spine; pixel clamping; per-tab widths/modes; floated persistent editor | Static split positions; operational callbacks/state omitted; flex override broke Shoelace | **Fail on integrated SHA.** Isolated candidate proves the mechanism but still needs policy/state correction. |
| Shell navigation and commands | Shared registry plus global create/rename/back/forward/focus shortcuts; F6 region cycling; context actions | Registry and palette exist, but only a subset is registered/routed globally | **Material partial.** Underlying features and their discoverable/keyboard surfaces have diverged. |
| Editor core | TipTap/Yjs rich editor, lists/tables/comments/wires/outliner | Rich typing, inline/block formatting, undo/redo, tables and provider/document switching pass real Chromium | **Strong core, incomplete outliner fidelity.** Node bullets absent; DnD/fold/wire gutter still lack primary browser proof. |
| CRDT collaboration | Y.Doc plus real Awareness, catalog/document/search projections expected to converge | Organism's two-context Y.Doc slice converges; Vehicle supplies an invalid Awareness; document/search/history projections split | **Mixed and structurally risky.** Live editing works on one plane while dependent product features fail on another. |
| Workspace/sidebar/home | Per-graph workspace, folders/documents/tags; Newly Created derived from document timestamps; pinned/recent in session preferences | Sidebar sees the live workspace, but Home activity is browser-local and can call a nonempty graph empty | **Basic navigation works; Home authority is not faithful.** Persistence confidence is also limited by FID-004. |
| Import/original/settings/Excalidraw | Local artifact ingestion, original readers, settings operations and scene/wire persistence | Real-gardend integration tests pass document transfer, PDF/EPUB/DOCX parsing, settings action matrix and Excalidraw round-trip | **Highest-confidence parity cluster**, still not equivalent to the unexecuted full `ACC-J430` browser journey. |
| Search/history/block tools | Catalog, document/block lexical/semantic reads and snapshots over the same documents | UI sidebar filtering works; MCP document/block/search/history reads fail for live-only Y.Doc documents | **Blocked by projection convergence.** |
| Chat/TTS/mobile | Browser/local surfaces with lifecycle cleanup and responsive identity | Real Chromium passes these against the in-memory cell contract | **Behaviorally promising, T2/T3 proof incomplete.** Not yet a real-gardend/full-resilience verdict. |
| Hosted/auth/public/access | Cognito/gateway roles, public/share paths and hosted variants | Access UI exists; manifest correctly marks viewer hydration, share links and public workspace contracts blocked | **Explicitly incomplete by backend contract.** Local success cannot close these claims. |
| Choreograph/Emporium/graph products | Garden-native projections plus external service telemetry | Components/services exist; external telemetry remains gated; Emporium graph tests currently drift from live node/edge counts | **Partial and not release-claimable.** |
| Acceptance | Source-mapped manifest plus Garden parity registries | 80 capabilities / 38 journeys validate statically; exhaustive runner not implemented/integrated | **Coverage specification, not coverage closure.** |

## Repository and oracle health observed during the audit

| Surface | Result | Interpretation |
|---|---|---|
| Core Shrubbery packages | tokens `47`, chat-kernel `88`, editor-kernel `190`, nucleus `347`, render `66`, runtime `401`, components `478` passed | Useful structural regression coverage. |
| Organism | `238/238` passed, including real-gardend settings/import/Excalidraw/picker suites | Strong evidence for named flows, not broad UI fidelity. |
| Storybook | `88/88` passed | Component/catalog faces are coherent. |
| Vehicle | `21` assertions printed passed, package exited red with two unhandled Awareness rejections | Pass count is invalid evidence until the rejection is fixed. |
| Rhizome | one real-trace test timed out; six live-cell tests skipped because port `7090` was down | Root suite is not green and live coverage is conditional. |
| Atelier app | one real integration failed: portrait artifact upload returned `400` instead of `200` | Artifact contract or fixture drift needs triage. |
| Emporium app | two graph-view assertions failed: live graph has `30` nodes/edges where tests expect `9`/`14` | Likely oracle/fixture cardinality drift; behavior needs semantic rather than exact-count adjudication. |
| Root command | also stops on the user's untracked `apps/cow-palace` package because it has no tests | Kept separate from port conclusions; no user files were changed. |
| Garden parity gates | security passes; OpenAPI, surface inventory and storage discipline fail | The pinned source oracle itself needs contract reconciliation. |

## Structural clusters

### A. Shape parity without operational parity

The port can preserve an ontology/config object, custom-element tag or DOM
shape while losing the event, authority, state or affordance that makes it
operate. FID-002 and FID-003 are two forms of this error.

### B. Boundary protocol violations

Custom elements are not ordinary styled containers. Their host layout,
properties, composed events and shadow parts are protocols. FID-001 crossed
that boundary through global shell CSS and silently disabled physical behavior.

### C. State ownership and persistent organism identity

Panel positions/modes belong to controlled shell/session state, while the live
editor is a persistent Class-B organism measured against the center anchor.
Layout transitions must move and remeasure it without remounting its editor,
provider or CRDT room.

### D. Projection convergence

Y.Doc durability is not sufficient if the document catalog/RDF/JSON projection
cannot discover the same object after restart. FID-004 is a backend convergence
defect, not an editor rendering defect.

### E. Proof validity

DOM presence, component properties and high unit-test counts do not prove
pointer geometry, visible affordances, persistence or backend authority.
Evidence must be scoped to the exact manifest claim it exercises. FID-005 and
FID-006 are defects in the confidence mechanism itself.

### F. Opaque types that erase operational protocols

`unknown` is appropriate at a dependency boundary only when the consuming
adapter performs a runtime capability check or owns the concrete construction.
FID-008 shows an opaque handle being treated as if any truthy object satisfied
the Awareness event protocol.

### G. Oracle integrity

Garden source, generated OpenAPI, surface inventory and storage rules currently
disagree. A fidelity decision must not silently choose whichever oracle makes a
test pass; the disagreement itself is versioned evidence.

## Evidence that is useful but deliberately narrow

- Combined deterministic Chromium journey passed rich typing/formatting,
  undo/redo, table insertion, imported read-only → Make Editable in place,
  original-source cleanup, workspace isolation, quick clip, TTS, chat and
  desktop/mobile node identity.
- Integration suites passed at census start: components 478, runtime 401,
  organism 238; corresponding TypeScript checks passed.
- Real gardend production slice passed its seven named transitions and produced
  traces/video/backend logs, while also exposing FID-004.

These results lower risk only for their named transitions. They do not close
FID-001–003 or the remaining unexecuted manifest.

## Dispatch gate

1. Preserve the two partial repairs (panes and node bullets) without integrating
   them until the behavior-policy comparison is reviewed.
2. Keep adding observed live defects here without immediately assigning them.
3. Map each finding to its Garden oracle, manifest claim and shared structural
   cluster.
4. Resolve oracle disagreements and dependency order before implementation.
5. Only then resume or create bounded implementation lanes.
