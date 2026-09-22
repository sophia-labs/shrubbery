# Greenhouse Skin — SLICE 1: Identity Strip

**Date:** 2026-07-04
**Governing narrative:** `plans/greenhouse-ergonomics-grand-narrative-20260704.md`
**Diff:** `apps/vehicle/src/vehicle-app.ts` + `apps/vehicle/src/__tests__/vehicle-app.test.ts`
**2 files changed, 374 insertions(+), 19 deletions(-)**

---

## 1. What changed and why

The agent header was seven equal boxes: LIFECYCLE, MODEL, DRIVER, GRAPH, RUN, SESSION, UPDATED — a
dossier for someone who has left the building. This slice replaces them with a single identity strip
that reads as a sentence: a pulsing tone-dot, a large agent name, a lifecycle predicate, an inline
model picker, and two reference links (driver, graph), with run/session/updated demoted to a muted
meta line below.

The change is pure skin plus the view-model that backs it. `buildAgentPresence` is a pure function
that takes the flat fields the component already held and returns an `AgentPresenceViewModel` — four
typed buckets: `identity`, `state`, `model`, `references` + `meta`. The render side calls
`renderPresenceStrip → renderPresenceDot + renderPresenceSentenceReference + renderPresenceMetaLine`.
No data-fetch changes, no new reactive state, no store touch. The model picker is re-skinned in place
(`presence-model` wrapper) but its interaction logic is unchanged.

The motivation is the narrative's central complaint: the interface treats live agency as a record
to be read rather than a presence to be with. The strip addresses that in the smallest bounded scope —
the agent header — before touching any of the four stances (Room, Bench, Constitution, Dispatch).

---

## 2. Verdict on each criterion

**Salience became uneven in the right way — PASS.**
The agent name is now 24 px bold at line-height 1.12; the lifecycle predicate and model are 15 px
regular; run, session, and updated are 12 px muted in a single ellipsizing line. A first-glance
reading exists: name dominates, lifecycle/model are secondary, identifiers recede. Before the slice,
every datum was the same uppercase-label + same-weight value at the same size.

**A record became a presence — PARTIAL PASS.**
The tone-dot (live/held/dormant) gives the lifecycle state a visual behavior: `live` pulses via a
`@keyframes presence-live-pulse` animation (respects `prefers-reduced-motion`), `held` is amber,
`dormant` is muted grey. The agent header now *looks different* depending on what the agent is doing.
The limit is that the dot animates but nothing else does — the sentence line does not update in real
time, it renders from the last-known state snapshot like everything else in the app. Presence as
continuous liveness awaits a deeper slice (likely the Room stance / floor indicator). Within the
scope of "the header," this is the correct incremental move.

**A display-kind joined the vocabulary — PASS.**
Four kinds are now typed explicitly in the view-model rather than being `[string, unknown]` pairs
inlined in `renderStat`:

- `AgentPresenceTone` (`'live' | 'held' | 'dormant'`) — a lifecycle reading mapped to a visual
  register, not a raw string
- `AgentPresenceModel` (`value + observedAt? + observer?`) — a model value that carries its
  provenance chain (which session event set it, who observed the change); the observer-relative
  principle surfaces here structurally for the first time in the UI layer
- `AgentPresenceReference` (`label + value`) — a named pointer that renders as a sentence fragment,
  not a form field
- the `identity` / `state` split inside `AgentPresenceViewModel` — separates durable name+kind from
  live lifecycle tone

The `meta` array (run, session, updated) is still `AgentPresenceReference[]` — same shape as
references but rendered differently. That could become its own kind (`AgentPresenceMeta`) in a later
slice if the demand signals sharpen.

---

## 3. Skeleton findings

These are the demand signals the data layer must eventually supply, surfaced by having to write
`buildAgentPresence` in terms of real inputs:

**F-1 — Model provenance is latent in events, not in the agent record.**
`buildAgentPresence` reconstructs `model.observedAt` and `model.observer` by scanning
`this.events` for `agent.model.changed` entries. The agent record itself carries only the current
model string. If the observer-relative principle holds (and the narrative says it must), the
projection layer should surface last-writer + timestamp as first-class fields on the agent view-model
so the skin does not have to mine raw events.

**F-2 — `kindLine` has no canonical source.**
The strip constructs `kindLine` as `[agent.agentType, agent.workflowName].filter(Boolean).join(' · ')`,
which is a join of two optional strings that may both be null. The display-kind `identity.kindLine`
implies a single projected field — a brief human-readable sentence about what the agent *is* — that
the RDF/projection layer should own rather than leaving to ad-hoc string surgery in the view.

**F-3 — `AgentPresenceTone` is a derived classification, not a stored value.**
`agentPresenceTone(lifecycle)` is a three-way branch on the raw lifecycle string. The tone is
genuinely a derived kind (the skeleton's job, not the store's), but it depends on the lifecycle
string being one of a small closed set. Any lifecycle value outside `'running' | 'paused'` silently
becomes `'dormant'`. The projection layer should either close that set or surface an explicit
`tone` field so the mapping is not hidden inside the skin.

---

## 4. Verification state

- **typecheck:** pass
- **tests:** pass — 21 passed (vehicle-service.test.ts: 18, vehicle-app.test.ts: 3)
- **scope violations:** none
- **failures:** none

**Reviewer concerns (honest):**

The three new `vehicle-app.test.ts` tests cover `buildAgentPresence` (pure function, good) and
`agentPresenceTone` (pure function, good). They do not cover `renderPresenceStrip` or
`renderPresenceDot` at the DOM level — the sentence structure, meta line, and tone-dot classes are
not asserted. This is acceptable for a first skin slice (render tests live in the component tests,
not here) but is a gap: if the CSS class names or sentence structure change silently, no test
catches it. A follow-on slice that touches the render methods should add DOM-level presence
assertions.

The `presence-model` re-skin of the model picker re-uses `.agent-model-trigger` as the button class.
That name is left over from the old `stat` context; it is not a bug but it is a semantic mismatch
that will need renaming when the picker gets its own kind.

---

## 5. Natural next slice

The strip now reads *who the agent is and what state it is in*. The next natural slice is the floor:
*who has the floor and what is the steering queue*. The driver lease and pending-driver count are
both present in the data (the existing `driver()` method + whatever the vehicle service exposes for
queued turn requests) but currently rendered only as one item in the meta line. Making the floor
visible — occupied, contested, free — is the Room stance's load-bearing affordance, and it is the
thing that turns the strip from a presence label into a live room.
