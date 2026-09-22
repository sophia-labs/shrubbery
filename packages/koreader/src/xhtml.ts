import {
  blockAnchor,
  documentFileName,
  documentXhtmlPath,
  type ReaderBlock,
  type ReaderDocument,
  type ReaderMark,
} from './model.js'

export interface KoreaderXhtmlOptions {
  readonly libraryTitle?: string
  readonly canonicalUrl?: string
  readonly documentHref?: (documentId: string) => string
  readonly navigation?: KoreaderDocumentNavigation
}

export interface KoreaderDocumentNavigation {
  readonly position: number
  readonly total: number
  readonly previous?: KoreaderNavigationEntry
  readonly next?: KoreaderNavigationEntry
}

export interface KoreaderNavigationEntry {
  readonly id: string
  readonly title: string
}

const DEFAULT_CSS = `
@page { margin: 0.9em 0.75em 0.7em; }
html { color: #000; background: #fff; }
body { font-family: serif; font-size: 1em; line-height: 1.54; margin: 0 auto; max-width: 40em; }
header.sophia-document-header { break-inside: avoid; margin: 0 0 3em; page-break-inside: avoid; text-align: center; }
nav.sophia-reader-navigation { border-bottom: 0.06em solid #aaa; color: #555; display: table; font-family: sans-serif; font-size: 0.62em; font-weight: bold; letter-spacing: 0.08em; margin: 0 0 2.8em; padding: 0 0 0.8em; table-layout: fixed; text-transform: uppercase; width: 100%; }
nav.sophia-reader-navigation.sophia-reader-navigation-bottom { border-bottom: 0; border-top: 0.06em solid #aaa; margin: 4em 0 0; padding: 0.9em 0 0; }
nav.sophia-reader-navigation > span { display: table-cell; vertical-align: middle; width: 33.333%; }
nav.sophia-reader-navigation .sophia-navigation-position { text-align: center; }
nav.sophia-reader-navigation .sophia-navigation-next { text-align: right; }
nav.sophia-reader-navigation a { color: #222; text-decoration: none; }
p.sophia-utility { border-bottom: 0.06em solid #aaa; color: #555; font-family: sans-serif; font-size: 0.62em; font-weight: bold; letter-spacing: 0.09em; margin: 0 0 2.8em; padding: 0 0 0.8em; text-align: left; text-transform: uppercase; }
p.sophia-workspace { color: #555; font-family: sans-serif; font-size: 0.66em; font-weight: bold; letter-spacing: 0.11em; margin: 0 0 0.6em; text-transform: uppercase; }
h1.sophia-document-title { break-before: auto; font-size: 2.15em; font-weight: normal; line-height: 1.12; margin: 0 0 0.4em; page-break-before: auto; }
p.sophia-document-meta { color: #666; font-family: sans-serif; font-size: 0.64em; letter-spacing: 0.08em; margin: 0; text-transform: uppercase; }
article { margin: 0 auto; }
article > h1, article > h2 { border-top: 0.06em solid #aaa; break-before: page; font-weight: normal; margin-top: 2.4em; padding-top: 0.8em; page-break-before: always; }
article > h1:first-child, article > h2:first-child { break-before: auto; page-break-before: auto; }
article > h3, article > h4, article > h5, article > h6 { font-family: sans-serif; letter-spacing: 0.04em; margin-top: 1.8em; }
p { margin: 0.85em 0; }
p, li, blockquote { orphans: 2; widows: 2; }
ul, ol { padding-left: 1.4em; }
li { margin: 0.35em 0; }
li[data-level="2"] { margin-left: 1.1em; }
li[data-level="3"] { margin-left: 2.2em; }
li[data-level="4"] { margin-left: 3.3em; }
li[data-level="5"], li[data-level="6"] { margin-left: 4.4em; }
blockquote { border-left: 0.12em solid #777; font-size: 1.08em; margin: 1.4em 0 1.4em 0.35em; padding-left: 1em; }
pre { font-family: monospace; font-size: 0.88em; line-height: 1.35; white-space: pre-wrap; word-break: break-word; }
code { font-family: monospace; }
hr { border: 0; border-top: 0.06em solid #999; margin: 2.4em auto; width: 40%; }
.sophia-underline { text-decoration: underline; }
.sophia-todo-marker { font-family: monospace; }
.sophia-math { font-family: serif; font-style: italic; }
.sophia-image-placeholder { border: 0.08em solid #777; padding: 0.7em; }
p.sophia-empty-note { border-bottom: 0.06em solid #bbb; border-top: 0.06em solid #bbb; color: #666; font-style: italic; margin: 3.5em auto; padding: 1.3em 0; text-align: center; }
footer.sophia-provenance { border-top: 0.06em solid #999; color: #666; font-family: sans-serif; font-size: 0.58em; letter-spacing: 0.07em; margin-top: 6em; padding-top: 0.9em; text-transform: uppercase; }
footer.sophia-provenance p { margin: 0.25em 0; }
`.trim()

export function renderKoreaderXhtml(
  document: ReaderDocument,
  options: KoreaderXhtmlOptions = {},
): string {
  const documentHref = options.documentHref
    ?? ((documentId: string) => `./${documentFileName(documentId)}`)
  const metadata = [
    `revision ${document.revision}`,
    document.updatedAt ? `updated ${displayTimestamp(document.updatedAt)}` : undefined,
    document.readOnly ? 'read-only' : undefined,
  ].filter((value): value is string => value !== undefined)
  const workspace = options.libraryTitle ?? document.graphId
  const hasReadableContent = document.blocks.some((block) =>
    block.type !== 'paragraph' || block.text.trim() !== '',
  )
  const emptyNote = hasReadableContent
    ? ''
    : '\n    <p class="sophia-empty-note">This page is still gathering.</p>'
  const renderedBlocks = omitRepeatedTitleHeading(document)
  const topNavigation = options.navigation
    ? `\n  ${renderDocumentNavigation(options.navigation, documentHref, 'top')}`
    : ''
  const bottomNavigation = options.navigation
    ? `\n  ${renderDocumentNavigation(options.navigation, documentHref, 'bottom')}`
    : ''

  const canonical = options.canonicalUrl
    ? `\n  <link rel="canonical" href="${escapeAttribute(safeHref(options.canonicalUrl))}"/>`
    : ''
  const library = options.libraryTitle
    ? `\n  <meta name="sophia:library" content="${escapeAttribute(options.libraryTitle)}"/>`
    : ''

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="generator" content="Shrubbery KOReader target"/>
  <meta name="sophia:graph-id" content="${escapeAttribute(document.graphId)}"/>
  <meta name="sophia:document-id" content="${escapeAttribute(document.id)}"/>
  <meta name="sophia:revision" content="${document.revision}"/>${library}${canonical}
  <title>${escapeText(document.title)}</title>
  <style type="text/css">${DEFAULT_CSS}</style>
</head>
<body data-sophia-graph-id="${escapeAttribute(document.graphId)}" data-sophia-document-id="${escapeAttribute(document.id)}" data-sophia-revision="${document.revision}">${topNavigation}
  <header class="sophia-document-header">
    <p class="sophia-utility">Sophia / Reader · ${escapeText(document.graphId)}</p>
    <p class="sophia-workspace">${escapeText(workspace)}</p>
    <h1 class="sophia-document-title">${escapeText(document.title)}</h1>
    <p class="sophia-document-meta">${escapeText(metadata.join(' · '))}</p>
  </header>
  <article>
${renderBlocks(renderedBlocks, documentHref)}${emptyNote}
  </article>${bottomNavigation}
  <footer class="sophia-provenance">
    <p>Sophia / ${escapeText(document.graphId)}</p>
    <p>${escapeText(document.id)} · revision ${document.revision}</p>
  </footer>
</body>
</html>
`
}

function renderDocumentNavigation(
  navigation: KoreaderDocumentNavigation,
  documentHref: (documentId: string) => string,
  placement: 'top' | 'bottom',
): string {
  const total = Number.isFinite(navigation.total)
    ? Math.max(1, Math.trunc(navigation.total))
    : 1
  const position = Number.isFinite(navigation.position)
    ? clampInteger(navigation.position, 1, total)
    : 1
  const previous = navigation.previous
    ? navigationLink('Previous', navigation.previous, documentHref)
    : '<span aria-hidden="true">Beginning</span>'
  const next = navigation.next
    ? navigationLink('Next', navigation.next, documentHref)
    : '<span aria-hidden="true">End</span>'
  const library = '<a href="../index.xhtml">Library</a>'
  const className = placement === 'bottom'
    ? 'sophia-reader-navigation sophia-reader-navigation-bottom'
    : 'sophia-reader-navigation'
  const left = placement === 'top' ? library : previous

  return `<nav class="${className}" aria-label="Reader navigation"><span>${left}</span><span class="sophia-navigation-position">${position} / ${total}</span><span class="sophia-navigation-next">${next}</span></nav>`
}

function navigationLink(
  label: string,
  entry: KoreaderNavigationEntry,
  documentHref: (documentId: string) => string,
): string {
  const direction = label === 'Previous' ? '&#8249; ' : ' &#8250;'
  const visible = label === 'Previous' ? `${direction}${label}` : `${label}${direction}`
  return `<a href="${escapeAttribute(safeHref(documentHref(entry.id)))}" title="${escapeAttribute(entry.title)}">${visible}</a>`
}

function omitRepeatedTitleHeading(document: ReaderDocument): readonly ReaderBlock[] {
  const first = document.blocks[0]
  if (
    first?.type === 'heading'
    && (first.level ?? 1) === 1
    && normalizedTitle(first.text) === normalizedTitle(document.title)
  ) {
    return document.blocks.slice(1)
  }
  return document.blocks
}

function normalizedTitle(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

export function renderKoreaderLibraryIndex(
  title: string,
  documents: readonly ReaderDocument[],
): string {
  const rows = documents
    .map((document) => {
      const href = documentXhtmlPath(document.id)
      const detail = [
        `revision ${document.revision}`,
        document.updatedAt,
        document.snippet,
      ].filter((value): value is string => Boolean(value))
      return `      <li><a href="${escapeAttribute(href)}">${escapeText(document.title)}</a><br/><small>${escapeText(detail.join(' · '))}</small></li>`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="generator" content="Shrubbery KOReader target"/>
  <title>${escapeText(title)}</title>
  <style type="text/css">${DEFAULT_CSS}\nli { margin-bottom: 0.9em; }</style>
</head>
<body>
  <header class="sophia-document-header">
    <p class="sophia-utility">Sophia / Reader · Library</p>
    <p class="sophia-workspace">In this garden</p>
    <h1 class="sophia-document-title">${escapeText(title)}</h1>
  </header>
  <main>
    <ol>
${rows}
    </ol>
  </main>
</body>
</html>
`
}

function displayTimestamp(value: string): string {
  const trimmed = value.trim()
  const numeric = /^\d{10,13}$/.test(trimmed) ? Number(trimmed) : Number.NaN
  const epoch = Number.isFinite(numeric) && trimmed.length <= 10 ? numeric * 1000 : numeric
  const parsed = Number.isFinite(epoch) ? epoch : Date.parse(trimmed)
  if (!Number.isFinite(parsed)) return value
  const date = new Date(parsed)
  return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10)
}

function renderBlocks(
  blocks: readonly ReaderBlock[],
  documentHref: (documentId: string) => string,
): string {
  const output: string[] = []
  let index = 0
  while (index < blocks.length) {
    const block = blocks[index]
    if (block.type === 'bullet' || block.type === 'numbered') {
      const listType = block.type
      const grouped: ReaderBlock[] = []
      while (index < blocks.length && blocks[index].type === listType) {
        grouped.push(blocks[index])
        index += 1
      }
      output.push(renderList(grouped, listType, documentHref))
      continue
    }
    output.push(renderBlock(block, documentHref))
    index += 1
  }
  return output.map((line) => `    ${line}`).join('\n')
}

function renderList(
  blocks: readonly ReaderBlock[],
  type: 'bullet' | 'numbered',
  documentHref: (documentId: string) => string,
): string {
  const tag = type === 'bullet' ? 'ul' : 'ol'
  const items = blocks
    .map((block) => {
      const level = clampInteger(block.level ?? 1, 1, 6)
      return `<li ${blockAttributes(block)} data-level="${level}">${renderInline(block.text, block.marks, documentHref)}</li>`
    })
    .join('')
  return `<${tag}>${items}</${tag}>`
}

function renderBlock(
  block: ReaderBlock,
  documentHref: (documentId: string) => string,
): string {
  const attributes = blockAttributes(block)
  const content = renderInline(block.text, block.marks, documentHref)
  switch (block.type) {
    case 'heading': {
      const level = clampInteger(block.level ?? 1, 1, 6)
      return `<h${level} ${attributes}>${content}</h${level}>`
    }
    case 'paragraph':
      return `<p ${attributes}>${content || '&#160;'}</p>`
    case 'todo': {
      const marker = block.checked ? '[x]' : '[ ]'
      return `<p ${attributes} class="sophia-todo"><span class="sophia-todo-marker">${marker}</span> ${content}</p>`
    }
    case 'quote':
      return `<blockquote ${attributes}><p>${content}</p></blockquote>`
    case 'code': {
      const language = block.language
        ? ` class="language-${escapeAttribute(cssIdentifier(block.language))}"`
        : ''
      return `<pre ${attributes}><code${language}>${escapeText(block.text)}</code></pre>`
    }
    case 'divider':
      return `<hr ${attributes}/>`
    case 'image': {
      if (block.imageSrc && safeImageHref(block.imageSrc)) {
        const alt = block.altText ?? block.text
        return `<figure ${attributes}><img src="${escapeAttribute(block.imageSrc)}" alt="${escapeAttribute(alt)}"/><figcaption>${escapeText(alt)}</figcaption></figure>`
      }
      return `<p ${attributes} class="sophia-image-placeholder">[Image] ${content}</p>`
    }
    case 'math':
      return `<p ${attributes} class="sophia-math">${content}</p>`
    case 'bullet':
    case 'numbered':
      throw new Error(`List block ${block.id} reached scalar renderer`)
  }
}

function renderInline(
  text: string,
  marks: readonly ReaderMark[],
  documentHref: (documentId: string) => string,
): string {
  const usableMarks = marks
    .map((mark) => ({
      ...mark,
      start: clampInteger(mark.start, 0, text.length),
      end: clampInteger(mark.end, 0, text.length),
    }))
    .filter((mark) => mark.end > mark.start)

  if (usableMarks.length === 0) return escapeText(text)

  const boundaries = new Set<number>([0, text.length])
  for (const mark of usableMarks) {
    boundaries.add(mark.start)
    boundaries.add(mark.end)
  }
  const offsets = [...boundaries].sort((left, right) => left - right)
  const output: string[] = []

  for (let index = 0; index < offsets.length - 1; index += 1) {
    const start = offsets[index]
    const end = offsets[index + 1]
    if (end <= start) continue
    const active = usableMarks
      .filter((mark) => mark.start <= start && mark.end >= end)
      .sort(compareMarks)
    let segment = escapeText(text.slice(start, end))
    for (const mark of active) {
      segment = wrapMark(segment, mark, documentHref)
    }
    output.push(segment)
  }
  return output.join('')
}

function compareMarks(left: ReaderMark, right: ReaderMark): number {
  const byStart = left.start - right.start
  if (byStart !== 0) return byStart
  const byLength = (right.end - right.start) - (left.end - left.start)
  if (byLength !== 0) return byLength
  return left.type.localeCompare(right.type)
}

function wrapMark(
  body: string,
  mark: ReaderMark,
  documentHref: (documentId: string) => string,
): string {
  const normalized = mark.type.toLowerCase()
  switch (normalized) {
    case 'bold':
    case 'strong':
      return `<strong>${body}</strong>`
    case 'italic':
    case 'em':
      return `<em>${body}</em>`
    case 'underline':
      return `<span class="sophia-underline">${body}</span>`
    case 'strike':
    case 'strikethrough':
      return `<s>${body}</s>`
    case 'code':
      return `<code>${body}</code>`
    case 'highlight':
      return `<mark>${body}</mark>`
    case 'link':
    case 'wikilink': {
      const candidate = mark.targetDocumentId
        ? documentHref(mark.targetDocumentId)
        : mark.href
      if (!candidate) return body
      const href = safeHref(candidate)
      const title = mark.label ? ` title="${escapeAttribute(mark.label)}"` : ''
      return `<a href="${escapeAttribute(href)}"${title}>${body}</a>`
    }
    default:
      return `<span data-sophia-mark="${escapeAttribute(mark.type)}">${body}</span>`
  }
}

function blockAttributes(block: ReaderBlock): string {
  const parent = block.parentId
    ? ` data-sophia-parent-id="${escapeAttribute(block.parentId)}"`
    : ''
  return `id="${escapeAttribute(blockAnchor(block.id))}" data-sophia-block-id="${escapeAttribute(block.id)}" data-sophia-block-type="${block.type}"${parent}`
}

function safeHref(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('#')) return trimmed
  if (isSafeLocalRelative(trimmed)) return trimmed
  if (/^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed)) return trimmed
  return '#'
}

function safeImageHref(value: string): boolean {
  const trimmed = value.trim()
  return isSafeLocalRelative(trimmed) || /^https?:\/\//i.test(trimmed)
}

function isSafeLocalRelative(value: string): boolean {
  if (!value.startsWith('./') || value.includes('\\') || containsControlCharacter(value)) {
    return false
  }
  return !value.split('/').includes('..')
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) <= 0x1f) return true
  }
  return false
}

function cssIdentifier(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'text'
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
