# Garden → Shrubbery fidelity acceptance program

Status: design and executable manifest; runner implementation is intentionally a follow-up.

Oracle: Garden `cf0cb9600ba25ee49f7268301bcf3d949ed48f3b`

Target: the Shrubbery commit recorded at execution time

Machine-readable catalog: [`garden-capability-manifest.json`](./garden-capability-manifest.json)

Structural contracts live in [`schemas/`](./schemas/). Validate IDs, reciprocal
coverage, tiers/modes/roles, evidence declarations and both pinned-oracle and
target source paths with:

```sh
node scripts/validate-acceptance-manifest.mjs --check-sources
```

## The corrected intention

The goal is not an enormous click checklist and not a claim that every custom
element was registered. It is an auditable acceptance-claims program:

1. derive user-visible capabilities from a pinned Garden source oracle;
2. map each capability to its Shrubbery surface, backend authority, role and
   deployment mode;
3. exercise the smallest set of real user journeys that traverses every
   meaningful state transition and contract boundary;
4. capture enough browser, backend and graph evidence to reproduce every
   verdict; and
5. refuse to call the port complete while an in-scope claim is untested,
   blocked or contradicted by the backend.

This is how the walkthrough gets rid of doubt. Watching it is useful, but the
lasting product is the evidence bundle and capability verdict ledger.

## Scope and source of truth

The pinned oracle is Garden at the SHA above, not whichever branch happens to
be checked out on test day. Inventory sources are:

- `frontend/src/app-shell.ts`: routes, home, shell and journey composition;
- `frontend/src/lib/capabilities.ts`: addressable user commands;
- `frontend/src/lib/testids.ts`: primary agent-legible surfaces;
- `frontend/src/components/**`: rendered states, actions and accessibility;
- `frontend/src/services/**`: host/backend effects;
- `parity/local-loopback-surface.json`: local gardend route, scope and status;
- the dormant real-browser outliner harness at Garden `8673381`, used as a
  technique reference rather than as oracle product code.

The manifest contains 80 source-mapped capabilities. Each has a stable ID,
Garden evidence, Shrubbery target, backend/browser contract, modes, roles,
tier, statefulness and one or more journey IDs. An inventory update is a code
review event: new or removed Garden actions/components/routes must produce an
explicit manifest diff.

Internal visual primitives are covered as component contracts. Backend-only
APIs with no user-visible Garden surface are not frontend fidelity claims, but
may be prerequisites/evidence providers. Feature-flagged or externally backed
user surfaces remain in the inventory and receive `BLOCKED` when their real
contract cannot run; they are not silently omitted.

## Test tiers and claim boundaries

| Tier | Purpose | What it can prove |
|---|---|---|
| T0 component | Happy DOM and Storybook controlled contracts | Rendering, events, keyboard semantics, deterministic visual states |
| T1 in-memory browser | Real Chromium plus Shrubbery's in-process cell contract | App composition and browser-only behavior without backend variance |
| T2 local cell | Real Chromium plus a fresh full `gardend` | The primary local Garden product journey and real persistence/contracts |
| T3 resilience/collaboration | Two browser contexts, disconnects and retained-profile restarts | Awareness, convergence, reconnect, cleanup and durable state |
| T4 hosted/backend-blocked | Gateway, roles, auth, public and operator paths | Hosted claims only; a local result cannot substitute |
| T5 external | Disposable real service accounts, bounded inputs and budgets | Real provider integration; fixture-only success is insufficient |
| T6 safety-gated | Destructive actions on runner-owned fixtures | Confirmation, cancellation, exact mutation and cleanup |

A PASS is always scoped as `(capability, mode, role, target SHA)`. For example,
`PASS local-owner/local-cell` says nothing about hosted viewers. The final
release claim must name its scope and list all out-of-scope BLOCKED claims.

## Deterministic local gardend fixture

Each local run owns a new profile under a run-specific temporary directory. It
must never discover or wipe Garden's normal `default` profile. The runner:

1. builds or selects the exact `gardend` binary and records its SHA/hash;
2. starts it with a fresh profile and captures stdout/stderr;
3. discovers the random port and bearer token from the fresh loopback manifest;
4. verifies PID liveness and `/health` before using the manifest;
5. seeds through REST/MCP/CRDT authorities, never by editing profile files;
6. writes the browser proxy handoff server-side so the token never enters page
   JavaScript;
7. runs fixture verification and records a normalized baseline; and
8. normally destroys only the owned temp profile after evidence finalization.

The fixture set should contain:

- two graphs with colliding labels and different content for isolation;
- nested folders, editable documents, a daily-note series, Dream Journal,
  pinned/new/recent documents and tags;
- stable block IDs, rich editor structures, comments and directed/bidirectional
  wires with several predicates;
- an Excalidraw scene with valid, stale and missing scene anchors;
- small synthetic PDF, EPUB, DOCX, TXT, Markdown, HTML, XML and image files,
  each with committed SHA-256 and known parsed text;
- graph export/import, RDF and synthetic Obsidian/Notion/Roam archives;
- query data containing strings, integers, decimals, booleans and dates for
  SPARQL/Vega behavior;
- local HTTP pages for Quick Clip success, redirect, malformed, oversized and
  private-network rejection cases; and
- deterministic chat, health, Choreograph and external-service adapters for
  controlled states, clearly distinguished from real-provider runs.

Fixture IDs use an acceptance-run prefix and are recorded in an ownership
allowlist. Timestamps are fixed where a test clock exists; date-sensitive UI
otherwise computes the expected date from the recorded timezone/locale at run
start. Random IDs are generated from a recorded seed.

### Reset and restart

The default isolation unit is one fresh profile per shard, not “delete whatever
is present.” Within a shard, a journey may restore its named baseline through
public contracts. Restart tests retain the owned profile, terminate gardend,
start the same binary against that profile, rediscover the new port/token and
reconnect fresh browser contexts. State is compared by normalized RDF dumps,
workspace/document Yjs hashes/state vectors, artifact hashes and graph catalog.

## State model and tractable exhaustiveness

The manifest orders 38 journeys. It avoids a full Cartesian product by covering
states and transitions, then applying pairwise combinations only where the same
implementation path serves multiple dimensions.

Core states include:

- route: anonymous/authenticated/public/operator;
- graph: empty/populated/A/B, owner/editor/viewer;
- document: none/editable/read-only/imported/original/drawing/tag/daily;
- shell: desktop/mobile, home/editor, single/split, one selected right panel;
- provider: connecting/synced/disconnected/reconnecting/destroyed;
- async operation: idle/loading/success/error/cancel/retry;
- data: empty/single/multiple/malformed/stale/missing; and
- mutation: preview/cancel/confirm/settle/reload/restart.

Pairwise reduction is legitimate only when omitted combinations share the same
transition and contract boundary. It is not legitimate across different
authorities (for example local MCP versus gateway public routes), roles, MIME
renderers, persistence layers or destructive effects. Those require separate
claims.

## Runner design

The future runner should be a thin Playwright program in `apps/organism`, using
the already reserved Playwright dependency and existing `spawnGardend` and
browser-harness patterns. It should not grow a privileged page-side control
API. Visible user actions use roles, accessible names and stable test IDs. A
small bridge may expose readiness and read-only corroborating state only.

The intended command contract is:

```text
pnpm acceptance:run \
  --journey ACC-J430 \
  --headed \
  --slow-mo 250 \
  --pause-at mutations,external,human-judgment \
  --artifact-dir /private/tmp/shrubbery-acceptance/<run-id> \
  --keep-open
```

Unattended mode is headless, has no arbitrary sleeps, pauses only when an action
requires authority not granted at invocation, and exits non-zero for FAIL or an
unexpected BLOCKED verdict. Retry is explicit and recorded; it never overwrites
the first failure evidence.

### Watch-along for Vera

`--headed` launches a visible Chromium window. `--slow-mo` controls pacing. A
small always-visible run HUD or sidecar page should show:

- run and journey ID, target/backend SHAs and elapsed time;
- current step in plain language, expected result and next action;
- latest PASS/FAIL/BLOCKED verdict;
- whether the agent or Vera currently owns input; and
- Pause, Resume, Step, Take over, Return control and Stop-after-step controls.

At a takeover checkpoint, automation finishes the current atomic action,
flushes trace/evidence, releases input and waits. Vera can inspect or perform
the declared action. Resume records a screenshot, DOM/accessibility snapshot
and graph-state delta before the agent continues. Unstructured human edits are
allowed only in an explicitly marked exploratory interval; they fork the run
and prevent it from being used as a deterministic release verdict unless the
actions are translated into logged steps.

When the in-app Browser surface is available and Vera asks to watch side by
side, its visibility should be enabled and it can drive the same journey
protocol. Standalone headed Playwright remains the reproducible repo runner.

## No hidden mutations

Every state change is one of:

1. a visible product action;
2. a declared fixture seed/reset through an authenticated public contract;
3. a declared, scoped fault injected by the runner proxy; or
4. a safety-approved external/destructive action.

Each is appended to `effects.jsonl` with timestamp, journey/step, actor,
contract, target fixture IDs, request hash, response status and resulting state
snapshot. Browser evaluation may read readiness/state but may not call stores,
editor commands or backend clients to make the product pass. Direct CRDT/RDF
seeding is allowed only before a journey and appears in the fixture ledger.

## Evidence bundle

Every run writes an immutable directory:

```text
<run-id>/
  run.json                       # IDs, mode/role, verdict summary, start/end
  versions.json                  # Shrubbery/Garden/gardend SHAs, binary hashes
  environment.json               # OS/browser/TZ/locale/viewport, redacted env
  fixture.json                   # seed, owned IDs, source fixture hashes
  effects.jsonl                  # every declared mutation/fault/takeover
  browser/console.jsonl
  browser/page-errors.jsonl
  browser/requests.jsonl         # headers/bodies redacted, timing retained
  browser/trace.zip
  browser/video.webm
  backend/stdout.log
  backend/stderr.log
  backend/loopback-audit.redacted.jsonl
  state/baseline/*               # catalog/RDF/Yjs/artifact normalized hashes
  journeys/<journey>/<step>/
    step.json                    # action, expected, observed, verdict, times
    before.png
    after.png
    accessibility.json
    requests.jsonl
    state-before.json
    state-after.json
  verdicts.jsonl
  defects.jsonl
  coverage.json
```

Every step records wall-clock and monotonic timestamps, a correlation ID, page
URL, browser console/page errors, relevant requests/responses, screenshot,
backend log window and authoritative state before/after. Video and trace are
run-level with step annotations. Secrets, bearer tokens, credentials, signed
URLs, private graph prose and local file paths are redacted before finalization;
redaction itself is recorded.

## Verdicts and defects

Allowed verdicts:

- `PASS`: every assertion passed with required evidence;
- `FAIL`: observed behavior contradicts the claim;
- `BLOCKED`: a named prerequisite/contract is unavailable, with owner and
  evidence; and
- `NOT-APPLICABLE`: the claim genuinely does not apply to this declared
  mode/role, with rationale.

There is no `SKIP`, “mostly passed,” or assumed pass. A rerun does not erase an
earlier FAIL. The verdict record contains run/journey/capability/step, scope,
expected/observed, evidence paths, rationale, timestamps and exact rerun
command.

A defect record contains stable defect ID, severity, capability/journey/step,
oracle behavior, Shrubbery behavior, reproduction, expected/actual, mode/role,
first/last seen target SHA, evidence links, suspected contract/owner, status,
workaround and exact focused rerun. One defect may affect multiple capability
claims, but each affected claim keeps its own FAIL/BLOCKED verdict.

## Coverage closure

The port is not accepted because 87/87 tags register, tests compile or the
happy path looked right once. Closure requires all of the following:

1. source inventory diff is empty or every change is reviewed/classified;
2. every manifest capability has a terminal verdict in every claimed
   mode/role;
3. each production capability has at least one T1–T6 behavioral journey;
4. each stateful local capability proves reload, provider switch, new context or
   restart persistence as appropriate;
5. mutations have authoritative before/after evidence and duplicate/idempotency
   checks;
6. asynchronous behavior has meaningful error, retry and cleanup evidence;
7. accessibility and keyboard assertions are embedded in primary journeys, not
   relegated only to a component story;
8. desktop/mobile and multi-client claims prove preservation/convergence, not
   merely fresh mounts;
9. hosted/backend-blocked/external claims remain visibly BLOCKED until real
   contracts run; and
10. the final report lists every remaining defect and BLOCKED claim before it
    states the exact scope of “feature complete.”

The capstone should run the T2 local-cell catalog, then T3 resilience and T6
safety, on a clean Shrubbery SHA with a retained evidence bundle. T4/T5 are
separate reports because local gardend cannot honestly prove Cognito, hosted
ACL/public routes, Choreograph telemetry or third-party providers.

## Implementation sequence

1. Land and validate the manifest/schema and fixture provenance.
2. Add a runner-owned fresh-profile gardend lifecycle with retain/restart.
3. Promote the current raw Chromium harness into reusable capture/reporting
   fixtures; keep the in-memory and live-cell modes separate.
4. Implement T2 journeys by ordered domain, using the existing real-gardend
   integration tests as lower-level contract preflight.
5. Add evidence/ledger/report finalization and focused rerun.
6. Add two-context/fault/restart T3 behavior.
7. Add headed HUD/takeover UX without changing unattended semantics.
8. Run hosted/external suites only with disposable accounts and explicit
   authority.

The runner itself is deliberately not implemented in this side effort. The
manifest and protocol are the stable contract it should implement.
