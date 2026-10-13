/**
 * mn-file-glyph — the ONE picture of a file and of a folder (review V4 / P1.12,
 * Files canvas design §4).
 *
 * Before this there were three icon systems for the same two objects: the tree
 * drew a generic diamond for a PDF and an amber folder, the canvas drew a bare
 * outlined box with a mis-set "PD/F", the grid drew a folded-corner paper with a
 * caption and a 72px green folder. This is the grid's drawing made the
 * standard: the folded-corner paper with a type caption, and a folder, drawn at
 * 16, 32, 64 and 96 px by the tree, the list and the canvas card.
 *
 * Skin-blind by construction. It reads tokens and nothing else:
 *   rest      stroke --mn-files-glyph-stroke (component.css: the quiet ink, which
 *             reaches 3:1 on every surface the glyph sits on, in every skin;
 *             98 draws it in its frame colour)
 *   selected  stroke --mn-color-text-accent
 * Accent means selection, never decoration. Paper is --mn-color-surface-editor
 * (the "reading paper" role), the folded corner and the folder body are
 * --mn-color-surface-subtle, the caption is --mn-color-text-secondary. A skin
 * that wants a different object (98's desktop icons) changes those roles, not
 * this file.
 *
 * The geometry is drawn in pixels for each of the four sizes, not scaled from
 * one master, so a one-pixel outline lands on half pixels and stays crisp at 16
 * and 32. The type caption is drawn from 32 px up; at 16 px it could not be read.
 *
 * Decorative by default (`aria-hidden`): the card, the row or the cell names the
 * file. Give it a `label` and it becomes an image with that name.
 */
import { LitElement, css, html, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'

export const GLYPH_SIZES = [16, 32, 64, 96] as const
export type GlyphSize = (typeof GLYPH_SIZES)[number]
export type GlyphKind = 'file' | 'folder' | 'document'

/** The nearest of the four sizes; a tie goes to the larger. Anything non-numeric is 32. */
export function snapGlyphSize(size: number): GlyphSize {
  if (!Number.isFinite(size)) return 32
  let best: GlyphSize = GLYPH_SIZES[0]
  for (const candidate of GLYPH_SIZES) {
    if (Math.abs(size - candidate) <= Math.abs(size - best)) best = candidate
  }
  return best
}

/**
 * The caption a type draws: upper-cased letters and digits only, four at most,
 * null when there is none. (`.pdf` draws PDF.) Alphanumerics only, so the
 * caption is safe to place in markup by construction.
 */
export function glyphCaption(type: string): string | null {
  const caption = type.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)
  return caption || null
}

type Point = readonly [x: number, y: number]

export interface GlyphGeometry {
  readonly kind: GlyphKind
  readonly size: GlyphSize
  readonly stroke: number
  /** The drawing's outer box, stroke included. Integer-aligned at 16 and 32 px. */
  readonly box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  /** The outline's centre line, a closed polygon inset half a stroke from the box. */
  readonly outline: readonly Point[]
  /** The folded corner of a file (a triangle inside the outline), null for a folder. */
  readonly fold: { readonly size: number; readonly points: readonly Point[] } | null
  /** Where a file's type caption sits, null where it would be unreadable (16 px) and for a folder. */
  readonly caption: { readonly x: number; readonly y: number; readonly fontSize: number } | null
}

const STROKE: Record<GlyphSize, number> = { 16: 1, 32: 1, 64: 1.5, 96: 2 }

/** Outer paper box (stroke included), the corner fold, and the caption's size in px (null: too small). */
const PAPER: Record<GlyphSize, { w: number; h: number; fold: number; font: number | null }> = {
  16: { w: 10, h: 14, fold: 4, font: null },
  32: { w: 22, h: 28, fold: 8, font: 7 },
  64: { w: 46, h: 58, fold: 16, font: 11 },
  96: { w: 68, h: 86, fold: 24, font: 16 },
}

/** Outer folder box (stroke included), the tab's length along the top, and its rise. */
const FOLDER: Record<GlyphSize, { w: number; h: number; tab: number; rise: number }> = {
  16: { w: 14, h: 11, tab: 6, rise: 2 },
  32: { w: 28, h: 22, tab: 12, rise: 4 },
  64: { w: 58, h: 46, tab: 24, rise: 8 },
  96: { w: 86, h: 68, tab: 36, rise: 12 },
}

/** The drawing for a kind at a size: pure, so the tree, the list and the canvas agree by construction. */
export function fileGlyphGeometry(kind: GlyphKind, size: GlyphSize): GlyphGeometry {
  const stroke = STROKE[size]
  const inset = stroke / 2
  if (kind === 'folder') {
    const { w, h, tab, rise } = FOLDER[size]
    const x = Math.floor((size - w) / 2), y = Math.floor((size - h) / 2)
    const l = x + inset, r = x + w - inset, top = y + inset, body = y + rise + inset, bottom = y + h - inset
    return { kind, size, stroke, box: { x, y, w, h }, fold: null, caption: null,
      outline: [[l, top], [l + tab, top], [l + tab + rise, body], [r, body], [r, bottom], [l, bottom]] }
  }
  const { w, h, fold, font } = PAPER[size]
  const x = Math.floor((size - w) / 2), y = Math.floor((size - h) / 2)
  const l = x + inset, r = x + w - inset, t = y + inset, b = y + h - inset
  return { kind, size, stroke, box: { x, y, w, h },
    outline: [[l, t], [r - fold, t], [r, t + fold], [r, b], [l, b]],
    fold: { size: fold, points: [[r - fold, t], [r - fold, t + fold], [r, t + fold]] },
    caption: font === null ? null : { x: size / 2, y: y + Math.round(h * 0.74), fontSize: font } }
}

const path = (points: readonly Point[], close: boolean) =>
  `${points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ')}${close ? ' Z' : ''}`

/** A document's face: the paper ruled with a few lines of text instead of a type caption (numbers only, nothing to escape). */
function ruledLines(g: GlyphGeometry): string {
  const { box } = g
  const left = box.x + Math.round(box.w * 0.22), right = box.x + Math.round(box.w * 0.78)
  const first = box.y + Math.round(box.h * 0.42), step = Math.max(3, Math.round(box.h * 0.14))
  return [0, 1, 2].map(i => `<path class="rule" data-part="rule" stroke-width="${g.stroke}" d="M${left} ${first + i * step} L${i === 2 ? left + Math.round((right - left) * 0.6) : right} ${first + i * step}"/>`).join('')
}

/**
 * The drawing as one `<svg>` string, rendered with `unsafeHTML` (the way
 * `icons.ts` does, and for its reason: happy-dom drops SVG children that Lit's
 * `svg` fragment tag builds, while a parsed `<svg>…</svg>` is right in every
 * engine). Every interpolated value is a number from `fileGlyphGeometry` or the
 * alphanumeric caption, so there is nothing to escape.
 */
function glyphMarkup(g: GlyphGeometry, caption: string | null, ruled = false): string {
  const part = g.kind === 'folder' ? 'folder' : 'paper'
  return `<svg width="${g.size}" height="${g.size}" viewBox="0 0 ${g.size} ${g.size}" focusable="false" aria-hidden="true">` +
    `<path class="outline" data-part="${part}" stroke-width="${g.stroke}" d="${path(g.outline, true)}"/>` +
    (g.fold ? `<path class="fold" data-part="fold" stroke-width="${g.stroke}" d="${path(g.fold.points, true)}"/>` : '') +
    (ruled && g.size >= 32 ? ruledLines(g) : '') +
    (g.caption && caption && !ruled
      ? `<text class="caption" data-part="caption" x="${g.caption.x}" y="${g.caption.y}" font-size="${g.caption.fontSize}">${caption}</text>`
      : '') +
    '</svg>'
}

@customElement('mn-file-glyph')
export class MnFileGlyph extends LitElement {
  static styles = css`
    :host {
      display: inline-flex;
      flex: none;
      line-height: 0;
      vertical-align: middle;
    }
    :host([hidden]) { display: none; }
    .art { display: block; line-height: 0; }
    svg { display: block; overflow: visible; }
    .outline, .fold {
      stroke: var(--mn-files-glyph-stroke);
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    .rule { stroke: var(--mn-files-glyph-stroke); stroke-linecap: round; opacity: 0.7; fill: none; }
    :host([selected]) .rule { stroke: var(--mn-color-text-accent); }
    .outline { fill: var(--mn-color-surface-editor); }
    .fold { fill: var(--mn-color-surface-subtle); }
    .caption {
      fill: var(--mn-color-text-secondary);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-weight: 600;
      letter-spacing: 0.06em;
      text-anchor: middle;
      user-select: none;
    }
    :host([selected]) .outline,
    :host([selected]) .fold { stroke: var(--mn-color-text-accent); }
    :host([selected]) .caption { fill: var(--mn-color-text-accent); }
  `

  /** What it draws. Anything but `folder` is a file. */
  @property({ type: String, reflect: true }) kind: GlyphKind = 'file'
  /** The type caption (`pdf` draws PDF). Drawn from 32 px up, never on a folder. */
  @property({ type: String }) type = ''
  /** 16, 32, 64 or 96 px; any other number snaps to the nearest of them. */
  @property({ type: Number, reflect: true }) size: GlyphSize = 32
  /** Strokes in accent instead of the neutral outline: the one thing accent is for. */
  @property({ type: Boolean, reflect: true }) selected = false
  /** An accessible name. Without one the glyph is decorative. */
  @property({ type: String }) label = ''

  render() {
    const size = snapGlyphSize(Number(this.size))
    const g = fileGlyphGeometry(this.kind === 'folder' ? 'folder' : 'file', size)
    const ruled = this.kind === 'document'
    return html`<span class="art" role=${this.label ? 'img' : nothing} aria-label=${this.label || nothing}
      aria-hidden=${this.label ? nothing : 'true'}>${unsafeHTML(glyphMarkup(g, glyphCaption(this.type), ruled))}</span>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-file-glyph': MnFileGlyph
  }
}
