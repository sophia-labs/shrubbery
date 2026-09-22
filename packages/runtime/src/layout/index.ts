/**
 * @shrubbery/runtime layout — P2 face machinery barrel plus the real face
 * implementations: the ratified v1 catalog `hoja.document`,
 * `sparql.bindings-table`, `sophia.home` (design §9.2 Phase 2's "exactly"
 * gate). `media.viewer` is real and tested but DELIBERATELY NOT exported
 * here (F6, repair round 3 — see `faces/index.ts`'s header and
 * `faces/media-face-internal.ts`'s own header for the quarantined internal
 * path and its one registered consumer). Wiring the ratified three onto a
 * live `FaceRegistry`/`LayoutResourceBroker` pair inside `apps/organism` is
 * separate work; this barrel exposes the generic contract + registry +
 * broker + interpreter + the face/adapter factories, not an assembled
 * organism.
 */
// F5 quarantine (repair round 3, faces-mvp review): an EXPLICIT named
// re-export list, not `export * from './types.js'` — the wildcard form
// would silently carry `sealedOpenFaceParamsSchema` (the reviewed
// open-params escape hatch) into this PUBLIC barrel too. A casual consumer
// of `@shrubbery/runtime/layout` must not reach it; it is importable only
// from the explicitly-internal `sealed-open-face-params-internal.ts`
// module. `isSealedOpenFaceParamsSchema`/`listSealedOpenFaceParamsUsages`/
// `SealedOpenFaceParamsUsage` stay public — they are read-only inspection
// surfaces (grant no capability) and `FaceRegistry`'s own construction-time
// allowlist (face-registry.ts, the F5 defense-in-depth companion) is what
// actually gates a registration, not barrel visibility.
export type { PixelBox, LeafConstraints } from './types.js'
export { DEFAULT_LEAF_CONSTRAINTS } from './types.js'
export type { FacePersistence } from './types.js'
export type { DisposeReason } from './types.js'
export type { FocusReason, FocusRequest } from './types.js'
export type { ResourceKey, ResourceShape, ResourceLease } from './types.js'
export type {
  DurableResourceAdapter,
  DerivedResourceAdapter,
  ResourceComputeContext,
  ResourceAdapter,
  ResourceBrokerDiagnostics,
  ResourceBroker,
  SurfaceActivationDiagnostics,
  SurfaceActivationPriority,
  SurfaceActivationScheduler,
} from './types.js'
export type { FaceMountContext, FaceView, FaceRegistration } from './types.js'
export type { ClosedFaceParamsSchema } from './types.js'
export { closedParamsSchema, noFaceParams } from './types.js'
export type { SealedOpenFaceParamsUsage } from './types.js'
export { listSealedOpenFaceParamsUsages, isSealedOpenFaceParamsSchema } from './types.js'

export * from './face-registry.js'
export * from './fragment-face-set.js'
export * from './fragment-splice.js'
export * from './source-object-service.js'
export * from './resource-broker.js'
export * from './resource-store.js'
export * from './surface-activation.js'
export * from './layout-interpreter.js'
export * from './layout-edge-interpreter.js'
export * from './surface-host.js'
export * from './named-query-registry.js'
export * from './named-query-audit.js'
export * from './workspace-surface-element.js'
export * from './layout-dashboard-host.js'
export * from './subject-drill-down.js'
export * from './faces/index.js'
