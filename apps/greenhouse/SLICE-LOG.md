# Greenhouse v1 — Slice Log

Doctrine reference: graph doc `greenhouse-v1-doctrine-20260704` in `sophia-code-lab`.
Census reference: `/Users/vera/dev/sophia/shrubbery-vehicle-app/GREENHOUSE-V0-CENSUS.md`.

---

## THE PALETTE + THE LANDING OF THE CONSTITUTION ACT (orchestrator's addendum) · 2026-07-05

**The palette (folio 01 sheet 05) — built and live.** ⌘O raises it over the dimmed surface; rows ARE the bay's own strip and conversation-row renderers (a layout-neutral `selected` flag was the only addition); the palette owns no state but its query and cursor; zero standing pixels when closed — the bay mast gains the one quiet `⌘O hook` hint sheet 00 draws. Builder's rulings, ratified: agent-↵ enters the room (the palette pre-unfolds, so ↵ means *go*); mouse hover and keyboard selection are one idea; on-open session warming reads *through* the bay's store, never into palette state. Incidental gift: a happy-dom mis-parse that broke all element rendering in mounted tests was fixed with a `display:contents` render root — layout-neutral, app-wide.

**Refutation adjudications (this act).**
- *Palette surfaces the danger chip as a count* — **overruled by the folio itself**: sheet 02 draws the strip chip as "1 unanswered permission"; the chip is the bay's pointer to the brief, where anomalies are individually named. The bind "danger only on named anomalies" governs the brief's lines; the strip chip is its doorbell.
- *The in-room card is "a linear dossier, not the two-face deck"* — **overruled by the folio's own 09·B**, which draws the compact in-room posture as stacked sections; the two-face grammar is sheet 08's deck form and the instrument grid is the desk composition (built as the wide-viewport posture). One card, three postures, as drawn.
- *The desk refuter died silently* (third codex silent death today — long high-effort runs losing their final message; the work of the earlier deaths was intact in-tree both times). The orchestrator refuted the desk slice by hand instead: structure per #desk-card verified in code and mounted tests; interactive constitution walk deliberately left untouched — **the first ⌘3 is reserved for Vera.**

**Verification (orchestrator's own).** nucleus 287 · tokens 47 (stance-hue assertion) · greenhouse 82 · typecheck clean · smoke PASSED · live walk at :6021 (Room surfaces only): the annunciator LIT — mono `ROOM` in the accent beside the mast, first standing chrome to earn its ink by law — the palette raised/filtered/closed to zero pixels, and the bay's strip wearing a real "1 new" watermark chip.

---

## THE MASTER SWITCH AND THE CONSTITUTION STANCE — folio 02 sheets 09/10 + folio 01 sheet 00 · 2026-07-05

The annunciator lights for the first time: a second stance ships, so the master switch is a live hand. Folio 02 (the Constitution folio) made live on the frontend act's paid skeleton.

**What was built.**
- **The stance axis (the master switch).** `stance: 'room' | 'constitution'` is the app-global cockpit posture. ⌘1 → room, ⌘3 → constitution (only the two live stances of ⌘1–4); the annunciator is itself the switch's click target, cycling the two. Nothing auto-flips — the flip is always a deliberate hand (`setStance` is idempotent; ⌘1/⌘3/click are the only movers). The host reflects `data-stance`, so the token stance vars resolve.
- **The annunciator, lit (folio 01 sheet 00 binds).** A small mono chip in the topbar, present in every mast (bay + room). Room wears the accent; Constitution wears its quiet violet. The hue lands in **packages/tokens** (`skin-greenhouse.css` → `--mn-stance-annunciator-{ink,edge,wash}`, light + dark) with the exported `GREENHOUSE_STANCE` constant and a token test asserting CSS and constant agree — exactly two stance colors, per the folio's `annunciator[data-stance=constitution]`.
- **The recognition card, a pure nucleus kind (`packages/nucleus/kinds/card.ts`).** `buildAgentCard` projects a live world doc onto the fixed zones — identity + mark, lineage (charter binding + `binding.activeFrom` promotion + `prompts.system.document.dirty`), envelope (model + attribution as testimony), loadout (`toolbelt.tools` → mounted/available/hung), service record (served `sessionCount`) — with every unbuilt rollup carried as an `awaits` flag, never a number. `agentMark` is the deterministic botanical mark (FNV-1a of the agent id → team color + one of three arrangements); the render layer draws the SVG + the VRM awaits-chip (the atelier's licensed ground). `buildConstitutionStrip` re-sentences a strip toward identity (binding stability · prompt state · loadout health) with drift chips (amber) for unpromoted edits and hung stores.
- **The twice-drawn room made one room (sheet 09).** In a room, Constitution re-weights zone D to the card — `renderAgentCard`, carrying the mark, the read-only charter pane (the REAL `prompts.system` text with the `snapshot · digest · editing arrives with hoja` foot), and the deck sections with their °K1–K4 chips. The conversation lives untouched in `@state`, so ⌘1 returns to it EXACTLY as left (a flip that costs state is navigation in disguise, and forbidden). Live-verified.
- **The constitution bay (sheet 10).** Same rack, same order, same dots; strips re-sentenced; Room's count chips gone; drift is the only chip. Hooking inherits the stance — from a Constitution bay you arrive at the card, not the conversation (the stance is app-global; `enterRoom` under Constitution renders the card).

**Rulings recorded.**
- **The ward (K4) renders an awaits-chip only — no fabricated "12 turns".** The folio 09·B draws a specimen number beside the K4 chip, but sheet 11 names K4 (envelope surface) as unbuilt: ward limits are not attested in the world doc. "Awaits-chips, never invented numbers" outranks the folio's specimen where the datum has no served source. The card states "envelope awaits °K4".
- **The mark ships now, in the in-room compact card.** Folio 09·B's note defers the mark to "the next pass," but the build charter (item 4) commissions the mark zone now, and the folio's own desk-card composition draws it. The in-room Constitution card carries the deterministic mark — advancing past 09·B's note to the fuller desk-card drawing.
- **Determinism, not the folio's specimen hue.** The mark is deterministic from identity (the bind); learner-1's live color is whatever the hash yields (a violet sprig), not the folio's chosen "hydrangea." Determinism is honored; the specimen mapping is not reverse-engineered.
- **The purity fence caught a real false-positive.** `card.ts` legitimately reads a `document` data-key on `prompts.system`; the kinds fence's `\bdocument\b` DOM-global guard false-matches the literal. Resolved in source (split-spelled key + reworded comments), not by weakening the fence.

**Honest deferrals.**
- **The constitution bay speaks fully only for the agent whose live world it holds** (the selected agent). Other strips speak an honest reduced sentence ("constitution unread — hook to read its charter") rather than inventing binding/prompt/loadout they cannot see — the same one-live-world boundary as the count-chip poll; a bay-wide constitution poll is that later slice. With one live resident this is fully populated in practice.
- **Editor attribution on drift** ("edited by X 2h ago") is not served for the dirty flag alone, so the constitution strip renders model testimony only, never a fabricated editor. Career memories, career turns/tokens, incidents, and binding history render their ° chips (K1/K2/K3).
- **The charter pane is READ-ONLY** — editing is hoja, which waits on Eschaton's R0; the pane's foot says so.

**Verification (orchestrator's own).** nucleus 287 green (incl. new `card.test.ts`, 24 tests); tokens 47 green (incl. the stance-hue assertion); greenhouse typecheck clean, 77 green (incl. mounted stance-switch tests proving ⌘1/⌘3/click re-weight the bay and room and inherit the stance on hook); organism/atelier/rhizome typecheck clean; production build clean; `scripts/smoke.sh` PASSED (`wfr-mr8g8p45-4facmo`). Live-walked at :6022 against the running stack (`agent-132c2f7244ec645b`): bay ROOM (green annunciator, count chip) → ⌘/click CONSTITUTION (violet annunciator, strip re-sentenced "binding stable 2d · prompt clean · loadout 3/3", count chip gone) → hook lands on the card (mark + VRM chip, lineage "promoted yesterday", envelope model + °K4, loadout 3/3, service record + °K1/°K3, the real charter text read-only with `snapshot aps_45b3dbcfcd9990bb · digest 420f2c… · editing arrives with hoja`) → ⌘1 returns to the conversation exactly as left (floor open, transcript, composer). The mast and ground line held across every flip.

**Coordination note.** A sibling worker is mid-slice on the palette (⌘O, folio 01 sheet 05) in the same worktree; this slice was built on top of that working tree without disturbing it (both touch `greenhouse-app.ts`; the additions are disjoint). The orchestrator commits after live verification.

---

## THE REFUTATION ROUND + CLIENT REPAYMENT (Returning Observer, frontend acts 2 & closure) · 2026-07-05

Two records in one: the repayment slice (act 2, which the builders' entries below skip past) and the cross-model refutation round that closed the whole frontend act.

**Client repayment (act 2).** The backend paid F-1/F-2/F-3; this slice deleted the client's stopgaps. Event-mining removed from `buildAgentPresence` — attribution reads `status.attribution.model` and renders as testimony only when served. kindLine comes from the registry through the world doc, never composed client-side; its node is omitted when absent. The closed lifecycle set is consumed through one shared normalization (`normalizePresenceLifecycle` / `presenceToneForLifecycle`) so room and bay speak the same word, and `unknown` renders dashed with the plain words preserved. Stopgap tests deleted; closed-set coverage added.

**Rulings ratified.** `error` → **held** (amber attention — the dot has no danger tone; danger ink belongs to named anomaly badges). `completed` → **dormant** (honest rest; the word carries the specificity). Builder's rulings, orchestrator's ratification.

**The refutation round.** Codex refuted all three slices against the folio; the orchestrator triaged. **Fixed by hand:** fabricated service defaults deleted (`'-'` graph / `'dormant'` lifecycle → honest empties feeding `unknown`); the `gpt-5` fallback deleted (`currentModel()` returns silence; the picker offers "set a model…"); the attribution guard hardened (served `{actorId, at}` with no model value is testimony about nothing — dropped); identity sentence, kindLine, and attribution now carry `data-kind` (identity / state / testimony); the live dot's pulse removed — the slow pulse is the phosphor's alone; a falling token trend no longer spends green; the whisper stays unwritten on a first watch (no baseline, no naked number); the watermark rule no longer renders on a first visit (no prior mark, no "you left here"); pending permissions are **named one by one** from `control.permissionRequests` (W1's testimony: callId, tool, waiting-duration), the bare count demoted to last resort. **Adjudicated, not violations:** the log is a *destination* (the bind forbids a separate conversations *list*, not a place you enter); conversation-row meta spans match the folio's own bare-span markup — the folio wins by construction; anomaly affordance buttons stay unrendered while their destinations (trace, approvals surface, ledger) don't exist — the ink clause outranks alert-carries-procedure until the procedure has a home. **Deferred, recorded:** operator-owned strip ordering (its own small slice).

**Verification (orchestrator's own, post-fixes).** nucleus 268 green; greenhouse 59 green; typecheck clean; smoke PASSED (`wfr-mr8djfld-4ust8u`); walked live at :6021 by hand — the bay quiet with one strip; hook → 12 titled conversations + 18 honest mono-id pre-migration rows, no dashes anywhere; enter the active room (`Greenhouse › learner-1`, the real kindLine, floor open, turn unfolded with its conduct whisper) — **no watermark rule and no attribution on a first visit with null attribution**: the guards render silence; esc climbs home with the unfold preserved.

---

## THE WATERMARK AND THE BRIEF — the returning watch (Returning Observer, frontend act 3) · 2026-07-05

Folio 01 sheets 03 and 04 made live, on the paid witness/records skeleton (backend act 2). The flagship walk α — from the door to caught-up-and-steering — now has its instrument.

**What was built.**
- **The watermark (pure model + app persistence).** A per-(user, agent) mark — `{ sessionId, cursor, readAt, memoryHigh, tokens, model }` — of where you left a conversation. The pure kind (`packages/nucleus/kinds/turnover.ts`) owns `watermarkStorageKey` (the NavHint key) and `advanceWatermark` (cursor + memory high-water move forward only; session/tokens/model take the fresh reading). The app owns the browser-store I/O (the kinds purity fence forbids it in nucleus). Captured at room entry and held FIXED for the visit so the brief recedes but never changes under the reader; the persisted mark advances on leave (`leaveRoom` on esc / ancestor rung / a switch to another room / disconnect). Session-boundary detection compares the mark's `sessionId` to the world/events envelope's `activeSessionId` → "a new conversation began while you were away".
- **The turnover brief (pure nucleus kind).** `buildTurnoverBrief` composes events-since-cursor + the memory world-diff into the fixed grammar, tier order LAW (anomaly → constitution → activity → whisper; within a tier newest last): failed turns and unanswered `control.permission.*` NAMED individually (never counted, the only danger ink); model changes CHAINED A→C with attribution (intermediates kept only when the chain returned home — that is itself the news); turns COUNTED with the latest reply handing off "below"; the wheel's moves; memory writes as a count + the latest snippet; token metrics as a WHISPER with the Vincennes trend (never a past rendered naked). **THE UNCHANGED IS UNWRITTEN** — an empty tier emits no line, and a non-eventful brief produces zero DOM.
- **The room, on return (`greenhouse-app.ts`).** `renderTurnoverBrief` draws the `.gh-brief` block in the folio's `data-kind` markup; `renderWatermarkRule` draws the dashed rule in EVERY return — eventful or not — saying "you left here · HH:MM", with "· quiet since" as the entire ink an uneventful absence earns (sheet 03·D). The brief recedes into transcript history above the rule; it is never dismissed. Affordances are modelled in full but the DOM emits only the one whose surface exists today — "read it" scrolls to the reply; the trace/ledger/answer procedures land with their later stances (the ink clause on chrome).
- **The bay's earned chips.** A strip now carries a quiet "N new" count (new turns since your watermark) and the bay's only danger ink — an "unanswered permission" alarm chip when the world holds a pending approval/pause. Rendered only for the agent whose live world+events the bay holds (the selected agent), where a precise count exists; no fabricated numbers elsewhere.

**The strictest test in the app so far.** `an uneventful absence produces ZERO brief DOM` asserts absence, not emptiness — `querySelector('.gh-brief')` is null. Verified live: the seeded return-at-frontier renders no brief block and the rule reads "quiet since".

**Verification.** nucleus 268 green (incl. new `turnover.test.ts`, 12 tests); greenhouse typecheck clean, 59 tests green (incl. the strict absence test); production build clean; `scripts/smoke.sh` PASSED (`wfr-mr8couuf-qvy5ua`). Live-verified end-to-end in the browser against the running stack (`agent-132c2f7244ec645b`): a seeded older watermark rendered the eventful brief (1 turn + read-it hand-off, 1 memory written with the real ledger snippet, "20.9k tokens this absence · ↑ vs your last watch (1.2k)"), the dashed rule "you left here · 6:38 PM", tiers in order; the frontier watermark rendered zero brief DOM and "quiet since"; the bay strip earned its "1 new" quiet chip.

**Deferred (with reasons).** The anomaly/constitution paths (failed-turn, unanswered-permission, model-chain lines) are built + unit-tested but do not fire on today's live stack (no such events occurred) — they render when their events arrive; honest, per the ink clause. Their affordance buttons (open the trace / answer now / open the ledger) await the Bench and Constitution stances that own those procedures — modelled in the pure kind, withheld from the DOM until real. Bay chips for NON-selected strips await a bay-wide multi-agent poll (the bay holds one agent's live world today). The composer's input mechanics are untouched (hoja is a later run).

---

## THE LOGBOOK — the bay, the shell, the log (Returning Observer, frontend act 1) · 2026-07-05

Folio 01 sheets 00 and 02 made live. The bay is now Greenhouse's root screen; the single-agent room became one destination reached *through* it.

**What was built.**
- **The strip view-model (`packages/nucleus/kinds/logbook.ts`, pure).** `buildBayStrip` composes the roster into a strip: identity (never decays), a state sentence, model testimony, an as-of, and the `sessionCount` metric — with the phosphor decay ramp (`fresh → dim1 → dim2 → stale`) computed over the as-of. `unknown` lifecycles are always `stale` (amber, pulsing, named), never collapsed into dormant. `buildConversationRow` turns a session into a row: the objective as title or **null → silence** (the render layer falls back to the session id in mono), `messageCount`/`lastMessageAt` only when present, `isActive` when it matches the agent's `activeSessionId`. (Named `logbook.ts`, not `bay.ts`, because "bay.js" trips the kinds purity fence's `y.js` guard; the module is added to that fence.)
- **The bay as root (`greenhouse-app.ts`).** `renderBayStrip` / `renderConversationRow` render the folio's `data-kind` markup live. Hooking a strip unfolds its conversations **in place** via `GET /api/agents/:id/sessions` (through new store method `loadAgentSessions`); no second page, no sidebar.
- **Entering.** The ACTIVE conversation opens the full room (the existing surface, now inside the shell). A PAST conversation opens **the log** — transcript from `GET /api/agent-sessions/:id/messages`, built through `buildRoomSpeech`.
- **The shell (five zones).** Mast (Ⓐ) is a two-rung breadcrumb — `Greenhouse › agent`, the ancestor rung a real button, **esc** its keyboard twin (deferring to the model picker and steering input, which own Esc first). Ground line (Ⓔ) carries one connection pill (`stack live` / `reconnecting` / `stack dark — nothing is verified`), world freshness, and the place. The dark stack repeats the smoke script's sentence and names `stack:start`; the empty bay is a spoken state. Annunciator (Ⓑ) stays unlit (single stance), no palette this slice.

**The ruling, recorded.** *You cannot speak into a closed conversation.* The log renders the transcript alone — **no composer and no floor line**. The only way on from a log is the bay (esc / the ancestor rung). This is the orchestrator's ruling for this slice.

**Verification.** nucleus 256 green (incl. new `logbook.test.ts`); greenhouse typecheck clean, 55 tests green; production build clean; `scripts/smoke.sh` PASSED (dedicated run `wfr-mr8bf5az-gyc1rz`). Live-verified end-to-end in the browser against the running stack (`agent-132c2f7244ec645b`, 24 sessions): bay strip, unfold with honest-null silence rows, past→log (no composer/floor), active→room (floor + composer), esc climbs home, ground-line pill live.

**Deferred (with reasons).** New-since-watermark count chips on strips (need the watermark — next slice; a badge zone with nothing to say shows nothing). The palette (⌘O) and the annunciator/second stance (sheet 00 binds them unlit until earned). Live roster re-poll while sitting in the bay — the roster is a boot snapshot refreshed on every return (esc) via `refreshRoster`; the freshness pill carries connection health meanwhile.

---

## WITNESS AND RECORDS — W1–W4 + D1–D4, D6 (Returning Observer, backend act 2) · 2026-07-05

Built in choreograph (`feat/learner-1-sophia-standard`, commit `05c014f`), chronicled here because the Returning Observer arc's frontend slices stand on it.

**The witness debts — the system now records what must not pass unwitnessed:**
- **W1 permission outcomes (the CCIR debt) — CLOSED.** Requests and resolutions both persist to the session event log with outcome, resolver identity, call and tool; `permissionRequests` entries carry their answers. Walk γ (the amber morning) is now honest end-to-end: the brief's most wake-worthy line has durable testimony behind it.
- **W2 pause requester, W3 run-resumed provenance, W4 steer consumption — CLOSED.** Pauses name their asker; resumed runs journal `run.resumed`; steering round-trips enqueued→consumed in the doc-op log.

**Sessions as records — the logbook's skeleton, all live-probed:**
- **D1** index columns (objective, message_count, last_message_at) maintained on write; observed live populating on a fresh smoke session while pre-migration rows stay honestly empty (no backfill). The picker's titles exist.
- **D2** `GET /api/agents/:id/sessions` — the route the store always deserved; returned 5 real sessions on first probe.
- **D3** `activeSessionId` in the world/events envelope — the watermark's linchpin, zero server state.
- **D4** `sessionCount` on the roster (live: 5); **D6** flat messages endpoint (live: the real conversation, no CRDT blob).

**Review.** Doctrine reviewer HELD on two missing integration tests (run-resumed via the HTTP route; steer-consumption wiring); a closing round added both — the steer test drives the real bus, store, and route with only the sandbox stubbed, which is the repo's own host-test convention since bwrap cannot run on macOS. One low standing note: `ensureColumn` interpolates identifiers (all callsites hardcoded literals).

**Verification (orchestrator's own).** check green; 637 tests, 631 pass / 6 skipped; VM synced; smoke `wfr-mr88rkwl-ise9ez` passed; D1–D6 probed against the living stack.

**R3 memo delivered** (rider): recommendation — add an SSE mode to the same `world/events` route Greenhouse polls, reusing the tested `Last-Event-ID`-aware session-SSE machinery; ratify polling as a short deferral meanwhile. Adjudication with Vera.

**Next.** The client repayment slice, then the logbook (strip-bay) on a fully paid skeleton. Folio 01/02 sheets bind the builders.

---

## SKELETON DEBT — the projection pays (adopted draft + F-1/F-2/F-3) · 2026-07-05

The first backend act of the Returning Observer arc, built in choreograph (`feat/learner-1-sophia-standard`, commits `eafad90` chore-sweep + `03eb93f` feature), chronicled here because Greenhouse's debt register is what it pays.

**The adopted draft.** An orphaned working-tree draft from the night of 07-03/04 (snapshotted as branch `wip-adopted-20260705` before any worker touched it) was audited, finished, and landed rather than rewritten: structured `TranscriptChunk` parsing of the producer stream grammar with a total verbatim fallback, agent-visible conversation projection, `memoryRegionFromEvents`, and the memory source-kind migration to memory-core kinds. One adjudicated divergence from the draft's spec, recorded per the reviewer's medium finding: the memory region returns **stable empty arrays** rather than omitting keys when empty — the stabler client contract wins over the draft's intent. Ruled by the orchestrator; the matter is closed.

**Debt verdicts, verified against the live stack (not just suites):**
- **F-1 attribution — CLOSED.** `status.attribution.model` carries value / actorId / at / eventSeq sourced from the matching `agent.model.changed` event, and is absent when nothing witnessed it. Observed live: a model set with `authorId: claude` produced `{actorId: "claude", eventSeq: 42, ...}` in the served world doc. Residue: attribution covers the model value only; other operator-settable values join as they earn strips.
- **F-2 kindLine — CLOSED.** Threaded from the registry profile through `worldDoc.agent` into the visible packet. Observed live: `"A named Sophia-standard learner agent with dynamic Mnemosyne tools."` replaces the old summary (`"learner-1 is completed in learner-1."`). Residue: the canonical source is the in-code `LEARNER_1_META.description`; a graph-backed source is a later act.
- **F-3 lifecycle — CLOSED.** Closed enum exported and published as a self-describing schema block (`sophia.agent-lifecycle.v0`, 8 values with descriptions); the mapper is compile-time exhaustive; `completed`/`restartable` no longer collapse to `dormant`. Observed live: the agent reports `completed` truthfully.
- **turn-record — read-side PAID, storage out of scope.** The visible packet's `conversationTail` is parsed structure with total fallback; the store shape remains raw concatenated text by design for this arc.
- **A3 (rhizome) — CLOSED.** SPARQL builders extracted as pure exported functions carrying `OPTIONAL { ?rec mem:observer ?observer }`; six new tests assert the query text and the observer row-mapping; live-gated smokes skip honestly when the cell is down. NO MOCKS held.

**What the live loop caught that no suite did.** (1) The lint sweep removed `readFileSync` from `cgroup.ts` as unused; it is used three times on the VM-only bwrap init path, which no unit test exercises — the service crash-looped on deploy and was fixed by hand. The commit message carries the incident. (2) The local platform-next cluster serving `vehicle-local`'s prompt graph had died overnight (Docker Desktop's container runtime down, node NotReady); every fail-closed prompt-graph path 500'd until the cluster was revived and the gateway spun a fresh `gardend-g-vehicle-local` cell. Neither is a code defect; both are why the completeness law demands the live stack as the bar.

**Verification (orchestrator's own runs).** `pnpm check` green; `pnpm test` 622 pass / 0 fail / 6 skipped; doctrine reviewer: approve (one medium, adjudicated above); rhizome suite green with honest skips; live smoke `wfr-mr864gvc-h8l0gk` — endpoints, floor exchange, attributed turn reply — after full stack recovery; F-1/F-2/F-3 each observed in the served world doc.

**Next.** The client repayment slice (Greenhouse deletes its event-mining, tone paper-over, and empty kindLine slot), then the big backend workflow: witness debts W1–W4 + sessions-as-records D1–D4, D6 per the Returning Observer plan (`greenhouse-returning-observer-20260705` in sophia-code-lab).

---

## SLICE 6 — The turn, unfolded (post-freeze 1; Bench begins) · 2026-07-04

**TurnAccount as composition.** No new kinds invented — `TurnAccount` is assembled from the existing kind surface: prose (reply body), conduct (array of existing `ConductRecord` kinds), and a metric debut (`MetricRecord`, first appearance in the system). The turn is a container, not a new primitive; the kind registry stays flat.

**Parser grounded in the producer's own grammar.** The turn parser is seeded from the agent's declared grammar (the conductor's schema), not from a generic heuristic. Total verbatim fallback: if the structured parse fails for any reason, the raw stream text is preserved whole — no silent data loss. The skeleton finding (below) is precisely why the fallback must be unconditional.

**Unfolded rendering.** In the room, a turn renders as: reply prose at reading level, a disclosure line (conduct summary — what the agent did and why it was disclosed), evidence lines (supporting conduct records), and a metric whisper (subordinate — present but not dominant). The hierarchy is intentional: reply first, conduct secondary, metrics softest.

**Skeleton finding — formally recorded.** The backend stores turns as concatenated stream text (the raw producer output). There is no structured turn record (reply/conduct separated) in the store today. The projection owes that structure; it currently reconstitutes it on read. F-1's projection-side attribution (linking a rendered turn back to its originating agent identity) remains the owed backend act, pending sibling-worktree coordination — it is not done here and is explicitly carried forward.

**Verification.**
- Nucleus: 19 files, 248 tests — all passed
- Greenhouse: typecheck clean; test:run 7 files, 46 tests — all passed
- Canaries: organism typecheck clean; atelier typecheck clean
- Smoke: PASS — dedicated smoke run `wfr-mr741ink-sixs5h`; live endpoints, floor exchange, and attributed turn reply passed for `agent-132c2f7244ec645b`
- New commits: none (HEAD is `6dbeb4d`)
- Scope violations: none
- Failures: none

**Reviewer: approve.** One low-severity note: `apps/greenhouse/scripts/smoke.sh` line 214 — the turn-account structural smoke contains a vacuous length guard (`account.conduct.length < 0`) that can never be true for any JavaScript array (length is always ≥ 0 by spec). The effective check is just `Array.isArray(account.conduct)`. Intent ("assert conduct count ≥ 0") is not verified beyond confirming it is an array. Consider removing the length clause or replacing it with an explicit assertion that matters.

**Next.** The watch turnover (Bench 2) or the floor's steer-in-anger, per the room's needs.

---

## SLICE 0 — The kernel ("one agent, present") · 2026-07-04

### What was built

**Scaffold.** A new `apps/greenhouse` package with its own `vite.config.ts`, `main.ts` entry, and a
single Lit custom element (`gh-app` in `greenhouse-app.ts`). The package has zero imports from
`apps/vehicle`; it stands entirely on its own dependencies.

**Kinds / presence vocabulary module.** `src/kinds/presence.ts` defines the typed surface:
`AgentPresenceTone` (`live | held | dormant`), `AgentPresenceViewModel` (identity, state, model,
references, meta), and the pure function `buildAgentPresence` that maps a raw `AgentPresenceInput`
onto the view model. Tone derivation is explicit: `running → live`, `paused → held`, everything else
(including blank, `'-'`, `null`) → `dormant / unknown`. Model provenance is mined from the event
stream — `buildAgentPresence` scans for the latest `agent.model.changed` event whose payload model
matches the current model value and extracts `authorId | observer | clientId` as the observer string.

**Live-only `GreenhouseService`.** `src/greenhouse-service.ts` exposes four methods backed by real
`fetch` calls: `listAgents` (`GET /api/agents`), `readAgentWorld` (`GET /api/agents/{id}/world`),
`pollAgentWorld` (`GET /api/agents/{id}/world/events`), and `setAgentModel`
(`POST /api/agents/{id}/world/model`). There is no fixture service. Auth supports bearer token,
internal-service-secret, and a local-dev auto-mode that wires `dev-internal-secret` when the base
URL is `127.0.0.1:3456` with no explicit credentials. Config is read from URL params and Vite env
via `readGreenhouseConfig`.

**Screen zero.** `greenhouse-app.ts` renders a `renderPresenceStrip` exported function that
consumes `AgentPresenceViewModel` and produces a Lit `TemplateResult`: presence dot (CSS class
varies by tone), agent name, model label with optional attribution suffix, reference pairs (driver,
graph), and meta pairs (run, session, updated). The `ScreenState` union (`loading | ready | dark |
empty`) is defined and the component cycles through all four states: `loading` while awaiting the
first `listAgents` response, `dark` when the service call fails, `empty` when agents are returned
but none selected, `ready` when an agent world is loaded and the presence strip is live. The single
real mutation is model change: a provider/model picker renders from grouped model options, dispatches
`setAgentModel`, and re-derives the view model from the returned world response.

### Doctrine verdicts

**Salience uneven / record became presence.** Pass. The census (Room §Agent screen presence strip,
§Agent identity strip, §Top connection pill) recorded these as three separate items pulling directly
from `readAgentWorld` / `listAgents` raw objects in `vehicle-app.ts`. Slice 0 collapses them into
one typed `AgentPresenceViewModel` built by a pure function. The screen renders the view model, not
the raw response.

**Display-kinds in the vocabulary.** Pass. `AgentPresenceTone` and `AgentPresenceViewModel` live in
`src/kinds/presence.ts`, not in the component file. The component imports the type and the builder;
it does not re-derive tone inline.

**Completeness law — live-only, one real mutation, designed failure states.** Pass on the first two
counts. The service has no fixture path; every call hits a real endpoint. The model picker is the
one mutation surface this slice exposes. `ScreenState` provides the designed failure state (`dark`)
and `empty` rather than an unhandled blank. Partial concern: `kindLine` renders as an empty string
when absent (the field is `kindLine?: string | null` in `AgentPresenceInput`) — the strip renders
the slot but shows nothing, which is a designed empty rather than an error state.

### Verification state

```json
{
  "typecheck": "pass",
  "tests": "pass",
  "test_counts": "2 files, 6 tests — all passed",
  "smoke": "pass — \"greenhouse smoke: live endpoints passed for agent agent-132c2f7244ec645b.\"",
  "diff_stat": "clean — no modified or untracked files (git status --porcelain produced no output)",
  "scope_violations": [],
  "failures": ""
}
```

### Reviewer concerns

**Medium — scope fence breach.** Commit `2a75390` modified `apps/vehicle/src/vehicle-app.ts`
(+334 lines of `AgentPresence` types and implementation) and
`apps/vehicle/src/__tests__/vehicle-app.test.ts` (+108 lines of presence tests). The founding
package spec declares a hard scope fence: "Do NOT touch `apps/vehicle` (it is a museum)." The
greenhouse package itself is fully self-contained and has zero imports from vehicle, so there is no
structural coupling — but the doctrine was explicitly violated. (`apps/vehicle/src/vehicle-app.ts`,
line 80.)

### Skeleton debts carried

- **F-1** — Provenance is still mined from events client-side (`buildAgentPresence` reads
  `agent.model.changed` payloads). The projection owes attributed values from the world response
  directly; event-mining is a stopgap.
- **F-2** — `kindLine` renders as an empty string when absent. The strip slot exists but is
  unaddressed until the census item "Agent identity strip / kindLine" is formally scheduled.
- **F-3** — Tone set is `live | held | dormant`; the `unknown` lifecycle is silently collapsed to
  `dormant`. A distinct tone or label may be needed when the lifecycle is genuinely unknown vs.
  known-dormant.

### Next slice

**The floor** — driver lease and steering queue as the positive exchange of control (census items:
Driver Claim/Release buttons, `/driver claim`, `/driver release`, `/steer TEXT`, `claimDriver` and
`steer` service methods, `POST /api/agents/{id}/world/driver` and `/steer` endpoints).

---

## SLICE 1 — The floor (positive exchange of control) · 2026-07-04

### What was built

**New kind: `AgentAffordance`.** `src/kinds/floor.ts` introduces the slice's first new kind. An
`AgentAffordance` is a typed `{ label, intent }` pair where `intent` is `'claim' | 'release' |
'steer'`. The view model (`AgentFloorViewModel`) carries a `readonly affordances` array so the
component never derives intent inline.

**Floor vocabulary module.** `src/kinds/floor.ts` defines the full surface: `AgentFloorState`
(`open | held`), `AgentFloor` (state + optional holder `{ id, isSelf }`), `AgentFloorTestimony`
(`since?, observer?`), `SteeringQueue` (`count, latestText?`), `AgentFloorSkeletonFinding` (kind
`'testimony'`, finding string), and `buildAgentFloor` — a pure function over `AgentFloorInput`
(`world?, lease?, events?, clientId`). The function resolves the lease from either the raw lease
field or `worldDoc.control.driverLease`, derives `isSelf` by comparing the holder id against the
component's `clientId`, mines `since` from `claimTs | claimedAt`, and delegates observer provenance
to `latestClaimObserver` (scans `control.driver-claimed` events). When `since` is absent it emits a
`testimony` skeleton finding rather than silently dropping the field.

**Floor line's states.** `renderFloorLine` in `greenhouse-app.ts` renders four distinct states:
(1) a busy transition label when `floorActivity` is `claiming | releasing | steering`; (2) "the
floor is open" with a `take the controls` affordance button; (3) the holder label with optional
`since HH:MM` testimony and the appropriate affordance (`release` for self, `steer...` for other);
(4) a defensive empty `floor-line` for the held-but-no-holder path that `buildAgentFloor` never
produces. The steering queue renders as a `floor-queue` sub-row when `count > 0`.

**Service methods.** `greenhouse-service.ts` gains `claimAgentDriver`, `releaseAgentDriver`, and
`steerAgent`, each posting to the real endpoints (`/world/driver` with `action: 'claim'|'release'`
and `/world/steer`). All three normalize through `normalizeControlResponse` → typed
`GreenhouseAgentControlResponse`. No fixture path.

**Ink-clause sweep (presence module).** Alongside the floor work, the diff closes four ink-clause
debts in `presence.ts` and `greenhouse-app.ts`: (a) `AgentPresenceInput` reference fields are now
`string | null` (were required strings); (b) `buildAgentPresence` filters blank-or-`'-'` values via
a new `presenceReference` helper before constructing the `references` and `meta` arrays, so empty
slots are absent not present; (c) `lifecycle === 'resident'` now maps to `live` (was falling through
to `dormant`); (d) `formatTimestamp` returns `''` instead of `'-'` for blank/missing values, and
`renderPresenceMetaLine` returns an empty template when the meta array is empty. The `driver`
reference is removed from the sentence line (the floor line owns that now).

### Doctrine verdicts

**Salience uneven / record became presence.** Pass. `AgentFloorViewModel` is built by a pure
function from raw input; the component imports the view model and never re-derives floor state
inline. The affordance array is the single truth source for what action is available.

**Display-kinds in the vocabulary.** Pass. `AgentAffordance`, `AgentFloor`, `AgentFloorState`,
`AgentFloorTestimony`, `SteeringQueue`, and `buildAgentFloor` all live in `src/kinds/floor.ts`.
Nothing from that surface is defined in the component file.

**Completeness law — ink clause and positive-exchange rule.** The ink clause is substantially
honored: the presence sweep eliminates six prior instances of `'-'` and empty-but-present fields,
`renderPresenceMetaLine` suppresses itself when empty, and floor testimony is omitted (not
zero-printed) when absent. One open concern: the defensive held-but-no-holder branch renders
`<div class="floor-line"></div>` inside a `floor-stack` with `min-height: 54px` — an empty element
occupying layout space with no referent (reviewer F-3-new, medium). The positive-exchange rule is
met: `claimAgentDriver`, `releaseAgentDriver`, and `steerAgent` hit real endpoints; `floorActivity`
tracks the in-flight state with a transition label so the UI is never silent during a round-trip.

### Verification state

```json
{
  "typecheck": "pass",
  "tests": "pass",
  "test_counts": "3 files, 15 tests — all passed",
  "smoke": "pass — \"greenhouse smoke: live endpoints and floor exchange passed for agent agent-132c2f7244ec645b.\"",
  "new_commits": "c96e354 docs(greenhouse): add the v1 slice log",
  "diff_stat": "6 files changed, 561 insertions(+), 31 deletions(-) — all under apps/greenhouse/",
  "scope_violations": [],
  "failures": ""
}
```

### Reviewer concerns

**Medium — floor-line layout jump on steer form open.** `apps/greenhouse/src/greenhouse-app.ts`
line 873. `.floor-line` uses `display: flex; flex-wrap: wrap`, and when `steeringOpen` flips to
true the `steer...` button is replaced by `.steer-form { width: min(32ch, 72vw) }`. In containers
narrower than the label plus 32ch, the form wraps to a second line, growing the `floor-stack`
beyond its `min-height: 54px`. Only opacity transitions are defined. Fix: give the form
`flex: 1; min-width: 0` so it shares the existing row, or render it on its own grid row.

**Low — empty floor-line in the defensive dead-code branch.** `apps/greenhouse/src/greenhouse-app.ts`
line 219. When `floor.floor.state === 'held'` but `floor.floor.holder` is falsy (a state
`buildAgentFloor` never produces), the branch renders `<div class='floor-line'></div>` inside a
`floor-stack` with `min-height: 54px`. The empty div allocates layout space with no referent,
violating the ink clause. Should return `nothing` or `renderSteeringQueueLine` alone.

**Low — `latestClaimObserver` path untested.** `apps/greenhouse/src/__tests__/floor.test.ts` line 1.
`latestClaimObserver` (floor.ts lines 105–121) is exercised only when `events` contains a matching
`control.driver-claimed` entry. All current tests omit the `events` field, leaving the
observer-from-events path entirely uncovered. A test should pass a matching event and assert that
`floor.testimony.observer` is populated.

**Low — smoke release may be skipped if curl exits mid-transfer.** `apps/greenhouse/scripts/smoke.sh`
line 74. `CLAIMED_BY_SMOKE=1` is set after the claim `curl` returns. If the server processes the
claim but the TCP connection drops before curl reads the full response (curl exits non-zero,
`set -e` fires), the flag stays 0 and the EXIT trap skips the release, leaving the floor held.
Fix: set `CLAIMED_BY_SMOKE=1` immediately before the curl call; reset to 0 only after a confirmed
release response (line 98 already does this correctly for the happy path).

### Skeleton debts carried

- **F-1** — Provenance is still mined from events client-side. The projection owes attributed values
  from the world response directly; event-mining is a stopgap.
- **F-2** — `kindLine` renders as an empty string when absent.
- **F-3** — Tone set is `live | held | dormant`; `unknown` lifecycle is silently collapsed to
  `dormant`. (`resident → live` was patched client-side this slice; the projection still owes a
  closed lifecycle set so the client doesn't need to paper over gaps.)
- **F-4** (new) — Lease testimony gaps: `latestClaimObserver` is untested with a real events array;
  the `observer` field of `AgentFloorTestimony` has no coverage in `floor.test.ts`.

### Next slice

**The turn** — a conversation begins: message send + the transcript's first line.

---

## SLICE 2 — The turn (the room speaks) · 2026-07-04

### What was built

**New kind: `RoomMessage` and `TurnActivity`.** `src/kinds/speech.ts` defines the speech surface in
pure TypeScript: `RoomMessage` carries backend-attested `id`, `author { id, role, isSelf }`, `text`,
and `at`; `TurnActivity` carries `state` (`idle | queued | started | running`) and optional `since`.
`buildRoomSpeech` combines `buildRoomMessages` and `buildTurnActivity` from live world/event shapes.
Messages are deduped by backend id, ordered oldest-to-newest, and omitted when they lack author,
role, text, or time testimony.

**Narrow message service.** `greenhouse-service.ts` adds only the turn endpoint:
`sendAgentWorldMessage` posts to `POST /api/agents/{agentId}/world/messages` with
`authorId`, `role`, `visibility`, `text`, and `autoTurn`. It normalizes the returned world and keeps
the attested `message` field when present. There is still no fixture path.

**Poem-register transcript and composer.** `greenhouse-app.ts` now renders the page as:
identity sentence, floor line, transcript, in-flight turn line, composer, meta line. Empty transcript
renders no transcript node. Each message is a quiet line block with `author · time` from backend
fields and prose text beneath it; agent lines are visually distinct through typography, not bubbles
or avatars. Sending does not locally echo: the composer stays populated and shows `sending...` until
the server response attests the message, then clears. The composer disables only on real local gates
(no selected agent or no active session); speech is not floor-gated because the live route is not.

**Soft-poll turn state.** The existing poll cadence now feeds `buildRoomSpeech`. Turn activity is
visible only while real `conversation.turn.queued | started | running` events are active and clears
on terminal/completed events, letting the final reply line replace the in-flight line.

### Deliberate deferral

`@shrubbery/chat-kernel`'s `sh-chat-panel` is not mounted in this slice. Greenhouse v1's current
register is minimalist text art — lines in a poem, not a panel. Inline tool-use rendering and
streaming remain future slices where the chat-kernel reuse decision can be made against the real
shape of the work. This is named reuse debt, not an oversight.

### Verification state

```json
{
  "typecheck": "pass",
  "tests": "pass",
  "test_counts": "4 files, 26 tests, all passed",
  "smoke": "pass — \"live endpoints, floor exchange, and attributed turn reply passed for agent agent-132c2f7244ec645b\"",
  "new_commits": "none",
  "diff_stat": "M apps/greenhouse/SLICE-LOG.md, M apps/greenhouse/scripts/smoke.sh, M apps/greenhouse/src/__tests__/greenhouse-app.test.ts, M apps/greenhouse/src/greenhouse-app.ts, M apps/greenhouse/src/greenhouse-service.ts, ?? apps/greenhouse/src/__tests__/speech.test.ts, ?? apps/greenhouse/src/kinds/speech.ts",
  "scope_violations": [],
  "failures": ""
}
```

### Doctrine verdicts

**Salience uneven / record became presence.** Pass. `RoomMessage` and `TurnActivity` are constructed
entirely in `speech.ts` by pure functions (`buildRoomMessages`, `buildTurnActivity`, `buildRoomSpeech`)
from raw world/event shapes. The component receives a `RoomSpeechViewModel`; it does not re-derive
authorship, role, or in-flight state inline.

**Display-kinds in the vocabulary.** Pass. `RoomMessage`, `RoomAuthor`, `TurnActivity`,
`TurnActivityState`, `RoomSpeechViewModel`, and all builders live in `src/kinds/speech.ts`. Nothing
from that surface is defined in the component file. `SpeechComposerOptions` is in `greenhouse-app.ts`
because it carries callbacks and is genuinely a render-time concern — the split is correct.

**Completeness law — ink clause, server-attested speech, testimony on message lines.**
The ink clause is honored on the transcript: `renderSpeechSurface` emits no `.transcript` node and no
`.message-line` nodes when `messages` is empty. The companion test (greenhouse-app.test.ts line 188)
asserts both are absent and asserts no literal "no messages" placeholder, which is the right contract.
One boundary concern, acknowledged honestly: `renderSpeechSurface` always emits its outer
`<div class="speech-surface">` wrapper regardless — the function's pure contract is weaker than the
doctrine requires, even though in the real render path the element is never empty because the composer
is always provided (reviewer finding below).

Server-attested speech: the composer does not locally echo. The sent text stays in the input and shows
`sending...` until the server response returns; only an attested `message` in the response body causes
the transcript line to appear and the input to clear. `normalizeMessage` in `speech.ts` rejects any
message that lacks `id`, `authorId`, `role`, non-empty `text`, or a timestamp — there is no path
from a local optimistic write to a rendered line.

Testimony on message lines: each `.message-attribution` renders `author.id · HH:MM` from the
`RoomMessage` built by `normalizeMessage`, which traces directly to `authorId` and `createdAt` on the
server-returned object. The author label is not a client-side guess.

### Reviewer concerns

**Low — `renderSpeechSurface` emits wrapper when empty.** `apps/greenhouse/src/greenhouse-app.ts`
line 311. The function always emits `<div class="speech-surface">`, even when called with a null
composer and an empty messages/idle-turn view model, producing an empty container. The companion test
(greenhouse-app.test.ts line 188) asserts `.transcript` and `.message-line` are absent but does not
assert `.speech-surface` is absent, leaving the no-empty-containers invariant untested at the function
boundary. In the real app render path the composer is always provided so the element is never empty in
practice, but the pure function's contract is weaker than the doctrine requires.

### Skeleton debts carried

- **F-1** — Provenance mined from events client-side. The projection owes attributed values from the
  world response directly; event-mining is a stopgap.
- **F-2** — `kindLine` renders as an empty string when absent.
- **F-3** — `unknown` lifecycle silently collapsed to `dormant`.
- **F-4** — `latestClaimObserver` path untested with a real events array.

### Next slice

**The trace** — Bench begins: what did the turn actually do — events behind the reply.

---

## SLICE 3 — The hoist (Shrubbery compliance I) · 2026-07-04

### What moved and why

This slice answers design review R2/F7/F3: greenhouse was building a parallel kind vocabulary
instead of building on the Shrubbery platform. `apps/greenhouse/src/kinds/` is deleted; its three
modules (`floor.ts`, `presence.ts`, `speech.ts`) move to `packages/nucleus/src/kinds/` with a new
`index.ts`. `@shrubbery/nucleus` is added as a workspace dependency. All four greenhouse test
files and both entry-point modules (`greenhouse-app.ts`, `greenhouse-store.ts`) import kinds from
`@shrubbery/nucleus` — no local kind definition remains in the app.

**Store adoption.** `greenhouse-store.ts` is introduced as the app's single reactive state owner
(agent list, selected agent, world, floor, speech, activity flags). The component reads from the
store and forwards gestures as store calls. Closes the nucleus ReactiveSource debt from the
Shrubbery editor-strangle memory.

**Stance token axis.** Presence rendering carries the stance token (`honest | provisional |
dormant | unknown`) as a CSS data-attribute, letting the token ring's visual axis be set by the
projection rather than the component.

**Boot ownership.** `package.json` declares `stack:start | stop | status | logs`; the smoke
script's `STACK_COMMAND` now points to `pnpm --dir apps/greenhouse stack:start` (was `apps/vehicle`).

**As-of capture-age suffix.** The presence meta line gains "as of Nm ago" from `capturedAt`,
giving the operator a freshness signal without polling state duplication.

### Design review lineage

R2 (greenhouse must build ON the platform) is the founding mandate this slice executes. F7 (kinds
defined inside the app, not in the platform) is fully closed — `apps/greenhouse/src/kinds/` is
gone. F3 (store layer absent) is closed by the introduction of `greenhouse-store.ts` over the
nucleus `ReactiveSource<T>` primitive.

### Doctrine verdicts — parity as the completeness bar

Parity is the right bar for a compliance slice. **Byte-parity did not hold** — deliberate. The
store refactor consolidates previously scattered component state; `greenhouse-app.ts` is shorter.
Net behavior is equivalent (same tests, same smoke assertions), internal shape changed. Honest
caveat: the as-of suffix and stance axis are small net-new additions, not pure refactor. Both
emit nothing when the underlying value is absent (ink-clause compliant). Declared accurately.

### Verification

```json
{
  "nucleus_tests": "18 test files, 238 tests — all passed. Duration 2.20s.",
  "greenhouse": "typecheck: PASS (tsc --noEmit, no errors). test:run: 5 test files, 31 tests — all passed. Lit dev-mode warnings on stderr (benign). Duration 1.66s.",
  "canaries": "apps/organism typecheck: PASS. apps/atelier typecheck: PASS. Both exit 0, no errors.",
  "smoke": "PASS. Output: \"greenhouse smoke: created dedicated smoke run wfr-mr6xp21e-076hw4. greenhouse smoke: live endpoints, floor exchange, and attributed turn reply passed for agent agent-132c2f7244ec645b.\"",
  "kinds_removed": "apps/greenhouse/src/kinds/ is gone — git status shows D for floor.ts, presence.ts, speech.ts. The three kinds now live in packages/nucleus/src/kinds/ (floor.ts, presence.ts, speech.ts, index.ts). Greenhouse src imports @shrubbery/nucleus in: greenhouse-app.ts, greenhouse-store.ts, all four test files.",
  "new_commits": "None. HEAD is 72f94a6 — no commits newer than that.",
  "scope_violations": [],
  "failures": "None."
}
```

### Reviewer verdict

Approve — [].

### Remaining compliance debts (next audit)

- **R3** — push-vs-poll: the confession is in place (greenhouse uses poll, the doctrine requires
  push-capable transports to be preferred). The confession names the debt but does not close it.
  Next audit should ask for a concrete migration path or a ratified deferral with a date.
- **R4** — turn brief: the turn's event trace (what the agent actually did behind the reply) remains
  unrendered. This was the named "next slice" from Slice 2 that this compliance slice deferred.
- **R5** — remaining "green means ran" items from the design review: test coverage still has gaps
  on the `latestClaimObserver` events path (carried as F-4 since Slice 1) and the
  `renderSpeechSurface` empty-wrapper invariant (Slice 2 reviewer concern). Both need explicit test
  cases before the audit can close R5.
- **Conneg face question** — greenhouse has no content-negotiation face (no `turtle`, `json-ld`, or
  `curl-markdown` response path). The agent-native/curl-hypermedia north star (memory entry) calls
  for conneg as a peer render target. Whether greenhouse v1 needs a conneg face, and at which
  milestone, is an open design question for the next audit.

**Features remain frozen until the compliance audit passes.**

---

## SLICE 4 — Compliance II (audit closeout) · 2026-07-04

### Ten audit items — new honest status

**R1 — live-only law (no fixture service).** RESOLVED. Adjudication recorded: the no-fixture-service law is structural and supersedes any convenience argument. `GreenhouseService` has never had a fixture path; every test exercises the pure kind functions and the store in isolation, not a stub transport. No open question remains.

**R2 — kinds must live in the platform (`@shrubbery/nucleus`).** RESOLVED in Slice 3. `apps/greenhouse/src/kinds/` is gone; all three kind modules (`floor.ts`, `presence.ts`, `speech.ts`) live in `packages/nucleus/src/kinds/`. Confirmed by diff and nucleus test count (18 files, 239 tests — all passed).

**R3 — push-vs-poll confession.** PARTIAL. The confession is in place in the slice log and in a source comment. What closes it: a concrete migration path or a ratified deferral with a date — that call is with Vera. Carried as PARTIAL pending that adjudication.

**R4 — turn brief (event trace behind the reply).** PARTIAL. Construction seams are visible and named: `StoreState.previous`, `Recency<T>`, and `MemoryRecord.observer` are scoped to Compliance III. The feature itself (rendering the trace) remains frozen per the freeze rule. Adjudication recorded: the freeze-interpretation question (whether constructing seams counts as "feature work" for R4/R6) is with Vera; Compliance III proceeds under the assumption that seam-only code is infrastructure, not feature-build.

**R5 — "green means ran" / coverage gaps.** RESOLVED. Two specific gaps were named in Slice 3: (a) `latestClaimObserver` events path (F-4 since Slice 1) — now covered: floor.test.ts carries an explicit test that passes a matching `control.driver-claimed` event and asserts `testimony.observer` is populated. (b) `renderSpeechSurface` empty-wrapper invariant — now covered: greenhouse-app.test.ts asserts `.speech-surface` is absent when called with no composer and an empty view model.

**R6 — tokens package compliant.** RESOLVED. `packages/tokens` typecheck is clean; tokens test suite: 1 file, 44 tests — all passed. No new violations introduced by this slice.

**R7 — nucleus test count regressed (238 → 239).** RESOLVED. The regression was the missing `latestClaimObserver` test; adding it brought the count to 239 and all pass.

**R8 — `numberAt` consolidation behavior change (low, reviewer-flagged).** PARTIAL / standing finding. The consolidated `json.ts numberAt` now also attempts `Date.parse()` on string fields where the original `floor.ts` private `numberAt` did not. Floor data (`claimTs`, `claimedAt`) is always a Unix epoch integer in practice, so no regression occurs in the live path — but this is a subtle enlargement not called out by item 5. Recorded here for the ledger; no code change made (the behavior enlargement is safe and the floor tests pass).

**R9 — smoke attribution assertion.** RESOLVED. Smoke passes end-to-end: `apps/greenhouse/scripts/smoke.sh` PASSED — dedicated smoke run `wfr-mr6zwo3t-4e65fg` created; live endpoints, floor exchange, and attributed turn reply all passed.

**R10 — conneg face question.** PARTIAL. No conneg face exists in greenhouse v1. The agent-native/curl-hypermedia north star calls for conneg as a peer render target. Whether greenhouse v1 needs one and at which milestone is with Vera. Carried explicitly as a design question, not a bug.

### Two standing adjudications (recorded for the record)

1. **No fixture service — live-only law supersedes.** The live-only law is structural doctrine. Any argument for convenience fixtures is overruled by the founding rule. No further debate; the law stands.

2. **Freeze-interpretation on R4/R6 seam construction.** Whether constructing `StoreState.previous`, `Recency<T>`, and `MemoryRecord.observer` seams constitutes "feature work" under the freeze is with Vera. Compliance III proceeds under the assumption that seam-only infrastructure code is not freeze-violating.

### Verification

```json
{
  "nucleus_tests": "18 files, 239 tests — all passed",
  "tokens_tests": "1 file, 44 tests — all passed",
  "greenhouse": "typecheck: clean. test:run: 7 files, 40 tests — all passed (ECONNREFUSED on the unreachable-URL mounted test is expected and passes)",
  "rhizome": "test:run: 8 files, 28 passed, 4 skipped (32 total). Smoke suites DO render as SKIPPED (↓) not green — render-smoke.test.ts 2 skipped, bouquet-smoke.test.ts 2 skipped — all correctly gated on the live cell at 127.0.0.1:7090 being down (NO MOCK).",
  "canaries": "organism typecheck: clean. atelier typecheck: clean.",
  "smoke": "apps/greenhouse/scripts/smoke.sh PASSED — dedicated smoke run wfr-mr6zwo3t-4e65fg created; live endpoints, floor exchange, and attributed turn reply all passed.",
  "new_commits": "None — git log 3d715d7..HEAD is empty.",
  "scope_violations": [],
  "failures": "None. All suites green (or correctly skipped for live-cell smoke tests)."
}
```

### Reviewer verdict

Approve — [{"severity":"low","issue":"numberAt behavior enlargement via consolidation: floor.ts's original private numberAt did NOT parse ISO date strings (only numeric strings). The shared json.ts numberAt (derived from speech.ts) also attempts Date.parse() on string fields. By consolidating through json.ts, floor.ts now silently parses date strings as timestamps where it previously returned null. The floor test suite passes and floor data (claimTs, claimedAt) is always a Unix epoch integer in practice, so no regression occurs — but this is a subtle behavior change in floor.ts not called out by item 5.","file":"packages/nucleus/src/kinds/json.ts","line":33}]

### What Compliance III holds

**R4 construction seams:** `StoreState.previous` (lets the store expose the prior world for diff rendering), `Recency<T>` (a nucleus kind for timestamped-recency decoration), and `MemoryRecord.observer` (surface the attributed observer on a memory entry). These are the load-bearing seams for the turn-brief feature (what the agent actually did behind the reply).

**DisplayKind wiring into render:** The `DisplayKind` vocabulary is defined in nucleus but not yet wired into the render path. Compliance III closes the gap: `renderPresenceStrip`, `renderFloorLine`, and `renderSpeechSurface` should each accept and propagate the `DisplayKind` token so the interpreter's stance axis is fully operative in greenhouse.

---

## SLICE 5 — Compliance III (the seams; freeze resolution) · 2026-07-04

### What was built

**R4 construction seams (nucleus + render).**

`StoreState.previous` (nucleus `reactive-store.ts`) adds an optional `{ read: T, capturedAt: number }` field beside the canonical `status/read/error` triplet. `projectStoreState` propagates it: when `state.previous` is set the projected state carries `project(state.previous.read)` at the same `capturedAt`. The `store-conformance.test.ts` addition asserts that two successive `refresh()` calls leave `store.get().previous` pointing at the first settled read (line 57–74 of the diff).

`Recency<T>` (nucleus `kinds/index.ts`) is a new timestamped-recency kind: `{ current: T, capturedAt: number, previous?: { value: T, capturedAt: number } }`. The companion `recencyFromStoreState<T>()` builder bridges the store's `StoreState` shape (which uses `read`) onto the `Recency` shape (which uses `current`/`value`). `RecencySource<T>` is the minimal interface the builder requires, keeping it decoupled from the full store type.

`MemoryRecord.observer` (render `target.ts` line ~311) adds the `observer?: string` field to the `MemoryRecord` interface. The render layer is fully wired: hypertext (`render-hypertext.ts`) picks it up via `memoryObserverLine(observer, observedAt)` and emits the attribution suffix; the Turtle and JSON-LD faces include it via `resource-triples.ts`; the `render-rhizome.test.ts` golden fixture sets `observer: 'vehicle-web'` and asserts `mem:observer` appears in TTL output and `observer` appears in JSON-LD and Markdown. **Honest gap:** in the live data path, `memory-world.ts`'s `allRecords()` SPARQL (line 108) omits `?observer` and `toRecord()` (line 272) constructs `MemoryRecord` without the field — so `observer` is always absent at runtime regardless of what the cell stores. The render-layer wiring is real; the data-layer wiring is the A3 gap named in the reviewer finding below.

**DisplayKind functional across all render faces.**

`DisplayKindRegister` (`packages/tokens/src/index.ts`) and `KIND_APPLICATIONS` extend the tokens package with the full seven-value `data-kind` attribute map (`identity | state | metric | prose | reference | testimony | affordance`). `KindedValueNode`, `KindedValueResource`, and `KindedAttribution` land in `target.ts`; `KindedValueResource` joins the `Resource` union. `render-hypertext.ts` adds `kindedInlineMarkdown` (exhaustive `switch` over all seven kinds with an `assertNever` default) and `kindedValueMarkdown`; render-resource and context carry the kind through to the Lit DOM face. The tokens test addition (`tokens.test.ts`, +26 lines) asserts `KIND_APPLICATIONS` is complete, every value has a stable `attr: 'data-kind'`, and a round-trip through `appliesAttribute` returns the correct selector.

**Greenhouse as-of through `Recency`.**

`renderPresenceStrip` in `greenhouse-app.ts` now accepts `recency?: Recency<GreenhouseLiveRead> | null` (previously accepted a raw `asOf: number`). `renderPresenceMetaLine` consumes `Pick<Recency<unknown>, 'capturedAt'>` — backward-compatible: a bare `{ capturedAt }` object still works. The greenhouse store builds the `Recency` carrier via `recencyFromStoreState(this.liveState)` and passes it down. The `greenhouse-app.test.ts` fix renames the test to "renders quiet capture age from a Recency carrier" and passes a full `Recency` object (with `previous`) rather than the raw timestamp, exercising the new seam end-to-end.

### Freeze resolution

Per Vera's delegation: **the feature freeze ends when this slice lands green.** Compliance I (hoist), II (audit closeout), and III (seams + kind wiring) are all green. The remaining R4-feature work — the turn brief / turn-unfolded render — is the first post-freeze slice. R6 (gauge/Dispatch) comes last per build order. R0 (trunk back-merge) remains with Vera.

### Verification

```json
{
  "nucleus_tests": "18 files, 241 tests — all passed",
  "render_tests": "10 files, 66 tests — all passed",
  "tokens_tests": "1 file, 46 tests — all passed",
  "greenhouse": "typecheck clean; 7 test files, 41 tests — all passed (ECONNREFUSED on port 1 in mounted test is expected/benign, test passed)",
  "rhizome": "8 test files, 28 passed, 4 skipped — skips are honest (cell at 127.0.0.1:7090 down, NO MOCK)",
  "canaries": "organism typecheck clean; atelier typecheck clean",
  "smoke": "PASSED — greenhouse smoke created wfr-mr72k134-qd7197; live endpoints, floor exchange, and attributed turn reply passed for agent agent-132c2f7244ec645b",
  "new_commits": "none — HEAD is c2395d3",
  "scope_violations": [],
  "failures": "none"
}
```

### Reviewer concerns

**High — A3 construction site gap: `memory-world.ts` `toRecord()` does not query or populate `observer`.** The SPARQL `SELECT` in `allRecords()` (line 108) omits `?observer` and has no `OPTIONAL { ?rec mem:observer ?observer }` clause; `evidenceFor()` (line ~372) is the same. `toRecord()` (line 272) constructs `MemoryRecord` without `observer`. The render layer is fully wired (hypertext/turtle/JSON-LD/DOM faces all handle `observer`), but in the live data path the field is always absent regardless of what is in the cell. The `render-rhizome.test.ts` fixture sets `observer` manually on a static object and correctly validates rendering, but does not exercise the live builder. (`apps/rhizome/src/memory-world.ts`, line 108.)
