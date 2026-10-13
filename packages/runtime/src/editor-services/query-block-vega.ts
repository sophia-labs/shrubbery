/**
 * Lazy Vega-Lite rendering for QueryBlock binding results — chart grammar
 * lives in `./vega-theme.js` (the house palette/config builder + the
 * theme-as-data merge/override seam); this module owns the mount lifecycle
 * and is where the theme actually gets applied to a real spec.
 */

import { isNumericQueryBlockTerm, type QueryBlockResult, type QueryBlockTerm } from './query-block-service.js'
import { fragmentRegionIdOf } from '../layout/fragment-splice.js'
import {
  orderedKindOfTerms,
  resolveValueFace,
  type ValueDictionary,
} from '@shrubbery/nucleus/value-faces'
import {
  buildVegaTheme,
  ensureVegaTooltipStyles,
  mergeVegaTheme,
  resolveVegaThemeMode,
  sanitizeAuthoredVegaConfig,
  sanitizeAuthoredVegaSpecColors,
  QUERY_BLOCK_VEGA_CONFIG,
  type VegaThemeMode,
  valueToneColor,
} from './vega-theme.js'

export interface QueryBlockVegaView {
  finalize(): void
}

export interface QueryBlockVegaEmbedResult {
  readonly view: QueryBlockVegaView
}

export type QueryBlockVegaEmbed = (
  container: HTMLElement,
  spec: Record<string, unknown>,
  options: {
    readonly actions: false
    readonly renderer: 'svg'
    readonly tooltip?: { readonly disableDefaultStyle: true }
  },
) => Promise<QueryBlockVegaEmbedResult>

export type QueryBlockVegaEmbedLoader = () => Promise<QueryBlockVegaEmbed>

export interface MountQueryBlockVegaOptions {
  readonly container: HTMLElement
  readonly result: QueryBlockResult
  readonly vegaLiteSpec: string
  /**
   * The graph-authored `ux:vegaTheme` override for THIS chart, or null/absent
   * for the pure house theme. Explicit — this module holds NO ambient theme
   * state: the caller that knows the chart's surface resolves it (a fragment
   * chart via `resolveVegaThemeOverride(element)`; an editor QueryBlock
   * passes nothing and keeps the house theme).
   */
  /** TRUSTED house categorical pinning (chart.vega-lite's slot assignment) — applied after sanitization; never authored data. */
  readonly pinnedColorScale?: { readonly domain: readonly unknown[]; readonly range: readonly string[] } | null
  readonly themeOverride?: Record<string, unknown> | null
  /** Test seam; production deliberately uses the lazy dynamic import below. */
  readonly loadEmbed?: QueryBlockVegaEmbedLoader
  /**
   * The graph's value dictionary (nucleus value faces). A field whose values
   * all resolve to one ORDERED kind (a rung) is charted by its faces: labels
   * in the data, the kind's display order as the scale domain, and — on a
   * color channel — the value-face tone palette as the range. TRUSTED house
   * code applied after sanitization, like `pinnedColorScale`.
   */
  readonly valueDictionary?: ValueDictionary | null
  /** Told what the value faces could not apply (e.g. an authored sort pinned over the ladder). */
  readonly onValueFaceHints?: (hints: readonly string[]) => void
}

/** Cap the label width of every categorical y axis (top level and layers) the author left open. */
function limitCategoryLabels(node: unknown, limit: number): void {
  if (!isRecord(node)) return
  const encoding = isRecord(node.encoding) ? node.encoding : null
  const y = encoding && isRecord(encoding.y) ? encoding.y : null
  if (y && (y.type === 'nominal' || y.type === 'ordinal') && y.axis !== null) {
    const axis = isRecord(y.axis) ? y.axis : {}
    if (axis.labelLimit === undefined) y.axis = { ...axis, labelLimit: limit }
  }
  if (Array.isArray(node.layer)) for (const layer of node.layer) limitCategoryLabels(layer, limit)
}

/** Narrow blocks: legends go under the chart instead of taking a side column. */
function legendsBelow(node: unknown): void {
  if (!isRecord(node)) return
  const encoding = isRecord(node.encoding) ? node.encoding : null
  for (const channel of ['color', 'shape', 'size', 'opacity', 'strokeDash']) {
    const def = encoding && isRecord(encoding[channel]) ? encoding[channel] as Record<string, unknown> : null
    if (!def || def.legend === null) continue
    const legend = isRecord(def.legend) ? def.legend : {}
    if (legend.orient === undefined) def.legend = { ...legend, orient: 'bottom', direction: 'horizontal', columns: 2 }
  }
  if (Array.isArray(node.layer)) for (const layer of node.layer) legendsBelow(layer)
}

function isFacetedSpec(spec: Record<string, unknown>): boolean {
  if ('facet' in spec || 'repeat' in spec || 'concat' in spec || 'hconcat' in spec || 'vconcat' in spec) return true
  const encoding = isRecord(spec.encoding) ? spec.encoding : {}
  return 'row' in encoding || 'column' in encoding || 'facet' in encoding
}

/**
 * Vega ends a label cut by `labelLimit` with "…" and keeps no trace of the
 * rest. Give each such SVG label a <title> with the full value it came from
 * (the one data value that starts with the visible prefix), so hover and
 * assistive tech still read the whole label.
 */
export function titleTruncatedLabels(container: HTMLElement, spec: Record<string, unknown>): number {
  const data = isRecord(spec.data) && Array.isArray(spec.data.values) ? spec.data.values : []
  const candidates = new Set<string>()
  for (const row of data) {
    if (!isRecord(row)) continue
    for (const value of Object.values(row)) if (typeof value === 'string') candidates.add(value)
  }
  let titled = 0
  for (const text of container.querySelectorAll('svg text')) {
    const shown = text.textContent ?? ''
    if (!shown.endsWith('…')) continue
    const prefix = shown.slice(0, -1)
    const matches = [...candidates].filter(value => value.startsWith(prefix) && value !== shown)
    if (matches.length !== 1) continue
    const title = container.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'title')
    title.textContent = matches[0]
    text.appendChild(title)
    titled += 1
  }
  return titled
}

const ENCODING_ORDER_CHANNELS = new Set(['x', 'y', 'color', 'row', 'column', 'facet', 'xOffset', 'yOffset', 'shape', 'detail'])

/**
 * Value faces on a Vega-Lite spec (plans/2026-09-25-document-primitives.md §3
 * "Ordering"). For every result column whose terms resolve to one ordered kind:
 *   - the injected data rows carry the value's LABEL (axes, legends and
 *     tooltips read "held-out confirmed", not an IRI);
 *   - each encoding channel on that field gets `scale.domain` = the kind's
 *     full display order (so every member appears, the empty ones at zero),
 *     unless the author pinned a `sort` array — that is kept, and a hint says so;
 *   - a `color` channel on that field gets the matching tone range.
 * Walks the top-level encoding and every `layer[]` encoding. Returns the
 * label map per field (applied to the data by the caller) and the hints.
 */
export function applyValueFacesToVegaSpec(
  spec: Record<string, unknown>,
  result: QueryBlockResult,
  dictionary: ValueDictionary,
  mode: VegaThemeMode,
): { readonly labels: ReadonlyMap<string, ReadonlyMap<string, string>>; readonly hints: readonly string[] } {
  const labels = new Map<string, Map<string, string>>()
  const hints: string[] = []
  if (result.resultKind !== 'bindings') return { labels, hints }
  const fields = new Map<string, { domain: string[]; range: string[] }>()
  for (const column of result.columns) {
    const kind = orderedKindOfTerms(result.rows.map(row => row[column]), dictionary)
    if (!kind) continue
    const members = dictionary.orders.get(kind) ?? []
    const byIri = new Map<string, string>()
    const domain: string[] = []
    const range: string[] = []
    for (const iri of members) {
      const view = resolveValueFace({ type: 'uri', value: iri }, dictionary)
      byIri.set(iri, view.text)
      domain.push(view.text)
      range.push(view.tone ? valueToneColor(view.tone, mode) : valueToneColor({ kind: 'named', name: 'muted' }, mode))
    }
    labels.set(column, byIri)
    fields.set(column, { domain, range })
  }
  if (fields.size === 0) return { labels, hints }
  const visit = (node: unknown): void => {
    if (!isRecord(node)) return
    const encoding = isRecord(node.encoding) ? node.encoding : null
    if (encoding) {
      for (const [channel, def] of Object.entries(encoding)) {
        if (!ENCODING_ORDER_CHANNELS.has(channel) || !isRecord(def) || typeof def.field !== 'string') continue
        const face = fields.get(def.field)
        if (!face) continue
        const scale = isRecord(def.scale) ? def.scale : {}
        if (Array.isArray(def.sort)) {
          hints.push(`${channel}: an authored sort is pinned over the ${def.field} order`)
        } else if (!('domain' in scale)) {
          def.scale = { ...scale, domain: [...face.domain] }
          if (def.sort === undefined) def.sort = null
        }
        if (channel === 'color') {
          def.scale = { ...(isRecord(def.scale) ? def.scale : {}), domain: [...face.domain], range: [...face.range] }
        }
      }
    }
    if (Array.isArray(node.layer)) node.layer.forEach(visit)
    if (isRecord(node.spec)) visit(node.spec)
  }
  visit(spec)
  return { labels, hints }
}

// Re-exported for back-compat with existing imports of this module's own
// former in-place default — the light-mode house theme. Prefer
// `buildVegaTheme('light' | 'dark')` for new code (this alias cannot reflect
// dark mode).
export { QUERY_BLOCK_VEGA_CONFIG }

// ── Theme-as-data override seam — SCOPED, never global ────────────────────
//
// A graph-authored `ux:vegaTheme` belongs to ONE fragment surface/region,
// never to the process. The shell registers each render pass's per-REGION
// themes against the SURFACE ROOT ELEMENT hosting those regions
// (`render-workspace.ts`'s fragment path, from
// `WorkspaceFragmentRegion.vegaTheme`), and a chart resolves its own
// override by walking the composed tree from its mount point: the nearest
// interpreter wrapper's `data-layout-node-id="frag:{encodedRegionId}:…"`
// names the region (fragment-splice.ts owns that grammar — the region
// segment is percent-encoded, `fragmentRegionIdOf` is the ONE decoder), the
// nearest registered
// scope root supplies that region's theme. A chart outside any fragment
// region — an editor QueryBlock, a standalone harness — resolves to null
// and keeps the pure house theme.
//
// No module state: two surfaces (or two sessions, or parallel tests) can
// never race or contaminate each other, and reset is structural — the shell
// re-registers the CURRENT map on every render pass (an empty map clears),
// and a torn-down root's WeakMap entry dies with its DOM.

const vegaThemeScopes = new WeakMap<Element, ReadonlyMap<string, Record<string, unknown>>>()

/**
 * Register (or clear, with null/empty) the per-region graph-authored themes
 * for every fragment region hosted under `scopeRoot`. Called by the shell on
 * EVERY render pass with the pass's current themes — never additive, so a
 * region/session that disappeared clears with the pass that dropped it.
 */
export function setVegaThemeScopeOverrides(
  scopeRoot: Element,
  themesByRegion: ReadonlyMap<string, Record<string, unknown>> | null,
): void {
  if (!themesByRegion || themesByRegion.size === 0) {
    vegaThemeScopes.delete(scopeRoot)
    return
  }
  vegaThemeScopes.set(scopeRoot, themesByRegion)
}

/**
 * Resolve the graph-authored theme override governing `start`, or null when
 * no registered scope/region governs it. Walks the COMPOSED tree (crossing
 * shadow roots via their host) — the same direction CSS custom properties
 * cascade — remembering the NEAREST fragment-region wrapper passed on the
 * way; the walk answers at the first registered scope root it reaches.
 */
export function resolveVegaThemeOverride(start: Element | null | undefined): Record<string, unknown> | null {
  let regionId: string | null = null
  let node: Element | null = start ?? null
  while (node) {
    if (regionId === null) {
      const nodeId = node.getAttribute('data-layout-node-id')
      if (nodeId) regionId = fragmentRegionIdOf(nodeId)
    }
    const scoped = vegaThemeScopes.get(node)
    if (scoped) return regionId === null ? null : (scoped.get(regionId) ?? null)
    const root = node.getRootNode()
    node = node.parentElement ?? (root instanceof ShadowRoot ? root.host : null)
  }
  return null
}

let productionEmbedPromise: Promise<QueryBlockVegaEmbed> | null = null

function loadProductionEmbed(): Promise<QueryBlockVegaEmbed> {
  productionEmbedPromise ??= import('vega-embed')
    .then(({ default: embed }) => embed as unknown as QueryBlockVegaEmbed)
    .catch((cause) => {
      productionEmbedPromise = null
      throw cause
    })
  return productionEmbedPromise
}

/**
 * Empty specs intentionally return null so the UI can offer an actionable hint.
 * Non-empty malformed specs throw: silently substituting a different chart would
 * make a persisted document appear correct while ignoring its authored contract.
 */
export function parseVegaLiteSpec(specString: string): Record<string, unknown> | null {
  if (!specString.trim()) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(specString)
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    throw new Error(`Invalid Vega-Lite spec: ${detail}`)
  }
  if (!isRecord(parsed)) {
    throw new Error('Invalid Vega-Lite spec: the root value must be a JSON object')
  }
  return parsed
}

function termValueKind(term: QueryBlockTerm): 'number' | 'boolean' | 'date' | 'text' {
  const datatype = term.datatype?.toLowerCase() ?? ''
  // The ONE numeric-datatype rule (query-block-service.ts) — shared with the
  // table's term-typed column classification.
  if (isNumericQueryBlockTerm(term)) return 'number'
  if (datatype.includes('#boolean')) return 'boolean'
  if (datatype.includes('#date') || datatype.includes('#time')) return 'date'

  const normalized = term.value.trim().toLowerCase()
  if (normalized === 'true' || normalized === 'false') return 'boolean'
  if (/^-?\d+(?:\.\d+)?$/.test(normalized)) return 'number'
  if (!Number.isNaN(Date.parse(term.value)) && /[-/:t]/i.test(term.value)) return 'date'
  return 'text'
}

/**
 * The ONE canonicalization of an RDF binding term into the primitive value a
 * Vega datum row actually carries. Everything that compares against chart
 * data — the injected `data.values` rows below, AND any series-identity
 * surface built outside the spec's data (a pinned categorical
 * `scale.domain`, the fold-to-"Other" `indexof` haystack —
 * `chart-vega-lite-face.ts`'s `distinctSeriesValues`) — MUST go through this
 * exact function: a numeric term becomes the number `5`, and a domain entry
 * collected as the lexical string `"5"` would silently never match it.
 *
 * NON-FINITE numeric terms keep their LEXICAL STRING identity: xsd:float/
 * xsd:double admit "INF"/"-INF"/"NaN" as valid lexical forms, but no finite
 * JS number exists for them — `Number("INF")` is `NaN`, and NaN is identity-
 * poison for every comparison surface above (`NaN !== NaN` in a Vega
 * `indexof`, and `JSON.stringify` turns a domain NaN into `null` while the
 * datum row keeps NaN — so the value silently folds to "Other"). Carrying
 * the lexical string ("INF") through domain, haystack, AND datum keeps all
 * three agreeing — same rule, every surface.
 */
export function vegaTermPrimitive(term: QueryBlockTerm): string | number | boolean {
  const kind = termValueKind(term)
  if (kind === 'number') {
    const parsed = Number(term.value)
    return Number.isFinite(parsed) ? parsed : term.value
  }
  return kind === 'boolean' ? term.value.toLowerCase() === 'true' : term.value
}

/** Convert RDF binding terms into the primitive rows Vega-Lite expects. */
export function transformBindingsToVegaValues(
  result: QueryBlockResult,
): Array<Record<string, unknown>> {
  if (result.resultKind !== 'bindings') return []

  return result.rows.map((row) => {
    const value: Record<string, unknown> = {}
    for (const column of result.columns) {
      const term = row[column]
      if (!term || !term.value) {
        value[column] = null
        continue
      }
      value[column] = vegaTermPrimitive(term)
    }
    return value
  })
}

function measuredContainerWidth(container: HTMLElement): number {
  return Math.round(
    container.getBoundingClientRect().width ||
      container.parentElement?.getBoundingClientRect().width ||
      640,
  )
}

function renderEmptySpecHint(container: HTMLElement): void {
  const hint = container.ownerDocument.createElement('div')
  hint.className = 'query-block-host-vega-hint'
  hint.textContent = 'Add a Vega-Lite spec to visualize this data.'
  container.replaceChildren(hint)
}

/**
 * Mount a real Vega-Lite view and return its exact lifecycle cleanup.
 *
 * Binding convention matches Garden:
 * - authored `data.values` is authoritative, including an empty array;
 * - otherwise the current SPARQL binding rows are injected at the top level.
 */
export async function mountQueryBlockVega(
  options: MountQueryBlockVegaOptions,
): Promise<() => void> {
  const parsed = parseVegaLiteSpec(options.vegaLiteSpec)
  if (!parsed) {
    renderEmptySpecHint(options.container)
    return () => {}
  }

  // The chart color laws hold for EVERY spec this module mounts, whoever
  // authored it: spec-level color surfaces (background, mark colors, color-
  // channel value/range/scheme) are stripped here, the authored `config`'s
  // law surfaces below — strip-with-a-surfaced-warning, never a rejected
  // chart (one offending key in a dashboard document should not take the
  // chart down). `chart.vega-lite`'s own generated specs pass untouched:
  // their pinned `scale.range` IS the validated palette (the lawful-color
  // escape — see `sanitizeAuthoredVegaSpecColors`).
  const specSanitization = sanitizeAuthoredVegaSpecColors(parsed)
  const spec = specSanitization.sanitized

  // PROVENANCE, not value-inspection (re-judge r4): the house face's own
  // fixed-order categorical pinning arrives as this TRUSTED option — set only
  // by house code (`chart.vega-lite`'s applyResult), never parsed from an
  // authored spec — and is applied AFTER sanitization. Persistent slot
  // assignment legitimately emits sparse ranges (a returning slot-5 entity
  // pins [slot5]) that no value test can tell from a spoof; provenance can.
  if (options.pinnedColorScale) {
    const encoding = isRecord(spec.encoding) ? spec.encoding : (spec.encoding = {})
    const colorDef = isRecord(encoding.color) ? encoding.color : (encoding.color = {})
    colorDef.scale = {
      domain: [...options.pinnedColorScale.domain],
      range: [...options.pinnedColorScale.range],
    }
  }

  const mode = resolveVegaThemeMode(options.container)
  const valueFaces = options.valueDictionary
    ? applyValueFacesToVegaSpec(spec, options.result, options.valueDictionary, mode)
    : null
  if (valueFaces) options.onValueFaceHints?.(valueFaces.hints)

  const data = isRecord(spec.data) ? spec.data : null
  if (!data || !Object.prototype.hasOwnProperty.call(data, 'values')) {
    const values = transformBindingsToVegaValues(options.result)
    for (const [field, byIri] of valueFaces?.labels ?? []) {
      for (const row of values) {
        const label = typeof row[field] === 'string' ? byIri.get(row[field] as string) : undefined
        if (label !== undefined) row[field] = label
      }
    }
    spec.data = { values }
  }
  // Fill the block: with autosize `fit` + `contains: padding` the width
  // already includes the padding, so the whole measured width is used (the
  // earlier `- 40` left an empty strip on the right). Faceted specs size one
  // cell, so they keep a width share. The block re-mounts on resize.
  const containerWidth = measuredContainerWidth(options.container)
  if (spec.width === undefined) {
    spec.width = Math.max(160, isFacetedSpec(spec) ? containerWidth - 96 : containerWidth)
  }
  if (spec.autosize === undefined) spec.autosize = { type: 'fit', contains: 'padding' }
  if (spec.padding === undefined) spec.padding = 12
  if (spec.$schema === undefined) {
    spec.$schema = 'https://vega.github.io/schema/vega-lite/v6.json'
  }

  // House theme, selected (not flipped) for the mount's current data-theme,
  // then the caller-resolved graph-authored `ux:vegaTheme` override (if any)
  // merged on top, then this ONE chart's own authored `spec.config` (if any)
  // merged on top of that — closest-wins, each layer only overriding the
  // keys it sets. The authored layer merges LAW-SANITIZED: the same color
  // laws `validateVegaThemeOverride` enforces on the ux:vegaTheme layer,
  // with strip semantics (`sanitizeAuthoredVegaConfig`).
  const houseTheme = buildVegaTheme(mode, options.container)
  const graphTheme = options.themeOverride ?? null
  const effectiveTheme = graphTheme ? mergeVegaTheme(houseTheme, graphTheme) : houseTheme
  const configSanitization = isRecord(spec.config)
    ? sanitizeAuthoredVegaConfig(spec.config)
    : { sanitized: {}, violations: [] as readonly string[] }
  spec.config = mergeVegaTheme(effectiveTheme, configSanitization.sanitized)
  const lawViolations = [...specSanitization.violations, ...configSanitization.violations]

  ensureVegaTooltipStyles(options.container.ownerDocument ?? document)
  const embed = await (options.loadEmbed ?? loadProductionEmbed)()
  options.container.replaceChildren()
  // Narrow blocks: long category labels truncate (with their full text as a
  // tooltip, below) instead of taking half the width.
  if (containerWidth < 720) limitCategoryLabels(spec, Math.max(90, Math.round(containerWidth * 0.36)))
  if (containerWidth < 560) legendsBelow(spec)
  const mounted = await embed(options.container, spec, {
    actions: false,
    renderer: 'svg',
    tooltip: { disableDefaultStyle: true },
  })
  // Surfaced AFTER the embed lands (vega-embed owns the container's content
  // during mount) — the chart renders lawfully AND the author is told exactly
  // which surfaces were ignored, instead of silently repainting their spec.
  if (lawViolations.length > 0) renderChartLawWarning(options.container, lawViolations)
  titleTruncatedLabels(options.container, spec)
  let finalized = false
  return () => {
    if (finalized) return
    finalized = true
    mounted.view.finalize()
  }
}

/**
 * The visible strip-warning for law-guarded authored color surfaces — a small
 * note under the (still rendered) chart. Inline-styled deliberately: this
 * mount path serves both the editor QueryBlock host (light-DOM, its own
 * stylesheet) and `<sh-vega-chart-view>`'s shadow root, and a note this small
 * should not need a stylesheet contract with every host.
 */
function renderChartLawWarning(container: HTMLElement, violations: readonly string[]): void {
  const note = container.ownerDocument.createElement('div')
  note.className = 'sh-vega-law-warning'
  note.dataset.vegaLawWarning = ''
  note.setAttribute('role', 'note')
  note.style.cssText =
    'font-size:11px;padding:4px 0;color:var(--mn-color-text-secondary)'
  note.textContent =
    `Chart color law: ignored authored ${violations.join(', ')} — ` +
    'chart colors come only from the validated house palette.'
  container.appendChild(note)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
