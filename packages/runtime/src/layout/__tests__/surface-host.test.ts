import { describe, expect, it } from 'vitest'
import type { ResourceLocator } from '@shrubbery/nucleus/layout'
import { FaceRegistry } from '../face-registry.js'
import { LayoutResourceBroker } from '../resource-broker.js'
import { LayoutSurfaceController } from '../surface-host.js'
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
