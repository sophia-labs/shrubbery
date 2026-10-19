/**
 * document-quote-sources.ts — what of the open document can be drawn over its
 * original: its comments (from the Y.Doc `comments` map, as `WorkspaceComment`)
 * and its highlights (the `highlight` mark on the Y.Doc `content` fragment),
 * each with the text of the block it sits in, which the matcher uses to choose
 * among repeated passages.
 *
 * The Y types are read by shape, as `document-comments.ts` does, so this never
 * depends on which copy of yjs created them.
 */

import type { WorkspaceComment } from '@shrubbery/runtime'
import type { SourceQuoteAnnotation } from './source-quote-annotations.js'

interface DeltaOp {
  readonly insert?: unknown
  readonly attributes?: Readonly<Record<string, unknown>> | null
}

interface YXmlTextLike {
  toDelta(): readonly DeltaOp[]
}

interface YXmlElementLike {
  getAttribute(name: string): unknown
  toArray(): readonly unknown[]
}

export interface QuoteSourceDoc {
  getXmlFragment(name: string): { toArray(): readonly unknown[] }
}

export interface DocumentQuoteState {
  readonly blockText: ReadonlyMap<string, string>
  readonly highlights: readonly SourceQuoteAnnotation[]
}

function isXmlText(value: unknown): value is YXmlTextLike {
  return typeof (value as Partial<YXmlTextLike> | null)?.toDelta === 'function'
}

function isXmlElement(value: unknown): value is YXmlElementLike {
  const candidate = value as Partial<YXmlElementLike> | null
  return typeof candidate?.getAttribute === 'function' && typeof candidate.toArray === 'function'
}

function blockIdOf(element: YXmlElementLike): string | null {
  for (const name of ['data-block-id', 'blockId']) {
    const value = element.getAttribute(name)
    if (typeof value === 'string' && value) return value
  }
  return null
}

export function isQuoteSourceDoc(value: unknown): value is QuoteSourceDoc {
  return typeof (value as Partial<QuoteSourceDoc> | null)?.getXmlFragment === 'function'
}

/** Each top-level block's text, and each run of highlighted text with its block. */
export function documentQuoteState(doc: QuoteSourceDoc): DocumentQuoteState {
  const blockText = new Map<string, string>()
  const highlights: SourceQuoteAnnotation[] = []
  const blocks = doc.getXmlFragment('content').toArray()
  blocks.forEach((block, blockIndex) => {
    if (!isXmlElement(block)) return
    const blockId = blockIdOf(block)
    let text = ''
    let run = ''
    const runs: string[] = []
    const endRun = (): void => {
      if (run.trim()) runs.push(run)
      run = ''
    }
    const walk = (element: YXmlElementLike): void => {
      for (const child of element.toArray()) {
        if (isXmlText(child)) {
          for (const op of child.toDelta()) {
            if (typeof op.insert !== 'string') {
              endRun()
              continue
            }
            text += op.insert
            if (op.attributes?.highlight) run += op.insert
            else endRun()
          }
        } else if (isXmlElement(child)) {
          endRun()
          if (text && !/\s$/.test(text)) text += '\n'
          walk(child)
        }
      }
    }
    walk(block)
    endRun()
    if (blockId) blockText.set(blockId, text)
    runs.forEach((quote, runIndex) => {
      highlights.push({
        id: `highlight:${blockId ?? `#${blockIndex}`}:${runIndex}`,
        kind: 'highlight',
        quote,
        context: text,
      })
    })
  })
  return { blockText, highlights }
}

/**
 * The annotations to draw: every unresolved comment (one without a quote is
 * kept, so it can be reported as not found) and every highlight.
 */
export function quoteAnnotationsFor(
  comments: readonly WorkspaceComment[],
  state: DocumentQuoteState | null,
): readonly SourceQuoteAnnotation[] {
  const fromComments = comments
    .filter(comment => !comment.resolved)
    .map((comment): SourceQuoteAnnotation => ({
      id: comment.id,
      kind: 'comment',
      quote: comment.quotedText ?? '',
      text: comment.text,
      author: comment.author,
      context: comment.blockId ? state?.blockText.get(comment.blockId) ?? null : null,
    }))
  return [...fromComments, ...(state?.highlights ?? [])]
}
