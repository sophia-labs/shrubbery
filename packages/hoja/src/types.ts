/** The three stable Hoja surface postures. */
export type HojaPosture = 'composer' | 'embedded' | 'page'

/** A deliberately small structural mirror of TipTap's JSONContent. */
export interface HojaJSONContent {
  type: string
  attrs?: Record<string, unknown>
  content?: HojaJSONContent[]
  marks?: HojaJSONContent[]
  text?: string
}

/**
 * A wikilink occurrence carried beside canonical `[[label]]` text.
 *
 * The label is always available. Target ids are nullable because plain
 * `[[label]]` text contains no graph truth: only a host resolver can turn it
 * into a resolved reference. Hoja never invents an id from the label.
 */
export interface HojaWikiLinkReference {
  readonly label: string
  readonly targetDocId: string | null
  readonly targetGraphId: string | null
  readonly targetBlockId?: string | null
  readonly blockPreview?: string | null
}

/** A host-provided result for a scoped wikilink request. */
export interface HojaWikiLinkSuggestion {
  readonly label: string
  readonly targetDocId: string
  readonly targetGraphId?: string | null
  readonly targetBlockId?: string | null
  readonly blockPreview?: string | null
}

export interface HojaWikiLinkRange {
  readonly from: number
  readonly to: number
}

/** A request emitted only by the focused Hoja instance. */
export interface HojaWikiLinkRequestDetail {
  readonly requestId: number
  readonly query: string
  readonly matchedText: string
  readonly range: HojaWikiLinkRange
}

export interface HojaWikiLinkSuggestionsDetail {
  readonly request: HojaWikiLinkRequestDetail
  readonly suggestions: readonly HojaWikiLinkSuggestion[]
}

export interface HojaWikiLinkResolveContext {
  /** Aborted when a newer query supersedes this one or the tray closes. */
  readonly signal: AbortSignal
}

export type HojaWikiLinkResolver = (
  request: HojaWikiLinkRequestDetail,
  context: HojaWikiLinkResolveContext,
) =>
  | readonly HojaWikiLinkSuggestion[]
  | Promise<readonly HojaWikiLinkSuggestion[]>

/** Canonical host intent produced by an edit or submit. */
export interface HojaComposerDetail {
  /** Canonical chat Markdown (including `[[label]]` references). */
  readonly value: string
  /** Plain text suitable for accessible previews and empty-state checks. */
  readonly plainText: string
  /** The editor document at the moment the intent was produced. */
  readonly json: HojaJSONContent
  /** Resolved and unresolved wikilink occurrences, in document order. */
  readonly references: readonly HojaWikiLinkReference[]
  readonly isEmpty: boolean
}

export type HojaChangeHandler = (detail: HojaComposerDetail) => void
export type HojaSubmitHandler = (detail: HojaComposerDetail) => void

/** Stable DOM event names for framework-neutral consumers. */
export const HOJA_EVENTS = {
  change: 'hoja-change',
  submit: 'hoja-submit',
  wikiLinkRequest: 'hoja-wikilink-request',
  wikiLinkSuggestions: 'hoja-wikilink-suggestions',
  wikiLinkClose: 'hoja-wikilink-close',
  wikiLinkResolveError: 'hoja-wikilink-resolve-error',
} as const

export interface HojaEventDetailMap {
  readonly 'hoja-change': HojaComposerDetail
  readonly 'hoja-submit': HojaComposerDetail
  readonly 'hoja-wikilink-request': HojaWikiLinkRequestDetail
  readonly 'hoja-wikilink-suggestions': HojaWikiLinkSuggestionsDetail
  readonly 'hoja-wikilink-close': HojaWikiLinkRequestDetail
  readonly 'hoja-wikilink-resolve-error': {
    readonly request: HojaWikiLinkRequestDetail
    readonly error: unknown
  }
}
