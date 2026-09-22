/**
 * @shrubbery/nucleus/layout — Phase-1 layout-as-data public surface
 * (plans/shrubbery-layout-as-data-design-20260716.md §2, §9.2 Phase 1).
 *
 * Deliberately NOT folded into the package's main `src/index.ts` barrel.
 * `solver.ts` exports `LayoutPlan`/`LayoutPlanNode` — the SOLVED pixel-rect plan
 * of the Surface/layout-as-data engine. These once name-collided with a
 * different-shaped `LayoutPlan`/`LayoutPlanNode` in `workspace/interpreter.ts`
 * (the pre-existing `planFor`'s right-deep region-spine plan, re-exported through
 * `workspace/index.ts`); that collision has since been resolved by renaming the
 * workspace types to `WorkspaceSpinePlan`/`WorkspaceSpinePlanNode`. This module
 * nonetheless remains its own package.json subpath (`@shrubbery/nucleus/layout`)
 * — additive, does not touch the existing top-level surface, mirrors the
 * package's existing `./workspace`, `./contract`, `./kinds` subpath pattern.
 *
 * P2 face-machinery code (packages/runtime/src/layout/**) imports the Phase-1
 * document model, validator, operation reducer, solver, and diagnostics
 * ENTIRELY through this barrel — it must never reimplement tree validation,
 * operation semantics, or geometry solving (design §9.2 Phase 2: "consuming
 * the Phase-1 LayoutDocument... do NOT reimplement it").
 */
export * from './types.js'
export * from './diagnostics.js'
export * from './validate.js'
export * from './operations.js'
export * from './solver.js'
export * from './layout-edge.js'
