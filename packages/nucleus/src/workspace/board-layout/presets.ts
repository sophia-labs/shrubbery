/**
 * The board layout presets: the only ELK options either side sends (plans/2026-10-30-elk-layout/DESIGN.md). The JSON
 * beside this file is a verbatim copy of the hub's `presets.json`; gardend carries the same copy, so a person's
 * "Lay out" and Sophia's `{op:"layout"}` hand ELK the same options and get the same picture.
 */
import presetsJson from './presets.json'

export type BoardLayoutStyle = 'flow' | 'tree' | 'radial' | 'grid'
export type BoardLayoutDirection = 'right' | 'down' | 'left' | 'up'
export type BoardLayoutSpacing = 'tight' | 'normal' | 'loose'

/** An ELK layout option value, exactly as the presets file writes it (a number stays a number). */
export type ElkOptionValue = string | number
export type ElkOptions = Readonly<Record<string, ElkOptionValue>>

interface PresetsFile {
  readonly version: number
  readonly elkjs: string
  readonly common: ElkOptions
  readonly styles: Readonly<Record<BoardLayoutStyle, ElkOptions>>
  readonly defaultStyle: BoardLayoutStyle
  readonly directions: Readonly<Record<BoardLayoutDirection, string>>
  readonly defaultDirection: Readonly<Record<BoardLayoutStyle, BoardLayoutDirection>>
  readonly directional: readonly BoardLayoutStyle[]
  readonly spacing: Readonly<Record<BoardLayoutSpacing, number>>
  readonly spacingKeys: readonly string[]
  readonly framePadding: { readonly top: number; readonly left: number; readonly bottom: number; readonly right: number }
  readonly limits: { readonly nodes: number; readonly edges: number; readonly layoutMovesPerCall: number; readonly deadlineMs: number }
}

export const BOARD_LAYOUT_PRESETS = presetsJson as unknown as PresetsFile

/** The elkjs version the presets were written for; the runtime pins the same. */
export const ELKJS_VERSION = BOARD_LAYOUT_PRESETS.elkjs

export const BOARD_LAYOUT_LIMITS = BOARD_LAYOUT_PRESETS.limits

/** A layout request that cannot be honoured: an unknown option, nothing to lay out, a limit passed. */
export class BoardLayoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BoardLayoutError'
  }
}

export interface BoardLayoutRequestOptions {
  readonly style?: string | null
  readonly direction?: string | null
  readonly spacing?: string | null
}

export interface ResolvedBoardLayoutOptions {
  readonly style: BoardLayoutStyle
  /** The direction the layout runs in: the given one, else the style's default. Read only by directional styles. */
  readonly direction: BoardLayoutDirection
  readonly spacing: BoardLayoutSpacing
  /** Whether the style takes a direction (`flow`, `tree`). */
  readonly directional: boolean
}

function has<K extends string>(record: Readonly<Record<K, unknown>>, key: string): key is K {
  return Object.hasOwn(record, key)
}

/** Validate and default a request's style, direction and spacing. An unknown value is refused, naming it. */
export function resolveBoardLayoutOptions(request: BoardLayoutRequestOptions = {}): ResolvedBoardLayoutOptions {
  const p = BOARD_LAYOUT_PRESETS
  const style = request.style ?? p.defaultStyle
  if (!has(p.styles, style)) throw new BoardLayoutError(`unknown layout style '${style}': use ${Object.keys(p.styles).join(', ')}`)
  const direction = request.direction ?? p.defaultDirection[style]
  if (!has(p.directions, direction)) throw new BoardLayoutError(`unknown layout direction '${direction}': use ${Object.keys(p.directions).join(', ')}`)
  const spacing = request.spacing ?? 'normal'
  if (!has(p.spacing, spacing)) throw new BoardLayoutError(`unknown layout spacing '${spacing}': use ${Object.keys(p.spacing).join(', ')}`)
  return { style, direction, spacing, directional: p.directional.includes(style) }
}

/**
 * The root's `layoutOptions`: `common` ∪ `styles[style]` ∪ `elk.direction` (directional styles only), then every
 * `spacingKeys` entry the merge carries multiplied by the spacing factor. A multiplied number stays a number.
 */
export function layoutOptionsFor(options: ResolvedBoardLayoutOptions): Record<string, ElkOptionValue> {
  const p = BOARD_LAYOUT_PRESETS
  const merged: Record<string, ElkOptionValue> = { ...p.common, ...p.styles[options.style] }
  if (options.directional) merged['elk.direction'] = p.directions[options.direction]
  const factor = p.spacing[options.spacing]
  for (const key of p.spacingKeys) {
    const value = merged[key]
    if (value === undefined) continue
    merged[key] = typeof value === 'number' ? value * factor : Number(value) * factor
  }
  return merged
}

/** A frame laid out as a compound node: room for its name at the top. */
export function framePaddingOption(): Record<string, string> {
  const f = BOARD_LAYOUT_PRESETS.framePadding
  return { 'elk.padding': `[top=${f.top},left=${f.left},bottom=${f.bottom},right=${f.right}]` }
}
