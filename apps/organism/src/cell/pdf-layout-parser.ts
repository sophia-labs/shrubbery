/**
 * Recovered from Garden frontend/src/native/pdf-layout-parser.ts at
 * 77440927ccc714eaf16a07274001a89de0495c0b (SHA-256 0141d4434a869e378c69e4ab911b5b23b8f844cf50be9c6ef721999b410c3003).
 * Keep geometry and source-page metadata through document.write; Markdown is
 * not an intermediate representation. This is heuristic text-layer extraction,
 * not OCR or an assurance of faithful layout for every PDF.
 */
import { loadPdfJs } from './pdfjs-runtime.js'
import { PDF_SOURCE_ANCHOR_ATTRIBUTE, encodePdfSourceAnchor, pdfSourceText, pdfSourceTextSha256, sha256PdfSourceBytes,
  type PdfRect, type PdfSourceAnchorV1 } from '@shrubbery/nucleus'

export interface TipTapJsonNode {
  type?: string
  text?: string
  attrs?: Record<string, unknown> | null
  marks?: Array<{ type: string; attrs?: Record<string, unknown> | null }>
  content?: TipTapJsonNode[]
}

export type PdfExtractionStatus = 'text-extracted' | 'partial' | 'no-text'

interface PdfFastParseInput {
  bytes: Uint8Array
  fallbackTitle: string
  signal?: AbortSignal
}

export interface PdfFastParseResult {
  title: string
  tiptapJson: TipTapJsonNode
  warnings: string[]
  stats: Record<string, unknown>
  extractionStatus: PdfExtractionStatus
}

interface PdfTextItemLike {
  str: string
  transform?: unknown[]
  width?: number
  height?: number
  hasEOL?: boolean
  fontName?: string
}

interface PdfTextStyleLike {
  fontFamily?: string
  ascent?: number
  descent?: number
  vertical?: boolean
}

interface PdfTextSpan {
  text: string
  x: number
  y: number
  width: number
  height: number
  fontSize: number
  fontName: string
  sourceRect: PdfRect | null
}

interface PdfTextLine {
  pageNumber: number
  text: string
  normalized: string
  x: number
  x2: number
  y: number
  width: number
  height: number
  fontSize: number
  fontName: string
  cells: string[]
  sourceRects: PdfRect[] | null
}

interface PdfPageLayout {
  pageNumber: number
  width: number
  height: number
  bodyFontSize: number
  medianLineGap: number
  lines: PdfTextLine[]
  frame: Omit<PdfSourceAnchorV1['targets'][number], 'rects'> | null
}

type PdfLineRole = 'body' | 'heading' | 'list' | 'quote' | 'sidebar' | 'table' | 'skip'

interface ClassifiedLine {
  line: PdfTextLine
  role: PdfLineRole
  headingLevel?: number
}

interface PdfTextBlockUnit {
  type: 'heading' | 'paragraph' | 'listItem' | 'blockquote'
  text: string
  pageNumber: number
  role: string
  indent?: number
  level?: number
  listType?: string
  sourceRects: PdfRect[] | null
}

interface PdfTableBlockUnit {
  type: 'table'
  pageNumber: number
  role: string
  indent?: number
  rows: PdfTableRowUnit[]
  sourceRects: PdfRect[] | null
}

interface PdfTableRowUnit {
  cells: string[]
  isHeader: boolean
}

type PdfBlockUnit = PdfTextBlockUnit | PdfTableBlockUnit

const PDF_PARSE_YIELD_PAGE_INTERVAL = 2

export async function parsePdfFastTextDocument(input: PdfFastParseInput): Promise<PdfFastParseResult> {
  input.signal?.throwIfAborted()
  // One entry snapshot names exactly the bytes later handed to PDF.js; a
  // caller cannot change the hash/text relationship across an async boundary.
  const sourceBytes = new Uint8Array(input.bytes)
  const pdfjs = await loadPdfJs()
  input.signal?.throwIfAborted()
  const source = { sha256: await sha256PdfSourceBytes(sourceBytes), byteLength: sourceBytes.byteLength }
  input.signal?.throwIfAborted()
  const loadingTask = pdfjs.getDocument({
    data: sourceBytes,
    disableFontFace: true,
    useSystemFonts: true,
    useWorkerFetch: false,
    useWasm: false,
    stopAtErrors: false,
  })

  const abort = () => { void loadingTask.destroy().catch(() => undefined) }
  input.signal?.addEventListener('abort', abort, { once: true })
  try {
    input.signal?.throwIfAborted()
    const pdf = await loadingTask.promise
    input.signal?.throwIfAborted()
    const rawMetadata = await pdf.getMetadata().catch(() => null)
    const title = pdfTitleFromMetadata(rawMetadata) ?? input.fallbackTitle
    const warnings: string[] = []
    const pages: PdfPageLayout[] = []
    let textItemCount = 0

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      input.signal?.throwIfAborted()
      const page = await pdf.getPage(pageNumber)
      try {
        const viewport = page.getViewport({ scale: 1 })
        const textContent = await page.getTextContent()
        const styles = textContent.styles as Record<string, PdfTextStyleLike | undefined>
        const textItems: PdfTextItemLike[] = []
        for (const item of textContent.items) {
          if (isPdfTextItem(item)) textItems.push(item)
        }
        input.signal?.throwIfAborted()
        const frame = pdfPageFrame(pageNumber - 1, page.view, page.rotate, page.userUnit)
        if (!frame) warnings.push(`Page ${pageNumber}: source mapping unavailable (unsupported page geometry)`)
        const spans = textItems.flatMap((item) => pdfTextItemToSpan(item, styles, frame, viewport))
        if (spans.length === 0) warnings.push(`Page ${pageNumber} did not contain extractable text; it may be blank or require OCR`)
        textItemCount += spans.length
        pages.push(pdfPageLayout(pageNumber, viewport.width, viewport.height, spans, frame))
      } catch (error) {
        input.signal?.throwIfAborted()
        warnings.push(`Page ${pageNumber}: text extraction failed (${error instanceof Error ? error.message : String(error)})`)
      } finally {
        page.cleanup()
      }
      if (pageNumber < pdf.numPages && pageNumber % PDF_PARSE_YIELD_PAGE_INTERVAL === 0) {
        await yieldToMainThread()
      }
    }

    input.signal?.throwIfAborted()
    const content = await assemblePdfTipTap(title, pages, source, pdfjs.version, warnings, input.signal)
    input.signal?.throwIfAborted()
    // The title is synthetic metadata, not evidence that source text survived.
    const totalChars = content.slice(1).reduce((sum, node) => sum + tiptapNodeTextLength(node), 0)
    if (totalChars === 0) {
      warnings.push(textItemCount === 0
        ? 'No text extracted; PDF may be blank, scanned or image-based. OCR was not performed.'
        : 'No source text remained after layout analysis. Review the retained original; OCR was not performed.')
      content.push({
        type: 'paragraph',
        attrs: { 'data-block-id': 'pdf-empty-text-warning', 'data-pdf-role': 'empty-text-warning' },
        content: [{ type: 'text', text: '[No source text is available in this extraction. Consult the original PDF. OCR was not performed.]' }],
      })
    }

    return {
      title,
      tiptapJson: { type: 'doc', content },
      warnings,
      extractionStatus: totalChars === 0 ? 'no-text' : warnings.length > 0 ? 'partial' : 'text-extracted',
      stats: {
        approachId: 'pdf.fast-text',
        parserVersion: pdfjs.version,
        pageCount: pdf.numPages,
        totalChars,
        textItemCount,
        layoutAssembler: 'span-line-column-region-v2-recovered-1',
      },
    }
  } catch (error) {
    input.signal?.throwIfAborted()
    throw error
  } finally {
    input.signal?.removeEventListener('abort', abort)
    await loadingTask.destroy().catch(() => undefined)
  }
}

async function yieldToMainThread(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

function isPdfTextItem(item: unknown): item is PdfTextItemLike {
  return Boolean(
    item
    && typeof item === 'object'
    && 'str' in item
    && typeof (item as { str?: unknown }).str === 'string',
  )
}

function pdfPageFrame(pageIndex: number, view: number[], rotation: number, userUnit: number): PdfPageLayout['frame'] {
  if (!Array.isArray(view) || view.length !== 4 || !view.every(n => Number.isFinite(n) && Math.abs(n) <= 1e9)
    || !(view[2] > view[0]) || !(view[3] > view[1]) || ![0, 90, 180, 270].includes(rotation)
    || !Number.isFinite(userUnit) || userUnit <= 0 || userUnit > 1e6) return null
  return { pageIndex, space: 'pdf-user-space', viewBox: [...view] as unknown as PdfRect,
    rotation: rotation as 0 | 90 | 180 | 270, userUnit }
}

function pdfTextItemToSpan(item: PdfTextItemLike, styles: Record<string, PdfTextStyleLike | undefined>,
  frame: PdfPageLayout['frame'], viewport: { height: number; transform?: number[] }): PdfTextSpan[] {
  const text = item.str.replace(/\s+/g, ' ').trim()
  if (!text) return []
  const transform = Array.isArray(item.transform) ? item.transform : []
  let x = finiteNumber(transform[4]) ?? 0
  let y = finiteNumber(transform[5]) ?? 0
  let fontSize = Math.hypot(finiteNumber(transform[2]) ?? 0, finiteNumber(transform[3]) ?? finiteNumber(item.height) ?? 10)
  let width = Math.max(0, finiteNumber(item.width) ?? text.length * fontSize * 0.5)
  let height = Math.max(1, finiteNumber(item.height) ?? fontSize)
  const style = item.fontName ? styles[item.fontName] : undefined
  let sourceRect: PdfRect | null = null
  if (frame && transform.length === 6 && transform.every(n => typeof n === 'number' && Number.isFinite(n))) {
    const [a, b, c, d, e, f] = transform as number[]
    const baselineLength = Math.hypot(a, b)
    const advance = style?.vertical ? item.height : item.width
    if (baselineLength > 0 && fontSize > 0 && typeof advance === 'number' && Number.isFinite(advance) && advance > 0) {
      const dx = (style?.vertical ? -b : a) / baselineLength * advance
      const dy = (style?.vertical ? a : b) / baselineLength * advance
      const upX = style?.vertical ? -d : c, upY = style?.vertical ? c : d
      // Font-level extent, not glyph/ink or character alignment. Use PDF.js
      // font ascent/descent when available; its text-layer fallback is 0.8em.
      let ascent = finiteNumber(style?.ascent) ?? (finiteNumber(style?.descent) === null ? 0.8 : 1 + style!.descent!)
      let descent = finiteNumber(style?.descent) ?? ascent - 1
      // Some embedded fonts report two zero metrics despite visible, positive-
      // size text. PDF.js TextLayer also ignores that unusable pair and falls
      // back to 0.8em ascent; use a one-em font box, not a glyph-ink claim.
      if (ascent === 0 && descent === 0) { ascent = 0.8; descent = -0.2 }
      const points = [[e + upX * descent, f + upY * descent], [e + upX * ascent, f + upY * ascent],
        [e + dx + upX * descent, f + dy + upY * descent], [e + dx + upX * ascent, f + dy + upY * ascent]]
      const [cx1, cy1, cx2, cy2] = frame.viewBox
      const bounds: PdfRect = [Math.max(cx1, Math.min(...points.map(p => p[0]))), Math.max(cy1, Math.min(...points.map(p => p[1]))),
        Math.min(cx2, Math.max(...points.map(p => p[0]))), Math.min(cy2, Math.max(...points.map(p => p[1])))]
      if (bounds.every(Number.isFinite) && bounds[2] > bounds[0] && bounds[3] > bounds[1]) sourceRect = bounds
    }
    const v = viewport.transform
    if (v?.length === 6 && v.every(Number.isFinite)) {
      const map = (px: number, py: number) => [v[0] * px + v[2] * py + v[4], v[1] * px + v[3] * py + v[5]]
      const baseline = map(e, f)
      const end = map(e + a / Math.max(baselineLength, 1e-12) * width, f + b / Math.max(baselineLength, 1e-12) * width)
      x = Math.min(baseline[0], end[0]); y = viewport.height - baseline[1]
      width = Math.abs(end[0] - baseline[0])
      fontSize = Math.hypot(v[0] * c + v[2] * d, v[1] * c + v[3] * d)
      height = Math.max(1, fontSize)
    }
  }
  return [{
    text,
    x,
    y,
    width,
    height,
    fontSize,
    fontName: [item.fontName, style?.fontFamily].filter(Boolean).join(' '),
    sourceRect,
  }]
}

function pdfPageLayout(pageNumber: number, width: number, height: number, spans: PdfTextSpan[], frame: PdfPageLayout['frame']): PdfPageLayout {
  const lines = spansToLines(pageNumber, width, height, spans)
  return {
    pageNumber,
    width,
    height,
    bodyFontSize: median(lines.map((line) => line.fontSize).filter((value) => value > 0)) ?? 10,
    medianLineGap: median(lineGaps(lines)) ?? 14,
    lines,
    frame,
  }
}

function spansToLines(pageNumber: number, pageWidth: number, pageHeight: number, spans: PdfTextSpan[]): PdfTextLine[] {
  const sorted = [...spans].sort((left, right) => {
    const yDelta = right.y - left.y
    if (Math.abs(yDelta) > 1.5) return yDelta
    return left.x - right.x
  })
  const groups: PdfTextSpan[][] = []
  let current: PdfTextSpan[] = []
  let currentY = 0
  let currentHeight = 0

  for (const span of sorted) {
    if (current.length > 0) {
      const y = currentY / current.length
      const height = currentHeight / current.length || span.height
      if (Math.abs(y - span.y) <= Math.max(2.5, height * 0.45)) {
        current.push(span)
        currentY += span.y
        currentHeight += span.height
        continue
      }
      groups.push(current)
    }
    current = [span]
    currentY = span.y
    currentHeight = span.height
  }
  if (current.length > 0) groups.push(current)

  const visualLineGroups = groups.flatMap((group) => splitVisualLineGroup(group, pageWidth))
  const visualLines = visualLineGroups.map((group) => spanGroupToLine(pageNumber, group))
    .filter((line) => line.text.length > 0)
    .sort((left, right) => {
      const yDelta = right.y - left.y
      if (Math.abs(yDelta) > 1.5) return yDelta
      return left.x - right.x
    })

  return orderLinesForReading(pageWidth, pageHeight, visualLines)
}

function spanGroupToLine(pageNumber: number, spans: PdfTextSpan[]): PdfTextLine {
  const ordered = [...spans].sort((left, right) => left.x - right.x)
  const lineHeight = Math.max(...ordered.map((span) => span.height), 1)
  const cells = spansToCells(ordered, lineHeight)
  const text = cells.join(' ').replace(/  +/g, ' ').trim()
  const x = Math.min(...ordered.map((span) => span.x))
  const x2 = Math.max(...ordered.map((span) => span.x + span.width))
  return {
    pageNumber,
    text,
    normalized: normalizePdfText(text),
    x,
    x2,
    y: average(ordered.map((span) => span.y)),
    width: x2 - x,
    height: lineHeight,
    fontSize: Math.max(...ordered.map((span) => span.fontSize)),
    fontName: ordered.map((span) => span.fontName).join(' '),
    cells,
    sourceRects: ordered.every(span => span.sourceRect !== null) ? ordered.map(span => span.sourceRect!) : null,
  }
}

function splitVisualLineGroup(spans: PdfTextSpan[], pageWidth: number): PdfTextSpan[][] {
  const ordered = [...spans].sort((left, right) => left.x - right.x)
  const lineHeight = Math.max(...ordered.map((span) => span.height), 1)
  if (isLikelySpanTableRow(ordered, pageWidth)) return [spans]

  const midpoint = pageWidth / 2
  const leftSpans = ordered.filter((span) => span.x < midpoint)
  const rightSpans = ordered.filter((span) => span.x >= midpoint)
  // A font/style boundary can put another PDF.js item beyond the midpoint
  // inside one ordinary line. Columns need whitespace between glyph bounds,
  // not merely a large distance between the two items' starting positions.
  const gutter = leftSpans.length && rightSpans.length
    ? Math.min(...rightSpans.map((span) => span.x)) - Math.max(...leftSpans.map((span) => span.x + span.width))
    : 0
  if (
    leftSpans.length > 0
    && rightSpans.length > 0
    && Math.min(...rightSpans.map((span) => span.x)) - Math.min(...leftSpans.map((span) => span.x)) > pageWidth * 0.25
    && gutter > Math.max(18, pageWidth * 0.025)
  ) {
    return [leftSpans, rightSpans]
  }

  const cellGroups = spansToCellGroups(ordered, lineHeight)
  if (!shouldSplitColumnCells(cellGroups, pageWidth)) return [spans]
  return cellGroups
}

function spansToCellGroups(spans: PdfTextSpan[], lineHeight: number): PdfTextSpan[][] {
  const groups: PdfTextSpan[][] = []
  let current: PdfTextSpan[] = []
  let previous: PdfTextSpan | null = null
  for (const span of spans) {
    if (previous) {
      const gap = span.x - (previous.x + previous.width)
      if (gap > Math.max(10, lineHeight * 0.9)) {
        if (current.length > 0) groups.push(current)
        current = [span]
      } else {
        current.push(span)
      }
    } else {
      current = [span]
    }
    previous = span
  }
  if (current.length > 0) groups.push(current)
  return groups
}

function shouldSplitColumnCells(cellGroups: PdfTextSpan[][], pageWidth: number): boolean {
  if (cellGroups.length < 2) return false
  const cells = cellGroups.map((group) => spanGroupPlainText(group))
  if (isLikelyVisualTableRow(cells)) return false
  const groupBounds = cellGroups.map((group) => ({
    x: Math.min(...group.map((span) => span.x)),
    x2: Math.max(...group.map((span) => span.x + span.width)),
  }))
  const widestGap = groupBounds.slice(1).reduce((maxGap, bounds, index) => {
    const previous = groupBounds[index]
    return Math.max(maxGap, bounds.x - (previous?.x2 ?? bounds.x))
  }, 0)
  return widestGap > Math.max(18, pageWidth * 0.025)
}

function spanGroupPlainText(spans: PdfTextSpan[]): string {
  return spans
    .sort((left, right) => left.x - right.x)
    .reduce((result, span) => {
      if (!result) return span.text
      return `${result}${pdfTextNeedsSpace(result, span.text) ? ' ' : ''}${span.text}`
    }, '')
    .trim()
}

function spansToCells(spans: PdfTextSpan[], lineHeight: number): string[] {
  return spansToCellGroups(spans, lineHeight)
    .map((group) => spanGroupPlainText(group))
    .filter((cell) => cell.length > 0)
}

function orderLinesForReading(pageWidth: number, pageHeight: number, lines: PdfTextLine[]): PdfTextLine[] {
  const columnLayout = detectTwoColumnLayout(pageWidth, pageHeight, lines)
  if (!columnLayout) return lines

  const sorted = [...lines].sort(visualLineSort)
  const ordered: PdfTextLine[] = []
  let band: PdfTextLine[] = []
  const flushBand = () => {
    if (band.length === 0) return
    ordered.push(...orderColumnBand(band, columnLayout.splitX))
    band = []
  }

  for (const line of sorted) {
    if (isFullWidthReadingLine(line, pageWidth, columnLayout.splitX)) {
      flushBand()
      ordered.push(line)
    } else {
      band.push(line)
    }
  }
  flushBand()
  return ordered
}

function detectTwoColumnLayout(pageWidth: number, pageHeight: number, lines: PdfTextLine[]): { splitX: number } | null {
  const candidates = lines.filter((line) => (
    line.y > pageHeight * 0.10
    && line.y < pageHeight * 0.97
    && line.width > 36
    && line.width < pageWidth * 0.48
    && line.text.length >= 18
    && !isLikelyVisualTableRow(line.cells)
  ))
  if (candidates.length < 10) return null

  const midpoint = pageWidth / 2
  const left = candidates.filter((line) => line.x2 < midpoint)
  const right = candidates.filter((line) => line.x > midpoint)
  if (left.length < 6 || right.length < 6) return null

  const leftEdge = median(left.map((line) => line.x2))
  const rightEdge = median(right.map((line) => line.x))
  if (leftEdge === null || rightEdge === null || rightEdge - leftEdge < pageWidth * 0.08) return null

  return { splitX: (leftEdge + rightEdge) / 2 }
}

function orderColumnBand(lines: PdfTextLine[], splitX: number): PdfTextLine[] {
  const left: PdfTextLine[] = []
  const right: PdfTextLine[] = []
  const crossing: PdfTextLine[] = []

  for (const line of lines) {
    if (line.x < splitX && line.x2 > splitX) {
      crossing.push(line)
    } else if (line.x < splitX) {
      left.push(line)
    } else {
      right.push(line)
    }
  }

  return [
    ...crossing.sort(visualLineSort),
    ...left.sort(visualLineSort),
    ...right.sort(visualLineSort),
  ]
}

function isFullWidthReadingLine(line: PdfTextLine, pageWidth: number, splitX: number): boolean {
  if (isLikelyVisualTableRow(line.cells) && line.width > pageWidth * 0.42) return true
  if (line.width > pageWidth * 0.62) return true
  return line.x < splitX - pageWidth * 0.20 && line.x2 > splitX + pageWidth * 0.20
}

function visualLineSort(left: PdfTextLine, right: PdfTextLine): number {
  const yDelta = right.y - left.y
  if (Math.abs(yDelta) > 1.5) return yDelta
  return left.x - right.x
}

function isLikelyVisualTableRow(cells: string[]): boolean {
  if (cells.length < 3) return false
  return cells.every((cell) => {
    const text = cell.trim()
    return text.length > 0 && text.length <= 48
  })
}

function isLikelySpanTableRow(spans: PdfTextSpan[], pageWidth: number): boolean {
  if (spans.length < 3) return false
  const xSpread = Math.max(...spans.map((span) => span.x)) - Math.min(...spans.map((span) => span.x))
  if (xSpread < pageWidth * 0.20) return false
  return spans.every((span) => span.text.trim().length > 0 && span.text.trim().length <= 48)
}

async function assemblePdfTipTap(title: string, pages: PdfPageLayout[], source: PdfSourceAnchorV1['source'],
  version: string, warnings: string[], signal?: AbortSignal): Promise<TipTapJsonNode[]> {
  const furniture = repeatedFurnitureSignatures(pages)
  const blocks: PdfBlockUnit[] = []
  const titleNorm = normalizePdfText(title)

  for (const page of pages) {
    const classified = classifyPageLines(page, furniture, titleNorm)
    blocks.push(...linesToBlocks(page, classified))
  }

  const content: TipTapJsonNode[] = [
    {
      type: 'heading',
      attrs: {
        level: 1,
        'data-block-id': 'pdf-title',
        'data-pdf-role': 'title',
      },
      content: [{ type: 'text', text: title }],
    },
  ]
  for (const [index, block] of applyOutlineIndent(blocks).entries()) {
    signal?.throwIfAborted()
    const node = blockToTipTapNode(block, index + 1)
    const frame = pages.find(page => page.pageNumber === block.pageNumber)?.frame
    if (frame && block.sourceRects?.length && pdfSourceText(node).length > 0) {
      // A failed digest is an operation failure, not a legitimate unmapped
      // geometry result. Only the codec's bounded validation is downgraded.
      const textSha256 = await pdfSourceTextSha256(node)
      signal?.throwIfAborted()
      try {
        node.attrs![PDF_SOURCE_ANCHOR_ATTRIBUTE] = encodePdfSourceAnchor({ version: 1, source,
          textSha256, relation: 'derived-from', precision: 'block',
          extraction: { approach: 'pdf.fast-text', version }, targets: [{ ...frame, rects: block.sourceRects }] })
      } catch {
        warnings.push(`Source mapping unavailable for ${String(node.attrs?.['data-block-id'])}: anchor does not satisfy version 1 bounds`)
      }
    } else if (frame) warnings.push(`Source mapping unavailable for ${String(node.attrs?.['data-block-id'])}: missing contributing geometry`)
    content.push(node)
  }
  return content
}

function sourceRects(lines: PdfTextLine[]): PdfRect[] | null {
  return lines.every(line => line.sourceRects !== null) ? lines.flatMap(line => line.sourceRects!) : null
}

function classifyPageLines(page: PdfPageLayout, furniture: Set<string>, titleNorm: string): ClassifiedLine[] {
  const result: ClassifiedLine[] = []
  let listModeX: number | null = null
  let previousKept: PdfTextLine | null = null

  for (const line of page.lines) {
    if (isFurnitureLine(page, line, furniture) || isDuplicateTitleLine(line, titleNorm, page.bodyFontSize)) {
      result.push({ line, role: 'skip' })
      continue
    }

    let role: PdfLineRole = 'body'
    let headingLevel: number | undefined
    const heading = headingLevelForLine(line, page.bodyFontSize)
    if (isTableLine(line)) {
      role = 'table'
    } else if (isQuoteLine(line)) {
      role = 'quote'
    } else if (heading) {
      role = 'heading'
      headingLevel = heading
      listModeX = null
    } else if (isSidebarLine(page, line)) {
      role = 'sidebar'
      listModeX = null
    } else if (isListLine(line) || isIndentedListContinuation(line, previousKept, listModeX)) {
      role = 'list'
      listModeX = line.x
    } else {
      if (listModeX !== null && Math.abs(line.x - listModeX) > 14) listModeX = null
    }

    result.push({ line, role, headingLevel })
    previousKept = line
  }

  return result
}

function linesToBlocks(page: PdfPageLayout, classified: ClassifiedLine[]): PdfBlockUnit[] {
  const blocks: PdfBlockUnit[] = []
  let paragraphLines: PdfTextLine[] = []
  let quoteLines: PdfTextLine[] = []
  let sidebarLines: PdfTextLine[] = []
  let tableLines: PdfTextLine[] = []

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return
    blocks.push({
      type: 'paragraph',
      text: joinWrappedLines(paragraphLines),
      pageNumber: page.pageNumber,
      role: 'body',
      sourceRects: sourceRects(paragraphLines),
    })
    paragraphLines = []
  }
  const flushQuote = () => {
    if (quoteLines.length === 0) return
    blocks.push({
      type: 'blockquote',
      text: joinWrappedLines(quoteLines),
      pageNumber: page.pageNumber,
      role: 'quote',
      sourceRects: sourceRects(quoteLines),
    })
    quoteLines = []
  }
  const flushSidebar = () => {
    if (sidebarLines.length === 0) return
    const text = sidebarText(sidebarLines)
    blocks.push({
      type: 'blockquote',
      text,
      pageNumber: page.pageNumber,
      role: 'sidebar',
      sourceRects: sourceRects(sidebarLines),
    })
    sidebarLines = []
  }
  const flushTable = () => {
    if (tableLines.length === 0) return
    const rows = tableLines
      .map((line, index) => ({
        cells: normalizeTableCells(line.cells),
        isHeader: index === 0 || isLikelyTableHeader(line),
      }))
      .filter((row) => row.cells.length >= 2)
    const columnCount = Math.max(0, ...rows.map((row) => row.cells.length))
    if (rows.length >= 2 && columnCount >= 2) {
      blocks.push({
        type: 'table',
        pageNumber: page.pageNumber,
        role: 'table',
        sourceRects: sourceRects(tableLines),
        rows: normalizeTableRows(rows, columnCount),
      })
    } else {
      for (const line of tableLines) {
        blocks.push({
          type: 'paragraph',
          text: normalizeTableCells(line.cells).join(' | '),
          pageNumber: page.pageNumber,
          role: 'table-row',
          sourceRects: line.sourceRects,
        })
      }
    }
    tableLines = []
  }
  const flushAll = () => {
    flushParagraph()
    flushQuote()
    flushSidebar()
    flushTable()
  }

  for (const item of classified) {
    if (item.role === 'skip') continue

    if (item.role === 'body') {
      flushSidebar()
      flushTable()
      flushQuote()
      const previous = paragraphLines[paragraphLines.length - 1]
      if (previous && startsNewParagraph(page, previous, item.line)) {
        flushParagraph()
      }
      paragraphLines.push(item.line)
      continue
    }

    if (item.role === 'quote') {
      flushParagraph()
      flushSidebar()
      flushTable()
      quoteLines.push(item.line)
      continue
    }

    if (item.role === 'sidebar') {
      flushParagraph()
      flushQuote()
      flushTable()
      sidebarLines.push(item.line)
      continue
    }

    if (item.role === 'table') {
      flushParagraph()
      flushQuote()
      flushSidebar()
      tableLines.push(item.line)
      continue
    }

    flushAll()
    if (item.role === 'heading') {
      blocks.push({
        type: 'heading',
        text: item.line.text.replace(/:$/, ''),
        pageNumber: page.pageNumber,
        role: 'heading',
        sourceRects: item.line.sourceRects,
        level: item.headingLevel ?? 2,
      })
    } else if (item.role === 'list') {
      blocks.push({
        type: 'listItem',
        text: item.line.text.replace(/^[-•*]\s+/, '').replace(/^\d+[.)]\s+/, ''),
        pageNumber: page.pageNumber,
        role: 'list',
        sourceRects: item.line.sourceRects,
        listType: /^\d+[.)]\s+/.test(item.line.text) ? 'ordered' : 'bullet',
      })
    }
  }

  flushAll()
  return blocks
}

function startsNewParagraph(page: PdfPageLayout, previous: PdfTextLine, current: PdfTextLine): boolean {
  const gap = previous.y - current.y
  if (gap > Math.max(page.medianLineGap * 1.55, previous.height * 1.85)) return true
  if (Math.abs(previous.x - current.x) > 24) return true
  // A first-line indent is commonly much smaller than 24 points. Require a
  // completed preceding sentence and a positive indent so the following
  // wrapped line's return to the margin does not create another paragraph.
  if (current.x - previous.x >= Math.max(6, page.bodyFontSize * 0.6)
    && /[.!?][\u201d\u2019"')\]]*$/.test(previous.text.trim())) return true
  if (/[:.!?]$/.test(previous.text) && gap > page.medianLineGap * 1.22) return true
  return false
}

function sidebarText(lines: PdfTextLine[]): string {
  const labelIndex = lines.findIndex((line) => /^side note:?$/i.test(line.text.trim()))
  if (labelIndex < 0) {
    return joinWrappedLines(lines).replace(/^side note\s+/i, 'side note — ')
  }

  const label = lines[labelIndex]?.text.trim().replace(/:$/, '') ?? 'side note'
  const contentLines = lines.filter((_, index) => index !== labelIndex)
  const content = joinWrappedLines(contentLines)
  return content ? `${label} — ${content}` : label
}

function normalizeTableCells(cells: string[]): string[] {
  return cells.map((cell) => cell.replace(/\s+/g, ' ').trim())
    .filter((cell) => cell.length > 0)
}

function normalizeTableRows(rows: PdfTableRowUnit[], columnCount: number): PdfTableRowUnit[] {
  return rows.map((row) => {
    const cells = row.cells.slice(0, columnCount)
    while (cells.length < columnCount) cells.push('')
    return { ...row, cells }
  })
}

function applyOutlineIndent(blocks: PdfBlockUnit[]): PdfBlockUnit[] {
  let currentHeadingIndent: number | null = null

  return blocks.map((block) => {
    if (block.type === 'heading') {
      const level = Math.max(2, Math.min(3, block.level ?? 2))
      const indent = Math.max(0, level - 2)
      currentHeadingIndent = indent
      return { ...block, level, indent }
    }

    if (currentHeadingIndent === null) {
      return block
    }

    return {
      ...block,
      indent: Math.min(6, currentHeadingIndent + 1),
    }
  })
}

function isLikelyTableHeader(line: PdfTextLine): boolean {
  if (line.fontName.toLowerCase().includes('bold')) return true
  if (line.cells.length < 2) return false
  return line.cells.every((cell) => {
    const words = cell.trim().split(/\s+/)
    return words.length <= 3 && /^[A-Z]/.test(cell.trim())
  })
}

function blockToTipTapNode(block: PdfBlockUnit, index: number): TipTapJsonNode {
  if (block.type === 'table') {
    return tableBlockToTipTapNode(block, index)
  }

  const attrs: Record<string, unknown> = {
    'data-block-id': `pdf-p${block.pageNumber}-b${index}`,
    'data-pdf-page': block.pageNumber,
    'data-pdf-role': block.role,
    'data-source-format': 'pdf',
    'data-source-approach': 'pdf.fast-text',
    'data-source-page': block.pageNumber,
    'data-source-role': block.role,
    'data-source-id': `pdf-p${block.pageNumber}-b${index}`,
  }
  if (block.type === 'heading') {
    attrs.level = Math.max(2, Math.min(3, block.level ?? 2))
  }
  if (block.indent !== undefined && block.indent > 0) {
    attrs.indent = block.indent
  }
  if (block.type === 'listItem') {
    attrs.listType = block.listType ?? 'bullet'
  }
  return {
    type: block.type,
    attrs,
    content: block.text ? [{ type: 'text', text: block.text }] : undefined,
  }
}

function tableBlockToTipTapNode(block: PdfTableBlockUnit, index: number): TipTapJsonNode {
  const sourceId = `pdf-p${block.pageNumber}-b${index}`
  const attrs: Record<string, unknown> = {
    'data-block-id': sourceId,
    'data-pdf-page': block.pageNumber,
    'data-pdf-role': block.role,
    'data-source-format': 'pdf',
    'data-source-approach': 'pdf.fast-text',
    'data-source-page': block.pageNumber,
    'data-source-role': block.role,
    'data-source-id': sourceId,
  }
  if (block.indent !== undefined && block.indent > 0) {
    attrs.indent = block.indent
  }

  return {
    type: 'table',
    attrs,
    content: block.rows.map((row) => ({
      type: 'tableRow',
      content: row.cells.map((cell) => ({
        type: row.isHeader ? 'tableHeader' : 'tableCell',
        attrs: {
          colspan: 1,
          rowspan: 1,
          colwidth: null,
        },
        content: [{
          type: 'paragraph',
          content: cell ? [{ type: 'text', text: cell }] : undefined,
        }],
      })),
    })),
  }
}

function headingLevelForLine(line: PdfTextLine, bodyFontSize: number): number | null {
  const relative = line.fontSize / Math.max(1, bodyFontSize)
  const text = line.text.trim()
  const shortEnough = text.length <= 96
  if (/^(?:[IVX]+\.|Chapter|Section|Part)\s+/i.test(text) && shortEnough) return 2
  if (relative >= 1.75 && shortEnough) return 2
  if (relative >= 1.32 && shortEnough && !/[.;]$/.test(text) && !/[.;]\s/.test(text)) return 3
  if (relative >= 1.1 && shortEnough && /:$/.test(text)) return 3
  return null
}

function isQuoteLine(line: PdfTextLine): boolean {
  return /^>\s+/.test(line.text.trim())
}

function isTableLine(line: PdfTextLine): boolean {
  if (line.cells.length < 3) return false
  if (line.text.length < 18) return false
  return line.cells.every((cell) => cell.length > 0 && cell.length <= 40)
}

function isSidebarLine(page: PdfPageLayout, line: PdfTextLine): boolean {
  return line.x > page.width * 0.62 && line.width < page.width * 0.28 && line.fontSize <= page.bodyFontSize * 1.05
}

function isListLine(line: PdfTextLine): boolean {
  return /^[-•*]\s+/.test(line.text) || /^\d+[.)]\s+/.test(line.text)
}

function isIndentedListContinuation(line: PdfTextLine, previous: PdfTextLine | null, listModeX: number | null): boolean {
  if (listModeX !== null && Math.abs(line.x - listModeX) < 14 && line.text.length <= 140) return true
  return Boolean(
    previous
    && previous.text.endsWith(':')
    && line.x > previous.x + 20
    && line.text.length <= 140,
  )
}

function repeatedFurnitureSignatures(pages: PdfPageLayout[]): Set<string> {
  if (pages.length < 2) return new Set()
  const pageNumbersBySignature = new Map<string, Set<number>>()
  for (const page of pages) {
    for (const line of page.lines) {
      if (!isPageEdgeLine(page, line)) continue
      const signature = furnitureSignature(line.text)
      if (!signature || signature.length < 10) continue
      const pageNumbers = pageNumbersBySignature.get(signature) ?? new Set<number>()
      pageNumbers.add(page.pageNumber)
      pageNumbersBySignature.set(signature, pageNumbers)
    }
  }
  return new Set(
    [...pageNumbersBySignature.entries()]
      .filter(([, pageNumbers]) => pageNumbers.size >= 2)
      .map(([signature]) => signature),
  )
}

function isFurnitureLine(page: PdfPageLayout, line: PdfTextLine, furniture: Set<string>): boolean {
  if (/^\d+$/.test(line.text.trim()) && isPageEdgeLine(page, line)) return true
  return isPageEdgeLine(page, line) && furniture.has(furnitureSignature(line.text))
}

function isPageEdgeLine(page: PdfPageLayout, line: PdfTextLine): boolean {
  return line.y < page.height * 0.09 || line.y > page.height * 0.94
}

function isDuplicateTitleLine(line: PdfTextLine, titleNorm: string, bodyFontSize: number): boolean {
  if (!titleNorm || line.fontSize < bodyFontSize * 1.45) return false
  return titleNorm === line.normalized || titleNorm.startsWith(line.normalized)
}

function joinWrappedLines(lines: PdfTextLine[]): string {
  return lines.reduce((result, line) => {
    const text = line.text.trim()
    if (!result) return text
    if (result.endsWith('-')) return `${result.slice(0, -1)}${text}`
    return `${result} ${text}`
  }, '').replace(/  +/g, ' ').trim()
}

function lineGaps(lines: PdfTextLine[]): number[] {
  const gaps: number[] = []
  for (let index = 1; index < lines.length; index += 1) {
    const gap = lines[index - 1].y - lines[index].y
    if (gap > 0 && gap < 80) gaps.push(gap)
  }
  return gaps
}

function pdfTitleFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null
  const info = (metadata as { info?: unknown }).info
  if (!info || typeof info !== 'object') return null
  const title = (info as { Title?: unknown }).Title
  return typeof title === 'string' && title.trim() ? title.trim() : null
}

function normalizePdfText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ')
}

function furnitureSignature(value: string): string {
  return normalizePdfText(value).replace(/\b\d+\b/g, '#')
}

function pdfTextNeedsSpace(left: string, right: string): boolean {
  if (!left || !right) return false
  const last = left[left.length - 1] ?? ''
  const first = right[0] ?? ''
  if (/\s/.test(last) || /\s/.test(first)) return false
  if (/^[,.;:!?%)]$/.test(first)) return false
  if (/^[(\[{]$/.test(last)) return false
  return true
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle] ?? null
}

function tiptapNodeTextLength(node: TipTapJsonNode): number {
  if (node.type === 'text') return node.text?.length ?? 0
  return (node.content ?? []).reduce((sum, child) => sum + tiptapNodeTextLength(child), 0)
}
