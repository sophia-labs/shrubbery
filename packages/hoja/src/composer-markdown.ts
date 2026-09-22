import type { HojaJSONContent, HojaWikiLinkReference } from './types.js'

type Mark = HojaJSONContent

const INLINE_SPECIAL = new Set(['\\', '`', '*', '_', '['])

function sameMarks(left: readonly Mark[] | undefined, right: readonly Mark[] | undefined): boolean {
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? [])
}

function appendText(target: HojaJSONContent[], text: string, marks: readonly Mark[]): void {
  if (!text) return
  const previous = target.at(-1)
  if (previous?.type === 'text' && sameMarks(previous.marks, marks)) {
    previous.text = `${previous.text ?? ''}${text}`
    return
  }
  target.push({
    type: 'text',
    text,
    ...(marks.length ? { marks: marks.map(mark => ({ ...mark })) } : {}),
  })
}

function isEscaped(value: string, index: number): boolean {
  let slashes = 0
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) slashes += 1
  return slashes % 2 === 1
}

function findUnescaped(value: string, token: string, from: number): number {
  let index = value.indexOf(token, from)
  while (index !== -1 && isEscaped(value, index)) index = value.indexOf(token, index + token.length)
  return index
}

function unescapeMarkdown(value: string): string {
  return value.replace(/\\([\\`*_\[\]()])/g, '$1')
}

function safeHref(value: string): boolean {
  return !/^\s*(?:javascript|vbscript|data):/i.test(value)
}

interface ReferenceQueue {
  readonly byLabel: Map<string, HojaWikiLinkReference[]>
}

function makeReferenceQueue(references: readonly HojaWikiLinkReference[]): ReferenceQueue {
  const byLabel = new Map<string, HojaWikiLinkReference[]>()
  for (const reference of references) {
    const queue = byLabel.get(reference.label) ?? []
    queue.push(reference)
    byLabel.set(reference.label, queue)
  }
  return { byLabel }
}

function takeReference(queue: ReferenceQueue, label: string): HojaWikiLinkReference | undefined {
  return queue.byLabel.get(label)?.shift()
}

function parseInline(
  value: string,
  references: ReferenceQueue,
  inheritedMarks: readonly Mark[] = [],
): HojaJSONContent[] {
  const content: HojaJSONContent[] = []
  let cursor = 0

  while (cursor < value.length) {
    if (value[cursor] === '\n') {
      content.push({ type: 'hardBreak' })
      cursor += 1
      continue
    }

    if (value[cursor] === '\\' && cursor + 1 < value.length) {
      appendText(content, value[cursor + 1]!, inheritedMarks)
      cursor += 2
      continue
    }

    if (value.startsWith('[[', cursor)) {
      const close = findUnescaped(value, ']]', cursor + 2)
      if (close !== -1) {
        const label = unescapeMarkdown(value.slice(cursor + 2, close))
        const reference = takeReference(references, label)
        content.push({
          type: 'wikilink',
          attrs: {
            label,
            targetDocId: reference?.targetDocId ?? null,
            targetGraphId: reference?.targetGraphId ?? null,
            targetBlockId: reference?.targetBlockId ?? null,
            blockPreview: reference?.blockPreview ?? null,
            wireId: null,
          },
        })
        cursor = close + 2
        continue
      }
    }

    if (value[cursor] === '`') {
      const close = findUnescaped(value, '`', cursor + 1)
      if (close !== -1) {
        appendText(content, unescapeMarkdown(value.slice(cursor + 1, close)), [
          ...inheritedMarks,
          { type: 'code' },
        ])
        cursor = close + 1
        continue
      }
    }

    if (value.startsWith('**', cursor)) {
      const close = findUnescaped(value, '**', cursor + 2)
      if (close !== -1) {
        content.push(
          ...parseInline(value.slice(cursor + 2, close), references, [
            ...inheritedMarks,
            { type: 'bold' },
          ]),
        )
        cursor = close + 2
        continue
      }
    }

    if (value[cursor] === '*' || value[cursor] === '_') {
      const delimiter = value[cursor]!
      const close = findUnescaped(value, delimiter, cursor + 1)
      if (close !== -1) {
        content.push(
          ...parseInline(value.slice(cursor + 1, close), references, [
            ...inheritedMarks,
            { type: 'italic' },
          ]),
        )
        cursor = close + 1
        continue
      }
    }

    if (value[cursor] === '[' && !value.startsWith('[[', cursor)) {
      const labelEnd = findUnescaped(value, '](', cursor + 1)
      if (labelEnd !== -1) {
        const hrefEnd = findUnescaped(value, ')', labelEnd + 2)
        if (hrefEnd !== -1) {
          const href = unescapeMarkdown(value.slice(labelEnd + 2, hrefEnd))
          if (safeHref(href)) {
            content.push(
              ...parseInline(value.slice(cursor + 1, labelEnd), references, [
                ...inheritedMarks,
                { type: 'link', attrs: { href } },
              ]),
            )
            cursor = hrefEnd + 1
            continue
          }
        }
      }
    }

    let end = cursor + 1
    while (
      end < value.length &&
      value[end] !== '\n' &&
      !INLINE_SPECIAL.has(value[end]!)
    ) end += 1
    appendText(content, value.slice(cursor, end), inheritedMarks)
    cursor = end
  }

  return content
}

/**
 * Parse the deliberately small composer Markdown dialect into kernel JSON.
 *
 * Supported lossless forms are paragraphs/hard breaks, bold, italic, inline
 * code, links, and `[[label]]` wikilinks. Document-only structures are outside
 * the composer dialect rather than being falsely promised as round-trippable.
 */
export function parseComposerMarkdown(
  value: string,
  referenceBindings: readonly HojaWikiLinkReference[] = [],
): HojaJSONContent {
  const normalized = value.replace(/\r\n?/g, '\n')
  const references = makeReferenceQueue(referenceBindings)
  const paragraphs = normalized.split(/\n{2,}/)
  return {
    type: 'doc',
    content: paragraphs.map(paragraph => ({
      type: 'paragraph',
      ...(paragraph ? { content: parseInline(paragraph, references) } : {}),
    })),
  }
}

function escapeText(value: string): string {
  return value.replace(/[\\`*_\[\]]/g, character => `\\${character}`)
}

function escapeHref(value: string): string {
  return value.replace(/[\\)]/g, character => `\\${character}`)
}

function serializeInline(node: HojaJSONContent): string {
  if (node.type === 'hardBreak') return '\n'
  if (node.type === 'wikilink') {
    const label = String(node.attrs?.label ?? 'Untitled').replace(/\\/g, '\\\\').replace(/\]\]/g, '\\]\\]')
    return `[[${label}]]`
  }
  if (node.type !== 'text') return (node.content ?? []).map(serializeInline).join('')

  const marks = node.marks ?? []
  const code = marks.some(mark => mark.type === 'code')
  let text = code
    ? `\`${(node.text ?? '').replace(/`/g, '\\`')}\``
    : escapeText(node.text ?? '')

  if (!code && marks.some(mark => mark.type === 'italic')) text = `_${text}_`
  if (!code && marks.some(mark => mark.type === 'bold')) text = `**${text}**`
  const link = marks.find(mark => mark.type === 'link')
  const href = link?.attrs?.href
  if (typeof href === 'string' && safeHref(href)) text = `[${text}](${escapeHref(href)})`
  return text
}

function serializeBlock(node: HojaJSONContent): string {
  if (node.type === 'paragraph') return (node.content ?? []).map(serializeInline).join('')
  // Unsupported document-only blocks degrade visibly to their inline matter.
  // Hoja does not claim those structures are lossless in composer posture.
  return (node.content ?? []).map(child =>
    child.type === 'paragraph' ? serializeBlock(child) : serializeInline(child),
  ).join('\n')
}

/** Serialize kernel JSON into canonical composer Markdown. */
export function serializeComposerMarkdown(document: HojaJSONContent): string {
  return (document.content ?? []).map(serializeBlock).join('\n\n')
}

/** Collect wikilink occurrences and their host-resolved ids in document order. */
export function collectWikiLinkReferences(
  document: HojaJSONContent,
): readonly HojaWikiLinkReference[] {
  const references: HojaWikiLinkReference[] = []
  const visit = (node: HojaJSONContent): void => {
    if (node.type === 'wikilink') {
      const docId = node.attrs?.targetDocId
      const graphId = node.attrs?.targetGraphId
      const blockId = node.attrs?.targetBlockId
      const blockPreview = node.attrs?.blockPreview
      references.push({
        label: String(node.attrs?.label ?? 'Untitled'),
        targetDocId: typeof docId === 'string' && docId ? docId : null,
        targetGraphId: typeof graphId === 'string' && graphId ? graphId : null,
        targetBlockId: typeof blockId === 'string' && blockId ? blockId : null,
        blockPreview: typeof blockPreview === 'string' && blockPreview ? blockPreview : null,
      })
    }
    for (const child of node.content ?? []) visit(child)
  }
  visit(document)
  return references
}
