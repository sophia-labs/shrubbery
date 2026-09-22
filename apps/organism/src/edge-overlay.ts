/**
 * edge-overlay.ts — the PURE projection that turns the cell's `:ux:config`
 * selection edges into the `MnRelation[]` the `mn-relations` component renders as
 * a live diagram (semantic edge overlay, slice 1).
 *
 * This is the "one model, two consumers" split the codec documents: the
 * edge-interpreter reads `config.edges` to install BEHAVIOR; this module reads the
 * SAME `config.edges` to render the DIAGRAM. No DOM, no stores — the mount side
 * (a dev/side overlay host appended to `document.body`) lives in `main.ts`; every
 * mapping decision that is worth a test lives here.
 *
 * `mn-relations` is vocabulary-free — it only knows `MnRelation` ({from, to,
 * predicate, kind, note}). So the projection carries the face id-space translation
 * (`face:comments` → a human `Comments` endpoint) and the live-selection
 * annotation (the last publish tints the edge whose source face produced it) that
 * the component itself must stay ignorant of.
 */

import type { ConfigEdge, SelectedObject } from '@shrubbery/nucleus'
import type { MnRelation } from '@shrubbery/components'

/**
 * Human-readable endpoint label for a `face:<id>` IRI. Strips the `face:` prefix
 * (the id-space marker, meaningless to a viewer) and title-cases the remainder so
 * `face:comments` reads as `Comments`. A face id without the prefix (or an empty
 * remainder) falls back to the raw value rather than rendering a blank socket.
 */
export function faceLabel(faceId: string): string {
  const bare = faceId.startsWith('face:') ? faceId.slice('face:'.length) : faceId
  return bare ? bare.charAt(0).toUpperCase() + bare.slice(1) : faceId
}

/**
 * The source face a published selection came through, or null. The bus carries a
 * `SelectedObject`, not the edge that fired it, so the overlay recovers the active
 * source from the selection's discriminant: a comment pick flows from the comments
 * face, a block pick from the graph face, a folder pick from the sidebar face (the
 * only bus publisher of a SelectedFolder this slice — the sidebar folder branch;
 * the graph panel's folder branch writes the inspector imperatively, off-bus). Any
 * other kind (or a cleared selection) lights no edge — the overlay stays honest
 * rather than guessing. navigatesTo edges never touch the bus (an open is a
 * command, not selection currency), so they render un-annotated by construction.
 */
export function activeSourceFace(selection: SelectedObject | null): string | null {
  if (!selection) return null
  switch (selection.kind) {
    case 'comment':
      return 'face:comments'
    case 'block':
      return 'face:graph'
    case 'folder':
      return 'face:sidebar'
    default:
      return null
  }
}

/**
 * Project `config.edges` into the `MnRelation[]` the overlay renders. Each edge
 * becomes a directed `from → (predicate) → to` row with both endpoints labelled
 * and `kind: 'predicate'` (the solid-connector look; slice 1 carries no wire
 * edges). When `activeSelection` is supplied, every edge whose source face
 * produced it gets a `note` — the hover-title annotation `mn-relations` surfaces —
 * marking the row the last selection just fired through. Undefined `edges`
 * projects to an empty list (the overlay then renders its own empty state).
 */
export function configEdgesToRelations(
  edges: readonly ConfigEdge[] | undefined,
  activeSelection: SelectedObject | null = null,
): MnRelation[] {
  const active = activeSourceFace(activeSelection)
  return (edges ?? []).map((edge) => {
    const relation: MnRelation = {
      from: faceLabel(edge.from),
      to: faceLabel(edge.to),
      predicate: edge.predicate,
      kind: 'predicate',
    }
    return active !== null && edge.from === active
      ? { ...relation, note: 'last selection fired through this edge' }
      : relation
  })
}
