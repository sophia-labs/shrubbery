/**
 * Where a claim is printed, found from the PDF's own text. The reader's output carries a page and no boxes (Tom's envelope drops
 * Docling's provenance), so a claim is located here: on its page, find the line (or the two or three lines of a wrapped row) whose
 * words carry the parameter or symbol AND whose numbers carry the value, and box it. A claim that matches nothing is "not located":
 * no box is invented.
 *
 * Pure functions over pdf.js text items, so the same code runs in the browser (the text layer's source) and in Node (the hit-rate
 * measurement over real corpus PDFs).
 */

/** The part of a pdf.js `TextItem` this needs. */
export interface TextItemLike {
  readonly str: string
  readonly transform: readonly number[]
  readonly width: number
  readonly height: number
}

/** A rectangle in PDF user space (origin bottom-left, y up). */
export interface UserRect { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }

export interface PageLine {
  readonly text: string
  /** Letters and digits only, lower case, no spaces: for symbols that the page splits across items. */
  readonly squashed: string
  readonly words: ReadonlySet<string>
  readonly numbers: readonly number[]
  readonly rect: UserRect
  readonly height: number
}

export interface LocateClaim {
  readonly id: string
  /** The parameter's name as the reader gave it ('Input offset voltage'). */
  readonly label: string
  /** The symbol as printed ('VIO'), or ''. */
  readonly symbol: string
  /** The numbers the claim states (min, typ, max), in the units as printed. */
  readonly numbers: readonly number[]
}

export interface Located {
  readonly rect: UserRect
  /** 0..1: how sure the match is. */
  readonly score: number
  /** The printed text of the matched line(s). */
  readonly text: string
}

const STOP = new Set(['the', 'of', 'and', 'to', 'for', 'at', 'in', 'a', 'an', 'or', 'on', 'with', 'by', 'per'])

export const words = (text: string): string[] =>
  text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9µμ]+/g, ' ').split(' ').filter(w => w.length >= 2 && !STOP.has(w))

export const squash = (text: string): string => text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '')

/** The numbers a line prints. A sign counts only at the start of a token ("1.8-6.5" is 1.8 and 6.5); thousands commas are dropped. */
export function numbersIn(text: string): number[] {
  const out: number[] = []
  const t = text.replace(/(\d),(\d{3})(?!\d)/g, '$1$2')
  for (const m of t.matchAll(/(?<![\d.])[-−]?\d+(?:\.\d+)?/g)) {
    const n = Number(m[0].replace('−', '-'))
    if (Number.isFinite(n)) out.push(n)
  }
  return out
}

/** Text items → lines: items on one baseline are one line, left to right. */
export function linesOf(items: readonly TextItemLike[]): PageLine[] {
  const pieces = items.filter(i => i.str.trim() !== '' && i.transform.length >= 6)
    .map(i => ({ str: i.str, x: i.transform[4]!, y: i.transform[5]!, w: i.width, h: Math.abs(i.height) || Math.abs(i.transform[3]!) || 8 }))
    .sort((a, b) => b.y - a.y || a.x - b.x)
  const rows: (typeof pieces)[] = []
  for (const piece of pieces) {
    const row = rows[rows.length - 1]
    if (row && Math.abs(row[0]!.y - piece.y) <= Math.max(1.5, 0.4 * Math.max(row[0]!.h, piece.h))) row.push(piece)
    else rows.push([piece])
  }
  return rows.map(row => {
    row.sort((a, b) => a.x - b.x)
    let text = ''
    let last = -Infinity
    for (const p of row) {
      text += (text && p.x - last > 0.12 * p.h ? ' ' : '') + p.str
      last = p.x + p.w
    }
    const h = Math.max(...row.map(p => p.h))
    const y = row[0]!.y
    return { text, squashed: squash(text), words: new Set(words(text)), numbers: numbersIn(text), height: h,
      rect: { x0: Math.min(...row.map(p => p.x)), x1: Math.max(...row.map(p => p.x + p.w)), y0: y - 0.25 * h, y1: y + 0.9 * h } }
  })
}

const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 + 1e-4 * Math.abs(b)

function labelScore(claim: LocateClaim, text: string[], squashed: string, lineWords: ReadonlySet<string>): number {
  const tokens = text
  let hit = 0
  for (const t of tokens) if (lineWords.has(t) || [...lineWords].some(w => w.length >= 4 && t.length >= 4 && (w.startsWith(t) || t.startsWith(w)))) hit++
  const byWords = tokens.length ? hit / tokens.length : 0
  const symbol = squash(claim.symbol)
  const bySymbol = symbol.length >= 2 && squashed.includes(symbol) ? 0.8 : 0
  return Math.max(byWords, bySymbol)
}

const union = (a: UserRect, b: UserRect): UserRect => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) })

/**
 * The best line (or short run of lines) for each claim on one page. `taken` is the set of lines already given to a claim of
 * this page: a line a claim already has is passed over for an equally good unused one, so two rows that differ only in their
 * numbers get their own lines.
 */
export function locateOnPage(lines: readonly PageLine[], claims: readonly LocateClaim[]): Map<string, Located> {
  const found = new Map<string, Located>()
  const taken = new Set<number>()
  for (const claim of claims) {
    const tokens = words(claim.label)
    let best: { score: number; from: number; to: number } | null = null
    for (let i = 0; i < lines.length; i++) {
      let merged = ''
      let squashed = ''
      const mergedWords = new Set<string>()
      const numbers: number[] = []
      for (let to = i; to < Math.min(lines.length, i + 3); to++) {
        const line = lines[to]!
        if (to > i && lines[to - 1]!.rect.y0 - line.rect.y1 > 2.2 * line.height) break
        merged += ` ${line.text}`
        squashed += line.squashed
        for (const w of line.words) mergedWords.add(w)
        numbers.push(...line.numbers)
        const label = labelScore(claim, tokens, squashed, mergedWords)
        let score: number
        if (claim.numbers.length) {
          const matched = claim.numbers.filter(n => numbers.some(m => near(m, n))).length / claim.numbers.length
          if (matched < 0.5 || label < 0.4) continue
          score = 0.55 * matched + 0.45 * label
        } else {
          if (label < 0.8) continue
          score = 0.8 * label
        }
        score -= 0.03 * (to - i)
        if (taken.has(i)) score -= 0.02
        if (!best || score > best.score + 1e-9) best = { score, from: i, to }
      }
      void merged
    }
    if (best && best.score >= 0.5) {
      let rect = lines[best.from]!.rect
      const printed: string[] = []
      for (let k = best.from; k <= best.to; k++) { rect = union(rect, lines[k]!.rect); taken.add(k); printed.push(lines[k]!.text) }
      found.set(claim.id, { rect, score: best.score, text: printed.join(' / ') })
    }
  }
  return found
}

export interface LocateRow extends LocateClaim {
  /** The page the claim says it is on. */
  readonly page: number | null
  /** Other pages one of its readings was read on: tried when the claim's own page does not print it (a key value's prose page). */
  readonly alt: readonly number[]
}

export interface LocatedAt extends Located { readonly page: number }

/**
 * Every claim's box, page by page: a claim is looked for on its own page first, then on the pages of its readings. `lines` gives a
 * page's lines (the caller caches them); `onPage` lets a viewer draw boxes as pages finish.
 */
export async function locateAll(rows: readonly LocateRow[], lines: (page: number) => Promise<readonly PageLine[]>,
  onPage?: (page: number, found: ReadonlyMap<string, LocatedAt>) => void): Promise<Map<string, LocatedAt>> {
  const out = new Map<string, LocatedAt>()
  const pass = async (assign: (r: LocateRow) => number | null): Promise<void> => {
    const byPage = new Map<number, LocateRow[]>()
    for (const r of rows) {
      if (out.has(r.id)) continue
      const page = assign(r)
      if (page) byPage.set(page, [...(byPage.get(page) ?? []), r])
    }
    for (const [page, list] of [...byPage].sort((a, b) => a[0] - b[0])) {
      const found = locateOnPage(await lines(page), list)
      const here = new Map<string, LocatedAt>()
      for (const [id, hit] of found) { const at = { ...hit, page }; out.set(id, at); here.set(id, at) }
      if (here.size) onPage?.(page, here)
    }
  }
  await pass(r => r.page)
  const tries = Math.max(0, ...rows.map(r => r.alt.length))
  for (let k = 0; k < tries; k++) await pass(r => r.alt[k] ?? null)
  return out
}
