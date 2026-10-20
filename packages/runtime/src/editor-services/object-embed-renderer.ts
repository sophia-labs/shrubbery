/**
 * The runtime face of the kernel's `objectEmbed` node (typed objects D8.3): an `<sh-injerto>` around
 * `<sh-object-view slot="card">`, reading the object live through the typed-object seam. The renderer owns its mount
 * and its dispose, as `makeQueryBlockRenderer` does: ProseMirror destroys and recreates node views freely, so each
 * mount reads, each update re-reads only when the object or its graph changed, and `destroy` drops any read still in
 * flight.
 *
 * The object lives in the embed's own graph (`attrs.graphId`), else the document's. When the graph holds no triple
 * about it, the frame says so honestly and shows the block's snapshot label.
 */

import type { ObjectEmbedRenderer, ObjectEmbedRenderRequest } from '@shrubbery/editor-kernel'
import type { ShInjerto } from '../object-view/injerto-element.js'
import '../object-view/injerto-element.js'
import { objectModelOfRead, type TypedObjectService } from '../object-view/typed-object-service.js'

export type TypedObjectServiceSource = TypedObjectService | (() => TypedObjectService | null)

function serviceOf(source: TypedObjectServiceSource): TypedObjectService | null {
  return typeof source === 'function' ? source() : source
}

export function makeObjectEmbedRenderer(source: TypedObjectServiceSource): ObjectEmbedRenderer {
  return (target, initial) => {
    const doc = target.ownerDocument
    const frame = doc.createElement('sh-injerto') as ShInjerto
    target.replaceChildren(frame)
    let generation = 0
    let readFor = ''

    const snapshot = (request: ObjectEmbedRenderRequest, graphId: string | null): void => {
      frame.iri = request.attrs.iri
      frame.graphId = graphId ?? ''
      frame.label = request.attrs.label
      frame.classLabel = request.attrs.classLabel
    }

    const read = (request: ObjectEmbedRenderRequest): void => {
      const graphId = request.attrs.graphId ?? request.graphId
      snapshot(request, graphId)
      const key = `${graphId ?? ''}\u0000${request.attrs.iri}`
      if (key === readFor) return
      readFor = key
      const mine = ++generation
      const service = serviceOf(source)
      if (!graphId || !request.attrs.iri) {
        frame.model = null
        frame.status = 'absent'
        return
      }
      if (!service) {
        frame.model = null
        frame.status = 'error'
        frame.error = 'this editor has no typed-object reader'
        return
      }
      frame.status = 'loading'
      service.read(graphId, request.attrs.iri).then(
        (result) => {
          if (mine !== generation) return
          if (!result) {
            frame.model = null
            frame.status = 'absent'
            return
          }
          frame.model = objectModelOfRead(result)
          frame.status = 'ready'
        },
        (error: unknown) => {
          if (mine !== generation) return
          frame.model = null
          frame.error = error instanceof Error ? error.message : String(error)
          frame.status = 'error'
        },
      )
    }

    read(initial)
    return {
      update(next) {
        read(next)
      },
      destroy() {
        generation += 1
        frame.remove()
      },
    }
  }
}
