/**
 * Who the beings are, for the faces that only know an IRI (world-UX slice A / typed objects D9): an object page's "The
 * being" names `urn:sophia:agent:…`, and nothing in the item says whose post that was. The shell learns a being's name
 * (the label of the post that cast it) and its door (the workflow document and the post's id) from the run graph, and
 * registers it here; `<sh-object-view>` and `<sh-being-mark>` read it at render and render again when it changes.
 * Pure state plus an event target: no DOM, no network.
 */

export interface BeingRef {
  /** `urn:sophia:agent:agent-…`. */
  readonly iri: string
  /** The label of the post that cast it. */
  readonly name: string
  /** The door: the workflow document and the post's id (focus key `step:<stepId>`). */
  readonly documentId?: string | null
  readonly stepId?: string | null
}

const refs = new Map<string, BeingRef>()
const changes = new EventTarget()

export const beingDirectory = {
  get(iri: string): BeingRef | undefined {
    return refs.get(iri)
  },
  set(ref: BeingRef): void {
    const before = refs.get(ref.iri)
    if (before && before.name === ref.name && before.documentId === ref.documentId && before.stepId === ref.stepId) return
    refs.set(ref.iri, ref)
    changes.dispatchEvent(new Event('change'))
  },
  /** Call back when any being becomes known or changes; returns the unsubscribe. */
  subscribe(listener: () => void): () => void {
    changes.addEventListener('change', listener)
    return () => changes.removeEventListener('change', listener)
  },
  clear(): void {
    refs.clear()
    changes.dispatchEvent(new Event('change'))
  },
}
