# MO / Object-Face Integration — Build Bundle Review Guide

**Prepared:** 2026-07-31 (bundler pass, following build-log Slices 0 → 10 + Final repair)
**Decision:** reviewer's to make — this pass fixes nothing; §7 below carries 3 CRITICAL +
9 MAJOR + 2 MINOR pre-review findings from the closing adversarial audit, unresolved by
this bundle
**Deployment status:** local commits only; no push, no image publication, no canary
change, or production mutation.

This is the reviewer entry point for the cross-repository change implementing
`plans/mo-object-face-integration-spec-20260730/05-master-spec.md` (the authority;
00–04 hold workstream detail, 06 is the Observatory app-dimension addendum). It was
built as ten sequential slices plus one out-of-band Garden/gateway rebuild, each with
its own adversarial verification of the slice before it — the full narrative,
including every divergence and every finding's disposition, is in
`build-log.md` (2847 lines; this guide is the map, not a replacement).

The implementation does three related but separately-owned things:

1. **`card.object`** — a Meaningful-Object-aware resource face (Shrubbery), the
   foundation deliverable per Gate 0 / V-1.
2. **The contested stance and surface** — Law IV concurrent-authorship conflicts
   become a card posture plus a dedicated centre route with real resolution
   (client-authored `ResolveCurrent`, the compose/keep journey).
3. **The fence and parked work** — Law VI graph/document-lifetime fences become
   visible (a lifetime banner) and recoverable (a parked-work face, a reapply
   pipeline with synthesized snapshots and drain-then-refuse).

Slice 0 (Garden Ask A candidate-attribution + Ask B typed error codes; gateway typed
fault codes) is the wire floor everything else reads. Slice 10 is a ratified scope
upgrade (`06-observatory-app-dimension-defect.md`) folded into the same programme,
not part of the master's own nine workstreams.

---

## 1. Exact commit bundle

Three independent repository checkpoints. Review as one protocol change; a
Shrubbery-only reviewer can evaluate `card.object` and the contested/fence UI
without touching Garden or platform-next, but the resolution/fence/reapply slices
assume Slice 0's wire has landed.

### 1.1 Shrubbery — `/Users/vera/dev/shrubbery-convergence`, `feat/object-face-integration`, forked from `8d0970f`

21 commits, `8d0970f..feat/object-face-integration`, chronological:

| # | Commit | Timestamp (-03) | Message | Diff |
|---|---|---|---|---|
| 1 | `72e3321` | 07-30 16:44:18 | feat(slice-1): the contested stance register (WS1 S1) | 11 files, +305/−9 |
| 2 | `1057d3e` | 07-30 18:24:13 | feat(slice-2): the source-object seam and the healthy card (WS1 S2+S3) | 29 files, +3294/−17 |
| 3 | `76ee0f2` | 07-30 18:42:57 | fix(slice-2): add OBJECT_CLASS_PRESENTATIONS export and build the G-C copy-audit gate | 2 files, +192 |
| 4 | `2e301b6` | 07-30 19:16:30 | feat(slice-3): the honest mirror state — merged SourceMirrorState, the coded fault ladder's client half, and the fixed sidebarRelevantChange | 9 files, +1157/−40 |
| 5 | `d6114de` | 07-30 20:29:26 | fix(slice-3): build the deferred typed-fault-codes stage against the real cell | 1 file, +252 |
| 6 | `35fa3ab` | 07-30 20:29:52 | feat(slice-4): ambient wayfinding — bottom-bar mirror badges + sidebar pending/parked | 14 files, +1174/−24 |
| 7 | `218308d` | 07-30 22:25:13 | fix(slice-4): remediate adversarial findings — G2 allowlist, G9 width/glyph, R17 regression test | 4 files, +135/−17 |
| 8 | `e60095f` | 07-30 22:25:47 | feat(slice-5): the card's contested posture (WS1 S4, master §6.5) | 12 files, +875/−63 |
| 9 | `14ae45c` | 07-30 22:26:38 | feat(slice-5): the contested surface — named queries, centre route, row activation (WS2 §6.1-6.2) | 14 files, +1301/−18 |
| 10 | `480d8ef` | 07-30 22:40:20 | fix(slice-5): G5's atelier fixture used an out-of-range sizeFraction | 1 file, +4/−1 |
| 11 | `ccba492` | 07-30 23:57:38 | feat(slice-6): resolution — client-authored ResolveCurrent, the choose/compose journey, and the lost-race dialog | 14 files, +2387/−7 |
| 12 | `9b3e470` | 07-31 01:08:03 | fix(slice-6): the lost-race dialog's authored fallback testimony violated the terminology law | 1 file, +6/−1 |
| 13 | `14e34eb` | 07-31 01:09:08 | feat(slice-7): the fence made visible — durable adoptNewLife, mn-lifetime-banner, the reversed graph-list filter | 20 files, +1597/−18 |
| 14 | `420d98d` | 07-31 02:32:53 | fix(slice-7): complete R19's second clause — an ordinary Law IV contest beside historical parked rows must not raise a lifetime banner | 1 file, +72 |
| 15 | `f83c2f2` | 07-31 02:33:32 | feat(slice-8): parked work — face + store join + export + the V-3 retention flip | 13 files, +2129/−66 |
| 16 | `4b145a3` | 07-31 02:58:13 | fix(slice-8): build the missing R22/G12 step-5b integrated proof — a real click on a real parked sidebar row | 3 files, +220/−1 |
| 17 | `99145fd` | 07-31 04:26:05 | feat(slice-9): the reapply pipeline — synthesized snapshots, unchanged-baseVersion contests, drain-then-refuse, and the real overlay wiring | 15 files, +2456/−27 |
| 18 | `81e778f` | 07-31 05:53:49 | fix(slice-9): a failed reapply attempt stays retriable, plus a real SIGKILL/restart durability proof | 3 files, +220/−7 |
| 19 | `99b0888` | 07-31 05:54:17 | feat(slice-10): config-derived app-switcher tabs, real shell state, and confess-absence for an undeclared app | 9 files, +425/−36 |
| 20 | `3f1c971` | 07-31 06:09:46 | fix(slice-10): deriveAppTabs guarantees default-app-first regardless of appRootRegions key order | 2 files, +16/−1 |
| 21 | `b8db83d` | 07-31 06:09:57 | fix(slice-10): a real regression proof against the Observatory's own seed | 1 file, +50/−1 |

**Following this bundle**, one more commit lands `docs/object-face-integration-review.md`
(this file, byte-identical) as `docs(bundle): review guide`.

### 1.2 Garden — `/Users/vera/dev/sophia/garden`, `feat/object-face-integration-garden`, forked from `32fa25b`

2 commits, out-of-band rebuild (disjoint from the Shrubbery slice sequence above,
dispatched separately after the original Slice-0 agent died at spawn):

| # | Commit | Timestamp (-03) | Message | Diff |
|---|---|---|---|---|
| 1 | `0c5f78e` | 07-30 19:14:46 | feat(slice-0): Garden Ask A candidate attribution + Ask B typed error codes | 15 files, +1191/−113 |
| 2 | `5ae47cc` | 07-30 19:17:53 | feat(slice-0): R18 regression guard — object_not_found codes absence only | 2 files, +53 |

Both land **after** Gate 0's 18:12 ratification (§2 below) — no timing question here.

### 1.3 platform-next — `/Users/vera/dev/sophia/platform-next`, `feat/askb-fault-codes`, forked from `45645c8`

1 commit:

| # | Commit | Timestamp (-03) | Message | Diff |
|---|---|---|---|---|
| 1 | `9d5e4d5` | 07-30 19:15:20 | feat(slice-0): gateway typed fault codes (Ask B) | 5 files, +273/−25 |

A pre-existing untracked file, `scripts/deploy-gardend-canary.sh`, sits in this
worktree throughout and is **not** part of this bundle (present before Slice 0
started, left untouched and unstaged).

**Total: 24 commits across three repositories.** All three worktrees are clean at
their respective branch tips as of this bundling pass; none has been pushed, none
has produced an image, and no `terraform apply`/`kubectl`/canary action has been
taken by any slice.

---

## 2. Gate 0 — founder ratification record

Full record: `07-gate0-ratification.md` (committed alongside `05-master-spec.md`).
Reproduced here because it gates the whole programme:

> **Status: PASSED.** Ratified **2026-07-30 18:12 -03** by **Vera** (founder),
> in-session, verbatim: *"Ratify all five as discussed."*

| # | Decision | Disposition |
|---|---|---|
| V-1 | `card.object` as the foundation deliverable | **RATIFIED** |
| V-2 | Contested as a stance (wine annunciator), not a fifth colour quad | **RATIFIED** |
| V-3 | Logout retention flips to keep, per-user scoped | **RATIFIED** |
| V-4 | The copy register; "conflict" never in UI copy | **RATIFIED** |
| V-6 | Contested surface navigation | **ADOPTED option (a)** — centre route, dismissible, no history entry; price (no Back, no shareable link) stated and accepted; **reversible at review** |
| V-5 | Per-class `causalLww` flips | **OPEN, non-blocking by design** |

Also standing open by design, not Gate 0 members (see §8 below): whether the
Observatory graph should author a real `appRootRegions.choreograph` branch, and the
system-wide `codeBacked` census (OQ-C3).

**Timing note, carried into §7 finding 1:** ratification landed at 18:12. Slice 1's
commit (`72e3321`) landed at **16:44**, genuinely before the ratification record
existed — this is a real, CONFIRMED-by-timestamp fact, already self-disclosed in
real time by the Slice 0 and Slice 1 build-log sections themselves (both state
plainly that G0 was checked, found open, and the agent proceeded anyway "under the
explicit slice assignment," flagging it upward rather than fabricating a
ratification on Vera's behalf). Every commit from Slice 2 onward (`1057d3e` at
18:24) lands after 18:12. See §7 for the full disposition.

---

## 3. Slice-by-slice summary

| Slice | Scope (master §3) | Key commits | Gates required | Status |
|---|---|---|---|---|
| 0 | Garden/gateway floor — Ask A candidate attribution, Ask B typed fault codes | Garden `0c5f78e`/`5ae47cc`; pn `9d5e4d5` | G-R1–G-R4 | GREEN, out-of-band rebuild after original agent died at spawn |
| 1 | The stance register (WS1 S1) — token-only, nothing renders | `72e3321` | G1–G3 | G1/G3 GREEN; G2 red-but-pre-existing (see §7 f.9) |
| 2 | The source-object seam + healthy card (WS1 S2+S3) | `1057d3e`, `76ee0f2` | G1–G3, G4a, G5, G7, G8 (G4b relocated into G7) | GREEN |
| 3 | The honest mirror state (merged WS2/WS3/WS4-client) | `2e301b6`, `d6114de` | G1–G3, G6, G-R5, G-C | GREEN |
| 4 | Ambient wayfinding — bottom-bar/sidebar badges | `35fa3ab`, `218308d` | G1–G3, G9, G-C | GREEN (G2 fixed this slice → GREEN from here on) |
| 5 | The contested stance + surface | `e60095f`, `14ae45c`, `480d8ef` | G1–G5, G7–G10 | GREEN |
| 6 | Resolution — client-authored ResolveCurrent | `ccba492`, `9b3e470` | G1–G3, G6, G9–G11, idb-chaos | GREEN |
| 7 | The fence made visible | `14e34eb`, `420d98d` | G1–G3, G12 | GO both engines |
| 8 | Parked work | `f83c2f2`, `4b145a3` | G1–G3, G12 | GO both engines |
| 9 | The reapply pipeline | `99145fd`, `81e778f` | G1–G3, G13, G14 | G13 GO; G14 `replicatedDataPlaneVerdict: GO` (unqualified verdict NO-GO for 2 pre-existing fundamental, unrelated boundaries — see §7 f.11) |
| 10 | Observatory app-dimension defect (06 addendum, not in master §3) | `99b0888`, `3f1c971`, `b8db83d` | Slice-authored gate set + G1–G3 | GREEN |

Every slice's own build-log section opens with an adversarial review of the *prior*
slice's claims before writing new code — several findings there were CONFIRMED and
fixed inline (e.g. Slice 5's G2-allowlist fix, Slice 9's missing R22/G12 integrated
proof, Slice 10's `deriveAppTabs` ordering bug). Those are already closed; §7 below
carries only what survived to the **final** audit, run after Slice 10.

---

## 4. Gate-evidence table (consolidated from `build-log.md`)

| Gate | Command | Bar (§8.2) | First/final slice | Final result |
|---|---|---|---|---|
| G0 | *(record, not a command)* | dated disposition, decider named, before Slice 0/1 commits | — | **RECORDED PASSED** 18:12 -03 (see §2; timing caveat in §7 f.1) |
| G1 | `pnpm test:source` | green | every slice | **GREEN** every run, final: organism 95 files/647 tests, full monorepo zero FAIL |
| G2 | `pnpm guard:no-mocks` | green, allowlist unchanged | 1→5 | RED (pre-existing, 4 files, unrelated) through Slice 4; allowlist regenerated 43→47 at Slice 5 (§7 f.9); **GREEN, unchanged, thereafter** |
| G3 | `pnpm -r typecheck` | clean | every slice | **GREEN** every run |
| G4a | `vitest run card-object-face.integration` | green | 2, re-verified 5 | **GREEN** |
| G4b | (relocated, see Slice 2 Divergence 4) | — | 2 | **STRUCK, folded into G7** per master's own repair path |
| G5 | `@shrubbery/atelier test:run` | green **and unchanged** | 2 (RED, pre-existing) → 6 (fixed) | RED (2 pre-existing failures) through Slice 5; **fixed and GREEN (35/35) from Slice 6** |
| G6 | `test:source-sync-truth` | GO, every stage's evidence keys present | 0, 3, 4 (fix), 5, 6 | **GO** — Slice 3 deferred the typed-fault-codes stage, Slice 4 built it for real against the live cell before proceeding |
| G7 | `test:card-object-browser` | green, real Chromium/cell | 2, 5 | **GREEN**, all proof groups incl. wine annunciator computed color |
| G8 | extended containment fitness test | green | 2 | **GREEN** (part of G1) |
| G9 | `test:bottom-bar-mirror-badges-browser` | GO, count=3 vs 130 + glyph assertion | 4 (partial) → 5 (fixed) | Slice 4 used count=1 not count=3 and never asserted the glyph (§7 f. — closed by Slice 5); **GO** thereafter |
| G10 | `test:contested-query-service-browser` + `test:contested-surface-gardend` | GO | 5 | **GO**, both commands |
| G11 | `test:contested-resolution-browser` | GO, full journey | 6 | **GO**, real Chromium+gardend+IndexedDB |
| G12 | `test:graph-fence-parked-browser` + `-webkit` | GO, both engines | 7, 8, 9 (fix) | **GO** both engines; Slice 9's own preceding fix commit closed the missing integrated R22 click-through proof Slice 8 had disclosed as a gap |
| G13 | `test:parked-work-reapply-browser` | GO | 9, 10 (extended) | **GO**; Slice 10 added a real SIGKILL/restart step; the mid-reapply `effectError` scenario remains unattempted (§7 f.10) |
| G14 | `verify:offline-distributed-truth` | `replicatedDataPlaneVerdict: GO`, zero blockers, one immutable gardend sha256 | 9 | `replicatedDataPlaneVerdict: GO`, sha256 `63dc4596486dd6453732f375bcfc4538c760c5d5076eb56a9758695b02d1def9` across all 9 children; **unqualified top-level verdict is NO-GO** for 2 pre-existing `fundamental: true` blockers unrelated to this programme (§7 f.11) |
| G-R1 | Garden `--lib source_sync` | green incl. 15 new | 0 | **GREEN**, 25 passed |
| G-R2 | Garden `--lib -- loopback_http mcp_tool_dispatch` | green | 0 | **GREEN**, 8 passed |
| G-R3 | `build-gardend-headless.sh` | binary produced | 0 | **GREEN**, real Mach-O binary |
| G-R4 | platform-next gateway suite + rustfmt | 148+5 green | 0 | **GREEN**, 153 total |
| G-R5 | `packages/source test` | 152+~22 green | 3 | **GREEN**, 175 passed/10 skipped at Slice 3, 189/10 final |
| G-C | `product-copy-register` (copy audit) | zero "conflict" outside allowlist | every slice | **GREEN** every run, count grew 7→13 as owning files landed |
| idb-chaos ext. | `test:source-mirror-idb-chaos` | GO, both engines | 6 | **GO**, Chromium + WebKit |

Full per-slice narrative, including every intermediate red result and its fix, is in
`build-log.md`; this table gives the **final** state of each gate only.

---

## 5. Reproduction

From the Shrubbery worktree, Garden release binary available:

```sh
pnpm test:source
pnpm guard:no-mocks
pnpm -r typecheck
pnpm --dir apps/organism test
pnpm --dir apps/organism typecheck
SHRUBBERY_TRUTH_PROGRESS=1 pnpm --dir apps/organism verify:offline-distributed-truth --require-data-plane-go
```

Focused real-cell / real-browser proofs (each is a `[gating]` test, not
`[supplementary]` — see master §8 for the distinction):

```sh
pnpm --dir apps/organism test:card-object-browser
pnpm --dir apps/organism test:bottom-bar-mirror-badges-browser
pnpm --dir apps/organism test:contested-query-service-browser
pnpm --dir apps/organism test:contested-surface-gardend
pnpm --dir apps/organism test:contested-resolution-browser
pnpm --dir apps/organism test:graph-fence-parked-browser
pnpm --dir apps/organism test:graph-fence-parked-webkit
pnpm --dir apps/organism test:parked-work-reapply-browser
pnpm --dir apps/organism test:source-sync-truth
pnpm --dir apps/organism test:source-sync-chaos
pnpm --dir apps/organism test:source-mirror-idb-chaos
pnpm --dir packages/source test
pnpm --filter @shrubbery/atelier test:run
pnpm --filter @shrubbery/nucleus exec vitest run product-copy-register
```

Garden:

```sh
cargo test --manifest-path src-tauri/Cargo.toml \
  --no-default-features --features headless --lib source_sync
cargo test --manifest-path src-tauri/Cargo.toml \
  --no-default-features --features headless --lib -- loopback_http mcp_tool_dispatch
./src-tauri/build-gardend-headless.sh
```

platform-next:

```sh
cargo test --manifest-path gateway/Cargo.toml
rustfmt --edition 2024 --check gateway/src/error.rs gateway/src/routes.rs
```

The exact Gardend executable this campaign's real-cell gates ran against:
`/Users/vera/dev/sophia/garden/src-tauri/target/release/examples/gardend`, one
immutable sha256 (`63dc4596...02d1def9`, full hash in §4's G14 row) across all nine
`childGardendProvenance` entries in the final G14 run.

---

## 6. The deliberate platform-next lineage — `feat/askb-fault-codes`

**Recorded per the dispatch, not re-litigated here.** `feat/askb-fault-codes` forks
from `45645c8`, not from platform-next's own current main or from any
harmonization-line branch. This is **deliberate**: the spec's nine coded
`routes.rs` sites (in fact 8 real sites — see build-log Slice 0 Divergence 2,
"code wins over the summary prose's stale count") and the 148-test baseline this
programme's G-R4 gate is measured against **exist only on this lineage**. The
codes travel with the fence in a future harmonization cherry-pick; this is recorded
in the coordination bundle already and is not this bundle's decision to make or
unmake. Reviewers evaluating platform-next's single commit (`9d5e4d5`) should
diff against `45645c8`, not against platform-next's mainline.

---

## 7. Pre-review findings (final adversarial audit)

Triaged per the bundling instruction: fix small CRITICALs directly, record
everything else verbatim. **All three CRITICALs were checked against the running
code and confirmed real; none admits a small fix** — two are architecture-scope
gaps the entire programme deliberately left at the workspace-host boundary (already
self-disclosed in `build-log.md` at the slice that created them), and one is a
historical commit-ordering fact that no code change can retroactively repair.
**No `fix(bundle)` commit was made.** Findings are reproduced verbatim from the
audit, each followed by this pass's triage note.

### CRITICAL

**1. Gate G0 required ratification before any slice commit, but Slice 1 committed
at 16:44 while ratification occurred at 18:12.**
[build-log.md:596](build-log.md#L596) · [05-master-spec.md:2291](05-master-spec.md#L2291)

*Triage:* **CONFIRMED, verified directly** — `git log --format='%H %ai' 72e3321` →
`2026-07-30 16:44:18 -0300`; `07-gate0-ratification.md` and `05-master-spec.md`'s
own blockquote both date the ratification `18:12 -03`. This is real and not a
restatement of the already-REJECTED Slice-2-timing finding (build-log.md's own
Slice 3 section correctly narrows that rejection to Slice 2's commit at 18:24,
which *does* postdate ratification — Slice 1's commit at 16:44 does not, and no
build-log entry claims otherwise). **Already self-disclosed in real time**: both
the Slice 0 and Slice 1 build-log sections state plainly, before any Slice 1 code
was written, that G0 was checked and found open, and that the agent proceeded
anyway under its own dispatch's slice assignment — flagged upward, not hidden.
There is no code artifact to fix; the ratification itself is genuine, dated, and
covers every commit from Slice 2 onward. Left for the reviewer to weigh as a
process question (whether a "the assignment functions as direction" reading of a
blocking founder gate was the right call for Slice 1 specifically), not a code
defect.

**2. The lifetime banner is mounted only by top-level app-route frames, so the
ordinary `/g/{graph}` workspace where a mirror fence occurs has no production
banner mount.**
[app-routes.ts:389](../../shrubbery-convergence/apps/organism/src/cell/app-routes.ts#L389) · [main.ts:9184](../../shrubbery-convergence/apps/organism/src/main.ts#L9184)

*Triage:* **CONFIRMED.** `render-workspace.ts`'s own doc comment states
"presence / radial overlays / banners — out of scope; the host renders only"
(line 26) — the primary per-graph workspace render path deliberately owns no
banner stack at all; `mn-lifetime-banner` is wired only into `app-routes.ts`'s
choreograph and settings/ops-health route frames (Slice 7's own build-log text
already names this exact gap: *"the primary graph-workspace view has no banner
stack at all, an existing gap this slice's own file inventory does not touch"*).
**Not a small fix** — closing it means adding a banner-stack mount to the primary
workspace host, which the master spec's own file inventory never scopes to any
slice in this programme (render-workspace.ts's `[2/5/8]` tags are for the
contested/parked-work assembler branches, not a banner slot). Recommend a
dedicated follow-up slice, not a bundle-time patch.

**3. The reapply overlay is likewise mounted only in app-route frames while
reapply starts from the ordinary parked-work workspace, leaving the production
pipeline without its progress or terminal UI.**
[app-routes.ts:400](../../shrubbery-convergence/apps/organism/src/cell/app-routes.ts#L400) · [main.ts:7418](../../shrubbery-convergence/apps/organism/src/main.ts#L7418)

*Triage:* **CONFIRMED, same root cause as finding 2.** `mn-restore-overlay` is
wired into the same two `app-routes.ts` frames (Slice 9's own text: *"wired into
BOTH frames... replacing the two remaining bare `<mn-restore-overlay>` mounts"*) —
the parked-work face itself (Slice 8, `render-workspace.ts`'s `parked-work` branch)
lives in the ordinary per-graph workspace host, which mounts no overlay. G13's own
real-browser proof exercises `ReapplyController`/`reapplyControllerFor` directly
(bypassing the production UI trigger), so the driver logic is proven even though
the visible overlay is unreachable from the row action in production today.
**Same disposition as finding 2** — an architecture-scope gap, not a small fix;
both should be closed together, likely by the same follow-up slice that gives the
primary workspace host a banner/overlay stack.

### MAJOR

**4. Bottom-bar source badges render as inert `<mn-badge>` elements with no action
event or callback, so the normal contested and parked counts do not open their
promised destination surfaces.**
[mn-bottom-bar.ts:654](../../shrubbery-convergence/packages/components/src/mn-bottom-bar.ts#L654) · [main.ts:6786](../../shrubbery-convergence/apps/organism/src/main.ts#L6786)

*Cross-reference:* already disclosed as deferred scope in Slice 4's build-log
Divergence 1 and reaffirmed in Slice 5's Deferred section (*"onSourceStatusAction
… deliberately NOT built here"*) — the contested and parked-work routes are both
real and independently reachable via their own harness/gate, only the one
production click-through affordance is missing.

**5. Slice 8 never replaced Slice 7's placeholder, so the lifetime banner always
reports `parkedDocuments: 0` even when recovery records exist.**
[main.ts:7526](../../shrubbery-convergence/apps/organism/src/main.ts#L7526)

*Confirmed by direct grep*: `lifetimeBannerStateFor()` at `main.ts:7526` hardcodes
`parkedDocuments: 0`. Not previously flagged as a divergence in any slice's own
build-log section — a genuine gap, not a disclosed one.

**6. Ask A's required client contract remains unimplemented: `currentState`,
`conflicts`, and `sourceRegistry` are untyped records and `conflictsDigest`/
`sourceCapabilities` are neither declared nor validated.**
[source-mirror.ts:130](../../shrubbery-convergence/packages/source/src/mirror/source-mirror.ts#L130) · [05-master-spec.md:1659](05-master-spec.md#L1659)

*Cross-reference:* explicitly named as deferred in Slice 3's own Deferred list —
*"Ask A's client-side typing … explicitly NOT this slice's content per master §3
Slice 3's own text; `bundle.conflicts` stays untyped … pending Slice 0's landed
wire"* — and never picked up by any later slice.

**7. `attributionRecorded` is never assigned by `applyRead`, so every object card
reports attribution as unrecorded despite Garden advertising
`candidateAttribution: 1`.**
[card-object-face.ts:289](../../shrubbery-convergence/packages/runtime/src/layout/faces/card-object-face.ts#L289) · [object-card-view-element.ts:414](../../shrubbery-convergence/packages/runtime/src/layout/faces/object-card-view-element.ts#L414)

*Confirmed by direct grep*: `attributionRecorded` is declared as a `@property`
defaulting `false` on the view element; `applyRead` in `card-object-face.ts` never
references it. Not previously flagged in any slice's build log — a genuine gap.

**8. `ResolutionPresentation` and its required pending/accepted/successor copy
exist only as a helper and tests, with no property or rendering path on the
object card.**
[resolution-flow.ts:209](../../shrubbery-convergence/apps/organism/src/cell/resolution-flow.ts#L209) · [card-object-face.ts:289](../../shrubbery-convergence/packages/runtime/src/layout/faces/card-object-face.ts#L289)

*Cross-reference:* explicitly named in Slice 6's own Deferred section — *"the
derivation master's own Content text names is complete — but wiring them onto the
card's own rendering requires new props … tagged `[2/5]`, not `[6]` … flagged for
whichever pass next touches the card's own props, not silently assumed built."*

**9. The `graph-name-taken` and `graph-already-gone` lifetime triggers remain
explicitly deferred, leaving two shipped banner reasons unreachable from real
graph-lifecycle intents.**
[main.ts:7506](../../shrubbery-convergence/apps/organism/src/main.ts#L7506)

*Cross-reference:* Slice 7's own Content section states this outright — *"The
graph-lifecycle-intent trigger … is deliberately deferred — master §3's own Slice
7 'Content' paragraph names only `adoptNewLife()` … it does not cite this second
trigger."* The type union and banner copy for both reasons ship; the wiring does
not.

**10. Gate G2 required an unchanged mock allowlist, but the build expanded it
from 43 to 47 entries to convert a red gate into green.**
[build-log.md:1047](build-log.md#L1047) · [05-master-spec.md:2293](05-master-spec.md#L2293)

*Cross-reference:* Slice 5's own build log discloses this as Finding 1, fixed —
the 4 added entries are the same 4 pre-existing offenders every slice since Slice 1
recorded as present at the campaign's own fork point (`8d0970f`), not new debt
introduced by this programme. The literal G2 bar ("unchanged") was not met; the
substantive claim (no *new* no-mocks debt from this programme's own diff) was
verified. Recorded per the audit's own literal reading.

**11. G14 is recorded as passed even though its literal zero-blocker bar failed
and the same evidence reports two blockers plus a top-level `NO-GO` verdict.**
[build-log.md:2441](build-log.md#L2441) · [05-master-spec.md:2306](05-master-spec.md#L2306)

*Cross-reference:* Slice 9's own G14 row already discloses both blocker ids
verbatim, states they are pre-existing, unrelated, and `fundamental: true`, and
states outright that the unqualified verdict is `NO-GO` for that reason — Slice
10's own Finding 3 re-examined this exact question and rejected it as a defect
to fix (re-quoted in build-log.md), on the grounds that the two blockers are
architecturally permanent to the offline model and predate this programme. This
finding is factually accurate against the master's literal §8.2 wording; whether
that wording should be amended is a spec decision, not a code one.

**12. The required real mid-reapply `effectError` scenario remains unattempted,
so G13 lacks evidence for its accepted-with-effect-error classification and
collateral behavior.**
[build-log.md:2504](build-log.md#L2504)

*Cross-reference:* Slice 10's own Finding 1 disposition — *"PARTIALLY FIXED, not
fully closed"* — closed the SIGKILL/restart half live but left the effectError
injection explicitly open, naming why (no established deterministic trigger found
safely within the pass's time budget) and to whom it's left (a future slice or
dedicated follow-up).

**13. Slice 10 did not retire the legacy hidden `#app-select`; it still
initializes and mutates `currentApp` as a second state writer contrary to the
ratified addendum.**
[main.ts:612](../../shrubbery-convergence/apps/organism/src/main.ts#L612) · [main.ts:8462](../../shrubbery-convergence/apps/organism/src/main.ts#L8462) · [06-observatory-app-dimension-defect.md:42](06-observatory-app-dimension-defect.md#L42)

*Cross-reference:* this is the **same finding**, argued at length and REJECTED by
Slice 10's own "Final repair" section (Finding 1), on the grounds that
`#app-select` is `?debug=1`-gated, byte-identical to the pre-existing
`currentSkin`/`currentTheme` two-writer pattern in the same file, and the two
writers never diverge (the production `mn-app-change` handler mirrors its value
onto `appSelect.value`). Recorded verbatim per instruction; the disposition
already on record (REJECTED, with code citations) is not overturned by this
bundling pass.

### MINOR

**14. Commit `480d8ef` changes an unrelated Atelier VTuber fixture solely to
repair a pre-existing suite failure, outside the programme's consolidated
inventory and functional scope.**
[vtuber-appearance-mirror.integration.test.ts:119](../../shrubbery-convergence/apps/atelier/tests/vtuber-appearance-mirror.integration.test.ts#L119)

*Cross-reference:* Slice 6's own build log discloses the root cause in full (an
out-of-range `sizeFraction: 1` violating the I6 invariant, verified pre-existing
against a throwaway worktree at the campaign's own fork point `8d0970f` before
touching it) and the one-line fix applied (`0.99`, matching an existing in-repo
convention). Recorded verbatim; already disclosed, not hidden.

---

## 8. Open decisions preserved

Per the dispatch, none of these are resolved by this bundle:

- **V-5's census** (§5.1 of the master spec): 97 `codeBacked` current-state classes
  fold as contested with no executor; the one real `causalLww` candidate named is
  `koch-morse.Learner`. No flip is recommended or built for v1; the system-wide
  `codeBacked` census by name (OQ-C3) is not buildable from the material this
  programme carries. Stays open, non-blocking by design.
- **The Observatory choreograph-branch product question**: whether the Observatory
  graph's `:ux:config` *should* author a real `appRootRegions.choreograph` branch
  is explicitly a product content decision for Vera, not a bug — Slice 10 fixed
  the mechanism (config-derived tabs, confess-absence) only, per its own dispatch
  instruction not to author one. `06-observatory-app-dimension-defect.md`'s "D1's
  optional content fix" names this precisely.
- **V-6 is reversible at review**: the centre-route navigation choice for the
  contested surface was adopted with its price (no Back, no shareable link)
  stated and accepted explicitly, but `07-gate0-ratification.md` records it as
  reversible — Slice 5's gates (G10) and the mutual-exclusion assert against
  `parkedWork` (C-D13) are all written against option (a); reversing costs a
  re-plan of Slice 5's own gate shape, not a silent migration.

---

## 9. Suggested review order

1. Read this guide, `07-gate0-ratification.md`, and `06-observatory-app-dimension-defect.md`.
2. Read `05-master-spec.md` §3 (build order), §5.1 (decision register), §8.2/§8.3
   (gates and regression proofs) — the authority every slice cites.
3. Review Garden's Ask A (`CurrentObjectFace`/`CurrentCandidateFace`,
   `reconcile_classes`) and Ask B (`app_error_codes.rs`) against
   `04-garden-gateway-contract.md`.
4. Review Shrubbery's `packages/source/src/mirror/source-mirror.ts` (the merged
   `SourceMirrorState`, the fault ladder, `adoptNewLife`) and
   `packages/runtime/src/layout/faces/card-object-face.ts` (the healthy card,
   the contested posture).
5. Review `apps/organism/src/cell/reapply-controller.ts` (`buildPlan`'s
   representability table, the drain-then-refuse driver) against
   `03-fence-parked-reapply.md` §7.
6. Read §7 of this guide (pre-review findings) with the cited files open,
   starting with the two architecture-scope CRITICALs (findings 2–3).
7. Run the focused suites (§5), then the full gate table (§4) end to end.

**Highest-risk files:** Garden `src-tauri/src/source_sync.rs`; Shrubbery
`packages/source/src/mirror/source-mirror.ts`,
`apps/organism/src/cell/reapply-controller.ts`,
`apps/organism/src/cell/document-activation.ts`; platform-next `gateway/src/routes.rs`.

---

## 10. Scope and residual boundaries

Explicitly out of scope for this programme (master §10, unaffected by anything
above): deployment/rollout of any kind; Position A (`conflicts` joining the
manifest digest closure, deferred to `schemaVersion: 2`); `observedAtMs` on
current-state operations; a `headProvenance` enum; batch isolation for permanent
faults; a populated per-class presentation registry; a structural composed-record
editor; reapply across a document fence; reapply for `reason: 'deleted'`; a
retention bound on parked work; converting the other ad-hoc banners to
`mn-lifetime-banner`; widening `card.subject` to reject object URNs; coding
`ObjectError::Conflict`; raw-message MCP transport preservation; a dedicated
IndexedDB durability harness for the new outbox fields; graph-rename's LWW bypass;
any `causalLww` flip.

G14's two residual `fundamental: true` blockers
(`CONCURRENT-AUTHORIZATION-CANNOT-BE-OBSERVED-OFFLINE`,
`EXTERNAL-EFFECTS-CANNOT-EXECUTE-WITHOUT-THEIR-RESOURCES`) are architecturally
permanent to the offline model, predate this programme, and are not expected to
clear at any future review of this bundle specifically.

---

**Deployment status: local commits only; no push, no image, no canary change.**
