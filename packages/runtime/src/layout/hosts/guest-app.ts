/**
 * guest-app.ts — the framework-neutral guest-app mount contract (Mithras Flow
 * playground build, unit S1; build/contracts/interfaces.md §D, "The guest-app
 * host contract (Shrubbery S1 defines; the fork F5 implements; Vera 18:26)").
 *
 * These three interfaces are copied VERBATIM (field names, types,
 * optionality, comments) from the ratified contract — this module is the
 * seam every lane builds against, so it must not drift from the text Demi
 * pinned. Field-level `readonly` is preserved exactly as written there:
 * `GuestHostContext`'s fields are plain (a host may reuse/mutate the shape
 * across an `update()`), `GuestAppModule`'s `id`/`framework`/`styles` are
 * `readonly`.
 *
 * Vera, 2026-08-24 18:26: "Shrubbery should be flexible enough that the same
 * core concepts can render a Web Components app or a React app, taking heavy
 * cues from the way Mithras did their React app." This file is the one seam
 * both `defineReactFace` and `defineElementFace` mount through — the face
 * registry (and `defineGuestFace`, which wraps a `GuestAppModule` into a real
 * `FaceRegistration`) cannot tell a React guest from a Web-Components guest
 * apart; only `framework` is a hint for diagnostics.
 */

/**
 * What the host hands a guest at mount time, and what it may hand again
 * (partially) on `GuestMount.update`.
 */
export interface GuestHostContext {
  container: HTMLElement // a light-DOM element the guest owns entirely
  base: string // the absolute base the guest bundle was built with, e.g. '/flow/'
  backend?: unknown // host-provided persistence backend, typed by the guest (Flow: { repo: RepoLike; persistence: PersistenceLike })
  signal: AbortSignal // aborted on unmount; guests must remove global listeners on abort
  awareness?: unknown // y-protocols Awareness when the host opened a room
  graphId?: string
  docId?: string
}

/** What `GuestAppModule.mount` returns — the guest's own live handle. */
export interface GuestMount {
  unmount(): void
  update?(next: Partial<GuestHostContext>): void
}

/**
 * The one thing a guest app exports. `id`/`framework` are diagnostic, never
 * behavior-selecting (LAY-004's "data cannot supply code" spirit: the face
 * registry always dispatches on `faceId`, not on `framework`). `styles`, when
 * present, is the guest's stylesheet carried byte-verbatim plus its checksum
 * (FLOW-PIXEL-2: "a build-time checksum over that file fails CI when the
 * carried sheet diverges ... without a recorded decision").
 */
export interface GuestAppModule {
  readonly id: string // 'mithras-flow'
  readonly framework: 'react' | 'web-components' | 'other'
  readonly styles?: { css: string; sha256: string } // the guest's stylesheet VERBATIM + its checksum (FLOW-PIXEL-1)
  mount(ctx: GuestHostContext): Promise<GuestMount> | GuestMount
}

const GUEST_FRAMEWORKS = ['react', 'web-components', 'other'] as const

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isGuestStyles(value: unknown): value is { css: string; sha256: string } {
  if (!isPlainObject(value)) return false
  if (typeof value.css !== 'string') return false
  if (typeof value.sha256 !== 'string' || value.sha256.length === 0) return false
  return true
}

/**
 * Runtime shape check for a `GuestAppModule` — no `any` anywhere: every
 * branch narrows through `unknown`. Defense in depth beyond TypeScript,
 * exactly like `isWellShapedViewDescriptor` (nucleus) and `FaceRegistry`'s
 * own params-schema branding — a guest module can arrive from a dynamic
 * `import()` a lazy-loaded bundle controls, not just from code this package
 * compiled, so the boundary is worth checking for real.
 */
export function validateGuestModule(mod: unknown): mod is GuestAppModule {
  if (!isPlainObject(mod)) return false
  if (typeof mod.id !== 'string' || mod.id.length === 0) return false
  if (typeof mod.framework !== 'string' || !(GUEST_FRAMEWORKS as readonly string[]).includes(mod.framework)) return false
  if (mod.styles !== undefined && !isGuestStyles(mod.styles)) return false
  if (typeof mod.mount !== 'function') return false
  return true
}
