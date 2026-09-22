/**
 * face-registry.test.ts — the CLOSED catalog gate (LAY-003/LAY-004).
 *
 * Two things the task brief calls out explicitly: closed params are actually
 * ENFORCED (an unknown/extra key is rejected, not silently ignored), and the
 * `accepts(resource)` guard is a REAL second gate beyond faceId+params (a
 * face registered for `document` locators must not swallow an `iri`
 * descriptor just because the faceId string matches).
 */
import { describe, expect, it } from 'vitest'
import { createExactParamsSchema, validateLayoutDocument } from '@shrubbery/nucleus/layout'
import { DuplicateFaceRegistrationError, FaceRegistry, RegistrySealedError, UnallowlistedOpenFaceParamsError } from '../face-registry.js'
import {
  closedParamsSchema,
  isSealedOpenFaceParamsSchema,
  listSealedOpenFaceParamsUsages,
  noFaceParams,
  sealedOpenFaceParamsSchema,
  type FaceRegistration,
} from '../types.js'
import { buildTestRegistry, documentDescriptor, freshDocument, leafNode, mediaDescriptor } from './fixtures.js'

describe('FaceRegistry — closed catalog basics', () => {
  it('register/get/has round-trip, and registeredFaceIds lists every registered face', () => {
    const { registry, documentFace, mediaFace } = buildTestRegistry()
    expect(registry.has('test.document-face')).toBe(true)
    expect(registry.has('test.media-face')).toBe(true)
    expect(registry.has('nonexistent.face')).toBe(false)
    expect(registry.get('test.document-face')).toBe(documentFace.registration)
    expect(registry.get('test.media-face')).toBe(mediaFace.registration)
    expect(registry.get('nonexistent.face')).toBeNull()
    expect(new Set(registry.registeredFaceIds())).toEqual(new Set(['test.document-face', 'test.media-face']))
  })

  it('a duplicate faceId registration throws — the catalog is closed, bootstrap-only', () => {
    const { registry, documentFace } = buildTestRegistry()
    const collider: FaceRegistration = {
      faceId: documentFace.registration.faceId,
      persistence: 'stamp',
      resourceAdapterId: 'test.unused-adapter',
      accepts: () => true,
      paramsSchema: noFaceParams,
      mount: () => {
        throw new Error('unreachable')
      },
    }
    expect(() => registry.register(collider)).toThrow(DuplicateFaceRegistrationError)
    // The original registration is untouched by the failed attempt.
    expect(registry.get('test.document-face')).toBe(documentFace.registration)
  })
})

describe('FaceRegistry.seal — the catalog is closed for the WHOLE application lifecycle, not just per-call', () => {
  it('register() succeeds before seal(), throws RegistrySealedError after', () => {
    const registry = new FaceRegistry()
    const face: FaceRegistration = {
      faceId: 'seal.before',
      persistence: 'stamp',
      resourceAdapterId: 'test.unused-adapter',
      accepts: () => true,
      paramsSchema: noFaceParams,
      mount: () => {
        throw new Error('unreachable')
      },
    }
    registry.register(face)
    expect(registry.sealed()).toBe(false)
    registry.seal()
    expect(registry.sealed()).toBe(true)

    const late: FaceRegistration = {
      faceId: 'seal.after',
      persistence: 'stamp',
      resourceAdapterId: 'test.unused-adapter',
      accepts: () => true,
      paramsSchema: noFaceParams,
      mount: () => {
        throw new Error('unreachable')
      },
    }
    expect(() => registry.register(late)).toThrow(RegistrySealedError)
    // The already-registered face, and validate()/get() against it, are unaffected.
    expect(registry.get('seal.before')).toBe(face)
    expect(registry.has('seal.after')).toBe(false)
  })

  it('seal() is idempotent', () => {
    const registry = new FaceRegistry()
    registry.seal()
    expect(() => registry.seal()).not.toThrow()
    expect(registry.sealed()).toBe(true)
  })
})

// F5 (repair round 3, faces-mvp review): `sealedOpenFaceParamsSchema` is
// removed from the public `@shrubbery/runtime/layout` barrel — this is the
// SECOND, independent gate: even a caller who imports it via its
// explicitly-internal path still cannot silently register an open-params
// face on an ordinary `new FaceRegistry()`.
describe('FaceRegistry — F5: open-params escape-hatch quarantine', () => {
  function openParamsFace(faceId: string): FaceRegistration {
    return {
      faceId,
      persistence: 'stamp',
      resourceAdapterId: 'test.unused-adapter',
      accepts: () => true,
      paramsSchema: sealedOpenFaceParamsSchema(`test: ${faceId} genuinely needs open params`),
      mount: () => {
        throw new Error('unreachable')
      },
    }
  }

  it('isSealedOpenFaceParamsSchema distinguishes the open schema from genuinely closed ones', () => {
    expect(isSealedOpenFaceParamsSchema(noFaceParams)).toBe(false)
    expect(isSealedOpenFaceParamsSchema(closedParamsSchema({ maxRows: { type: 'number', optional: true } }))).toBe(false)
    expect(isSealedOpenFaceParamsSchema(sealedOpenFaceParamsSchema('test: distinguishing check'))).toBe(true)
  })

  it('a registry constructed with NO allowlist rejects an open-params registration by default', () => {
    const registry = new FaceRegistry()
    const face = openParamsFace('open.unallowlisted')
    expect(() => registry.register(face)).toThrow(UnallowlistedOpenFaceParamsError)
    expect(registry.has('open.unallowlisted')).toBe(false)
  })

  it('a registry constructed with the faceId explicitly allowlisted accepts it', () => {
    const registry = new FaceRegistry({ allowOpenParamsFaceIds: ['open.allowlisted'] })
    const face = openParamsFace('open.allowlisted')
    expect(() => registry.register(face)).not.toThrow()
    expect(registry.has('open.allowlisted')).toBe(true)
  })

  it('allowlisting one faceId does NOT allowlist a different open-params faceId on the same registry', () => {
    const registry = new FaceRegistry({ allowOpenParamsFaceIds: ['open.allowlisted'] })
    registry.register(openParamsFace('open.allowlisted'))
    const other = openParamsFace('open.not-allowlisted')
    expect(() => registry.register(other)).toThrow(UnallowlistedOpenFaceParamsError)
  })

  it('an ordinary closed-params face registers normally regardless of the allowlist', () => {
    const registry = new FaceRegistry() // no allowlist at all
    const face: FaceRegistration = {
      faceId: 'closed.ordinary',
      persistence: 'stamp',
      resourceAdapterId: 'test.unused-adapter',
      accepts: () => true,
      paramsSchema: noFaceParams,
      mount: () => {
        throw new Error('unreachable')
      },
    }
    expect(() => registry.register(face)).not.toThrow()
  })
})

describe('FaceRegistry.validate — closed params actually enforced (LAY-004)', () => {
  it('accepts a well-shaped descriptor whose params satisfy the face-owned exact schema', () => {
    const { registry } = buildTestRegistry()
    const verdict = registry.validate({
      schemaVersion: 1,
      faceId: 'test.document-face',
      resource: { kind: 'document', graphId: 'g1', documentId: 'd1' },
      params: { mode: 'document' },
    })
    expect(verdict.ok).toBe(true)
    if (verdict.ok) expect(verdict.registration.faceId).toBe('test.document-face')
  })

  it('rejects params carrying an unknown/extra key — not silently ignored', () => {
    const { registry } = buildTestRegistry()
    const verdict = registry.validate({
      ...documentDescriptor('d1'),
      params: { mode: 'document', arbitraryUnknownKey: 1 },
    })
    expect(verdict).toEqual({ ok: false, reason: 'invalid-params' })
  })

  it('rejects a params value of the wrong type for a declared field', () => {
    const { registry } = buildTestRegistry()
    const verdict = registry.validate({
      ...documentDescriptor('d1'),
      params: { mode: 'not-a-legal-enum-value' },
    })
    expect(verdict).toEqual({ ok: false, reason: 'invalid-params' })
  })

  it('a zero-field exact schema (noFaceParams) rejects ANY params object, even an empty one', () => {
    const registry = new FaceRegistry()
    registry.register({
      faceId: 'strict.no-params',
      persistence: 'stamp',
      resourceAdapterId: 'test.unused-adapter',
      accepts: () => true,
      paramsSchema: noFaceParams,
      mount: () => {
        throw new Error('unreachable')
      },
    })
    const withEmptyParams = registry.validate({
      schemaVersion: 1,
      faceId: 'strict.no-params',
      resource: { kind: 'iri', iri: 'urn:test:x' },
      params: {},
    })
    expect(withEmptyParams).toEqual({ ok: false, reason: 'invalid-params' })
    const withoutParams = registry.validate({
      schemaVersion: 1,
      faceId: 'strict.no-params',
      resource: { kind: 'iri', iri: 'urn:test:x' },
    })
    expect(withoutParams.ok).toBe(true)
  })
})

describe('FaceRegistry.validate — the accepts(resource) guard is a real second gate', () => {
  it('rejects a descriptor whose faceId+params are fine but whose resource kind the face does not accept', () => {
    const { registry } = buildTestRegistry()
    // test.document-face only accepts { kind: 'document' } locators.
    const verdict = registry.validate({
      schemaVersion: 1,
      faceId: 'test.document-face',
      resource: { kind: 'iri', iri: 'urn:test:sneaky' },
    })
    expect(verdict).toEqual({ ok: false, reason: 'resource-rejected' })
  })

  it('the media face symmetrically rejects a document-shaped resource', () => {
    const { registry } = buildTestRegistry()
    const verdict = registry.validate({
      schemaVersion: 1,
      faceId: 'test.media-face',
      resource: { kind: 'document', graphId: 'g1', documentId: 'd1' },
    })
    expect(verdict).toEqual({ ok: false, reason: 'resource-rejected' })
  })

  it('registry.accepts(faceId, locator) is a direct passthrough to the same guard', () => {
    const { registry } = buildTestRegistry()
    expect(registry.accepts('test.document-face', { kind: 'document', graphId: 'g1', documentId: 'd1' })).toBe(true)
    expect(registry.accepts('test.document-face', { kind: 'iri', iri: 'urn:test:x' })).toBe(false)
    expect(registry.accepts('nonexistent.face', { kind: 'iri', iri: 'urn:test:x' })).toBe(false)
  })
})

describe('FaceRegistry.validate — other rejection reasons', () => {
  it('rejects a value that is not a well-shaped ViewDescriptor at all', () => {
    const { registry } = buildTestRegistry()
    expect(registry.validate(null)).toEqual({ ok: false, reason: 'not-well-shaped' })
    expect(registry.validate({ faceId: 'test.document-face' })).toEqual({ ok: false, reason: 'not-well-shaped' })
    expect(registry.validate('a string, not a descriptor')).toEqual({ ok: false, reason: 'not-well-shaped' })
  })

  it('rejects an unregistered faceId even when the descriptor is otherwise well-shaped', () => {
    const { registry } = buildTestRegistry()
    const verdict = registry.validate({
      schemaVersion: 1,
      faceId: 'nobody.registered.this',
      resource: { kind: 'iri', iri: 'urn:test:x' },
    })
    expect(verdict).toEqual({ ok: false, reason: 'unregistered-face' })
  })
})

describe('FaceRegistry.toFaceRegistrationPredicate — real interop with Phase-1 validateLayoutDocument', () => {
  it('a document built only from registered faces validates against Phase 1 through the registry predicate', () => {
    const { registry } = buildTestRegistry()
    const doc = freshDocument('root', { root: leafNode('root', documentDescriptor('d1')) })
    const verdict = validateLayoutDocument(doc, { isFaceRegistered: registry.toFaceRegistrationPredicate() })
    expect(verdict.ok).toBe(true)
  })

  it('a leaf naming an unregistered face fails Phase-1 validation through the SAME predicate', () => {
    const { registry } = buildTestRegistry()
    const doc = freshDocument('root', {
      root: leafNode('root', {
        schemaVersion: 1,
        faceId: 'never.registered',
        resource: { kind: 'iri', iri: 'urn:test:x' },
      }),
    })
    const verdict = validateLayoutDocument(doc, { isFaceRegistered: registry.toFaceRegistrationPredicate() })
    expect(verdict.ok).toBe(false)
  })

  it('a leaf whose faceId is registered but resource is rejected by accepts() ALSO fails Phase-1 validation', () => {
    const { registry } = buildTestRegistry()
    // faceId is registered, params are fine, but the resource kind mismatches (document face over an iri).
    const doc = freshDocument('root', {
      root: leafNode('root', {
        schemaVersion: 1,
        faceId: 'test.document-face',
        resource: { kind: 'iri', iri: 'urn:test:sneaky' },
      }),
    })
    const verdict = validateLayoutDocument(doc, { isFaceRegistered: registry.toFaceRegistrationPredicate() })
    expect(verdict.ok).toBe(false)
  })

  it('two genuinely different registered faces both validate in the same document', () => {
    const { registry } = buildTestRegistry()
    const doc = freshDocument('split', {
      split: {
        kind: 'split',
        id: 'split',
        axis: 'horizontal',
        startNodeId: 'a',
        endNodeId: 'b',
        startBasisPoints: 5000,
      },
      a: leafNode('a', documentDescriptor('d1')),
      b: leafNode('b', mediaDescriptor('urn:test:blob-1')),
    })
    const verdict = validateLayoutDocument(doc, { isFaceRegistered: registry.toFaceRegistrationPredicate() })
    expect(verdict.ok).toBe(true)
  })
})

// createExactParamsSchema is exercised indirectly through the fixtures'
// document face above; this suite proves the reused Phase-1 primitive itself
// still behaves the way this module depends on (defense against a future
// nucleus regression silently loosening LAY-004 out from under this file).
describe('createExactParamsSchema — the reused Phase-1 primitive this module depends on', () => {
  it('rejects any key outside the declared field set', () => {
    const schema = createExactParamsSchema({ maxRows: { type: 'number', optional: true } })
    expect(schema({ maxRows: 10 })).toBe(true)
    expect(schema({ maxRows: 10, other: 'nope' })).toBe(false)
  })
})

// Diff-review SUSPECT: "closure is convention, not enforced by the contract"
// — `FaceRegistration.paramsSchema` is now a BRANDED `ClosedFaceParamsSchema`,
// constructible only through these three functions. This suite proves the
// wrappers behave identically to the Phase-1 primitives they wrap (the brand
// is compile-time-only — it adds no runtime behavior of its own to verify
// beyond "still callable, still closed"). The actual type-level guarantee (a
// bare `(params) => true` arrow does NOT satisfy `FaceRegistration.
// paramsSchema`) is enforced by `tsc --noEmit`, not by a runtime assertion —
// see this package's `typecheck` script.
describe('closedParamsSchema / noFaceParams / sealedOpenFaceParamsSchema — the P2 branded wrappers', () => {
  it('closedParamsSchema behaves exactly like the Phase-1 primitive it wraps', () => {
    const schema = closedParamsSchema({ maxRows: { type: 'number', optional: true } })
    expect(schema({ maxRows: 10 })).toBe(true)
    expect(schema({ maxRows: 10, other: 'nope' })).toBe(false)
  })

  it('noFaceParams accepts only an entirely absent params field', () => {
    expect(noFaceParams(undefined)).toBe(true)
    expect(noFaceParams({})).toBe(false)
  })

  it('sealedOpenFaceParamsSchema requires a justification string and then accepts any closed params', () => {
    const schema = sealedOpenFaceParamsSchema('test: genuinely open-ended face')
    expect(schema({ anything: 1, goes: 'here' })).toBe(true)
    expect(schema(undefined)).toBe(true)
  })

  // diff-review r2 SUSPECT: "closed params actually enforced" — the branded
  // open factory previously accepted ANY string, including an empty one,
  // with no observable effect from the justification at all.
  it('sealedOpenFaceParamsSchema REJECTS an empty or whitespace-only justification', () => {
    expect(() => sealedOpenFaceParamsSchema('')).toThrow(/non-empty justification/i)
    expect(() => sealedOpenFaceParamsSchema('   ')).toThrow(/non-empty justification/i)
    expect(() => sealedOpenFaceParamsSchema('\n\t')).toThrow(/non-empty justification/i)
  })

  it('every successful call is retained for a real audit pass via listSealedOpenFaceParamsUsages()', () => {
    const before = listSealedOpenFaceParamsUsages().length
    sealedOpenFaceParamsSchema('test: audit-trail proof, call one')
    sealedOpenFaceParamsSchema('test: audit-trail proof, call two')
    const usages = listSealedOpenFaceParamsUsages()
    expect(usages.length).toBe(before + 2)
    expect(usages.slice(-2).map((u) => u.justification)).toEqual([
      'test: audit-trail proof, call one',
      'test: audit-trail proof, call two',
    ])
    // A rejected (empty-justification) call must NOT be recorded.
    expect(() => sealedOpenFaceParamsSchema('')).toThrow()
    expect(listSealedOpenFaceParamsUsages().length).toBe(before + 2)
  })
})
