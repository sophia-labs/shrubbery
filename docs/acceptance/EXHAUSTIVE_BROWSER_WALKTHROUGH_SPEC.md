# Garden exhaustive browser and computer-use walkthrough specification

- Status: execution supplement; the runner does not exist yet, and this document is not a release verdict
- Audited: 2026-07-11
- Pinned Garden oracle: `cf0cb9600ba25ee49f7268301bcf3d949ed48f3b`
- Garden audit checkout: `4d55ef852ceba31c0ecd85ffaef2b4d2b7660ad9`
- Machine-readable catalog: [`garden-capability-manifest.json`](./garden-capability-manifest.json)
- Program contract: [`GARDEN_FIDELITY_ACCEPTANCE_PROGRAM.md`](./GARDEN_FIDELITY_ACCEPTANCE_PROGRAM.md)

## Purpose and corrected framing

The intended outcome is justified confidence in functional fidelity, not merely
an impressive watched demo. A browser walkthrough is one layer of the proof.
It cannot by itself prove that the graph, CRDT, search index, history, artifact
store, secret store, or restart state agrees with what the screen showed.

The acceptance system therefore has eight distinct obligations:

1. **Feature inventory:** derive every user-addressable capability from a pinned
   Garden source tree, and classify target-only or development-only surfaces.
2. **User journeys:** perform actions only through visible product controls,
   keyboard input, pointer input, file choosers, and declared OS checkpoints.
3. **Independent state oracles:** corroborate visible results through REST, MCP,
   RDF, Yjs, history, search, artifact bytes, and process logs without mutating
   product state through those channels during a journey.
4. **Durability and convergence:** prove reload, fresh-context, provider
   reconnect, retained-profile backend restart, and multi-client convergence.
5. **Fault behavior:** inject declared failures at the runner proxy or owned
   backend boundary and prove error, retry, idempotency, and cleanup behavior.
6. **Accessibility and keyboard:** test names, roles, state, focus, live regions,
   shortcuts, pointer alternatives, and dialog precedence inside the primary
   journeys, then run a dedicated closure sweep.
7. **Visual fidelity:** compare Garden and Shrubbery at matched viewports and
   states using screenshots, geometry, computed styles, and human review where
   pixel comparison is not semantically meaningful.
8. **Environment-specific contracts:** keep Chromium, the macOS Tauri WKWebView,
   hosted Cognito/gateway, and real third-party providers as separate claims.

The phrase **computer use** is reserved for behavior outside a normal Chromium
page: Tauri window chrome, native file/save dialogs, the OS keychain, external
protocol opens, and an actual packaged-app restart. Playwright WebKit is not a
substitute for the macOS WKWebView. A Chromium PASS is not a desktop-Tauri PASS.

Watching remains useful. It makes interaction quality, pacing, layout, and
unexpected behavior legible. The durable product is the append-only evidence
bundle and the capability verdict ledger.

## Normative sources and inventory gate

The catalog is generated and reviewed against the pinned Garden oracle, not a
moving checkout. On 2026-07-11, the relevant frontend oracle paths at Garden
`4d55ef8` had no diff from the pinned `cf0cb96` source. Before every acceptance
campaign the runner must nevertheless rerun:

```sh
node scripts/validate-acceptance-manifest.mjs --check-sources
git -C ../garden diff --name-status \
  cf0cb9600ba25ee49f7268301bcf3d949ed48f3b..HEAD -- \
  frontend/src/app-shell.ts frontend/src/lib/capabilities.ts \
  frontend/src/lib/testids.ts frontend/src/components frontend/src/services
```

Any source diff or newly reachable target surface opens the inventory gate. It
must be classified as `required`, `target-extension`, `development-only`,
`backend-only`, `removed-with-rationale`, or `unknown`. `unknown` is a release
blocker. Registering a custom element is not proof that it is reachable.

The current catalog validates structurally and contains 80 capabilities and 38
journeys. The audit also found five visible Garden capability groups that are
not yet first-class entries in the JSON manifest. They are specified below as
mandatory deltas. Until the JSON is amended and revalidated, the honest census
is **80 cataloged capabilities plus five discovered, not-yet-cataloged groups**.

### Granularity gate: capabilities are not atomic verdicts

The 80 capabilities are a coverage spine, not yet a literal inventory of every
independently fail-able transition. For example, `ACC-CAP-EDIT-003` combines
paragraphs, heading levels, three list families, task toggling, quotes, code,
tables and dividers; `ACC-CAP-CHROME-003` combines two pane dividers, dragging,
clamping, snapping, collapsing, restoration, popout, focus and split view. One
successful assertion cannot grant either entire family a PASS.

Before implementation of a journey family, expand every capability into atomic
subclaims with stable IDs:

```text
ACC-CLM-<capability-domain>-<capability-number>-<action-or-state-slug>
```

Each subclaim records its parent capability, pinned Garden source signal,
reachable control, precondition, visible action, expected result, independent
oracle, mode, role, durability level, fault variants, journey step and evidence
requirement. Examples include:

```text
ACC-CLM-EDIT-003-bullet-list-insert
ACC-CLM-EDIT-003-task-item-toggle
ACC-CLM-EDIT-003-table-add-column
ACC-CLM-CHROME-003-left-divider-snap
ACC-CLM-CHROME-003-right-collapse-restore
ACC-CLM-SECRET-001-openrouter-replace-no-residue
```

A parent capability is PASS only when every applicable subclaim is terminal
PASS for the claimed mode/role. The runner must emit `subclaimId` on events,
verdicts and defects. The machine-readable manifest does not yet have a
`subclaims` field, so **the atomic subclaim census remains unenumerated work**.
The runner may be scaffolded before that census is complete, but an exhaustive
campaign and “all features” statement may not be issued.

Before the runner may emit verdicts, extend the manifest or add one
schema-validated companion claims file containing subclaims, durability levels,
stable requirement IDs, universal and specialized evidence channels, and the
five discovered capabilities below. The validator must enforce reciprocal
capability/subclaim/journey/step links and source paths. The two Markdown tables
in this document are a reviewed 2026-07-11 snapshot; generate them from that
machine-readable authority once it exists and fail CI on a rendered diff. A
hand-maintained Markdown join is not an executable coverage guarantee.

## Evidence identity and append-only logging

Requirements have stable source-controlled IDs:

```text
ACC-REQ-<journey-number>-<step-id>
```

Concrete evidence produced by a run has an immutable instance ID:

```text
ACC-EVD-<run-id>-<journey-number>-<step-id>-<channel>-<ordinal>
```

Example:

```text
ACC-REQ-J200-reload
ACC-EVD-20260711T183012Z-a91c-J200-reload-crdt-hashes-001
```

`run-id`, `journey-number`, `step-id`, `channel`, and `ordinal` are separate
fields as well as parts of the display ID. Renaming a requirement is a reviewed
spec migration; a rerun creates new evidence IDs and never overwrites old ones.

Every runner event is appended to `events.jsonl` with this minimum envelope:

```json
{"schemaVersion":1,"seq":42,"eventId":"ACC-EVT-20260711T183012Z-a91c-000042","runId":"20260711T183012Z-a91c","journeyId":"ACC-J200","stepId":"reload","capabilityIds":["ACC-CAP-EDIT-001"],"subclaimId":"ACC-CLM-EDIT-001-cold-reload","actor":"runner","kind":"assertion","wallTime":"2026-07-11T18:31:04.120Z","monotonicNs":"541839440120","correlationId":"j200-reload-04","expected":"cold projections agree after a fresh context","observed":"document/block/search/history/RDF agree","verdict":"PASS","evidenceIds":["ACC-EVD-20260711T183012Z-a91c-J200-reload-crdt-hashes-001"],"prevSha256":"...","sha256":"..."}
```

The logger must:

- allocate strictly increasing run-local `seq` values from one writer;
- append one newline-delimited record, flush it, then perform the next action;
- hash-chain canonical redacted records through `prevSha256` and `sha256`;
- record intent before an action and outcome after it with one correlation ID;
- write browser actions, fixture effects, faults, approvals, takeovers,
  assertions, verdicts, defects, retries, process lifecycle, and cleanup;
- never place bearer tokens, provider keys, passwords, private prose, signed
  URLs, or unrestricted local paths in a record; and
- finalize a separate signed/hash manifest of every artifact. Finalization may
  add indexes and summaries but may not rewrite the JSONL ledgers.

`effects.jsonl`, `verdicts.jsonl`, and `defects.jsonl` are projections of the
same event stream for convenient review. A retry links to the first attempt and
retains its failure. Human observations are recorded as observations, not
machine assertions.

## Runner command and operating modes

The proposed command contract is:

```text
pnpm --filter @shrubbery/organism acceptance:run -- \
  --manifest docs/acceptance/garden-capability-manifest.json \
  --suite local-cell \
  --browser chromium \
  --headed \
  --slow-mo 150 \
  --hud \
  --pause-at approval,human-judgment \
  --artifact-dir /private/tmp/shrubbery-acceptance/<run-id> \
  --keep-open
```

The same command without `--headed`, `--slow-mo`, `--hud`, or `--keep-open` is
the unattended release lane. `--journey`, `--step`, `--capability`, and
`--rerun-from <defect.json>` provide focused replay. `--mode
local-desktop-tauri --driver computer` selects the native lane and must never be
silently emulated by Chromium.

Each local shard owns a fresh profile, graph IDs, files, ports, manifest, and
browser user-data directory. It seeds through public authenticated contracts,
then capability-gates the runner's corroborating backend client to reads for the
journey. All product mutations after setup use visible user actions. The browser
token remains in the server-side proxy and never reaches page JavaScript.

### Implementation shape

Keep the runner small and compositional rather than building another product
inside the test suite:

```text
apps/organism/acceptance/
  cli.mts                       # arguments, selection and exit status
  manifest.mts                  # schema validation and reciprocal coverage
  run-context.mts               # IDs, append writer, provenance and cleanup
  process/gardend.mts           # fresh profile, manifest discovery and restart
  browser/session.mts           # Chromium contexts, diagnostics, trace/video
  browser/watch-hud.mts         # optional pause/step/takeover sidecar
  fixture/seed.mts              # public-contract setup and ownership ledger
  oracle/garden-source.mts      # materialize and hash the pinned Garden oracle
  oracle/garden-browser.mts     # execute paired Garden reference states/actions
  oracle/{crdt,rdf,rest,mcp,artifacts}.mts
  faults/proxy.mts              # declared HTTP/WS latency/error/disconnect rules
  journeys/ACC-J*.mts           # visible actions and assertions by manifest ID
  report/finalize.mts           # immutable indexes, coverage and rerun commands
```

Each journey step follows one lifecycle: append intent; capture before-state;
perform the visible action; wait on an explicit product/transport readiness
signal; capture DOM, accessibility, network and screenshot evidence; read every
declared independent oracle; run any declared durability transition; append the
assertion and verdict; then capture after-state. On failure it first freezes
diagnostics and creates a defect record, then performs only ownership-safe
cleanup. Cleanup failure is a second defect and cannot replace the first one.

The runner exposes no arbitrary page-side mutation bridge. Page evaluation is
limited to readiness, immutable identity/geometry reads, browser capability
stubs declared by the fixture (for example deterministic speech), and evidence
capture that cannot make an assertion pass.

### Universal evidence baseline

Unless a secret-safe checkpoint below explicitly suppresses a source, every
browser step captures console and page errors, request/response metadata,
Playwright trace annotation, before/after screenshot, URL, focus owner, DOM
landmark summary, and accessibility snapshot. A native computer-use step
captures the driver action stream, window/video evidence, native focus and
accessibility state, plus applicable network/process diagnostics instead of
inventing a Playwright trace. The evidence arrays in the existing JSON manifest
are specialized channels added to this baseline; they are not a complete list.
The future claims schema must make both sets machine-enforced.

### Secret-safe capture boundary

A real provider key or password necessarily exists transiently in a secure
input/page process and an outbound request body. The correct invariant is **no
persistent residue**, not “the value never entered DOM or network.” Before a
secret-bearing action, the runner must append a capture-suppression checkpoint,
flush ordinary evidence, then stop trace, video, screenshots, DOM/accessibility
snapshots, clipboard capture and network-body recording. It may record only
redacted request metadata and status outside the page. Prefer an OS-native
secure prompt or a declared human-entry checkpoint; if Playwright fills the
field, tracing must already be off.

After submission, wait for the input to clear/unmount and the configured-state
read to settle before resuming capture. Never create a raw trace or HAR and hope
to redact it later: opaque `trace.zip`, video frames, screenshots and backend
stdout are not safely post-hoc redactable. The proxy must disable body logging,
and the backend log configuration must be audited not to emit credentials
before a real key is used. Start the runner with `umask 077`,
create artifact directories as `0700` and regular files as `0600`, retain the
secret only in process memory, and byte-scan the finalized allowlisted bundle
for the exact value and common URL/base64 encodings before it can be published.
The scan result is evidence; the secret and its encodings are not.

## Watch-along and takeover protocol

Headed mode shows the exact browser under automation. A separate HUD or sidecar
shows run ID, target and backend hashes, current requirement, action, expected
result, latest verdict, elapsed time, and input ownership. It exposes `Pause`,
`Resume`, `Step`, `Take over`, `Return control`, `Stop after step`, and
`Capture observation`.

Pause takes effect only after the current atomic action and after the logger has
flushed. Takeover captures a before screenshot, accessibility snapshot, URL,
focus owner, relevant state hashes, and a `human-takeover-start` event. Return
captures the same material plus a plain-language action log supplied by the
operator. An undeclared human mutation forks the run and makes it exploratory;
it cannot produce a deterministic release PASS until translated into a formal
step and rerun.

The in-app Browser may be used for side-by-side observation or exploration, but
the repo-owned Playwright runner remains the reproducible authority. Extension
content-script warnings are excluded only when a clean runner-owned Chromium
context proves they are absent; they are never blanket-filtered by message text.

### Token-bearing control-plane hardening

The browser handoff proxy, fault proxy and watch HUD hold loopback bearer tokens
or input-takeover authority. They bind only to explicit loopback addresses,
reject unexpected `Host` headers and DNS-rebinding forms, validate HTTP `Origin`
and WebSocket upgrade origin against the exact runner app/HUD origins, and use a
fresh high-entropy run control token. The HUD/control origin is separate from
the subject application origin and is never exposed to subject page scripts.

Upstream targets are an immutable per-run allowlist derived from the owned
gardend manifest; no user-supplied arbitrary target, generic CONNECT method, or
open-proxy behavior is permitted. State-changing HUD calls require the control
token plus same-origin/anti-CSRF validation, and takeover is logged before input
ownership changes. Start the entire runner under `umask 077`; redact tokens at
the source logger; close listeners, sockets and token files during cleanup; and
prove after the run that the ports no longer accept connections.

## Execution order and frontloaded work

The campaign is ordered to make the expensive stateful choke points small:

1. **Static inventory:** validate manifest/source reciprocity, route reachability,
   stable selectors, expected modes/roles, fixture hashes, and blocked claims.
2. **Build once:** record Shrubbery/Garden/gardend source hashes and binary hash;
   run typechecks, component tests, and backend contract preflights.
3. **Fixture preflight:** generate deterministic files/archives and expected
   normalized RDF/Yjs/artifact baselines before launching any browser.
4. **T0/T1 shards:** run component and deterministic in-memory Chromium lanes in
   parallel. They find rendering and wiring defects cheaply but grant no T2 PASS.
5. **T2 domain shards:** give each journey family its own fresh gardend profile.
   Navigation, editor, wires, artifacts, settings, and query lanes can run in
   parallel because they share only the pinned binary.
6. **T3 serial seams:** run multi-client, reconnect, retained-profile restart,
   and cross-projection convergence after relevant T2 shards pass.
7. **T6 safety:** run cancel proofs first, then approved fixture-only destructive
   mutations, restore, and final ownership cleanup.
8. **T4/T5/native campaigns:** run hosted, external-provider, and actual Tauri
   claims separately with disposable identities and explicit authority.

Parallel agents should own complete independent shards and return immutable
evidence bundles. They must not share one browser context, graph, profile, or
append writer. A coordinator merges only finalized indexes. The irreducibly
serial choke points are binary provenance, retained-profile restart, the two
clients inside one convergence scenario, destructive approval, and final
coverage closure.

## Durability levels

Every stateful capability declares the strongest applicable durability level:

| Level | Transition | Minimum proof |
|---|---|---|
| `D0` | settle in current view | UI and independent authority agree after an explicit product readiness signal |
| `D1` | navigate away/back or rerender shell | identity, selection, content, and unsaved-state contract remain correct |
| `D2` | page reload and fresh browser context | no reliance on page memory or a read-only test bridge |
| `D3` | provider disconnect/reconnect and offline queue | eventual convergence, no duplicate effect, correct user status |
| `D4-G` | gracefully stop and restart the same gardend binary on the retained owned profile | catalog, Yjs, REST/MCP, RDF, search, history, and artifacts agree |
| `D4-C` | force-kill gardend at declared persistence cut points, then restart on the retained profile | journal/recovery is lossless or explicitly fail-closed; no acknowledged mutation disappears or duplicates |
| `D5` | close and reopen the packaged desktop app | native preferences, window behavior, keychain status, and graph state survive |

`D4-C` must cover a kill after hot mutation but before debounce, after
authoritative sidecar write but before queue admission, after durable queue or
journal admission but before cold projection, during cold projection before its
checkpoint, and after projection but before acknowledgement. Prefer
acceptance-build failpoints or observed log barriers; do not add an unauthenticated
production crash endpoint. Every cut point records whether the UI had already
acknowledged the mutation and verifies pending/in-flight journal recovery.

An autosave claim requires `D2`, `D4-G`, and applicable `D4-C` points;
collaboration requires `D3` and
cross-client hash equality; native secret persistence requires `D5` while the
secret value remains unreadable to the browser and evidence recorder.

## Independent oracle matrix

| Surface family | Visible proof | Independent authority | Durability/fault additions |
|---|---|---|---|
| Workspace/catalog/sidebar | labels, order, selection, menus | graph catalog REST, workspace Y.Doc hash, workspace RDF/MCP | graph switch, `D2`, `D4-G`, `D4-C`, isolation and duplicate checks |
| Editor/outliner/rich blocks | ProseMirror DOM, caret, selection, controls | document Y.Doc state vector/hash, document/block REST+MCP, RDF, history, lexical search | debounce settle, `D2`, `D3`, `D4-G`, `D4-C`, invalid operation zero-delta |
| Comments and wires | marks, panels, overlays, navigation | CRDT records plus RDF/MCP exact IDs, predicates, directions, anchors | two clients, delete/update idempotency, stale/missing targets |
| Graph/query/Vega/Mermaid | rendered nodes/table/SVG/error | exact SPARQL result terms and persisted block JSON | empty/malformed/error, theme, `D2`, `D4-G`, applicable `D4-C` |
| Artifacts/drawings/imports/originals | reader/editor/canvas/progress/download | metadata record, original and derived SHA-256, scene JSON, RDF links | every MIME family, malformed input, cancel, `D4-G`, applicable `D4-C` |
| Search/semantic | result membership, ranking, filters, status | lexical/semantic API result IDs, index metadata/model hash | stale index, missing model, download approval, rebuild, `D4-G`, applicable `D4-C` |
| Settings/API/MCP | exact rows, controls, progress, status | exact authenticated route calls and non-secret backend state | unsupported runtime honesty, job resume, copy redaction, `D5` where native |
| Provider credentials | configured/missing only | keychain/gateway status endpoint and one successful bounded provider call | replace/delete, restart, no DOM/storage/log/network residue |
| History/restore | timeline, diff, overlay, cancel/complete | document/graph snapshots plus full normalized post-restore projections | rollback faults, connected-client reset, fresh context, `D4-G`, applicable `D4-C` |
| Auth/share/public | form, roles, denial, anonymous view | Cognito/gateway responses and ACL/public-route reads | expiry, refresh, 401/403, revoke, fresh anonymous context |
| Chat/Choreograph | streaming transcript/run phases/retry | transport events, journal sequence, RDF provenance | SSE resume/poll fallback, reconnect, shell rerender, provider failure |

### Restore-specific release gate

Graph restore does not PASS merely because an overlay reaches “complete.” The
runner must preflight bundle presence/hash/decodability and document membership;
flush or account for every persisted sidecar; record pre-restore Yjs, document
metadata, RDF, search, history, and artifact hashes; perform restore; force every
connected browser to discard or safely rebase its pre-restore Y.Doc; and prove
all projections in a fresh context and after `D4-G` plus applicable `D4-C`
cut points. Apply/rebuild/verify faults
must prove a verified rollback, including surfaced rollback failures. Missing or
corrupt bundle files may never be interpreted as empty documents. Until these
conditions hold, `ACC-CAP-RESTORE-001` is `FAIL` or `BLOCKED`, not a partial PASS.

## Fault matrix

Faults are declared fixture effects, injected by the runner-owned proxy or an
owned backend process, and appended before activation. At minimum `ACC-J700`
and the relevant primary journey cover:

| Fault | Expected product contract |
|---|---|
| latency and out-of-order responses | progress remains truthful; stale response cannot overwrite newer state |
| timeout/connection reset/offline WebSocket | visible disconnected/retrying state; bounded retry; eventual convergence |
| 401 and expired token | refresh or sign-in recovery without leaked credentials or false success |
| 403 | denied action remains zero-delta and explains the role boundary |
| 404/stale target | recoverable missing-state UI; unrelated state remains usable |
| 409 duplicate/revision conflict | explicit conflict/idempotent result; no duplicate object |
| 429 | bounded backoff and retry affordance; no request storm |
| 500 and malformed/truncated JSON | scoped error and retry; prior good state is not erased |
| job failure/cancel/process death | terminal state is honest; polling stops; restart can resume or explain non-resumability |
| quota/preflight rejection | mutation is blocked before partial CRDT/RDF/artifact effects |
| corrupt restore/import payload | fail closed, name the bad artifact, preserve baseline |

Arbitrary sleeps are forbidden as correctness gates. Use product readiness,
network completion, provider sync, job terminal state, or bounded polling with a
recorded timeout.

## Accessibility, keyboard, and visual fidelity

Every primary journey captures an accessibility snapshot at its meaningful
states and asserts role/name/state, focus owner, focus restoration, live-region
announcement, Escape precedence, and keyboard equivalence for pointer actions.
`ACC-J720` then covers landmark order, F6/Shift+F6, global shortcuts, dialogs,
mobile tabs, reduced motion, zoom/text scaling, and no keyboard trap. Automated
ARIA snapshots do not prove screen-reader speech; a release campaign should add
a recorded VoiceOver checkpoint for the editor, sidebar tree, modal, and status
announcements on macOS.

Visual proof uses matched Garden/Shrubbery fixtures, viewport, device scale,
font set, theme, skin, reduced-motion setting, browser engine, and captured
state. It records full and clipped screenshots, bounding boxes, divider and
gutter geometry, pseudo-element styles, overflow, focus rings, and text-wrap
metrics. Pixel diff thresholds are component/state-specific and never hide
missing controls. Dynamic canvas, graph, caret, timestamps, and antialiasing
regions receive masks plus semantic geometry assertions and human review.

The runner must execute the pinned Garden oracle, not merely read its source
strings. It materializes `cf0cb96` into a runner-owned immutable worktree (or
uses a content-addressed prebuilt oracle artifact), records its tree/build
hashes, boots its appropriate frontend/backend adapters, performs the paired
reference step, and writes `ACC-ORACLE-EVD-*` screenshots, geometry,
accessibility and behavior observations. Shrubbery evidence links to the exact
oracle evidence instance. If the pinned Garden state cannot be executed against
an equivalent deterministic fixture, that visual/behavioral comparison is
BLOCKED; a source inspection or remembered screenshot cannot substitute.

Run Chromium comparison for web composition and actual packaged Tauri on macOS
for WKWebView/native behavior. If they differ, report two verdicts; do not call
the difference “a WebKit thing” without a matched-engine reproduction.

## Current harnesses and what they can prove

| Harness | Real browser | Backend | Reusable contribution | Claim boundary |
|---|---|---|---|---|
| `apps/organism/scripts/browser-harness.mts` | Chromium | deterministic in-memory cell | broad T1 shell/editor/chat/TTS/mobile actions and read-only bridge | cannot prove gardend, persistence, hosted, or native contracts |
| `settings-browser-harness.mts` | Chromium | robust controlled settings contract | imports, graph jobs, history, local AI, write-only provider-secret UI, exact request accounting | responses are fixtures; not a T2/T5 secret/provider/backend PASS |
| `imported-document-browser.mts` | Chromium | in-memory cell | read-only/original/make-editable identity behavior | not real MIME parsing or artifact bytes on disk |
| `daily-note-browser-harness.mts` | Chromium | full local gardend | real daily-note find-or-create behavior | focused lane, not full navigation coverage |
| `keyboard-parity-browser-harness.mts` | Chrome/Chromium | full local gardend | global shortcuts, landmark focus, backend rename | no complete keyboard/a11y sweep and currently headless-only |
| `fid004-cold-projection-browser.mts` | fresh Chromium contexts | two full gardend generations on retained profile | UI-only mutation after fixture setup, cold projections, exact revision/history counts, `D4-G` restart provenance, headed/slow/keep-open | focused editor projection proof; no `D4-C` crash cut points and not the full 38-journey runner |
| `hosted-access-browser-harness.mts` | Chromium | deterministic gateway fixture | role UI, exact authenticated requests, deny/cancel/confirm behavior, headed mode | not real gateway ACL or public-link proof |
| Garden `8673381` `e2e-local` outliner suite | Chromium | page-seeded local Y.Docs | pointer geometry and outliner interaction techniques | page evaluation mutates stores/editor; technique reference only |
| Garden current hosted Playwright smoke | Chromium | live canary/Cognito | hosted boot and locator/auth technique | programmatic theme mutation and one smoke do not provide exhaustive fidelity |

The new runner should extract lifecycle, capture, logging, and selector helpers
from these scripts rather than wrapping all scripts and treating their exits as
capability verdicts.

## Cataloged capability-to-journey map

The table below is the human-readable join over all 80 current manifest
capabilities. Each namespace resolves to the step requirements in the following
section; each concrete run resolves those requirements to `ACC-EVD-*` records.

| Capability | Discoverable Garden feature | Journey(s) | Evidence requirement namespace |
|---|---|---|---|
| `ACC-CAP-DESIGN-001` | Controlled component states, Garden skin/theme axes, focus and accessible names | `ACC-J010` | `ACC-REQ-J010-*` |
| `ACC-CAP-ROUTE-001` | Garden and Sophia landing pages plus privacy and terms routes | `ACC-J100` | `ACC-REQ-J100-*` |
| `ACC-CAP-AUTH-001` | Sign in, sign up, verify email, resend verification and sign out | `ACC-J900` | `ACC-REQ-J900-*` |
| `ACC-CAP-AUTH-002` | Token refresh, expiry, invalid-session recovery and return-to-app navigation | `ACC-J900` | `ACC-REQ-J900-*` |
| `ACC-CAP-HOME-001` | Home resume and new-document actions | `ACC-J020`, `ACC-J110` | `ACC-REQ-J020-*`, `ACC-REQ-J110-*` |
| `ACC-CAP-HOME-002` | Pinned, new and recent documents, today's daily note and Dream Journal | `ACC-J110` | `ACC-REQ-J110-*` |
| `ACC-CAP-TENANCY-001` | Workspace catalog, owned/shared grouping and graph switching | `ACC-J120` | `ACC-REQ-J120-*` |
| `ACC-CAP-TENANCY-002` | Create, rename, duplicate and delete workspaces | `ACC-J120`, `ACC-J990` | `ACC-REQ-J120-*`, `ACC-REQ-J990-*` |
| `ACC-CAP-TENANCY-003` | Strict graph isolation of documents, history, pins, wires and active providers | `ACC-J120`, `ACC-J800` | `ACC-REQ-J120-*`, `ACC-REQ-J800-*` |
| `ACC-CAP-TENANCY-004` | Owner, editor and viewer affordances and write denial | `ACC-J910` | `ACC-REQ-J910-*` |
| `ACC-CAP-CHROME-001` | Breadcrumbs, home, back/forward navigation and document switcher | `ACC-J020`, `ACC-J110` | `ACC-REQ-J020-*`, `ACC-REQ-J110-*` |
| `ACC-CAP-CHROME-002` | Theme, skin and appearance persistence | `ACC-J010`, `ACC-J020`, `ACC-J110` | `ACC-REQ-J010-*`, `ACC-REQ-J020-*`, `ACC-REQ-J110-*` |
| `ACC-CAP-CHROME-003` | Selected right panel, resize, collapse, popout, focus mode and split view | `ACC-J110` | `ACC-REQ-J110-*` |
| `ACC-CAP-MOBILE-001` | Responsive Files/Editor/Chat tabs, home/resume and software-keyboard-safe layout | `ACC-J020`, `ACC-J720` | `ACC-REQ-J020-*`, `ACC-REQ-J720-*` |
| `ACC-CAP-A11Y-001` | Landmarks, names, focus order, live regions, dialogs and state semantics | `ACC-J010`, `ACC-J720` | `ACC-REQ-J010-*`, `ACC-REQ-J720-*` |
| `ACC-CAP-KEYBOARD-001` | Global shortcuts, command palette, focus restoration and Escape precedence | `ACC-J720` | `ACC-REQ-J720-*` |
| `ACC-CAP-NAV-001` | Document and folder create, rename, move and delete | `ACC-J130`, `ACC-J990` | `ACC-REQ-J130-*`, `ACC-REQ-J990-*` |
| `ACC-CAP-NAV-002` | Sidebar drag/drop, multi-select, batch move/delete and context menus | `ACC-J130` | `ACC-REQ-J130-*` |
| `ACC-CAP-NAV-003` | Sidebar search, sort, direction, grouping, folder visibility and tag section | `ACC-J140` | `ACC-REQ-J140-*` |
| `ACC-CAP-NAV-004` | Pin/unpin home, open split, original download and make imported source editable | `ACC-J140` | `ACC-REQ-J140-*` |
| `ACC-CAP-NAV-005` | Daily-note row/header/calendar navigation and Dream Journal | `ACC-J140` | `ACC-REQ-J140-*` |
| `ACC-CAP-EDIT-001` | Live CRDT typing, autosave, reload and document-switch survival | `ACC-J020`, `ACC-J200`, `ACC-J800` | `ACC-REQ-J020-*`, `ACC-REQ-J200-*`, `ACC-REQ-J800-*` |
| `ACC-CAP-EDIT-002` | Inline bold, italic, strike, highlight, code and hyperlink formatting | `ACC-J210` | `ACC-REQ-J210-*` |
| `ACC-CAP-EDIT-003` | Paragraph, headings, bullet/ordered/task lists, quote, code, table and divider blocks | `ACC-J210` | `ACC-REQ-J210-*` |
| `ACC-CAP-EDIT-004` | Outliner indent/outdent, collapse/expand, subtree zoom and gutter controls | `ACC-J220` | `ACC-REQ-J220-*` |
| `ACC-CAP-EDIT-005` | Block selection and before/after/child drag-and-drop with invalid-drop protection | `ACC-J220` | `ACC-REQ-J220-*` |
| `ACC-CAP-EDIT-006` | In-document find, block IDs, copyable code and caret/selection status | `ACC-J220` | `ACC-REQ-J220-*` |
| `ACC-CAP-EDIT-007` | Math, footnotes, margin gloss and calendar-event content | `ACC-J230` | `ACC-REQ-J230-*` |
| `ACC-CAP-EDIT-008` | Slash-command discovery, keyboard selection and unavailable-command honesty | `ACC-J230` | `ACC-REQ-J230-*` |
| `ACC-CAP-EDIT-009` | Wikilink insertion, autocomplete, picker, navigation and missing-target handling | `ACC-J230` | `ACC-REQ-J230-*` |
| `ACC-CAP-EDIT-010` | Inline image upload/insert, signed retrieval and display-size cycling | `ACC-J230` | `ACC-REQ-J230-*` |
| `ACC-CAP-TAG-001` | Tag recognition, autocomplete, block tags, chips and folder-scoped tag pages | `ACC-J240` | `ACC-REQ-J240-*` |
| `ACC-CAP-CITE-001` | Source metadata/annotations and Shrubbery citation insertion extension | `ACC-J240`, `ACC-J940` | `ACC-REQ-J240-*`, `ACC-REQ-J940-*` |
| `ACC-CAP-COMMENT-001` | Add, edit, move, hover-correlate, resolve/unresolve and delete comments | `ACC-J300` | `ACC-REQ-J300-*` |
| `ACC-CAP-WIRE-001` | Create document/block wires with predicate, direction and cross-document target | `ACC-J310` | `ACC-REQ-J310-*` |
| `ACC-CAP-WIRE-002` | Outgoing/incoming bundles, snapshot context, refresh, predicate update and delete | `ACC-J310` | `ACC-REQ-J310-*` |
| `ACC-CAP-WIRE-003` | Radial context overlay and draggable pinned wire/block/document cards | `ACC-J320` | `ACC-REQ-J320-*` |
| `ACC-CAP-WIRE-004` | Wire-mode navigation, split-pane targeting and document-switcher integration | `ACC-J320` | `ACC-REQ-J320-*` |
| `ACC-CAP-GRAPH-001` | Workspace/document graph visualization, recenter, open, split and wire-from-node | `ACC-J330` | `ACC-REQ-J330-*` |
| `ACC-CAP-INSPECT-001` | Selection inspector, relations and context-sensitive actions | `ACC-J330` | `ACC-REQ-J330-*` |
| `ACC-CAP-QUERY-001` | SPARQL query blocks: author, run, table/raw result, empty/error and persistence | `ACC-J400` | `ACC-REQ-J400-*` |
| `ACC-CAP-VEGA-001` | Vega-Lite auto recommendation, mark/channel builder, raw JSON, SVG and malformed-spec recovery | `ACC-J400` | `ACC-REQ-J400-*` |
| `ACC-CAP-MERMAID-001` | Mermaid authoring/rendering, theme response, persistence and syntax-error display | `ACC-J400` | `ACC-REQ-J400-*` |
| `ACC-CAP-EXCAL-001` | Create drawing, edit Excalidraw scene, autosave, reopen and restart persistence | `ACC-J410` | `ACC-REQ-J410-*` |
| `ACC-CAP-EXCAL-002` | Scene-link wire projection, hydration, target recovery and stale/missing diagnostics | `ACC-J410` | `ACC-REQ-J410-*` |
| `ACC-CAP-ART-001` | Artifact view/edit/history, generate intent, save/cancel and revision restore | `ACC-J420` | `ACC-REQ-J420-*` |
| `ACC-CAP-ART-002` | Image generation request, progress, result upload and insert/use flow | `ACC-J950` | `ACC-REQ-J950-*` |
| `ACC-CAP-IMPORT-001` | File/folder upload and parsing for PDF, EPUB, DOCX, TXT, Markdown, HTML, XML and images | `ACC-J430` | `ACC-REQ-J430-*` |
| `ACC-CAP-ORIGINAL-001` | Toggle parsed/original without losing editor state; render PDF, EPUB, text/HTML and image originals | `ACC-J430` | `ACC-REQ-J430-*` |
| `ACC-CAP-ORIGINAL-002` | Download original, copy/open link and original-coordinate comment pins | `ACC-J430` | `ACC-REQ-J430-*` |
| `ACC-CAP-CLIP-001` | Quick Clip web URL, progress/result/error, clip-another and imported-document open | `ACC-J440` | `ACC-REQ-J440-*` |
| `ACC-CAP-CLIP-002` | YouTube transcript import and explicit deferred/unavailable behavior | `ACC-J950` | `ACC-REQ-J950-*` |
| `ACC-CAP-EXPORT-001` | Document export formats, generated filename/content and cancellation | `ACC-J450` | `ACC-REQ-J450-*` |
| `ACC-CAP-ARCHIVE-001` | Graph archive export/import, duplicate and round-trip content fidelity | `ACC-J450`, `ACC-J990` | `ACC-REQ-J450-*`, `ACC-REQ-J990-*` |
| `ACC-CAP-SEARCH-001` | Global Actions/All/Documents/Blocks search with fuzzy, exact, alphabetical and smart sorting | `ACC-J500` | `ACC-REQ-J500-*` |
| `ACC-CAP-SEMANTIC-001` | Local embedding model prepare, status, graph index refresh and semantic search | `ACC-J500`, `ACC-J950` | `ACC-REQ-J500-*`, `ACC-REQ-J950-*` |
| `ACC-CAP-HISTORY-001` | Document snapshots: list, count, preview/diff, bookmark, copy, delete and restore | `ACC-J510`, `ACC-J990` | `ACC-REQ-J510-*`, `ACC-REQ-J990-*` |
| `ACC-CAP-RESTORE-001` | Graph restore points, snapshot/diff, restore progress, cancel and recovery overlay | `ACC-J510`, `ACC-J990` | `ACC-REQ-J510-*`, `ACC-REQ-J990-*` |
| `ACC-CAP-TTS-001` | Read from selection/cursor, highlight, pause/resume, skip, speed and cleanup | `ACC-J020`, `ACC-J520` | `ACC-REQ-J020-*`, `ACC-REQ-J520-*` |
| `ACC-CAP-CHAT-001` | Chat compose/send, streaming transcript, markdown/code, citations and error retry | `ACC-J020`, `ACC-J530` | `ACC-REQ-J020-*`, `ACC-REQ-J530-*` |
| `ACC-CAP-CHAT-002` | Chat model selection, session slots, surface actions, popout and shell-rerender survival | `ACC-J020`, `ACC-J530`, `ACC-J950` | `ACC-REQ-J020-*`, `ACC-REQ-J530-*`, `ACC-REQ-J950-*` |
| `ACC-CAP-SET-001` | Account, appearance, reduced motion, panel labels, theme/skin and sign out | `ACC-J600` | `ACC-REQ-J600-*` |
| `ACC-CAP-SET-002` | Local API/MCP connection info, copy/reveal controls and scoped client-token lifecycle | `ACC-J600` | `ACC-REQ-J600-*` |
| `ACC-CAP-SET-003` | Graph operations and read-only graph workbench/query inspection | `ACC-J610`, `ACC-J990` | `ACC-REQ-J610-*`, `ACC-REQ-J990-*` |
| `ACC-CAP-SET-004` | PDF ingestion engine selection, Docling preparation and vault/importer status | `ACC-J610`, `ACC-J950` | `ACC-REQ-J610-*`, `ACC-REQ-J950-*` |
| `ACC-CAP-SET-005` | Billing/storage plan, upgrade messaging, feedback and analytics consent | `ACC-J920`, `ACC-J950` | `ACC-REQ-J920-*`, `ACC-REQ-J950-*` |
| `ACC-CAP-SHARE-001` | List/add/remove workspace members and assign editor/viewer roles | `ACC-J910` | `ACC-REQ-J910-*` |
| `ACC-CAP-SHARE-002` | Create, copy and revoke a public share link | `ACC-J910` | `ACC-REQ-J910-*` |
| `ACC-CAP-PUBLIC-001` | Anonymous public workspace navigation, document rendering, block links and connection view | `ACC-J910` | `ACC-REQ-J910-*` |
| `ACC-CAP-COLLAB-001` | Two-browser awareness, user name/color, presence list and remote cursor/selection | `ACC-J800` | `ACC-REQ-J800-*` |
| `ACC-CAP-COLLAB-002` | Concurrent edits, reconnect, offline queue, eventual convergence and restart persistence | `ACC-J800` | `ACC-REQ-J800-*` |
| `ACC-CAP-ERROR-001` | Loading, empty, 401/403/404/409/429/500, disconnect, retry and cleanup states | `ACC-J700` | `ACC-REQ-J700-*` |
| `ACC-CAP-STORAGE-001` | Storage usage/preflight, warning/limit banners and blocked mutation without partial state | `ACC-J700` | `ACC-REQ-J700-*` |
| `ACC-CAP-OPS-001` | Ops health route, polling, status severity, detail/error and copy JSON | `ACC-J930` | `ACC-REQ-J930-*` |
| `ACC-CAP-CHOREO-001` | Studio routing, run list, launch, anatomy, gates and compare screens | `ACC-J940` | `ACC-REQ-J940-*` |
| `ACC-CAP-CHOREO-002` | Live run telemetry, SSE/poll fallback, phase/node details, retry, replay and provenance | `ACC-J940`, `ACC-J950` | `ACC-REQ-J940-*`, `ACC-REQ-J950-*` |
| `ACC-CAP-EMP-001` | Emporium vocabulary catalog, version/anatomy/class query and ingest into graph | `ACC-J940` | `ACC-REQ-J940-*` |
| `ACC-CAP-EMP-002` | Emporium graph view, navigation and live gardend read integration | `ACC-J940` | `ACC-REQ-J940-*` |
| `ACC-CAP-ZOTERO-001` | Zotero item search, materialize source, annotations, tags, incoming wires and external open | `ACC-J940`, `ACC-J950` | `ACC-REQ-J940-*`, `ACC-REQ-J950-*` |
| `ACC-CAP-DESTRUCT-001` | Confirmation/cancel semantics and fixture-only scope for destructive actions | `ACC-J990` | `ACC-REQ-J990-*` |

## Journey step evidence requirements

The manifest remains authoritative for each step's action and expected result.
This table fixes the stable requirement-to-channel mapping used by the logger.

| Journey | Step | Stable requirement ID | Required evidence channels |
|---|---|---|---|
| `ACC-J010` | `discover` | `ACC-REQ-J010-discover` | `console`, `screenshot`, `catalog-diff` |
| `ACC-J010` | `interact` | `ACC-REQ-J010-interact` | `trace`, `screenshot`, `console`, `page-errors` |
| `ACC-J020` | `desktop` | `ACC-REQ-J020-desktop` | `trace`, `screenshot`, `console`, `page-errors` |
| `ACC-J020` | `speech-mobile` | `ACC-REQ-J020-speech-mobile` | `trace`, `screenshot`, `browser-state` |
| `ACC-J100` | `landings` | `ACC-REQ-J100-landings` | `trace`, `screenshot`, `network` |
| `ACC-J100` | `legal` | `ACC-REQ-J100-legal` | `screenshot`, `console`, `page-errors` |
| `ACC-J110` | `home` | `ACC-REQ-J110-home` | `trace`, `screenshot`, `network`, `graph-before-after` |
| `ACC-J110` | `chrome` | `ACC-REQ-J110-chrome` | `trace`, `screenshot`, `browser-state` |
| `ACC-J120` | `catalog` | `ACC-REQ-J120-catalog` | `trace`, `network`, `backend-log`, `graph-before-after` |
| `ACC-J120` | `isolation` | `ACC-REQ-J120-isolation` | `screenshot`, `graph-before-after`, `crdt-hashes` |
| `ACC-J130` | `crud` | `ACC-REQ-J130-crud` | `trace`, `screenshot`, `network`, `graph-before-after` |
| `ACC-J130` | `batch` | `ACC-REQ-J130-batch` | `trace`, `effects-ledger`, `graph-before-after` |
| `ACC-J140` | `organize` | `ACC-REQ-J140-organize` | `trace`, `screenshot`, `browser-state` |
| `ACC-J140` | `daily-source` | `ACC-REQ-J140-daily-source` | `network`, `download`, `graph-before-after`, `screenshot` |
| `ACC-J200` | `edit` | `ACC-REQ-J200-edit` | `trace`, `crdt-hashes`, `backend-log` |
| `ACC-J200` | `reload` | `ACC-REQ-J200-reload` | `screenshot`, `crdt-hashes`, `graph-before-after` |
| `ACC-J210` | `marks` | `ACC-REQ-J210-marks` | `trace`, `screenshot`, `crdt-hashes` |
| `ACC-J210` | `blocks` | `ACC-REQ-J210-blocks` | `trace`, `screenshot`, `graph-before-after` |
| `ACC-J220` | `outline` | `ACC-REQ-J220-outline` | `trace`, `screenshot`, `accessibility`, `crdt-hashes` |
| `ACC-J220` | `move-find` | `ACC-REQ-J220-move-find` | `trace`, `screenshot`, `clipboard`, `graph-before-after` |
| `ACC-J230` | `slash-rich` | `ACC-REQ-J230-slash-rich` | `trace`, `screenshot`, `crdt-hashes` |
| `ACC-J230` | `links-images` | `ACC-REQ-J230-links-images` | `network`, `trace`, `screenshot`, `graph-before-after` |
| `ACC-J240` | `tags` | `ACC-REQ-J240-tags` | `trace`, `screenshot`, `graph-before-after` |
| `ACC-J240` | `citations` | `ACC-REQ-J240-citations` | `trace`, `screenshot`, `graph-before-after` |
| `ACC-J300` | `lifecycle` | `ACC-REQ-J300-lifecycle` | `trace`, `screenshot`, `crdt-hashes` |
| `ACC-J300` | `delete` | `ACC-REQ-J300-delete` | `trace`, `graph-before-after`, `effects-ledger` |
| `ACC-J310` | `create` | `ACC-REQ-J310-create` | `trace`, `network`, `graph-before-after` |
| `ACC-J310` | `manage` | `ACC-REQ-J310-manage` | `trace`, `screenshot`, `graph-before-after` |
| `ACC-J320` | `overlay` | `ACC-REQ-J320-overlay` | `trace`, `screenshot`, `browser-state` |
| `ACC-J320` | `mode` | `ACC-REQ-J320-mode` | `trace`, `graph-before-after`, `accessibility` |
| `ACC-J330` | `graph` | `ACC-REQ-J330-graph` | `screenshot`, `trace`, `graph-before-after` |
| `ACC-J330` | `inspect` | `ACC-REQ-J330-inspect` | `screenshot`, `accessibility`, `trace` |
| `ACC-J400` | `query-vega` | `ACC-REQ-J400-query-vega` | `trace`, `screenshot`, `network`, `graph-before-after` |
| `ACC-J400` | `mermaid` | `ACC-REQ-J400-mermaid` | `screenshot`, `console`, `crdt-hashes` |
| `ACC-J410` | `scene` | `ACC-REQ-J410-scene` | `trace`, `screenshot`, `artifact-hashes`, `backend-log` |
| `ACC-J410` | `links` | `ACC-REQ-J410-links` | `trace`, `graph-before-after`, `artifact-hashes` |
| `ACC-J420` | `edit` | `ACC-REQ-J420-edit` | `trace`, `artifact-hashes`, `graph-before-after` |
| `ACC-J420` | `history` | `ACC-REQ-J420-history` | `screenshot`, `network`, `artifact-hashes` |
| `ACC-J430` | `import` | `ACC-REQ-J430-import` | `trace`, `network`, `backend-log`, `graph-before-after`, `artifact-hashes` |
| `ACC-J430` | `reader` | `ACC-REQ-J430-reader` | `trace`, `screenshot`, `download`, `artifact-hashes`, `browser-state` |
| `ACC-J440` | `success` | `ACC-REQ-J440-success` | `trace`, `network`, `backend-log`, `graph-before-after` |
| `ACC-J440` | `errors` | `ACC-REQ-J440-errors` | `screenshot`, `network`, `graph-before-after`, `effects-ledger` |
| `ACC-J450` | `document` | `ACC-REQ-J450-document` | `download`, `artifact-hashes`, `screenshot` |
| `ACC-J450` | `graph` | `ACC-REQ-J450-graph` | `network`, `backend-log`, `graph-before-after`, `artifact-hashes` |
| `ACC-J500` | `lexical` | `ACC-REQ-J500-lexical` | `trace`, `screenshot`, `network` |
| `ACC-J500` | `semantic` | `ACC-REQ-J500-semantic` | `network`, `backend-log`, `screenshot`, `graph-before-after` |
| `ACC-J510` | `snapshots` | `ACC-REQ-J510-snapshots` | `trace`, `network`, `graph-before-after`, `effects-ledger` |
| `ACC-J510` | `restore` | `ACC-REQ-J510-restore` | `trace`, `backend-log`, `bundle-validation`, `crdt-hashes`, `document-projections`, `rdf-normalized`, `search-history`, `artifact-hashes`, `fresh-context`, `restart-D4-G`, `crash-D4-C`, `rollback-faults`, `graph-before-after` |
| `ACC-J520` | `playback` | `ACC-REQ-J520-playback` | `trace`, `screenshot`, `browser-state` |
| `ACC-J520` | `cleanup` | `ACC-REQ-J520-cleanup` | `console`, `page-errors`, `browser-state` |
| `ACC-J530` | `conversation` | `ACC-REQ-J530-conversation` | `trace`, `screenshot`, `console` |
| `ACC-J530` | `survival` | `ACC-REQ-J530-survival` | `trace`, `browser-state`, `page-errors` |
| `ACC-J600` | `preferences` | `ACC-REQ-J600-preferences` | `trace`, `screenshot`, `browser-state` |
| `ACC-J600` | `connection` | `ACC-REQ-J600-connection` | `clipboard-redacted`, `network-redacted`, `loopback-audit` |
| `ACC-J610` | `workbench` | `ACC-REQ-J610-workbench` | `trace`, `network`, `graph-before-after` |
| `ACC-J610` | `ingestion` | `ACC-REQ-J610-ingestion` | `network`, `backend-log`, `graph-before-after` |
| `ACC-J700` | `faults` | `ACC-REQ-J700-faults` | `trace`, `network`, `console`, `page-errors`, `effects-ledger` |
| `ACC-J700` | `quota` | `ACC-REQ-J700-quota` | `screenshot`, `network`, `graph-before-after` |
| `ACC-J720` | `mobile` | `ACC-REQ-J720-mobile` | `trace`, `screenshot`, `browser-state` |
| `ACC-J720` | `a11y` | `ACC-REQ-J720-a11y` | `accessibility`, `trace`, `screenshot` |
| `ACC-J800` | `awareness` | `ACC-REQ-J800-awareness` | `dual-video`, `trace`, `crdt-hashes`, `backend-log` |
| `ACC-J800` | `recover` | `ACC-REQ-J800-recover` | `network`, `backend-log`, `graph-before-after`, `crdt-hashes` |
| `ACC-J900` | `funnel` | `ACC-REQ-J900-funnel` | `trace-redacted`, `screenshot-redacted`, `network-redacted` |
| `ACC-J900` | `session` | `ACC-REQ-J900-session` | `browser-state-redacted`, `network-redacted`, `console` |
| `ACC-J910` | `roles-share` | `ACC-REQ-J910-roles-share` | `trace-redacted`, `network-redacted`, `graph-before-after` |
| `ACC-J910` | `public` | `ACC-REQ-J910-public` | `trace-redacted`, `screenshot`, `network-redacted` |
| `ACC-J920` | `plan-consent` | `ACC-REQ-J920-plan-consent` | `screenshot`, `network-redacted`, `browser-state` |
| `ACC-J920` | `feedback` | `ACC-REQ-J920-feedback` | `network-redacted`, `effects-ledger` |
| `ACC-J930` | `states` | `ACC-REQ-J930-states` | `screenshot`, `clipboard`, `accessibility`, `browser-state` |
| `ACC-J930` | `hosted` | `ACC-REQ-J930-hosted` | `network-redacted`, `trace-redacted` |
| `ACC-J940` | `choreograph` | `ACC-REQ-J940-choreograph` | `trace`, `screenshot`, `accessibility` |
| `ACC-J940` | `emporium-zotero` | `ACC-REQ-J940-emporium-zotero` | `network`, `graph-before-after`, `screenshot` |
| `ACC-J950` | `gate` | `ACC-REQ-J950-gate` | `effects-ledger`, `verdict` |
| `ACC-J950` | `run` | `ACC-REQ-J950-run` | `trace-redacted`, `network-redacted`, `backend-log-redacted`, `graph-before-after` |
| `ACC-J990` | `cancel` | `ACC-REQ-J990-cancel` | `trace`, `effects-ledger`, `graph-before-after` |
| `ACC-J990` | `confirm` | `ACC-REQ-J990-confirm` | `trace`, `backend-log`, `effects-ledger`, `graph-before-after` |
| `ACC-J990` | `closure` | `ACC-REQ-J990-closure` | `coverage-report`, `defect-ledger`, `graph-before-after` |

## Mandatory manifest deltas discovered by this audit

These IDs are reserved by this supplement so implementation work can proceed,
but they cannot receive a release PASS until they are added to the JSON manifest
with reciprocal journey coverage and source validation.

| Provisional capability | Garden source/reachability | Target status | Required journey and evidence |
|---|---|---|---|
| `ACC-CAP-MODE-001` — bottom-bar Local/Cloud state, connect, disconnect, stale credentials and sign-out panel | `mn-bottom-bar` mounts `mn-cloud-mode-pill`; `mn-cloud-mode-panel` performs native hosted-mode effects | controlled components exist, but Organism bottom bar explicitly says the pill is not lifted/mounted | add `ACC-J600:mode-local` and `ACC-J900:mode-hosted`; `ACC-REQ-J600-mode-local`, `ACC-REQ-J900-mode-hosted`; browser trace plus native credentials/config state and `D5` |
| `ACC-CAP-SET-006` — hosted API-key create, show-once copy/dismiss, list/prefix/last-used, limit and revoke | Garden Settings `api-keys` section, hosted only | Organism labels this section “AI Provider Keys,” a different contract; Garden account API-key lifecycle is not mapped | add `ACC-J925`; show-once secret must be redacted from artifacts, revoke proves denial, all actions use disposable keys |
| `ACC-CAP-SECRET-001` — AI provider key configured/missing, configure/replace/delete, local keychain and hosted Choreograph secret store | Garden Local AI OpenRouter key and provider-key native bridge | Shrubbery now has write-only `ProviderSecretStore`, Tauri and gateway implementations, plus component UI; current harness proves only controlled behavior | add `ACC-J600:provider-secret` and `ACC-J950:provider-call`; use the source-time secret-safe capture boundary, prove no persistent residue in DOM/URL/storage/logs/artifacts/graph, byte-scan the bundle, then prove status across `D5` and bounded provider use |
| `ACC-CAP-SET-007` — native Interface/window appearance | Garden Settings `interface`, local-desktop only | controlled Interface section exists but current service offers generic shell preferences, not a proven native window-mode effect | add `ACC-J605` in actual Tauri/WKWebView; capture native title bar/window geometry before/after and `D5` |
| `ACC-CAP-AI-001` — hosted Experimental Dreaming/Describing master and per-graph controls, background results and Dream Journal navigation | Garden Settings `experimental`, hosted only | no concrete Organism setting effects or hosted background-job evidence found | add `ACC-J945`; controlled fixture states at T1, then real disposable hosted graph, job/provenance, per-graph isolation, opt-in/privacy and durable hosted re-entry |

Before runner implementation, audit `frontend/src/components/**`,
`frontend/src/services/**`, and all Organism production route mounts again for
additional omissions. Static filename coverage is only a lead: primitives may
be transitively covered, while one component may expose several independent
capabilities.

## Explicitly blocked, unknown, or out-of-oracle surfaces

| Surface | Classification on 2026-07-11 | What closes it |
|---|---|---|
| Cognito signup/verify/refresh and hosted roles | environment-blocked T4 | disposable identities, controlled expiry, real gateway ACL, redacted evidence |
| public link create/revoke and anonymous public document/wire routes | backend-blocked T4 | gateway public alias/link contracts and fresh anonymous browser context |
| operator health | hosted/operator-only | operator credential and real health service; local fixture remains T0 only |
| billing, credits, feedback and analytics delivery | external/hosted T5 | disposable account, no purchase in unattended mode, bounded feedback sink |
| semantic model first download and Docling preparation | network/time-gated T5 | explicit approval, recorded model/runtime hashes, cached follow-up run |
| YouTube transcript | explicitly deferred in Garden local surface | honest unavailable UX or a real implemented provider contract |
| OpenRouter image/chat calls | cost/secret-gated T5 | disposable key, cost ceiling, redacted provider trace, delete key afterward |
| Choreograph launch/live telemetry | host-adapter/external T4/T5 | real gateway route, resumable event stream, journal/RDF provenance equality |
| Zotero external open | desktop/external | disposable Zotero fixture plus observed `zotero://` handoff; browser fixture cannot prove OS launch |
| graph restore with an already-connected editor | correctness-blocked | browser client reset/rebase and full projection/rollback proof described above |
| Tauri keychain, native title bar, save/file dialogs and packaged-app restart | native computer-use | actual signed/dev Tauri app and OS-level driver or recorded human checkpoint |
| exact macOS WKWebView rendering | unknown until native lane exists | matched packaged-app run; Playwright WebKit does not close it |
| Organism `/chat-debug` | development-only target route | exclude from Garden fidelity; optionally keep a target-extension smoke |
| `mn-research-*`, `mn-ribbon`, `mn-graph-three`, and target-only relation views | target extensions, reachability/product status not yet ratified | product decision, production route proof, then separate extension capabilities |
| extension-injected `contentscript.js` warnings | outside product | reproduce in runner-owned clean Chromium; preserve product console errors unfiltered |

No blocked or unknown row is silently skipped. It receives `BLOCKED` with an
owner and evidence or remains an inventory blocker. `NOT-APPLICABLE` is allowed
only for a declared mode/role where the capability genuinely does not apply.

## Evidence bundle and final closure

The bundle layout from the acceptance program is normative, with these added
append-only files:

```text
<run-id>/
  events.jsonl
  effects.jsonl
  verdicts.jsonl
  defects.jsonl
  approvals.jsonl
  observations.jsonl
  artifacts.manifest.json
  artifacts.manifest.sha256
```

Final coverage is computed as the cross product of every cataloged capability's
declared modes and roles, reduced only by reviewed pairwise rules. A release
statement must report:

- the exact Garden oracle, Shrubbery SHA/dirty hash, gardend SHA/binary hash,
  browser and OS/native versions;
- terminal verdict counts by capability, mode, role, tier, and durability level;
- every FAIL, BLOCKED, NOT-APPLICABLE, open defect, inventory delta, takeover,
  retry, and unclean console/page error;
- evidence IDs supporting every PASS; and
- the narrower sentence that the evidence actually justifies.

“All features work” is permitted only when the inventory gate is closed, every
claimed cell is terminal, every stateful claim meets its durability level, and
the mandatory manifest deltas above have been resolved. Until then, the output
is a precise census of what was proven and what remains uncertain.
