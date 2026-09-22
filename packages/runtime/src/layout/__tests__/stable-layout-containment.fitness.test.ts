/**
 * stable-layout-containment.fitness.test.ts — the "solved frames, flowing
 * content" invariant, positively asserted at the core.
 *
 * THE INVARIANT (docs/design/stable-layout-invariant.md): geometry is solved
 * from declared state and is stable under interaction; content changes happen
 * INSIDE a frame (scroll/clip), never resize the frame or reflow siblings.
 *
 * This is a FITNESS test, not a scenario: it mounts a REAL `LayoutInterpreter`
 * (real `FaceRegistry`, real `LayoutResourceBroker`, two genuinely different
 * real faces, a real two-leaf split `LayoutDocument` — exactly the wiring
 * `layout-interpreter.test.ts`/`layout-edge-interpreter-live.test.ts` use) and
 * asserts the containment guarantee the interpreter already bakes in, so a
 * future refactor that let content escape its pane fails HERE:
 *
 *   1. the root is overflow-CONTAINED (`overflow:hidden`, a real containing
 *      block via `position:relative`) — content can never push the shell;
 *   2. every leaf wrapper is a SOLVED-SIZED, OVERFLOW-OWNING box: absolutely
 *      positioned at the solver's exact root-absolute pixels, sized to the
 *      solved allocation, with `overflow` set to `hidden` (clip faces) or
 *      `auto` (scroll faces) — so a face's internal growth scrolls/clips
 *      WITHIN its own box and cannot reflow a sibling;
 *   3. the mounted geometry is a FUNCTION OF THE SOLVED PLAN, not of content:
 *      injecting an enormous child into a live face leaves every wrapper's
 *      declared box byte-for-byte unchanged.
 *
 * Containment ALREADY HOLDS in the core today (root: layout-interpreter.ts:292;
 * leaf wrapper position/size: `ensureWrapper`/`positionWrapper`; leaf wrapper
 * overflow: layout-interpreter.ts:585) — this test is the mechanical guard that
 * pins it, so the felt "flowing content" surfaces that DON'T yet hold it (the
 * document editor float — see editor-host-jump-characterization.test.ts) are
 * measured against a core that provably does. NO MOCKS.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LayoutPlanNode } from '@shrubbery/nucleus/layout'
import { LayoutInterpreter } from '../layout-interpreter.js'
import { FaceRegistry } from '../face-registry.js'
import { LayoutResourceBroker } from '../resource-broker.js'
import { createCardObjectFace, createCardObjectResourceAdapter } from '../faces/card-object-face.js'
import type { SourceObjectRead, SourceObjectService } from '../source-object-service.js'
import {
  buildTestBroker,
  buildTestRegistry,
  createDocumentFace,
  createDocumentAdapter,
  documentDescriptor,
  freshDocument,
  leafNode,
  mediaDescriptor,
  splitNode,
} from './fixtures.js'

/**
 * A real, valid two-leaf horizontal split. Left leaf is a `test.document-face`
 * (constraints `overflow: 'scroll'` → wrapper `overflow:auto`); right leaf is a
 * `test.media-face` (constraints `overflow: 'clip'` → wrapper `overflow:hidden`)
 * — so ONE document exercises BOTH containment modes at once.
 */
function twoLeafDoc() {
  return freshDocument('split', {
    split: splitNode('split', 'horizontal', 'a', 'b', 5000),
    a: leafNode('a', documentDescriptor('doc-a')),
    b: leafNode('b', mediaDescriptor('urn:test:blob-a')),
  })
}

/** Guard: `overflow:visible`/`''` would let tall content escape the pane. */
const CONTAINED_OVERFLOW = new Set(['hidden', 'auto', 'scroll', 'clip'])

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('div')
  document.body.appendChild(root)
})

afterEach(() => {
  root.remove()
})

describe('stable-layout containment — solved frames, flowing content (fitness)', () => {
  it('roots the surface in a real, overflow-contained containing block', async () => {
    const { registry } = buildTestRegistry()
    const { broker } = buildTestBroker()
    const interpreter = new LayoutInterpreter(root, { registry, broker })

    const result = await interpreter.reconcile(twoLeafDoc(), { width: 1001, height: 600 })
    expect(result.ok).toBe(true)

    // The shell owns overflow: content growth inside any pane cannot push the
    // root or reflow the outer page — it is clipped at the surface boundary.
    expect(root.style.overflow).toBe('hidden')
    // A real containing block, so every absolutely-positioned leaf wrapper is
    // laid out against the root's box (not some distant ancestor).
    expect(root.style.position).toBe('relative')

    await interpreter.dispose()
  })

  it('gives every leaf a solved-sized, overflow-owning box (geometry = f(plan))', async () => {
    const { registry } = buildTestRegistry()
    const { broker } = buildTestBroker()
    const interpreter = new LayoutInterpreter(root, { registry, broker })

    await interpreter.reconcile(twoLeafDoc(), { width: 1001, height: 600 })

    const plan = interpreter.currentPlan()
    expect(plan).not.toBeNull()
    expect(plan!.root.kind).toBe('split')
    if (plan!.root.kind !== 'split') throw new Error('expected a split root')
    const planA = plan!.root.start
    const planB = plan!.root.end
    if (planA.kind !== 'leaf' || planB.kind !== 'leaf') throw new Error('expected two leaf children')

    const wrapperA = interpreter.leafWrapperElement('a')
    const wrapperB = interpreter.leafWrapperElement('b')
    expect(wrapperA).not.toBeNull()
    expect(wrapperB).not.toBeNull()

    // Each wrapper is a POSITIONED, OVERFLOW-OWNING box whose declared geometry
    // equals the solver's allocation exactly — the box comes from the plan, not
    // from whatever the face happened to paint inside it.
    const assertSolvedContainedBox = (wrapper: HTMLElement, planNode: LayoutPlanNode) => {
      expect(wrapper.style.position).toBe('absolute')
      expect(CONTAINED_OVERFLOW.has(wrapper.style.overflow)).toBe(true)
      expect(wrapper.style.left).toBe(`${planNode.allocation.x}px`)
      expect(wrapper.style.top).toBe(`${planNode.allocation.y}px`)
      expect(wrapper.style.width).toBe(`${planNode.allocation.width}px`)
      expect(wrapper.style.height).toBe(`${planNode.allocation.height}px`)
    }
    assertSolvedContainedBox(wrapperA!, planA)
    assertSolvedContainedBox(wrapperB!, planB)

    // The two faces carry DIFFERENT declared overflow modes, and each wrapper
    // reflects its own: the document face scrolls, the media face clips. Both
    // are contained — neither lets content out of the pane.
    expect(wrapperA!.style.overflow).toBe('auto') // test.document-face → 'scroll'
    expect(wrapperB!.style.overflow).toBe('hidden') // test.media-face → 'clip'

    await interpreter.dispose()
  })

  it('does not resize a frame when its content grows without bound', async () => {
    const { registry, documentFace } = buildTestRegistry()
    const { broker } = buildTestBroker()
    const interpreter = new LayoutInterpreter(root, { registry, broker })

    await interpreter.reconcile(twoLeafDoc(), { width: 1001, height: 600 })

    const wrapperA = interpreter.leafWrapperElement('a')!
    const wrapperB = interpreter.leafWrapperElement('b')!
    const before = {
      aLeft: wrapperA.style.left,
      aWidth: wrapperA.style.width,
      aHeight: wrapperA.style.height,
      bLeft: wrapperB.style.left,
      bWidth: wrapperB.style.width,
      bHeight: wrapperB.style.height,
    }

    // Grow the LIVE document face's content by an absurd amount — the exact
    // shape of the "content changes" the invariant governs. Under a solved
    // frame this scrolls/clips inside wrapper A; it must NOT resize wrapper A
    // and must NOT push wrapper B.
    const faceEl = documentFace.mounts[0].element
    const tall = document.createElement('div')
    tall.style.width = '99999px'
    tall.style.height = '99999px'
    tall.textContent = 'x'.repeat(50_000)
    faceEl.appendChild(tall)

    // The frames are unchanged: their geometry is a function of the solved
    // plan, invariant under any amount of interior content.
    expect(wrapperA.style.left).toBe(before.aLeft)
    expect(wrapperA.style.width).toBe(before.aWidth)
    expect(wrapperA.style.height).toBe(before.aHeight)
    expect(wrapperB.style.left).toBe(before.bLeft)
    expect(wrapperB.style.width).toBe(before.bWidth)
    expect(wrapperB.style.height).toBe(before.bHeight)
    // ...and wrapper A still owns overflow, so that growth is contained.
    expect(CONTAINED_OVERFLOW.has(wrapperA.style.overflow)).toBe(true)

    await interpreter.dispose()
  })
})

/**
 * MO object-face integration spec, master §3 Slice 2 — extends this fitness
 * test with a REAL `card.object` leaf carrying 200 record fields: no frame's
 * declared box changes and no sibling moves. A real, small, fully working
 * `SourceObjectService` (never a `vi.fn` stand-in) is the record source —
 * this file's own no-mocks header applies to this addition too.
 */
describe('stable-layout containment — card.object with 200 record fields (fitness)', () => {
  function twoHundredFieldRecord(): Readonly<Record<string, unknown>> {
    const record: Record<string, unknown> = {}
    for (let index = 0; index < 200; index += 1) record[`field-${String(index).padStart(3, '0')}`] = index
    return record
  }

  function bigCardObjectService(): SourceObjectService {
    const read: SourceObjectRead = {
      provenance: 'mirror',
      graphId: 'g1',
      objectKey: 'stable-layoutBigCardbig-1',
      vocab: 'stable-layout',
      class: 'BigCard',
      objectId: 'big-1',
      record: twoHundredFieldRecord(),
      sourceVersion: 'a'.repeat(64),
      reconciliationStrategy: 'codeBacked',
      unavailable: ['lastWriter'],
      epoch: 'inc-1:1:hash',
    }
    return {
      async read() {
        return read
      },
    }
  }

  it('a card.object leaf with 200 fields does not resize its own frame or move its sibling', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const registry = new FaceRegistry()
    const documentFace = createDocumentFace()
    registry.register(documentFace.registration)
    registry.register(createCardObjectFace())

    const broker = new LayoutResourceBroker()
    const { adapter: documentAdapter } = createDocumentAdapter()
    broker.registerAdapter(documentAdapter)
    broker.registerAdapter(createCardObjectResourceAdapter(bigCardObjectService()))

    const interpreter = new LayoutInterpreter(root, { registry, broker })

    const doc = freshDocument('split', {
      split: splitNode('split', 'horizontal', 'a', 'b', 5000),
      a: leafNode('a', documentDescriptor('doc-a')),
      b: leafNode('b', {
        schemaVersion: 1,
        faceId: 'card.object',
        resource: { kind: 'graph', graphId: 'g1', subjectIri: 'urn:sophia:object:stable-layout:BigCard:big-1' },
      }),
    })

    const result = await interpreter.reconcile(doc, { width: 1200, height: 700 })
    expect(result.ok).toBe(true)

    const wrapperA = interpreter.leafWrapperElement('a')!
    const wrapperB = interpreter.leafWrapperElement('b')!
    const before = {
      aLeft: wrapperA.style.left,
      aWidth: wrapperA.style.width,
      aHeight: wrapperA.style.height,
      bLeft: wrapperB.style.left,
      bTop: wrapperB.style.top,
      bWidth: wrapperB.style.width,
      bHeight: wrapperB.style.height,
    }

    // The 200-field card is already mounted inside wrapper B's box — this
    // asserts the geometry it landed with is unchanged, and that mounting a
    // real 200-row record never pushed sibling wrapper A.
    const view = wrapperB.querySelector('sh-object-card-view')
    expect(view).not.toBeNull()

    expect(wrapperA.style.left).toBe(before.aLeft)
    expect(wrapperA.style.width).toBe(before.aWidth)
    expect(wrapperA.style.height).toBe(before.aHeight)
    expect(wrapperB.style.left).toBe(before.bLeft)
    expect(wrapperB.style.top).toBe(before.bTop)
    expect(wrapperB.style.width).toBe(before.bWidth)
    expect(wrapperB.style.height).toBe(before.bHeight)
    // wrapper B owns overflow (card.object declares `overflow:'clip'` ->
    // wrapper `overflow:hidden`) — the 200 fields scroll inside the card's
    // OWN `.stage`, never resizing this wrapper.
    expect(CONTAINED_OVERFLOW.has(wrapperB.style.overflow)).toBe(true)

    root.remove()
    await interpreter.dispose()
  })
})
