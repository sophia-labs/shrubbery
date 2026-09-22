# Domain Agents — implementation roadmap (platform layer + Shrubbery instance)

Status: ratified for implementation on 2026-08-03. This document specifies
behavior; it does not itself grant an agent authority over the world. Runtime
authority still comes only from an effective Layer 0 grant and, where named,
human approval.

Date: 2026-08-03 (rev 3 — Phanes runtime re-anchor + Development Domain)

Scope: cross-repo (shrubbery, choreograph, cloud, garden). This document lives
in shrubbery because Shrubbery is the first *recruited* domain; each workstream
names the repo and the **layer** it belongs to.

### Architectural precedence

The roadmap is a required-outcomes specification, not permission to replace a
stronger Sophia primitive with a weaker local invention. Where an existing,
deployed Sophia pattern meets the required behavior with stronger authority
boundaries or greater operational honesty, that pattern controls the
implementation. The first explicit precedent is Phanes: a small durable host
edge owns credentials, consent, trigger/listener reachability, and execution
of approved effects; the agent itself is a bounded capability sandbox whose
typed output proposes effects but never grants itself permission. Persistent
means graph-persistent identity and career continuity, not a resident agent
process. Steering remains a control-plane right over the bounded process and
cannot widen its world grant.

Phanes's durable turn is also the targeting precedent. A cloud graph is the
exact `(owner principal, graph id)` tuple, never a slug by itself. The host
commits that tuple with the trigger, derives replay/effect identity from the
host-owned turn plus effect ordinal, and supplies credentials only at the
effect edge. Sandbox-proposed targets and idempotency keys remain testimony;
they cannot retarget an effect or authorize a duplicate.

Phanes also controls the shape *inside* that sandbox. A transport adapter
recognizes and commits a trigger; it does not select the agent's response
program. The revived Domain Agent begins with a freeform central pilot that
orients from its graph-defined identity, charter, memory, and current world,
then decides whether to answer directly, invoke a deterministic domain
program, or delegate bounded read-only work to smaller emanations. A fixed
acceptance program may be an especially important instrument of a domain
agent, but it is not the agent's mind.

The co-located Choreograph **browser service** is the complementary capability
precedent. It is a private, agent-ignorant HTTP service that owns heavyweight
browser processes and short-lived session leases. It knows no prompts,
ontologies, turns, grants, or workflows. Choreograph's host-side capability
binding selects an engine, injects the origin clamp and credential-bearing
storage state, withholds the service session id from the sandbox, mediates the
small typed tool surface, emits testimony, and reaps the session. An agent
pilot, a deterministic program, and a model-free local/API invocation can
therefore use the same implementation without the service learning which kind
of caller it serves.

This is the intended meaning of **agent-less Choreograph** in this roadmap:
the witnessed run/capability substrate can execute a deterministic program or
serve a direct API invocation without a model stage. It is not an alternate
Domain Agent runtime and it does not let a domain trigger bypass the freeform
pilot. New heavyweight capabilities should prefer this split: a narrow private
service owns resource pools and leases; Choreograph binds that dumb service to
the exact run and effective grant; credentials and externally durable effects
remain at the host edge.

## 0. The end state (the onboarding sentence)

> "Here's your Sophia account, the Shrubbery cell, and the domain agent for
> you to work with."

Concretely, on onboarding day a recruited frontend specialist receives:

1. **A Sophia account** — a Cognito identity under which the Shrubbery Domain
   Cell is created (owner from birth), with viewer access to the exact
   Platform-authority owner/graph tuple and editor access to the exact Hoja
   probe campaign tuple.
2. **The Shrubbery Domain Cell** — a live gardend cell whose graph holds the
   domain: the capability manifest as RDF, the verdict ledger, evidence refs,
   the domain agent's charter and prompt document, sealed named-query
   catalogues, and dashboards authored as `ux:layoutJson`. The cell *serves its
   own site*: the human face is the domain dashboard; the agent face is
   curl-able hypertext/turtle/JSON-LD via the render pool.
3. **The Shrubbery Domain Agent** — a named, graph-persistent,
   Sophia-standard agent (standalone registered identity, graph-resident
   prompt, declared toolbelt, per-observer Geist memory graph, literally
   process-dormant-and-revivable) whose Phanes-style activity loop is a
   freeform domain control loop. On a ping or domain event, its Inkling pilot
   orients, chooses an appropriate response, and may call the acceptance
   program to pick untested claims, drive real browser journeys, emit
   testimony, write scoped verdicts, and refresh the domain dashboard. It may
   delegate bounded read-only subtasks to Inkling-Small emanations; their
   findings return to the pilot and never cross the host effect edge on their
   own. The specialist attaches via Vehicle/Greenhouse, holds or grants the
   driver lease, steers, reviews filmstrip evidence, and edits + promotes the
   agent's prompt as a graph document.

The co-work contract: the expert curates the manifest and the charter (a code
review event, per the acceptance program); the agent responds as a general
domain colleague and uses the acceptance program to execute journeys and
maintain the ledger; both write to the same graph; Shrubbery renders that
graph as the domain's face for both of them.

That sentence is the visible product of the **upper** layer only. §1 names the
lower one.

## 1. The two domains (the layering correction)

Earlier drafts scoped everything as "the Shrubbery Domain." That was a scope
error. There are two domains here, one stacked on the other:

**Layer 0 — the Platform Domain ("cloud development platform").** Its subject
matter is the machinery of domains itself: the cell model, the graph-defined
agent substrate, the capability/toolbelt system, the testimony/observatory
pipeline, the render pool, the site capability. This domain already exists in
nascent form — it just hasn't been named as a domain:

- its **cell** is the observatory graph (the platform witnessing itself:
  testimony → projections → `:projection:obs:*` → dashboards);
- its **manifest** proto-exists as `cloud/parity/surface-contracts.json`,
  the observatory's `generated/contract-summary.json`, and the gateway's
  control-tool list;
- its **agent activity** proto-exists in the `agent/observatory-*` branch
  lineage — bounded agents have been doing platform-domain work for months
  without the role being named;
- its **verdict discipline** is the gate/ledger idiom every repo already uses
  (M-gates, swarm capability matrix, deployment-state ledgers).

**Layer 1 — the Shrubbery Domain.** An *instance* served by Layer 0: the
Garden-fidelity charter, the 80-capability manifest, the Hoja proving ground,
shrub-1, the recruited specialist. Nothing at this layer builds machinery; it
authors content and consumes granted capabilities.

**The interface between the layers is the Domain Kit** — the reusable
contracts a domain instance is made of: a charter schema, a manifest→RDF
codec, the `Verdict` shape, the sealed named-query-catalogue convention, the
`ux:layoutJson` dashboard convention, a toolbelt *grant*, a cell, a site
route. Making the kit explicit is the real deliverable of this roadmap;
"spin up a domain" is a Platform Domain capability one level above "spin up a
site."

Consequences the rest of this document now respects:

1. **Workstream re-tagging.** WS-C, WS-E, WS-F, and the generic machinery
   formerly inside WS-A are Layer 0 work (now WS-K). WS-A (content), WS-B,
   WS-D, WS-G are Layer 1 work.
2. **Ownership splits.** The frontend specialist owns the Shrubbery Domain.
   The platform steward owns the Platform Domain — including, eventually, a
   platform-domain agent of their own (WS-P). One person cannot be the
   recruit's example and the platform's bottleneck at once.
3. **Authority points downward.** shrub-1's toolbelt is *granted by* Layer 0,
   not self-asserted at Layer 1: fences, quotas, storage-state minting,
   approval policies are platform-domain decisions recorded in the platform
   cell. A Layer 1 charter can request; only Layer 0 grants.
4. **The recruiting story generalizes on purpose.** "Account + cell + agent"
   is the onboarding for *any* domain owner. Shrubbery is the first recruited
   instance and the proving domain — the same role Hoja plays one level down.

## 2. Architecture at a glance

```
LAYER 0 · Platform Domain (steward-owned)
  Platform cell (observatory graph, evolving)     Domain Kit contracts
  bounded invocation + steering (WS-C) · site capability (WS-E)
  build + scratch cell + GitHub (WS-X)   · kit + platform agent (WS-K, WS-P)
  private dumb capability services (browser is the reference implementation)
  durable host edge: credentials · consent · triggers · approved effects
        │  grants: toolbelts · fences · quotas · approval policies
        ▼
LAYER 1 · Shrubbery Domain (specialist-owned)
                        ┌─ Sophia account (Cognito + grants) ─┐
  frontend specialist ──┤                                     │
                        └─ Vehicle/Greenhouse attach ─────────┤ driver lease,
                                                              │ steer, prompt
   Shrubbery Domain Agent graph (shrub-1, Sophia-standard)     │ edit + promote
     identity · charter · prompt · Geist memory · career      │
     trigger → bounded sandbox invocation → typed proposals ──┤
     granted tools: browser · site · graph · workflow         │
     pilot: orient → respond / invoke program / emanate        │
     acceptance program: manifest → journeys → verdicts       │
                                                              ▼
   host edge validates grant + approval + current manifest scope
                                      │ registered Emporium ingest
                                      ▼
   Shrubbery Domain Cell (gardend, cloud)
     manifest·ledger·charter·prompt·queries·ux:layoutJson
        │                       │
        │ TripleSource          │ testimony (test.beat/verdict, site.*)
        ▼                       ▼
   Render pool (planter-as-pool)   Observatory (intake → projector → RDF)
     dom | hypertext | turtle | json      → obs.filmstrip · freshness
```

## 3. Workstreams

Sizing: S = days, M = 1–2 weeks, L = 3+ weeks, for one focused person who
knows the repo. Parallelism is noted per milestone in §4.

---

### Layer 0 — Platform Domain workstreams

### WS-K · The Domain Kit (repos: shrubbery + cloud + choreograph) — M

The reusable contracts a domain is made of. Extracted, not invented — each
item generalizes something the observatory or acceptance program already does
once.

- **K1. Manifest codec.** Generic capability-manifest→RDF codec + SHACL shape
  (stable IDs, tiers, modes, roles, journey refs, evidence declarations),
  with round-trip test, in the idiom of `nucleus`'s `rdf-model.ts`. The JSON
  file remains the authoring surface; the graph is the served projection; a
  `--check-graph` validator asserts currency. (M)
- **K2. Verdict shape.** `Verdict` scoped `(capability, mode, role, target
  SHA)`, outcome ∈ PASS/FAIL/BLOCKED, content-addressed evidence refs,
  `as_of`, emitting `agt:` session URI. Ratified before any writer exists. (S)
- **K3. Catalogue + dashboard conventions.** The sealed named-query-catalogue
  pattern (`urn:sophia:query:{domain}.*`, reader-question namespacing, open-
  grounding-gaps header) and the one-`ux:layoutJson`-literal dashboard
  pattern with freshness governor, documented as kit contracts rather than
  observatory one-offs. (S)
- **K4. Toolbelt grant.** The grant document a Layer 0 steward issues to a
  domain agent: capabilities, fences, quotas, `approvalPolicy` boundaries —
  recorded in the platform cell, consumed by `agent-tool-manifest.ts`
  reconciliation. Charters request; grants authorize. (S)
- **Gate K:** a second domain (not Shrubbery) can be stood up from kit
  contracts alone — manifest, verdicts, catalogue, dashboard, grant — with
  zero new schema work. (The platform domain itself is that second instance;
  see WS-P.)

### WS-C · Graph-defined agents + bounded activity waves (repo: choreograph) — M

Phanes, combined with the deployed invocation kernel and witnessed capability
catalogue, is the runtime anchor. The learner-1/aleph branches are quarries,
not a runtime merge ladder. In particular, cross-run process adoption and a
resident world-document runtime are retired from the critical path.

- **C1. Quarry the portable graph contracts:** `agt:` relevel (`Agent ⊃
  Session ⊃ Run ⊃ Turn`, `agt:Run`), standalone registered identity
  (`mintStandaloneAgentId`, invariant across model/prompt changes),
  prompt-as-graph-document with snapshot/binding/promote and fail-closed graph
  errors, tool-manifest/effective-toolbelt schema, EA-3 vocabulary packs, and
  Geist per-observer memory graph. Land them as substrate-independent data
  contracts with byte/golden compatibility tests. Do not import aleph
  residency merely because it shares the branch. (S/M)
- **C2. Certify and generalize the Phanes seam:** a durable host edge owns
  credentials, consent, triggers/listeners, storage state, and effect
  execution; each trigger creates a budgeted capability sandbox; the sandbox
  returns typed proposed-effect envelopes; the edge validates the current
  grant, approval policy, and fence before executing an effect and emits a
  receipt/testimony either way. The durable host turn fixes the effect target;
  the host derives execution identity from that trusted turn plus the effect
  ordinal. A sandbox-supplied target or idempotency string is proposal data,
  never authority, and changing a prompt, grant revision, or disposable run ID
  cannot replay an already-landed source effect. No agent process survives
  between waves. (M)
- **C3. Close CA-1 S9 through the stronger Garden projection seam:** Garden's
  registered `sophia-agent-core` ontology and
  `wf-agent-session-projection` write pack validate the cumulative journal fold
  and materialize it into reserved `:projection:session`. Hosted Choreograph
  selects the gateway Emporium route automatically from its existing service
  auth; no sandbox or compatibility serializer writes a reserved graph
  directly. A rejected SHACL ingest leaves the projection unchanged and loud,
  while the durable run journal remains replay authority. The old isolated
  `:self:agent` target is superseded by this stronger served projection. (M,
  cross-repo)
- **C4. Generalize the domain-agent activity loop:** promote
  `script-domain-agent-activity-loop.ts` from the swarm branch to a first-
  class workflow whose graph-resident config supplies identity, charter,
  prompt binding, ontology refs, trigger, grant reference, budgets, and
  bounded depth-1 emanation policy. The workflow revives a freeform central
  pilot; deterministic programs such as the Shrubbery acceptance runner are
  callable instruments selected by that pilot, not replacements for it.
  Smaller emanations report back to the pilot and have no independent effect
  path. Phanes and shrub-1 are configurations of the same activity-loop
  primitive, not bespoke runtimes. (M)
- **C5. Wave-native steering:** Contract A run SSE is the watch surface. A
  row-level libsql driver lease/CAS grants one controller the process right.
  Program workflows use the host-injected `journey` primitive: `plan`,
  `before-beat`, and `after-beat` cross an internal run-control capability that
  has no graph, credential, model, toolbelt, or effect authority. At those
  boundaries the current lease epoch + row revision may skip/reorder a pending
  beat, re-parameterize non-authority journey data, inject a directive into the
  next `modelUse` stage, or honor a pause request. Every accepted/rejected
  amendment and frontier remains in the durable runtime row. Agent-controller
  stages continue to use chat/session turn-boundary steering. Steering changes
  what is attempted; it can never enlarge the effective toolbelt or bypass the
  host effect edge. (M)
- **Gate C:** identity/prompt/toolbelt/attach compatibility runs green; two
  differently chartered agents boot from graph-resident configuration with
  zero executor changes; neither leaves a process resident between waves;
  lease contention and a mid-wave beat amendment are witnessed; an
  out-of-grant proposed effect is refused at the host edge.

### WS-E · Site-as-capability (repos: cloud + shrubbery + choreograph) — L

The generalization: "running, hot-reloading, and serving a specific site is
something a cell can do" — implemented as *cell owns definition, pool projects*.

- **E1. Planter-as-pool.** Productionize `apps/planter` as a stateless
  deployment (same posture as the TEI/parser pools): exact owner+graph cell as
  `TripleSource` via the gateway, four conneg faces, health, no per-site state.
  Ownerless hosted boot refuses; the pool never discovers or guesses a target
  from a graph slug. (M)
- **E2. Site routing as triples.** Name→`(owner principal, graph id)` routing
  table in a reserved graph; gateway resolves host/path → exact tuple → pool
  render. Interpreter version pinned *as a triple* per site (the graph-native successor to
  `shrubbery-ui.lock.json`), pool serves N pinned shrubbery versions so a
  library upgrade never silently redefines a live site. (M)
- **E3. The `site` capability backend** (choreograph `CapabilityBackend`):
  the durable host turn, not the sandbox proposal, fixes the exact target and
  replay identity. `site_mint` = create the graph under the authorized owner
  principal from birth (fenced namespace per grant) + seed
  `@shrubbery/site` bundle triples + route write (unlisted). `site_update`
  = `sparql_update` against `:ux:config` behind the sealed-face-registry
  validation the observatory layout sink already enforces. `site_publish` =
  bind public name — `approvalPolicy: human`, always. `site_retire` → deferred
  cleanup, never in-run, mirroring the swarm's delete posture. Invocation
  envelope + receipt; quotas ride the existing tier-enforcement work. (M)
- **E4. Testimony.** `site.mint/route/publish/retire` kinds added to
  `contract/obs.golden.json`; regenerate gates; retention class `lifecycle-90d`.
  One golden edit, every consumer regenerated — no hand-edited artifacts. (S)
- **Gate E:** an agent mints an unlisted preview site under its grant, swarm-
  tests it through the browser capability, presents filmstrip evidence, and
  retirement executes only after human authorization; `site_publish` without
  approval is refused loudly; at least one domain cell's site is served by
  the pool with a pinned interpreter version; a same-slug graph under another
  owner is neither rendered nor mutated.

### WS-F · Observatory closure (repo: cloud + garden) — M

- **F1. Load `metric_catalog_v1.trig`** — register `obs:MetricDefinition` in
  the vocab/SHACL golden so metrics are agent-discoverable *in the graph*,
  closing the "biggest unshipped piece." Domain instances add their own
  metric definitions beside the `hoja_*` ones. (M)
- **F2. Ratify + wire trace capture v1** (branch
  `agent/observatory-trace-contract-v1`) only if wave-failure triage proves to
  need flush-causality traces; otherwise leave contract-only. Decision, not
  default work. (S/M)
- **F3. Activation ledger.** The observatory's dormant pieces the loop
  depends on (intake v2 states 4–7, capture flags) get their activation gates
  scheduled rather than implied. (S, mostly ops)
- **Gate F:** an agent discovers what is measurable about its own domain by
  SPARQL alone — zero code reading required.

### WS-P · The Platform Domain as an instance of itself (repos: cloud + choreograph) — M

Deliberately *after* the kit exists (WS-K) and deliberately minimal at first —
this workstream is the kit's second customer and its proof of generality.

- **P1. Platform cell.** Name the observatory graph as the Platform Domain
  Cell (or provision a sibling that federates it — decision §5.8). Its
  manifest is derived from `parity/surface-contracts.json` + the observatory
  contract summary + the control-tool list: the platform's capabilities as
  claims. (M)
- **P2. Grants live here.** WS-K4 grant documents are recorded in this cell;
  the Shrubbery grant is the first row. (S)
- **P3. Platform-domain agent (steward's colleague).** A second configuration
  of the C4 loop, chartered over the platform manifest: watches gate/ledger
  freshness, runs platform smoke journeys, keeps the activation ledger (F3)
  honest. The `agent/observatory-*` lineage, given a name, a memory, and a
  charter. (M — after WS-D proves the pattern at Layer 1)
- **Gate P:** the platform's own dashboard is kit-conformant (manifest,
  verdicts, catalogue, freshness) and at least one platform claim is verdict-
  covered by the platform agent — the platform domain is "alive" by the same
  definition it offers its tenants.

### WS-X · Development Domain capabilities (repos: cloud + choreograph + garden) — L

The Development Domain's subject is source and deployed engine behavior. It
closes the findings→fixes loop without giving a sandbox cloud, registry, or
repository credentials directly. This is a capability suite, not a required
specialized agent class. Any graph-defined Domain Agent whose current grant
includes these operations may choose them from its freeform pilot loop. A
separately chartered development-domain colleague can be useful, but the host
does not wake one implicitly and no remediation program replaces the pilot.

- **X1. `build`:** a typed proposed effect binds source SHA + build-context
  SHA + builder recipe to a content-addressed image. Following the browser
  service precedent, a private, agent-ignorant builder service exposes a small
  request/status/cancel contract, owns the content cache and ephemeral compute
  leases, and knows nothing about pilots or workflows. The Choreograph host
  binding withholds service handles and AWS credentials, fixes the request to
  the committed source turn, rereads the current grant, and enforces per-grant
  concurrency and spend quotas before it calls that service. The service
  launches the existing ephemeral-builder pattern, witnesses
  `build.plan/start/cache-hit/push/finish/refuse`, applies the existing
  fail-closed ECR push gates, and proves that the builder self-terminated. The
  same service contract is usable by a pilot-selected instrument or a
  model-free Choreograph invocation; neither path gains cloud credentials. (M)
- **X2. `cell.scratch`:** launch one gardend cell from an X1 image on a
  grant-fenced `dev-*` graph, unlisted, TTL'd in hours rather than days, and
  never publicly routed. Record image digest, graph seed/context digest,
  invocation, expiry, and teardown receipt so the exact no-mock test can be
  replayed. This is an engine-under-test, distinct from a hot-reload `site`.
  (M)
- **X3. `github`:** reads may clone/fetch/log/diff within the grant. Every
  write crosses the host edge as a proposed effect: push is ordinary only to
  an `agent/*` branch fence; opening a PR is ordinary plus notification;
  review/comment activity emits testimony; merge is
  `approvalPolicy: human` always. Credentials never enter the sandbox. (M)
- **X4. Findings→fixes program:** provide a digest-pinned deterministic
  instrument that can claim a FAIL verdict, branch, build, launch a scratch
  cell, replay the exact content-addressed scenario that produced the finding,
  and prepare a PR carrying before/after verdicts and evidence references.
  The awakened pilot decides whether to invoke it, interprets its result, and
  proposes every effect; it may stop, redirect, or answer without invoking the
  program. After human merge and deployment, the originating domain agent
  re-verdicts the deployed lineage. The same scenario digest that indicted the
  defect certifies the fix. (M)
- **Gate X:** a Domain Agent operating under a Development Domain grant chooses
  to convert one real FAIL into an `agent/*` PR using the pinned remediation
  program, an ephemeral builder, and a scratch cell; the same agent can also
  answer a development trigger without invoking that program. An over-quota
  build, public scratch route, non-fenced push, and unapproved merge are each
  refused and witnessed; all temporary compute and cells expire without
  manual cleanup.

---

### Layer 1 — Shrubbery Domain workstreams

### WS-A · The Shrubbery Domain Cell (repo: shrubbery + cloud) — M

The graph that *is* the Shrubbery domain — now pure content over kit
contracts.

- **A1. Provision the graph.** Control-plane `create_graph` on canary
  (`cloud/gateway/src/control_mcp.rs`); id fenced as `shrubbery-domain` (pin
  referents by IRI in every doc — "observatory" and "Hoja" are both overloaded
  names already). Create it while authenticated as the recruited specialist so
  their typed principal owns it from birth; the platform steward receives only
  the temporary editor grant described in G1. If the account does not exist
  yet, planning may proceed but graph creation waits—there is no ownership
  transfer fiction. (S)
- **A2. Manifest projection.** Run `docs/acceptance/garden-capability-manifest.json`
  (80 capabilities) through the K1 codec;
  `scripts/validate-acceptance-manifest.mjs` gains the `--check-graph` mode. (S,
  given K1)
- **A3. Domain catalogue.** `urn:sophia:query:shrub.*` per the K3 convention
  (`shrub.coverage.*`, `shrub.verdicts.*`, `shrub.freshness.*`,
  `shrub.agent.*`). (S)
- **A4. Domain dashboard.** One `ux:layoutJson` literal on
  `urn:sophia:ux:surface:shrubbery-domain` via a K3-conformant generator;
  faces: `stat.scalar` (coverage %, verdicts by tier, staleness),
  `sparql.bindings-table` (untested claims queue), `obs.filmstrip` (latest
  evidence), `card.subject` (recent FAIL/BLOCKED). (M)
- **Gate A:** curl the domain cell's hypertext face and receive the manifest
  coverage summary with Navigate links; `--check-graph` exits 0; dashboard
  renders in Organism against the live cell with zero app-code changes.

### WS-B · Hoja browser pipeline to first green wave (repos: all three) — M

The proving ground. Two paths, both needed; B1 unblocks the specialist's local
loop, B3 is the production loop the agent uses.

- **B1. Path A — local harness (shrubbery).** `apps/hoja/scripts/hoja-browser-harness.mts`
  in the Organism idiom (script owns Vite + `chromium.launch()`, real clicks,
  PNG checkpoints, non-zero on first failed invariant): create → type →
  autosave state → reload → list → reopen. Soil mode stubbed at the Vite
  middleware seam only (the app's own `/api/seeds` contract, not a mock of
  Shrubbery internals). CI: `test:hoja-browser` step in the `browser` job. (S)
- **B2. A11y legibility (shrubbery).** The agent acts on the accessibility
  tree (`read_a11y_tree`/`act` are ref-based), so accessible names are
  load-bearing: label `button.back`, `button.sign-out`, `button.new-leaf`,
  add testids per the acceptance program's "agent-legible surfaces" doctrine.
  This is the first concrete expert↔agent co-work artifact: making the domain
  legible to the agent is itself domain work. (S)
- **B3. Path B — first swarm wave (choreograph + cloud).** Execute the
  pending ledger items on `feat/hoja-cloud2-swarm-integrated`:
  `provision-hoja-probe.sh --apply` (probe identity + `obs-hoja-canary`),
  mint storage-state, deploy browser-service compose, generate the M1
  scenario document via `hoja-swarm-generate-v1`, invoke
  `hoja-cross-modal-swarm-v1` through `POST /g/obs-hoja-canary/invocations`.
  Target: M1 (create/edit/read/delete through the UI face) + I1/I2 invariants
  green; M2–M6 and I3–I5 follow as ordinary ledger work. Camoufox stays
  `experimental: true`; Chromium is the gating engine. (M)
- **B4. Evidence loop proof (all three).** One wave's `capture_beat` bundles
  land in S3, thin refs arrive as `test.beat`/`test.verdict` CaptureEvents,
  the projector folds them, and `obs.filmstrip` renders them in Organism via
  `hosted-evidence-service.ts` with sha256 verification. This closes O1 in
  the swarm ledger and is the template WS-D's verdicts ride on. (S, mostly
  provisioning)
- **Gate B:** CI runs `test:hoja-browser` green on every PR; one recorded
  swarm wave with all seven modalities reporting and I1/I2 agreeing; the
  filmstrip for that wave visible in Organism; hoja metrics
  (`hoja_test_pass_rate_permille` etc.) move from `provisional`.

### WS-D · Mint the Shrubbery Domain Agent (repos: choreograph + shrubbery) — M

A configuration, not a framework. Depends on A + B + C1/C2/C3 + K4. The
temporary user-RDF verdict lane is retired: verdict proposals cross the
Phanes-standard host edge, which binds the trusted home graph, checks the
current manifest scope, and performs dry-run → apply → zero-delta replay
through Garden's registered `sophia-domain-verdict` Emporium pack. The
sandbox cannot select a projection, vocabulary, subject, timestamp, session
witness, or apply bit.

- **D1. Charter.** Derived from `GARDEN_FIDELITY_ACCEPTANCE_PROGRAM.md` §"The
  corrected intention": derive claims from the manifest; exercise the smallest
  journey set that traverses every meaningful transition; capture evidence for
  every verdict; refuse to call anything complete while an in-scope claim is
  untested. Stored as a graph document in the domain cell; edits are code-
  review events. The charter *requests* capabilities; the grant (K4/P2)
  authorizes them. (S)
- **D2. Identity + registration.** Standalone registered name (proposal:
  `shrub-1`, pattern-matching `learner-1`; the specialist may well rename
  their colleague — the standalone-identity design makes renames safe). Birth
  registers the `agt:Agent` subject; Geist observer id gives it a memory
  graph `…:projection:memory:agent:{seg}` that survives every sandbox. (S)
- **D3. Granted toolbelt** (`agent-tool-manifest.ts` schema, per the K4 grant):
  - `browser` capability — rw, origin-clamped to the canary Hoja/Organism
    surfaces, storage-state minted host-side, `capture_beat` enabled.
  - `mnemosyne`/`garden-mcp` — scoped to the domain cell graph;
    `includeTools: [sparql_query, sparql_update, recall, remember,
    search_documents]`; `allowUndeclaredDiscoveredTools: false`;
    `strict_tool_manifest` on.
  - `workflow` — `loom_run` for bounded emanations (e.g. fan out one
    journey per capability under test, ≤8 steps, depth-1 structural).
  - `domain.verdict/write` — scoped to the home graph and
    `domain:shrub:verdict`; the host derives authority fields and Garden owns
    the reserved projection.
  - `site` — from WS-E, `approvalPolicy` splitting mint (ordinary) from
    publish (human-gated). Absent until E ships; the manifest's
    declared-vs-discovered reconciliation makes its later arrival loud,
    not silent. (S)
- **D4. Phanes-style activity loop + acceptance program.** A mention,
  direct instruction, scheduled tick, or relevant graph event revives the
  freeform Inkling pilot. It orients from the current domain graph and chooses
  whether to answer directly, call a domain program, or delegate a bounded
  read-only investigation to Inkling-Small emanations. The primary domain
  program is the runner the acceptance doc deliberately deferred: query untested/stalest
  `(capability, mode, role)` claims via the sealed catalogue → generate or
  select the journey → drive it through the browser capability (T1/T2 tiers
  first; T3 two-context and T4 hosted later) → emit `test.beat`/`test.verdict`
  testimony → propose the scoped `domain:Verdict` → refresh dashboard freshness.
  The runner remains a `controller: program` wave with `modelUse` confined to
  journey synthesis and failure triage — determinism where possible,
  judgment where needed — but selection and interpretation belong to the
  pilot. Every externally visible result still returns as a typed proposal to
  the host edge. (L)
- **D5. Supervised activation.** First N bounded waves with the steward
  holding the driver lease; steering, pause, and destructive-op deferral
  exercised for real; career rollups and the graph-defined agent projection
  verified in Vehicle. The agent is literally absent as a process between
  waves. Exit criterion is boring waves. (S, calendar time)
- **Gate D:** the dormant agent handles both a direct conversational trigger
  and an acceptance-work trigger without an executor change; in the latter it
  runs a wave, writes ≥1 correct scoped verdict with filmstrip evidence,
  updates the dashboard, and goes dormant. A bounded emanation reports only to
  the pilot. The career rollup shows the accumulated sessions and `recall`
  returns domain memories from a prior sandbox lifetime.

### WS-G · Onboarding kit (repos: cloud + shrubbery, mostly docs/scripts) — S

- **G1. Account provisioning script:** Cognito user; create
  `shrubbery-domain` while authenticated as that user (owner from birth;
  current cloud-2 has no ownership-transfer verb); temporary steward editor;
  viewer on the exact Platform-authority `(owner, observatory)` tuple; editor
  on the exact Hoja `(owner, obs-hoja-canary)` tuple; and a read proof through
  the ordinary owner-scoped Choreograph route Vehicle uses. Plan-by-default,
  owner credentials only in mode-0600 header files, typed confirmation before
  apply, in the idiom of `provision-hoja-probe.sh`. (S)
- **G2. Day-one runbook** — *served by the domain cell itself* (the hypertext
  face is the document): your account, your cell, your agent; how to attach,
  steer, review evidence, edit + promote the prompt; how manifest edits
  become the agent's work; the minting-vs-publishing boundary; where Layer 0
  ends and your domain begins; who to call. (S)
- **G3. Handoff ceremony:** the specialist accepts/rotates the staged account
  credential, verifies the domain graph already names their principal as
  owner, and decides whether to retain or revoke the steward's temporary
  editor grant; the agent's graph-defined collaborator projection shows that
  owner; first co-worked wave (expert picks the claim, agent runs it) executes
  together. There is no fictional steward→specialist ownership transfer. (S)
- **Gate G:** a person with zero repo checkouts can, from the account email
  alone, reach the domain site, attach to the agent, steer one wave, and read
  its verdict — in under an hour.

## 4. Sequence and dependencies

```
M0  Decisions ratified (§5) ──────────────────────────────────────┐
M1  L0: WS-K (kit) starts · WS-C1 quarry starts                   │
    L1: WS-B1/B2 (local harness + a11y)  ∥  WS-A1 (graph)         │ parallel
M2  L1: WS-A2..A4 (needs K1..K3) · WS-B3/B4 (swarm wave)          │
M3  L0: WS-C1..C5 landed          — start at M0                    │
M4  L1: WS-D (mint shrub-1; supervised activation) — A,B,C,K4     │
M5  L0: WS-E (site) ∥ WS-F (observatory) ∥ WS-X (development)     │
M6  L1: WS-G (onboarding day)  — needs D green; E/F enhance,      │
        do not block                                              │
M7  L0: WS-P (platform cell + platform agent) — after D proves    │
        the pattern; the kit's second customer                    ┘
```

Three schedule facts worth stating plainly:

- **WS-C is still the behavioral critical path, but no longer a 15k-line
  runtime merge.** Quarry only portable contracts and lease/steering CAS;
  extend the already-deployed Phanes/invocation seams. Layer 1 proceeds in
  parallel and the aleph residency ladder may drift harmlessly outside the
  critical path.
- **Onboarding day does not require WS-E or WS-P.** A specialist co-working
  with a verdict-writing, evidence-producing, steerable agent is A+B+C+K+D+G.
  Site-minting is the agent's growth arc after your recruit already has a
  colleague; the platform agent comes after the pattern is proven downstream.
- **The kit precedes the instance where cheap** (K1–K3 before A2–A4) **and
  follows it where expensive** (WS-P after WS-D): extract contracts early,
  generalize activity-loop configurations late.

## 5. Decision register (ratified 2026-08-03)

| # | Decision | Proposed default |
|---|---|---|
| 1 | Agent's registered name | `shrub-1` (rename-safe by design; the specialist may rechristen their colleague) |
| 2 | Domain graph home | canary cluster, graph `shrubbery-domain`, dedicated from birth |
| 3 | Verdict write lane | Gate open: host-authoritative `mo-projection-ingest` via the registered `sophia-domain-verdict` pack, with current-manifest scope check and dry-run → apply → zero-delta replay; the provisional user-RDF lane is retired |
| 4 | Agent model + budget posture | graph-defined dynamic OpenRouter binding; default pilot `thinkingmachines/inkling`, bounded read-only emanations `thinkingmachines/inkling-small`; record the resolved provider model in each run receipt; per-wave caps remain in the workflow spec |
| 5 | learner-1/aleph posture | quarry graph-side contracts and row-level steering/lease CAS; do not land the residency runtime ladder |
| 6 | Site namespace + quota for agent-minted graphs | per-grant fence (e.g. `site-shrub1-*`), tier-quota'd, unlisted by default |
| 7 | Trace capture v1 activation | defer until triage demonstrates need (F2) |
| 8 | Platform cell identity | the observatory graph *is* the platform cell (rename by IRI, no migration) vs. a sibling that federates it — steward's call at WS-P |
| 9 | Platform Domain ownership | the platform steward, named as such in the platform cell; explicitly not the Shrubbery specialist |
| 10 | GitHub write posture | `agent/*` pushes ordinary; PR open ordinary + notify; merge human-always |
| 11 | Scratch-cell TTL + builder quota | TTL hours-not-days; per-grant concurrent-builder cap; mandatory content-addressed cache |
| 12 | Development Domain ownership | platform steward initially; Development Agent is the steward's colleague and pairs with WS-P3 |

## 6. Risks and counters

- **Contract drift in the learner-1 quarry:** extract by contract and golden,
  not by branch ancestry. Prove each portable identity/prompt/toolbelt/lease
  shape against current main; leave residency-coupled code behind.
- **Listener mistaken for agent residency:** a trigger adapter may remain
  durable, but it owns no autonomous reasoning loop. Counter: process-liveness
  tests assert that the sandbox disappears after every wave while identity,
  prompt, memory, and receipts remain graph-readable.
- **Layer bleed** — the failure mode this revision exists to prevent: Layer 1
  work quietly growing platform machinery (a bespoke verdict shape, a one-off
  grant path), or Layer 0 work blocking on Shrubbery-specific content.
  Counter: the kit contracts are the boundary; anything Layer 1 needs that
  the kit lacks is a kit change, reviewed at Layer 0.
- **Name overloading** ("Hoja" is a component, a face, and an app;
  "observatory" exists twice; "domain" now has two layers): every charter/doc
  pins referents by IRI. This document's names are conveniences; the graph's
  IRIs are the truth.
- **A11y-ref fragility:** the agent's hands are the accessibility tree; a
  refactor that drops accessible names blinds it. Counter: the a11y checks in
  B2 join the CI harness, so legibility regressions fail PRs — the domain
  expert's incentive and the agent's are structurally aligned.
- **Verdict inflation:** an agent grading its own homework. Counter: verdicts
  are scoped claims over content-addressed evidence, reproducible by anyone
  from the bundle; the acceptance program's "refuse to call it complete"
  clause is in the charter; FAIL/BLOCKED render on the shared dashboard with
  no quiet path around them.
- **Cost drift** (browser waves, evidence storage, LLM turns): testimony
  retention classes are already priced; per-wave budget caps in the workflow
  spec; the observatory's own capacity metrics watch the watcher.
- **Naming accretion:** this program will coin names (domain cell, domain
  agent, waves, kit, layers). Keep the disambiguation note current in this
  file the way the README already does for Greenhouse.

## 7. What this buys beyond Shrubbery

With the layering explicit, the answer is structural rather than aspirational:
Layer 0's product is the Domain Kit plus the capability to grant it —
"spin up a domain" as a platform verb, one level above "spin up a site."
Shrubbery is the first recruited tenant and the proving domain; the Platform
Domain itself is the second instance (WS-P), run by the same rules it offers
its tenants; every future domain — a recruit, a product surface, a research
program — is an account, a cell, an agent, and a grant. The onboarding
sentence in §0 is not a Shrubbery feature. It is the platform's interface.
