/** The app's closed face catalogue: the faces a graph-authored Ovillo layout may name. */
export const OVILLO_FACE_IDS = Object.freeze({
  gallery: 'ovillo.gallery.v1',
  now: 'ovillo.now.v1',
  about: 'ovillo.about.v1',
  piecePlayer: 'ovillo.piece.player.v1',
  pieceTrace: 'ovillo.piece.trace.v1',
  pieceLedger: 'ovillo.piece.ledger.v1',
  pieceWorld: 'ovillo.piece.world.v1',
  pieceReceipt: 'ovillo.piece.receipt.v1',
  pieceScore: 'ovillo.piece.score.v1',
  bench: 'ovillo.mount.bench.v1',
  tract: 'ovillo.mount.tract.v1',
  scoreEditor: 'ovillo.mount.score-editor.v1',
})

export type OvilloFaceId = (typeof OVILLO_FACE_IDS)[keyof typeof OVILLO_FACE_IDS]

const IDS: ReadonlySet<string> = new Set(Object.values(OVILLO_FACE_IDS))

export function isOvilloFaceId(faceId: string): faceId is OvilloFaceId {
  return IDS.has(faceId)
}
