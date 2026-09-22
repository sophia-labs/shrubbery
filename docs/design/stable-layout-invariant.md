# The stable-layout invariant: solved frames, flowing content

## The invariant

**Geometry is solved from declared state and is stable under interaction;
content changes happen INSIDE a frame (scroll/clip), never resize the frame or
reflow siblings.**

A surface's frame is DECLARED (in the `LayoutDocument`) and SOLVED (by the
Surface engine — `packages/nucleus/src/layout` solver +
`packages/runtime/src/layout/layout-interpreter.ts`). Under it, a face's box is a
function of the solved plan, not of what the face paints. Interior content that
grows scrolls or clips within its own box; it cannot push a sibling or reflow the
shell.

## The two mechanisms a content surface can use to place itself

1. **Solved frame (correct).** The surface receives a solved rect and owns its
   overflow. Its position is a pure function of the declared plan and is stable
   under interaction. This is what every leaf under the engine does.

2. **Flow-reflow (straggler).** The surface sits in normal document flow, so
   focusing/typing grows a box that pushes its neighbours — e.g. the chat
   typing-jump.

3. **Measure-and-self-position (straggler).** The surface derives its OWN
   position from live measurement (`getBoundingClientRect()`), recomputed on
   `updated()`/`ResizeObserver`. When an interaction reflows the thing it
   measures, the surface snaps to a new place — e.g. the document editor float
   (`packages/runtime/src/editor-host.ts` `computeHostVars`).

## The rule

A content surface **receives a solved rect and owns its overflow**. It **must
not derive its own position from live measurement**, and it must not depend on
document flow to size itself.

## The core already embodies it

The solved-frame engine IS the invariant made mechanical. The
`LayoutInterpreter` sets the root to a real, overflow-contained containing block
(`position:relative; overflow:hidden`, layout-interpreter.ts:292) and mounts each
leaf as a solved-sized, overflow-owning box: absolutely positioned at the
solver's exact root-absolute pixels (`ensureWrapper`/`positionWrapper`), sized to
the solved allocation, with `overflow` set to `hidden` (clip faces) or `auto`
(scroll faces) at layout-interpreter.ts:585. So a face's internal growth
scrolls/clips within its pane and cannot reflow a sibling.

This is guarded, positively, by
`packages/runtime/src/layout/__tests__/stable-layout-containment.fitness.test.ts`
— a fitness test that mounts a REAL interpreter with a two-leaf split and asserts
the root is overflow-contained, each leaf wrapper is a solved-sized
overflow-owning box, and the mounted geometry is a function of the solved plan
(injecting enormous content leaves every frame's declared box unchanged).

## The fix is convergence, not redesign

The felt bugs happen at surfaces NOT yet under the engine that use mechanism 2 or
3. The fix is to bring those stragglers under the solved-frame engine (so their
position stops being a function of flow or live measurement) plus the containment
guard above, which keeps the core honest as they arrive.

## Target #1: the document editor float

The document editor is the exemplar of mechanism 3. It is a legacy accommodation
— the old shell can't own the editor's layout, and the host "never
self-establishes a containing block" — so `computeHostVars(anchorRect, mainRect)`
computes `--editor-x/y/w/h` from a measured anchor and recomputes on
focus-reflow, producing the "click-to-type jump."

That mechanism is pinned deterministically by
`packages/runtime/src/__tests__/editor-host-jump-characterization.test.ts`, which
feeds the real pure `computeHostVars` a pre-focus vs post-focus-reflow anchor and
asserts the float vars change. It CHARACTERIZES current behavior, not desired
behavior. The editor float is retired by making the editor a **solved face** under
the Surface engine — receiving a solved rect and owning its overflow, exactly like
every leaf in the containment fitness test. When that lands, the characterization
test should be replaced by a "no reposition on interaction" assertion.
