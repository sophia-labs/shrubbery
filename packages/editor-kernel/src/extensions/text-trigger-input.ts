import type { EditorView } from '@tiptap/pm/view'

/** Normalized insertion context shared by slash, tag, and wikilink triggers. */
export interface TextTriggerInputContext {
  readonly text: string
  readonly textBefore: string
  readonly parentStart: number
  readonly insertionFrom: number
}

/**
 * Resolve the text that will precede an insertion without owning the insertion.
 *
 * Most typing is a collapsed TextSelection. Replacing text in one textblock is
 * equally well-defined and must keep autocomplete working. ProseMirror also
 * leaves an AllSelection after select-all/delete on an otherwise-empty document;
 * the next printable key creates a fresh paragraph, whose content begins at 1.
 */
export function resolveTextTriggerInput(
  view: EditorView,
  from: number,
  to: number,
  text: string,
): TextTriggerInputContext | null {
  if (text.length === 0) return null
  const doc = view.state.doc
  const $from = doc.resolve(from)
  const $to = doc.resolve(to)
  if ($from.parent === $to.parent && $from.parent.isTextblock) {
    return {
      text,
      textBefore: $from.parent.textBetween(0, $from.parentOffset, '', ''),
      parentStart: $from.start(),
      insertionFrom: from,
    }
  }
  if (from === 0 && to === doc.content.size) {
    return { text, textBefore: '', parentStart: 1, insertionFrom: 1 }
  }
  return null
}
