/**
 * boot-gate.ts — W6.5's loud failure, and the reason it has to exist here.
 *
 * `createValidatedLayoutDocument` ALREADY rejects a leaf whose face is absent
 * from the sealed registry (`LAY003_UNREGISTERED_FACE`), so this module adds
 * no authority — the validator remains the gate. What it adds is the NAME.
 *
 * `packages/nucleus/src/layout/diagnostics.ts` deliberately TOKENIZES every
 * caller-chosen identifier before it reaches a diagnostic: a rejected leaf
 * reports `{"code":"LAY003_UNREGISTERED_FACE","nodeId":"id_4618695a",
 * "details":{"faceId":"id_392383c4"}}`. That is a considered defense-in-depth
 * choice (an id-shaped field must not become a smuggling channel for content),
 * and it is correct for a library that may be handed untrusted documents. But
 * it means W6.5's requirement — "one loud, named failure rather than a blank
 * pane" — is NOT satisfied by the validator's own output: a developer reading
 * that diagnostic learns that *a* face was unregistered, not *which*.
 *
 * The workbench's literal is code-authored, in this repo, by this app. There
 * is nothing untrusted about it, so naming it is safe here in a way it would
 * not be inside nucleus. This gate runs FIRST, over the app's own literal, and
 * throws with the face id verbatim plus the sealed registry's actual contents
 * — the message a person can act on. `tokenizeId` remains the correlation
 * route for anyone who reaches the validator's diagnostic instead.
 */
import { tokenizeId, type LayoutDocument } from '@shrubbery/nucleus/layout'
import type { FaceRegistry } from '@shrubbery/runtime/layout'

export class UnregisteredWorkbenchFaceError extends Error {
  readonly faceId: string
  readonly nodeId: string
  readonly registeredFaceIds: readonly string[]
  constructor(faceId: string, nodeId: string, registeredFaceIds: readonly string[]) {
    super(
      `seele-workbench: leaf '${nodeId}' names face '${faceId}', which is NOT in the sealed registry ` +
        `[${registeredFaceIds.join(', ')}]. The validator will also reject this, but with the face id ` +
        `tokenized as '${tokenizeId(faceId)}' — register the face before sealing, or fix the literal.`,
    )
    this.name = 'UnregisteredWorkbenchFace'
    this.faceId = faceId
    this.nodeId = nodeId
    this.registeredFaceIds = registeredFaceIds
  }
}

/**
 * Every `faceId` the document names must be in the sealed registry. Throws on
 * the FIRST offender, naming it. Returns the (ordered, de-duplicated) face-id
 * set on success, so a caller can log what it actually mounted.
 */
export function assertEveryFaceRegistered(doc: LayoutDocument, registry: FaceRegistry): readonly string[] {
  const seen: string[] = []
  for (const node of Object.values(doc.nodes)) {
    if (node.kind === 'leaf') {
      const faceId = node.descriptor.faceId
      if (!registry.has(faceId)) {
        throw new UnregisteredWorkbenchFaceError(faceId, node.id, registry.registeredFaceIds())
      }
      if (!seen.includes(faceId)) seen.push(faceId)
      continue
    }
    if (node.kind === 'grid') {
      for (const cell of node.children.kind === 'fixed' ? node.children.cells : []) {
        const faceId = cell.descriptor.faceId
        if (!registry.has(faceId)) {
          throw new UnregisteredWorkbenchFaceError(faceId, `${node.id}/${cell.id}`, registry.registeredFaceIds())
        }
        if (!seen.includes(faceId)) seen.push(faceId)
      }
    }
  }
  return seen
}
