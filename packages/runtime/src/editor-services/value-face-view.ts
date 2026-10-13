/**
 * The WEB target of nucleus value faces (`@shrubbery/nucleus/value-faces`):
 * turns a `ValueView` into DOM, and loads the per-graph value dictionary once
 * per graph session through the ordinary read-only query path.
 *
 * The chip borrows the Margins entry idiom (a small-caps lowercase label with
 * a tone rule) and takes its color from `valueToneColor` — the same palette a
 * chart colored by the same values uses.
 */

import {
  buildValueDictionary,
  EMPTY_VALUE_DICTIONARY,
  type ValueDictionary,
  type ValueFaceRule,
  type ValueView,
  valueDictionaryQuery,
} from '@shrubbery/nucleus/value-faces'
import { runWithRetry } from './query-retry.js'
import { type VegaThemeMode, valueToneColor } from './vega-theme.js'

export const VALUE_FACE_STYLE = `
.value-chip{display:inline-flex;align-items:center;gap:5px;max-width:100%;padding:1px 7px 1px 6px;border-radius:999px;background:color-mix(in srgb,var(--value-tone,currentColor) 11%,transparent);color:var(--mn-color-text-secondary,#475467);font:600 var(--mn-text-marginalia,11px)/1.35 var(--mn-font-chrome,system-ui,sans-serif);letter-spacing:var(--sophia-tracking-label,.04em);text-transform:lowercase;font-variant:small-caps;white-space:nowrap;overflow-wrap:normal;word-break:normal;vertical-align:baseline}
.value-chip::before{content:'';flex:none;width:7px;height:7px;border-radius:2px;background:var(--value-tone,currentColor)}
.value-chip[data-tone=none]::before{background:transparent;box-shadow:inset 0 0 0 1px currentColor}
`

/** Render one value view for the web target. */
export function renderValueView(document: Document, view: ValueView, mode: VegaThemeMode): HTMLElement {
  const element = document.createElement('span')
  if (view.face === 'value.chip') {
    element.className = 'value-chip'
    element.dataset.valueFace = view.face
    if (view.kind) element.dataset.valueKind = view.kind
    if (view.tone) {
      element.dataset.tone = view.tone.kind === 'named' ? view.tone.name : `order-${view.tone.index}`
      element.style.setProperty('--value-tone', valueToneColor(view.tone, mode))
    } else {
      element.dataset.tone = 'none'
    }
  } else {
    element.className = 'value-text'
  }
  element.textContent = view.text
  if (view.title && view.title !== view.text) element.title = view.title
  return element
}

export interface ValueDictionarySource {
  /** The graph's value dictionary; resolves to an empty one when the graph has no ruled kinds. */
  load(graphId: string): Promise<ValueDictionary>
}

/**
 * One dictionary query per graph session, cached. A failed load is not cached
 * (the next block retries) and never fails a block: faces fall back to generic.
 */
export function makeValueDictionarySource(
  select: (graphId: string, sparql: string) => Promise<ReadonlyArray<Readonly<Record<string, unknown>>>>,
  rules?: readonly ValueFaceRule[],
): ValueDictionarySource {
  const cache = new Map<string, Promise<ValueDictionary>>()
  const query = valueDictionaryQuery(rules)
  return {
    load(graphId) {
      const key = graphId.trim()
      if (!key || !query) return Promise.resolve(EMPTY_VALUE_DICTIONARY)
      const cached = cache.get(key)
      if (cached) return cached
      const pending = runWithRetry(() => select(key, query), 3)
        .then(rows => buildValueDictionary(rows as Parameters<typeof buildValueDictionary>[0]))
        .catch(() => {
          cache.delete(key)
          return EMPTY_VALUE_DICTIONARY
        })
      cache.set(key, pending)
      return pending
    },
  }
}
