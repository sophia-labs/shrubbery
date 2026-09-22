# Koch · a Garden graph view

A keyboard-first Morse receiving and sending trainer built as a dedicated Shrubbery app with a real `gardend` backend.

Text entry is the shared backend-free `<hoja-editor posture="composer">` surface. The Koch face controls its value and binds Hoja's change/submit intents to scoring; it does not grow a parallel textarea implementation.

The product boundary is deliberate: Koch owns its learning interaction, Web Audio synthesis, scoring, faces, and RDF vocabulary. A room is not a second Koch object: it is an ordinary Garden graph, opened through the shared Garden header and rendered with graph-authored Shrubbery surface triples. Nothing Morse-specific is coupled into Garden's engine or into Shrubbery's backend-free component packages.

## Learning contract

- LCWO character sequence: `K M U R E S N A P T L W I . J Z = F O Y , V G 5 / Q 9 2 H 3 8 B ? 4 7 C 1 D 6 0 X`
- start with two characters, then introduce one at a time;
- character shapes play at full speed (20 WPM by default);
- Farnsworth spacing lowers effective speed without teaching slow, countable symbols;
- copy by typing while listening; spaces between five-character groups are optional;
- 90% accuracy unlocks the next lesson.

Short runs guarantee several appearances of the newest character, then sample uniformly from the learned set.

## Send

Switch the practice activity to **Send**, start a run, and use Space or the on-screen straight key. Sidetone is synthesized locally. A two-unit decoding boundary separates elements from characters; assessment compares the resulting timing against the canonical one/three-unit element and one/three-unit gap relationships.

Send results report code accuracy, element duration, spacing, and consistency separately. The stored session includes semantic RDF summaries plus a versioned raw transition trace so future scoring changes can re-evaluate the evidence. Send mastery is deliberately separate from the receive score that unlocks Koch lessons.

## The graph is the room

Participants practice independently; current copy or keying transitions remain browser-local until submission. A filed `koch:PracticeSession` lives in the current graph's canonical user-RDF graph, so graph containment is the complete room relation. There is no `koch:PracticeRoom`, `koch:room`, or room slug nested inside it.

The shared header lists the caller's real Garden graph catalog. In hosted mode that catalog is already filtered by platform-next ACL grants. Selecting a graph reloads this Koch view at its graph identity; creating a room creates a Garden graph. A link identifies the graph but never grants access:

```text
http://localhost:5188/?graph=night-garden
```

Hosted membership uses the ordinary graph access plane. An **editor** can practice and file testimony, a **viewer** can inspect curriculum and everyone’s performance without mutating the graph, and an **owner** can manage grants from the normal Garden Members control in the header.

The People face is derived from graph testimony and visibly uses Shrubbery's information registers: learner names are identity, ACL/rank is state, scores are metrics, graph IDs are references, timestamps are testimony, and controls are affordances. It shows every `koch:Learner`, including learners with no filed run; hosted ACL members who have not practiced yet also appear. Receive and Send evidence remain distinct. A Send performance score weights code accuracy at 70% and timing at 30%.

For local multi-person simulation, an explicit development actor may be supplied in the URL. Hosted mode ignores it and uses the authenticated Cognito subject:

```text
http://localhost:5188/?graph=night-garden&actor=vera&name=Vera
```

## Garden record

Each run is inserted through the cell's `sparql_update` MCP tool into Garden's canonical user RDF graph:

```text
urn:mnemosyne:local:graph:{graph_id}:user:rdf
```

The graph stores a principal-associated `koch:PracticeSession` with activity, lesson, speeds, target, submission, scores, and timestamp. Receive runs have positional `koch:CopyAttempt` testimony; Send runs have `koch:KeyingAttempt` testimony and a versioned timing trace. The app queries those facts to derive personal progress and graph-wide participant performance. There is intentionally no local-storage score fallback.

Preferences and Surface layouts are principal-scoped. Old local receiving sessions are retained and idempotently gain activity/performance defaults. The short-lived prototype's nested-room assertions are removed without deleting any session or attempt testimony.

## Hosted Garden

Without hosted variables, the app uses the server-side `/cell/mcp` proxy. A hosted build uses the shared Shrubbery Cognito/gateway adapters when these values are present:

```bash
VITE_KOCH_GATEWAY_BASE_URL=https://api.canary.sophia-labs.com \
VITE_COGNITO_REGION=us-west-1 \
VITE_COGNITO_CLIENT_ID=... \
VITE_COGNITO_USER_POOL_ID=... \
VITE_KOCH_GRAPH_ID=koch-morse \
pnpm --filter @shrubbery/koch build
```

The hosted shell restores the same `shrubbery.cognito.tokens.v1` session used by Garden. It refuses anonymous fallback. Reads use platform-next's viewer-eligible SPARQL job route; mutations use the editor-gated graph MCP route. Graph listing, creation, and member grants use the gateway control plane.

## Run against a disposable real cell

```bash
pnpm --filter @shrubbery/koch gardend:dev
# in another terminal
pnpm --filter @shrubbery/koch dev
```

Open <http://localhost:5188>. The convenience cell uses a temporary profile and announces that it is disposable.

For a local profile whose practice graph survives process restarts:

```bash
pnpm --filter @shrubbery/koch gardend:persistent
# in another terminal
pnpm --filter @shrubbery/koch dev
```

The default profile is `apps/koch/.koch-garden/` (gitignored). Override it with `GARDEN_PROFILE_DIR`.

## Run against an existing Garden cell

Point the server-side proxy at that cell's loopback manifest; the bearer stays out of browser JavaScript:

```bash
GARDEND_LOOPBACK_MANIFEST=/path/to/profile/loopback.json \
VITE_KOCH_GRAPH_ID=my-garden \
pnpm --filter @shrubbery/koch dev
```

The target graph must already exist. Add `?graph=another-graph` to select a catalog entry explicitly; otherwise `VITE_KOCH_GRAPH_ID` supplies the initial graph. Koch triples and the user's custom Surface layout persist with the ordinary Garden graph.

## Verify

```bash
pnpm --filter @shrubbery/koch typecheck
pnpm --filter @shrubbery/koch test:run
pnpm --filter @shrubbery/koch build
```

When the release `gardend` binary is present, the test suite spawns it, writes a perfect session, reads the graph back, and proves lesson 3 is derived from the stored facts.
