/**
 * seele-workbench-document.test.ts — W6.1's acceptance (1) and (2), plus
 * W6.8's boot-gate negative.
 *
 * NO MOCKS: the registry, the broker-facing face registrations, the nucleus
 * validator and the nucleus SOLVER are all the real production ones. The
 * registry is assembled EXACTLY the way `src/main.ts` assembles it — the same
 * three faces, sealed — because a literal validated against a test double of
 * the registry proves nothing about the app that actually boots.
 *
 * ACCEPTANCE (2) IS THE ONE THAT MATTERS. Rev 1 of the suite had the split
 * axis inverted, and a test that only asserted "the document validates" would
 * have passed anyway — a vertical split of two registered faces is a perfectly
 * valid document. So this file solves real geometry at a real viewport and
 * asserts the constitution's rect is LEFT OF the context pane's, with equal
 * heights and equal tops. That is the assertion Rev 1's criteria could not
 * have made, and it is the reason F0 is caught here rather than by a human
 * noticing the panes are stacked.
 */
import { describe, expect, it } from 'vitest'
import {
  createValidatedLayoutDocument,
  solveLayout,
  tokenizeId,
  type LayoutDocument,
  type LayoutPlanNode,
  type ViewportAllocation,
} from '@shrubbery/nucleus/layout'
import {
  FaceRegistry,
  createHojaDocumentFace,
  createSeeleContextFace,
  createSophiaHomeFace,
  SEELE_CONTEXT_FACE_ID,
} from '@shrubbery/runtime/layout'
import {
  buildSeeleWorkbenchDocument,
  CONSTITUTION_BASIS_POINTS,
  CONSTITUTION_LEAF_ID,
  SEELE_CONTEXT_LEAF_ID,
  SEELE_WORKBENCH_LAYOUT_ID,
  WORKBENCH_ROOT_NODE_ID,
} from '../src/seele-workbench-document.js'
import { assertEveryFaceRegistered, UnregisteredWorkbenchFaceError } from '../src/boot-gate.js'

const GRAPH_ID = 'seele-workbench-proof'
const DOCUMENT_ID = 'constitution'

/** The SEALED registry `src/main.ts` boots with — same three faces, same order, sealed. */
function bootRegistry(): FaceRegistry {
  const registry = new FaceRegistry()
  registry.register(createHojaDocumentFace())
  registry.register(createSeeleContextFace())
  registry.register(createSophiaHomeFace())
  registry.seal()
  return registry
}

function validate(candidate: LayoutDocument, registry: FaceRegistry) {
  return createValidatedLayoutDocument(candidate, {
    isFaceRegistered: registry.toFaceRegistrationPredicate(),
    isFaceGridEligible: registry.toFaceGridEligibilityPredicate(),
  })
}

/** Flatten a solved plan into `{id → allocation}` — the real pixel rects the interpreter would render. */
function leafRects(node: LayoutPlanNode, into: Record<string, ViewportAllocation> = {}): Record<string, ViewportAllocation> {
  if (node.kind === 'leaf') {
    if (node.allocation) into[node.id] = node.allocation
    return into
  }
  if (node.kind === 'split') {
    leafRects(node.start, into)
    leafRects(node.end, into)
  }
  return into
}

describe('W6.1 — the workbench layout literal', () => {
  it('validates against the SEALED production-shaped registry, seele.context included', () => {
    const registry = bootRegistry()
    const result = validate(buildSeeleWorkbenchDocument(GRAPH_ID, DOCUMENT_ID), registry)
    expect(result.ok).toBe(true)
  })

  it('is exactly two leaves — no chat leaf in this revision (D15)', () => {
    const doc = buildSeeleWorkbenchDocument(GRAPH_ID, DOCUMENT_ID)
    const ids = Object.keys(doc.nodes).sort()
    expect(ids).toEqual([CONSTITUTION_LEAF_ID, SEELE_CONTEXT_LEAF_ID, WORKBENCH_ROOT_NODE_ID].sort())
    const leaves = Object.values(doc.nodes).filter(node => node.kind === 'leaf')
    expect(leaves).toHaveLength(2)
    expect(doc.layoutId).toBe(SEELE_WORKBENCH_LAYOUT_ID)
    // No node anywhere names a chat face or carries a chat locator.
    expect(JSON.stringify(doc)).not.toMatch(/chat/i)
  })

  it('both leaves carry the SAME document locator, resolved through two DIFFERENT adapters', () => {
    const doc = buildSeeleWorkbenchDocument(GRAPH_ID, DOCUMENT_ID)
    const constitution = doc.nodes[CONSTITUTION_LEAF_ID]
    const context = doc.nodes[SEELE_CONTEXT_LEAF_ID]
    if (constitution?.kind !== 'leaf' || context?.kind !== 'leaf') throw new Error('expected two leaves')
    expect(constitution.descriptor.resource).toEqual({ kind: 'document', graphId: GRAPH_ID, documentId: DOCUMENT_ID })
    expect(context.descriptor.resource).toEqual({ kind: 'document', graphId: GRAPH_ID, documentId: DOCUMENT_ID })

    const registry = bootRegistry()
    const hoja = registry.get(constitution.descriptor.faceId)
    const seele = registry.get(context.descriptor.faceId)
    expect(hoja?.resourceAdapterId).toBe('hoja.document.room-pool')
    expect(seele?.resourceAdapterId).toBe('seele.context.compile')
    expect(hoja?.resourceAdapterId).not.toBe(seele?.resourceAdapterId)
  })

  it('stores an INTEGER basis-point ratio, never pixels', () => {
    const doc = buildSeeleWorkbenchDocument(GRAPH_ID, DOCUMENT_ID)
    const root = doc.nodes[WORKBENCH_ROOT_NODE_ID]
    if (root?.kind !== 'split') throw new Error('expected a split root')
    expect(Number.isInteger(root.startBasisPoints)).toBe(true)
    expect(root.startBasisPoints).toBe(CONSTITUTION_BASIS_POINTS)
    expect(root.startBasisPoints).toBeGreaterThanOrEqual(1)
    expect(root.startBasisPoints).toBeLessThanOrEqual(9999)
  })

  it('is deep-frozen — a caller cannot mutate the returned document', () => {
    const doc = buildSeeleWorkbenchDocument(GRAPH_ID, DOCUMENT_ID)
    expect(Object.isFrozen(doc)).toBe(true)
    expect(Object.isFrozen(doc.nodes)).toBe(true)
    expect(Object.isFrozen(doc.nodes[WORKBENCH_ROOT_NODE_ID])).toBe(true)
  })

  it('carries the contract name through seele.context’s CLOSED params schema', () => {
    const registry = bootRegistry()
    const doc = buildSeeleWorkbenchDocument(GRAPH_ID, DOCUMENT_ID, { contractName: 'koch-morse' })
    const context = doc.nodes[SEELE_CONTEXT_LEAF_ID]
    if (context?.kind !== 'leaf') throw new Error('expected a leaf')
    expect(context.descriptor.params).toEqual({ contractName: 'koch-morse' })
    expect(validate(doc, registry).ok).toBe(true)

    // The schema is CLOSED: an unlisted key is rejected, not ignored.
    const registration = registry.get(SEELE_CONTEXT_FACE_ID)
    expect(registration?.paramsSchema({ contractName: 'seele-core' })).toBe(true)
    expect(registration?.paramsSchema({ contractName: 'seele-core', arbitraryUnknownKey: 1 })).toBe(false)
    expect(registration?.paramsSchema({})).toBe(false)
  })

  it('seele.context REFUSES a non-document locator', () => {
    const registration = bootRegistry().get(SEELE_CONTEXT_FACE_ID)
    expect(registration?.accepts({ kind: 'document', graphId: 'g', documentId: 'd' })).toBe(true)
    expect(registration?.accepts({ kind: 'graph', graphId: 'g' })).toBe(false)
    expect(registration?.accepts({ kind: 'iri', iri: 'urn:sophia:home' })).toBe(false)
  })
})

describe('W6.1 acceptance (2) — GEOMETRY, not just validity (C15/F0)', () => {
  const VIEWPORT = { width: 1500, height: 900 }

  function solvedRects(doc: LayoutDocument, registry: FaceRegistry): Record<string, ViewportAllocation> {
    const solved = solveLayout(doc, {}, VIEWPORT.width, VIEWPORT.height, {
      isFaceRegistered: registry.toFaceRegistrationPredicate(),
      isFaceGridEligible: registry.toFaceGridEligibilityPredicate(),
    })
    if (!solved.ok) throw new Error(`solve failed: ${JSON.stringify(solved.diagnostics)}`)
    return leafRects(solved.plan.root)
  }

  it('puts the constitution LEFT of the seele.context pane, at equal height and equal top', () => {
    const registry = bootRegistry()
    const rects = solvedRects(
      validate(buildSeeleWorkbenchDocument(GRAPH_ID, DOCUMENT_ID), registry).ok
        ? buildSeeleWorkbenchDocument(GRAPH_ID, DOCUMENT_ID)
        : (() => {
            throw new Error('literal did not validate')
          })(),
      registry,
    )

    const constitution = rects[CONSTITUTION_LEAF_ID]
    const context = rects[SEELE_CONTEXT_LEAF_ID]
    expect(constitution).toBeTruthy()
    expect(context).toBeTruthy()

    // LEFT of: the whole point. An inverted axis fails here.
    expect(constitution!.x).toBeLessThan(context!.x)
    expect(constitution!.x + constitution!.width).toBeLessThanOrEqual(context!.x)

    // Side-by-side, not stacked: same top, same height.
    expect(constitution!.y).toBe(context!.y)
    expect(constitution!.height).toBe(context!.height)

    // And they fill the viewport height, so neither is a strip above the other.
    expect(constitution!.height).toBe(VIEWPORT.height)
  })

  it('honours the basis-point ratio in real pixels — the constitution is the wider pane', () => {
    const registry = bootRegistry()
    const rects = solvedRects(buildSeeleWorkbenchDocument(GRAPH_ID, DOCUMENT_ID), registry)
    const constitution = rects[CONSTITUTION_LEAF_ID]!
    const context = rects[SEELE_CONTEXT_LEAF_ID]!
    expect(constitution.width).toBeGreaterThan(context.width)
    // 5800bp of 1500px, minus the divider's share — within a pixel of the ratio.
    const ratio = constitution.width / (constitution.width + context.width)
    expect(Math.abs(ratio - CONSTITUTION_BASIS_POINTS / 10000)).toBeLessThan
      (0.01)
  })

  it('a VERTICAL root would stack them — the inverted-axis regression, asserted directly', () => {
    // Not a hypothetical: this is Rev 1's literal, and it validates fine. What
    // it does NOT do is put the panes side by side — which is why validity was
    // never a sufficient oracle here.
    const registry = bootRegistry()
    const correct = buildSeeleWorkbenchDocument(GRAPH_ID, DOCUMENT_ID)
    const inverted = JSON.parse(JSON.stringify(correct)) as LayoutDocument
    ;(inverted.nodes[WORKBENCH_ROOT_NODE_ID] as { axis: string }).axis = 'vertical'

    expect(validate(inverted, registry).ok).toBe(true) // valid, and wrong
    const rects = solvedRects(inverted, registry)
    expect(rects[CONSTITUTION_LEAF_ID]!.x).toBe(rects[SEELE_CONTEXT_LEAF_ID]!.x) // stacked
    expect(rects[CONSTITUTION_LEAF_ID]!.y).toBeLessThan(rects[SEELE_CONTEXT_LEAF_ID]!.y)
  })
})

describe('W6.8 — the registry/validation boot gate', () => {
  function withUnregisteredFace(): LayoutDocument {
    const broken = JSON.parse(JSON.stringify(buildSeeleWorkbenchDocument(GRAPH_ID, DOCUMENT_ID))) as LayoutDocument
    ;(broken.nodes[SEELE_CONTEXT_LEAF_ID] as { descriptor: { faceId: string } }).descriptor.faceId =
      'seele.context.not-registered'
    return broken
  }

  it('the VALIDATOR rejects it — but tokenizes the face id, so it cannot name the face', () => {
    // Recorded deliberately rather than worked around: nucleus tokenizes every
    // caller-chosen identifier before it reaches a diagnostic (defense in depth
    // against an id-shaped smuggling channel). Correlation is still possible —
    // `tokenizeId` is exported — but "one loud, NAMED failure" is not something
    // the validator alone can deliver. Hence `boot-gate.ts`.
    const registry = bootRegistry()
    const result = validate(withUnregisteredFace(), registry)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    const text = JSON.stringify(result.diagnostics)
    expect(text).toContain('LAY003_UNREGISTERED_FACE')
    expect(text).not.toContain('seele.context.not-registered')
    expect(text).toContain(tokenizeId('seele.context.not-registered'))
  })

  it('the APP’s boot gate fails first, and names the face and the sealed catalogue verbatim (W6.5)', () => {
    const registry = bootRegistry()
    let thrown: unknown = null
    try {
      assertEveryFaceRegistered(withUnregisteredFace(), registry)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(UnregisteredWorkbenchFaceError)
    const message = (thrown as Error).message
    expect(message).toContain('seele.context.not-registered')
    expect(message).toContain(SEELE_CONTEXT_LEAF_ID)
    expect(message).toContain(SEELE_CONTEXT_FACE_ID) // the sealed catalogue is listed
  })

  it('the real literal passes the boot gate, naming exactly the two faces it mounts', () => {
    const registry = bootRegistry()
    const faces = assertEveryFaceRegistered(buildSeeleWorkbenchDocument(GRAPH_ID, DOCUMENT_ID), registry)
    expect([...faces].sort()).toEqual(['hoja.document', SEELE_CONTEXT_FACE_ID].sort())
  })

  it('registering after seal() throws — the catalogue really is closed', () => {
    const registry = bootRegistry()
    expect(registry.sealed()).toBe(true)
    expect(() => registry.register(createSeeleContextFace())).toThrow()
  })
})
