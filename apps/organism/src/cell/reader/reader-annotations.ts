/**
 * The document's comments, as the Reader draws them over the original: a person's highlights and notes (made in the
 * Reader, with a colour and a place), an agent's findings (comments by quote), and the text's own highlight marks.
 */
import type { WorkspaceComment } from '@shrubbery/runtime'
import { quoteAnnotationsFor, type DocumentQuoteState } from '../document-quote-sources.js'
import { readerColor, type ReaderAnnotation, type ReaderPlace } from './reader-model.js'

function placeOf(comment: WorkspaceComment): ReaderPlace | null {
  const anchor = comment.anchor
  if (typeof anchor?.page === 'number' && anchor.page >= 1) return { kind: 'page', page: anchor.page }
  if (typeof anchor?.chapter === 'number' && anchor.chapter >= 0) return { kind: 'chapter', chapterIndex: anchor.chapter }
  return null
}

export function readerAnnotationsFor(
  comments: readonly WorkspaceComment[],
  state: DocumentQuoteState | null,
): readonly ReaderAnnotation[] {
  const byId = new Map(comments.map(comment => [comment.id, comment]))
  return quoteAnnotationsFor(comments, state)
    .filter(annotation => annotation.quote.trim().length > 0)
    .map((annotation): ReaderAnnotation => {
      const comment = byId.get(annotation.id)
      if (!comment) return { ...annotation, color: 'yellow', mine: false }
      const highlight = comment.kind === 'highlight'
      return {
        ...annotation,
        kind: highlight ? 'highlight' : 'comment',
        text: highlight ? null : annotation.text,
        color: readerColor(comment.color),
        place: placeOf(comment),
        prefix: comment.anchor?.prefix ?? null,
        suffix: comment.anchor?.suffix ?? null,
        mine: comment.madeInReader === true,
        author: comment.claimedAuthor || annotation.author,
        signedBy: comment.claimedAuthor ? comment.author : null,
      }
    })
}
