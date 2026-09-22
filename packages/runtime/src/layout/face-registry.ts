/**
 * face-registry.ts — the CLOSED face catalog (LAY-003/LAY-004; design §3.1/
 * §3.2; Builder-1 task brief "a Face is a CLOSED registry entry — data
 * selects a face, data cannot supply code").
 *
 * `FaceRegistry.register` is the ONLY way a `FaceRegistration` enters the
 * catalog, and it is called exclusively from code at application boot
 * (design Appendix B: "assembled at application boot from version-pinned
 * code. Layout documents can name entries; they cannot call `register`").
 * Nothing in this module ever constructs a `FaceRegistration` from a
 * `LayoutDocument`, JSON, or any other data value.
 *
 * `validateDescriptor` is the P2 face-aware descriptor gate. It reuses Phase
 * 1's `isWellShapedViewDescriptor` (the generic closed/serializable-params
 * floor every descriptor must clear regardless of face) rather than
 * reimplementing that shape check, then layers the registry-specific checks
 * Phase 1 explicitly has no registry for yet: face lookup, that face's OWN
 * params schema, and the `accepts(resource)` guard.
 */
import {
  isWellShapedViewDescriptor,
  type FaceGridEligibilityPredicate,
  type FaceRegistrationPredicate,
  type ResourceLocator,
  type ViewDescriptor,
} from '@shrubbery/nucleus/layout'
import { isSealedOpenFaceParamsSchema, type FaceRegistration } from './types.js'

export type FaceValidationFailureReason =
  | 'not-well-shaped'
  | 'unregistered-face'
  | 'invalid-params'
  | 'resource-rejected'

export type FaceValidationResult =
  | { readonly ok: true; readonly registration: FaceRegistration }
  | { readonly ok: false; readonly reason: FaceValidationFailureReason }

/**
 * Thrown by `register` on a duplicate `faceId`. The catalog is closed and
 * bootstrap-only — a second registration under the same id is a programming
 * error (two faces silently shadowing each other), not a runtime condition a
 * caller should be expected to branch on.
 */
export class DuplicateFaceRegistrationError extends Error {
  constructor(readonly faceId: string) {
    super(`face '${faceId}' is already registered`)
    this.name = 'DuplicateFaceRegistrationError'
  }
}

/** Thrown by `register` once the registry has been `seal()`ed. */
export class RegistrySealedError extends Error {
  constructor(readonly faceId: string) {
    super(`face registry is sealed — cannot register '${faceId}' after boot`)
    this.name = 'RegistrySealedError'
  }
}

/**
 * F5 (repair round 3, faces-mvp review) — thrown by `register` when a
 * registration's `paramsSchema` was built with the reviewed open-params
 * escape hatch (`sealedOpenFaceParamsSchema`, types.ts) but its `faceId` was
 * not explicitly allowlisted in this registry's constructor. Defense in
 * depth alongside removing `sealedOpenFaceParamsSchema` from the public
 * `@shrubbery/runtime/layout` barrel (types.ts's own header, faces/
 * index.ts): even a caller who DOES reach the escape hatch (via its
 * explicit internal import path) still cannot silently register an
 * open-params face on an ordinary `new FaceRegistry()` — the allowlist must
 * be named up front, at construction, where it is easy to review.
 */
export class UnallowlistedOpenFaceParamsError extends Error {
  constructor(readonly faceId: string) {
    super(
      `face '${faceId}' uses the open-params escape hatch (sealedOpenFaceParamsSchema) but is not in this ` +
        'registry\'s allowOpenParamsFaceIds allowlist — pass it explicitly to `new FaceRegistry({ allowOpenParamsFaceIds: [...] })` if this is genuinely intended',
    )
    this.name = 'UnallowlistedOpenFaceParamsError'
  }
}

export interface FaceRegistryOptions {
  /**
   * `faceId`s permitted to register with an open (`sealedOpenFaceParamsSchema`)
   * params schema. Defaults to empty — a registry constructed with no options
   * rejects EVERY open-schema registration (see `UnallowlistedOpenFaceParamsError`).
   * v1 ships no genuinely open-ended face, so every real call site today
   * passes nothing and gets the strict default.
   */
  readonly allowOpenParamsFaceIds?: readonly string[]
}

export class FaceRegistry {
  private readonly byId = new Map<string, FaceRegistration>()
  private isSealed = false
  private readonly allowOpenParamsFaceIds: ReadonlySet<string>

  constructor(options: FaceRegistryOptions = {}) {
    this.allowOpenParamsFaceIds = new Set(options.allowOpenParamsFaceIds ?? [])
  }

  /**
   * Bootstrap-only. Throws on a duplicate `faceId` (see
   * `DuplicateFaceRegistrationError`), once `seal()` has been called (see
   * `RegistrySealedError`) — LAY-004's "closed behavior catalog" is a
   * property of the WHOLE application lifecycle, not just of any one call:
   * a caller that seals immediately after its bootstrap registrations makes
   * "no runtime code path can ever grow the catalog" an enforced invariant,
   * not just an observed convention (diff-review SUSPECT: "consider sealing
   * the registry after bootstrap") — or an open-params schema whose faceId
   * was not allowlisted at construction (see `UnallowlistedOpenFaceParamsError`,
   * F5 repair round 3).
   */
  register(registration: FaceRegistration): void {
    if (this.isSealed) {
      throw new RegistrySealedError(registration.faceId)
    }
    if (this.byId.has(registration.faceId)) {
      throw new DuplicateFaceRegistrationError(registration.faceId)
    }
    if (isSealedOpenFaceParamsSchema(registration.paramsSchema) && !this.allowOpenParamsFaceIds.has(registration.faceId)) {
      throw new UnallowlistedOpenFaceParamsError(registration.faceId)
    }
    this.byId.set(registration.faceId, registration)
  }

  /** Freezes the catalog. Idempotent. After this, every `register()` call throws `RegistrySealedError`. */
  seal(): void {
    this.isSealed = true
  }

  /** Introspection only — has `seal()` been called? */
  sealed(): boolean {
    return this.isSealed
  }

  get(faceId: string): FaceRegistration | null {
    return this.byId.get(faceId) ?? null
  }

  has(faceId: string): boolean {
    return this.byId.has(faceId)
  }

  /** Every registered face id, for diagnostics/inspection only — never used to authorize a mutation. */
  registeredFaceIds(): readonly string[] {
    return Array.from(this.byId.keys())
  }

  /**
   * The full P2 gate a descriptor must clear before its face may mount:
   * well-shaped (Phase 1) → registered faceId → that face's own closed
   * params schema → that face's `accepts(resource)` guard. Order matters for
   * the reported reason but not for the security property — a descriptor
   * failing ANY step is rejected.
   */
  validate(descriptor: unknown): FaceValidationResult {
    if (!isWellShapedViewDescriptor(descriptor)) {
      return { ok: false, reason: 'not-well-shaped' }
    }
    const registration = this.byId.get(descriptor.faceId)
    if (!registration) {
      return { ok: false, reason: 'unregistered-face' }
    }
    if (!registration.paramsSchema(descriptor.params)) {
      return { ok: false, reason: 'invalid-params' }
    }
    if (!registration.accepts(descriptor.resource)) {
      return { ok: false, reason: 'resource-rejected' }
    }
    return { ok: true, registration }
  }

  /**
   * Adapts `validate` into the `FaceRegistrationPredicate` shape Phase 1's
   * `validateLayoutDocument`/`solveLayout`/`applyOperation` accept as
   * `ValidateOptions.isFaceRegistered` (design §3.2's LAY-003/004 gate) — the
   * SAME registry now backs both the P2 mount-time gate and the P1
   * document-validity gate, so a face invisible to one is invisible to both.
   */
  toFaceRegistrationPredicate(): FaceRegistrationPredicate {
    return (descriptor: ViewDescriptor): boolean => this.validate(descriptor).ok
  }

  /**
   * Adapts this registry's own `persistence` classification into the
   * `FaceGridEligibilityPredicate` shape Phase 1's `validateLayoutDocument`/
   * `solveLayout` accept (design plans/surface-wave2-laneb-slice-20260716.md
   * §2.1's cell persistence rule: "faces with persistence:
   * 'persistent-non-relocatable' are invalid in grid cells"). An
   * UNREGISTERED faceId is not this predicate's own concern — `isFaceRegistered`
   * (`toFaceRegistrationPredicate`, above, backed by the SAME registry)
   * already gates that separately; treating an unknown faceId as eligible
   * here lets the two checks report DISTINCT diagnoses
   * (`LAY003_UNREGISTERED_FACE` vs `LAY003_CELL_FACE_NOT_GRID_ELIGIBLE`)
   * rather than this predicate silently pre-empting the other's verdict.
   */
  toFaceGridEligibilityPredicate(): FaceGridEligibilityPredicate {
    return (faceId: string): boolean => {
      const registration = this.byId.get(faceId)
      return !registration || registration.persistence !== 'persistent-non-relocatable'
    }
  }

  /** Convenience passthrough — does the registered face for `descriptor.faceId` accept this resource? Used by callers who already hold a known-registered face and just want the resource guard. */
  accepts(faceId: string, locator: ResourceLocator): boolean {
    const registration = this.byId.get(faceId)
    return registration ? registration.accepts(locator) : false
  }
}
