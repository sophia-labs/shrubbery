import { describe, expect, it } from 'vitest'
import type { ResourceLocator } from '@shrubbery/nucleus/layout'
import { FaceRegistry } from '../face-registry.js'
import { LayoutResourceBroker } from '../resource-broker.js'
import { LayoutSurfaceController, type SurfaceRatioChange } from '../surface-host.js'
import {
  noFaceParams,
  type DurableResourceAdapter,
  type FaceRegistration,
} from '../types.js'
import {
  buildTestBroker,
  buildTestRegistry,
  documentDescriptor,
  freshDocument,
  leafNode,
  mediaDescriptor,
  splitNode,
} from './fixtures.js'

function deferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T | PromiseLike<T>) => void
} {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe('LayoutSurfaceController lifecycle', () => {
  it('waits for an in-flight face mount before disposing the interpreter', async () => {
    const registry = new FaceRegistry()
    const broker = new LayoutResourceBroker()
    const loadStarted = deferred<void>()
    const loadResult = deferred<{ readonly id: string }>()
    let mounted = 0
    let disposed = 0
    let resourceDisposed = 0

    const adapter: DurableResourceAdapter<{ readonly id: string }> = {
      adapterId: 'test.deferred-surface-resource',
      shape: 'durable',
      accepts: (locator) => locator.kind === 'iri',
      resourceKey: (locator: ResourceLocator) => {
        if (locator.kind !== 'iri') throw new Error('expected an IRI locator')
        return locator.iri
      },
      load: async () => {
        loadStarted.resolve()
        return loadResult.promise
      },
      dispose: () => {
        resourceDisposed += 1
      },
    }
    const face: FaceRegistration = {
      faceId: 'test.deferred-surface-face',
      persistence: 'persistent-relocatable',
      resourceAdapterId: adapter.adapterId,
      accepts: (locator) => locator.kind === 'iri',
      paramsSchema: noFaceParams,
      constraints: () => ({ minWidth: 1, minHeight: 1, overflow: 'clip' }),
      mount: ({ target, descriptor }) => {
        mounted += 1
        const content = document.createElement('button')
        target.appendChild(content)
        return {
          focus: () => true,
          blur: () => {},
          resize: () => {},
          serialize: () => descriptor,
          dispose: () => {
            disposed += 1
            content.remove()
          },
        }
      },
    }
    broker.registerAdapter(adapter)
    registry.register(face)
    registry.seal()

    const host = document.createElement('div')
    document.body.appendChild(host)
    const controller = new LayoutSurfaceController(host, { registry, broker })
    controller.setSize(800, 600)
    controller.setDocument(freshDocument('leaf', {
      leaf: leafNode('leaf', {
        schemaVersion: 1,
        faceId: face.faceId,
        resource: { kind: 'iri', iri: 'urn:test:deferred-surface' },
      }),
    }))

    await loadStarted.promise
    const disposal = controller.dispose()
    loadResult.resolve({ id: 'resource' })
    await disposal
    await broker.settled()

    expect(mounted).toBe(1)
    expect(disposed).toBe(1)
    expect(resourceDisposed).toBe(1)
    expect(broker.diagnostics().outstandingLeases).toBe(0)
    expect(host.childElementCount).toBe(0)
    host.remove()
  })

  it('restores separator focus by split id after an unrelated reconcile', async () => {
    const { registry } = buildTestRegistry()
    const { broker } = buildTestBroker()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const controller = new LayoutSurfaceController(host, { registry, broker })
    const layout = freshDocument('split', {
      split: splitNode('split', 'horizontal', 'document', 'media'),
      document: leafNode('document', documentDescriptor('doc-a')),
      media: leafNode('media', mediaDescriptor('urn:test:media')),
    })

    try {
      controller.setSize(1001, 600)
      controller.setDocument(layout)
      await controller.whenReady()
      const before = controller.dividerOverlay.querySelector<HTMLElement>('[data-layout-divider="split"]')!
      before.focus()
      expect(document.activeElement).toBe(before)

      controller.setDocument(layout)
      await controller.whenReady()
      const after = controller.dividerOverlay.querySelector<HTMLElement>('[data-layout-divider="split"]')!
      expect(after).not.toBe(before)
      expect(document.activeElement).toBe(after)
    } finally {
      await controller.dispose()
      await broker.settled()
      host.remove()
    }
  })
})

describe('constrained separator allocation', () => {
  it.each(['horizontal', 'vertical'] as const)('uses actual %s and nested opposite-axis boundaries without rewriting authored ratios', async axis => {
    const { registry } = buildTestRegistry(), { broker } = buildTestBroker()
    const host = document.createElement('div'); document.body.append(host)
    const controller = new LayoutSurfaceController(host, { registry, broker, dividerThickness: 1 })
    const innerAxis = axis === 'horizontal' ? 'vertical' : 'horizontal'
    const layout = freshDocument('outer', {
      outer: splitNode('outer', axis, 'first', 'inner', 9500),
      inner: splitNode('inner', innerAxis, 'second', 'third', 9500),
      first: leafNode('first', documentDescriptor('first')),
      second: leafNode('second', documentDescriptor('second')),
      third: leafNode('third', documentDescriptor('third')),
    })
    try {
      controller.setSize(601, 401); controller.setDocument(layout); await controller.whenReady()
      const plan = controller.currentInterpreter().currentPlan()!.root
      if (plan.kind !== 'split' || plan.end.kind !== 'split') throw new Error('Expected nested splits')
      for (const solved of [plan, plan.end]) {
        const handle = controller.dividerOverlay.querySelector<HTMLElement>(`[data-layout-divider="${solved.id}"]`)!
        const expected = solved.axis === 'horizontal'
          ? (solved.start.allocation.x + solved.start.allocation.width + solved.end.allocation.x) / 2
          : (solved.start.allocation.y + solved.start.allocation.height + solved.end.allocation.y) / 2
        const authored = solved.axis === 'horizontal' ? solved.allocation.x + solved.allocation.width * .95 : solved.allocation.y + solved.allocation.height * .95
        expect(Math.abs(expected - authored)).toBeGreaterThan(10)
        expect(Number.parseFloat(solved.axis === 'horizontal' ? handle.style.left : handle.style.top) + 6).toBeCloseTo(expected, 6)
        expect(handle.getAttribute('aria-valuenow')).toBe('95')
      }
      expect(controller.currentDocument()).toBe(layout)
    } finally { await controller.dispose(); await broker.settled(); host.remove() }
  })

  it('retains keyboard focus, authored operation/drag semantics and mounted content after geometry correction', async () => {
    const { registry, documentFace } = buildTestRegistry(), { broker } = buildTestBroker()
    const host = document.createElement('div'); document.body.append(host)
    const changes: SurfaceRatioChange[] = []
    const controller = new LayoutSurfaceController(host, { registry, broker, dividerThickness: 1, onRatioChange: change => changes.push(change) })
    const layout = freshDocument('split', { split: splitNode('split', 'horizontal', 'left', 'right', 9500),
      left: leafNode('left', documentDescriptor('left')), right: leafNode('right', documentDescriptor('right')) })
    const handle = () => controller.dividerOverlay.querySelector<HTMLElement>('[data-layout-divider="split"]')!
    try {
      controller.setSize(601, 401); controller.setDocument(layout); await controller.whenReady()
      const content = [...documentFace.mounts].map(mount => mount.element)
      handle().focus(); handle().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
      await controller.whenReady()
      expect(document.activeElement).toBe(handle())
      expect(changes.at(-1)).toMatchObject({ source: 'keyboard', phase: 'commit', operation: { op: 'set_ratio', splitId: 'split', startBasisPoints: 9400 } })
      handle().dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 400, bubbles: true }))
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 300, bubbles: true }))
      window.dispatchEvent(new MouseEvent('pointerup', { clientX: 300, bubbles: true }))
      await controller.whenReady()
      expect(changes.slice(-2).map(change => [change.source, change.phase, change.operation.startBasisPoints])).toEqual([
        ['pointer', 'input', Math.round(300 / 601 * 10000)], ['pointer', 'commit', Math.round(300 / 601 * 10000)],
      ])
      const count = changes.length
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 400, bubbles: true }))
      expect(changes).toHaveLength(count)
      expect(documentFace.mounts.map(mount => mount.element)).toEqual(content)
      expect(documentFace.mounts.every(mount => !mount.disposed && mount.element.isConnected)).toBe(true)
    } finally { await controller.dispose(); await broker.settled(); host.remove() }
    expect(broker.diagnostics().outstandingLeases).toBe(0)
  })
})
