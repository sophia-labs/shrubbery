/**
 * WP0.1 — WorkspaceConfig ↔ RDF serialization contract (ONE schema, TWO consumers).
 *
 * This is the SINGLE canonical mapping between a `WorkspaceConfig` (the TS
 * rendering form) and RDF triples in the `sux:` vocabulary. It has two consumers
 * that MUST agree byte-for-byte on the shape:
 *   - the GATEWAY SEED (D6 / WP5.1): writes the default config into a workspace's
 *     `:ux:config` named graph at provision time.
 *   - the CLIENT LIVE READ (D1 / WP5.2): reads that named graph back via
 *     `/graphs/query` and parses it into the runtime `WorkspaceConfig`.
 *
 * The build-time `GARDEN_DEFAULT` literal and the server-seeded subgraph are the
 * SAME data in two encodings; the WP0.1 round-trip test pins that equivalence
 * (`GARDEN_DEFAULT → serialize → parse → deepEqual`).
 *
 * NOT WIRED. No store, no DOM, no network — pure functions. The runtime read
 * path is wired in WP5.2; the seed is authored in WP0.4 / WP5.1.
 *
 * Named graphs (per workspace cell; parallels `:user:rdf` at
 * `garden/src-tauri/src/rdf_authority.rs:18-20`, deliberately NOT under the
 * reserved `:projection:`):
 *   - `urn:mnemosyne:local:graph:{graph_id}:ux:config`   — layout (this module)
 *   - `urn:mnemosyne:local:graph:{graph_id}:ux:wfstate`  — wf working state (P6)
 */

import type {
  AppId,
  ConfigDimension,
  ConfigDimensionValue,
  ConfigEdge,
  DockState,
  PanelConfig,
  RegionConfig,
  SplitOrientation,
  SurfaceRegionMode,
  SurfaceRegionRole,
  WorkspaceConfig,
} from './types.js'
import {
  I,
  L,
  Lbool,
  Ldec,
  Lint,
  compareTriples,
  isIri,
  type Term,
  type Triple,
} from './rdf-model.js'

// Re-export the generic RDF model so existing consumers that import these from
// './ux-rdf.js' (the WP0.1 test, the seed generator) keep resolving after the
// split. The model itself now lives in rdf-model.ts with ZERO sux: knowledge.
export { termToNT, triplesToNT, parseNT } from './rdf-model.js'
export type { Term, Triple } from './rdf-model.js'

// ── Namespaces ───────────────────────────────────────────────────────────────

export const NS = {
  sux: 'http://sophia.ai/ux#',
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
} as const

const RDF_TYPE = NS.rdf + 'type'
const RDFS_LABEL = NS.rdfs + 'label'

/** sux: predicate/class IRI for a local term. */
const sux = (local: string): string => NS.sux + local

/** Mint the node IRI for a config-local id (region/panel/dimension/value/workspace). */
export const iriFor = (localId: string): string => NS.sux + localId

// ── Named-graph IRIs (per workspace cell) ────────────────────────────────────

const GRAPH_ROOT = (graphId: string): string => `urn:mnemosyne:local:graph:${graphId}`
/** `urn:mnemosyne:local:graph:{graph_id}:ux:config` — the layout subgraph. */
export const uxConfigGraphIri = (graphId: string): string => `${GRAPH_ROOT(graphId)}:ux:config`
/** `urn:mnemosyne:local:graph:{graph_id}:ux:wfstate` — the wf working-state subgraph (P6). */
export const uxWfStateGraphIri = (graphId: string): string => `${GRAPH_ROOT(graphId)}:ux:wfstate`

// ── Serialize: WorkspaceConfig → Triple[] ────────────────────────────────────

/**
 * Serialize a WorkspaceConfig to a canonical, sorted triple list.
 *
 * Output is DETERMINISTIC (sorted by s, p, then object) so the gateway seed is
 * idempotent and byte-stable. Both the default `rootRegions` and each
 * `appRootRegions[*]` are emitted as EXPLICIT indexed entries (RootEntry /
 * AppRootEntry) — never derived. (Derivation by "no childRegion target" is
 * unsound once apps contribute regions outside the default spine.)
 */
export function serializeConfigToTriples(config: WorkspaceConfig): Triple[] {
  const out: Triple[] = []
  const W = iriFor(config.id)
  const add = (s: string, p: string, o: Term) => out.push({ s, p, o })

  // Workspace node
  add(W, RDF_TYPE, I(sux('Workspace')))
  add(W, sux('localId'), L(config.id))
  add(W, RDFS_LABEL, L(config.label))
  add(W, sux('renderedByComponent'), L(config.renderedByComponent))

  // Regions (shared lookup table across all apps)
  for (const id of Object.keys(config.regions)) {
    const r = config.regions[id]
    const R = iriFor(id)
    add(W, sux('hasRegion'), I(R))
    add(R, RDF_TYPE, I(sux('Region')))
    add(R, sux('localId'), L(r.id))
    add(R, RDFS_LABEL, L(r.label))
    if (r.childRegion !== null) add(R, sux('childRegion'), I(iriFor(r.childRegion)))
    add(R, sux('order'), Lint(r.order))
    add(R, sux('splitOrientation'), L(r.splitOrientation))
    add(R, sux('collapsible'), Lbool(r.collapsible))
    add(R, sux('resizable'), Lbool(r.resizable))
    if (r.sizeFraction !== null) add(R, sux('sizeFraction'), Ldec(r.sizeFraction))
    if (r.dockState !== null) add(R, sux('dockState'), L(r.dockState))
    for (const panelId of r.docksPanel) add(R, sux('docksPanel'), I(iriFor(panelId)))
    if (r.renderedByComponent !== null) add(R, sux('renderedByComponent'), L(r.renderedByComponent))
    if (r.surfaceMode != null) add(R, sux('surfaceMode'), L(r.surfaceMode))
    if (r.surfaceRole != null) add(R, sux('surfaceRole'), L(r.surfaceRole))
    // sux:fragmentSurface — an ABSOLUTE IRI object, emitted verbatim (never
    // routed through iriFor: the surface IRI lives in its own urn: space, not
    // the sux: config-local id space).
    if (r.fragmentSurface != null) add(R, sux('fragmentSurface'), I(r.fragmentSurface))
  }

  // Panels
  for (const id of Object.keys(config.panels)) {
    const p = config.panels[id]
    const P = iriFor(id)
    add(W, sux('hasPanel'), I(P))
    add(P, RDF_TYPE, I(sux('Panel')))
    add(P, sux('localId'), L(p.id))
    add(P, RDFS_LABEL, L(p.label))
    add(P, sux('renderedByComponent'), L(p.renderedByComponent))
    add(P, sux('dockState'), L(p.dockState))
    add(P, sux('defaultVisible'), Lbool(p.defaultVisible))
  }

  // Dimensions + their ordered values
  for (const id of Object.keys(config.dimensions)) {
    const d = config.dimensions[id]
    const D = iriFor(id)
    add(W, sux('hasDimension'), I(D))
    add(D, RDF_TYPE, I(sux('ConfigDimension')))
    add(D, sux('localId'), L(d.id))
    add(D, RDFS_LABEL, L(d.label))
    add(D, sux('defaultValue'), L(d.defaultValue))
    d.values.forEach((v, idx) => {
      const V = iriFor(v.id)
      add(D, sux('hasValue'), I(V))
      add(V, RDF_TYPE, I(sux('ConfigValue')))
      add(V, sux('localId'), L(v.id))
      add(V, sux('literalValue'), L(v.literalValue))
      add(V, sux('appliesAttribute'), L(v.appliesAttribute))
      add(V, sux('ordinalIndex'), Lint(idx))
    })
  }

  // Default rootRegions — explicit ordered entries (NOT derived).
  config.rootRegions.forEach((regionId, idx) => {
    const RE = iriFor(`${config.id}-root-${idx}`)
    add(W, sux('hasRootEntry'), I(RE))
    add(RE, RDF_TYPE, I(sux('RootEntry')))
    add(RE, sux('atIndex'), Lint(idx))
    add(RE, sux('rootRegion'), I(iriFor(regionId)))
  })

  // Per-app root-region lists (WP0.0) — explicit indexed entries (not derivable).
  if (config.appRootRegions) {
    for (const app of Object.keys(config.appRootRegions)) {
      config.appRootRegions[app].forEach((regionId, idx) => {
        const E = iriFor(`${config.id}-approot-${app}-${idx}`)
        add(W, sux('hasAppRootEntry'), I(E))
        add(E, RDF_TYPE, I(sux('AppRootEntry')))
        add(E, sux('forApp'), L(app))
        add(E, sux('atIndex'), Lint(idx))
        add(E, sux('rootRegion'), I(iriFor(regionId)))
      })
    }
  }

  // Selection-hub edges (slice 1) — explicit indexed entries, mirroring the
  // RootEntry/AppRootEntry pattern. Subject is a MINTED IRI (never a blank
  // node: rdf-model Term is iri|literal only). from/to route through iriFor so
  // a face id ('face:editor') becomes a sux: IRI; predicate stays a plain
  // literal so the interpreter switches on it with no ontology lookup.
  if (config.edges) {
    config.edges.forEach((edge, idx) => {
      const E = iriFor(`${config.id}-edge-${idx}`)
      add(W, sux('hasConfigEdge'), I(E))
      add(E, RDF_TYPE, I(sux('ConfigEdge')))
      add(E, sux('atIndex'), Lint(idx))
      add(E, sux('from'), I(iriFor(edge.from)))
      add(E, sux('to'), I(iriFor(edge.to)))
      add(E, sux('predicate'), L(edge.predicate))
    })
  }

  return out.sort(compareTriples)
}

// ── Parse: Triple[] → WorkspaceConfig ────────────────────────────────────────

/**
 * Thrown by parseTriplesToConfig when the triple set contains NO `sux:Workspace`
 * node at all — the "this graph has no UX configuration yet" case (fresh,
 * imported, and legacy-migrated graphs all present it). A DISTINCT class from
 * every other parse/validation failure so callers can tell ABSENT from
 * MALFORMED: a shell may map the absent case to a built-in default, but a
 * malformed config (Workspace node present, invariants broken) must surface as
 * a real error — falling back over one would mask corruption.
 *
 * The message is pinned verbatim by conformance tests (fossil-conformance
 * asserts it surfaces unsoftened) — do not reword it.
 */
export class NoWorkspaceNodeError extends Error {
  constructor() {
    super('parseTriplesToConfig: no sux:Workspace node found')
    this.name = 'NoWorkspaceNodeError'
  }
}

/**
 * Recognize a NoWorkspaceNodeError across module-copy / realm boundaries: the
 * check is by `name`, not `instanceof`, so a bundler duplicating this module
 * (two class identities) cannot silently break a caller's absent-vs-malformed
 * branch.
 */
export function isNoWorkspaceNodeError(e: unknown): e is NoWorkspaceNodeError {
  return e instanceof Error && e.name === 'NoWorkspaceNodeError'
}

/**
 * Parse a triple list (e.g. CONSTRUCT/SELECT rows from `/graphs/query` over the
 * `:ux:config` graph) back into a runtime WorkspaceConfig. Inverse of
 * serializeConfigToTriples. Throws NoWorkspaceNodeError (the typed ABSENT
 * signal — see above) if no `sux:Workspace` node is present.
 *
 * The result is NOT deep-frozen (the caller freezes before commit — see
 * deep-freeze.ts); the WP0.1 round-trip compares modulo freeze.
 */
export function parseTriplesToConfig(triples: readonly Triple[]): WorkspaceConfig {
  // Index: subject → predicate-localName → Term[]
  const bySubject = new Map<string, Map<string, Term[]>>()
  for (const t of triples) {
    let preds = bySubject.get(t.s)
    if (!preds) bySubject.set(t.s, (preds = new Map()))
    const pl = t.p.startsWith(NS.sux) ? t.p.slice(NS.sux.length) : t.p
    const arr = preds.get(pl)
    if (arr) arr.push(t.o)
    else preds.set(pl, [t.o])
  }

  const localId = (iri: string): string => {
    const one = bySubject.get(iri)?.get('localId')?.[0]
    if (one && one.type === 'literal') return one.value
    return iri.startsWith(NS.sux) ? iri.slice(NS.sux.length) : iri
  }
  const lit = (preds: Map<string, Term[]> | undefined, key: string): string | null => {
    const t = preds?.get(key)?.[0]
    return t && t.type === 'literal' ? t.value : null
  }
  const iriRef = (preds: Map<string, Term[]> | undefined, key: string): string | null => {
    const t = preds?.get(key)?.[0]
    return t && t.type === 'iri' ? localId(t.value) : null
  }

  // Find the Workspace node.
  let W: string | null = null
  for (const [s, preds] of bySubject) {
    const rt = preds.get(RDF_TYPE)?.[0]
    if (rt && rt.type === 'iri' && localId(rt.value) === 'Workspace') {
      W = s
      break
    }
  }
  if (!W) throw new NoWorkspaceNodeError()
  const wp = bySubject.get(W)!

  // Regions
  const regions: Record<string, RegionConfig> = {}
  for (const iri of (wp.get('hasRegion') ?? []).filter(isIri).map((t) => t.value)) {
    const rp = bySubject.get(iri)
    const id = localId(iri)
    const docksPanel = (rp?.get('docksPanel') ?? [])
      .filter(isIri)
      .map((t) => localId(t.value))
      .sort() // determinism: docksPanel id-sorted
    // sux:fragmentSurface — the RAW IRI term value, deliberately NOT read
    // through iriRef/localId (which would shorten a sux:-prefixed IRI); the
    // surface IRI must round-trip verbatim. Key stays ABSENT when unset so
    // serialize→parse→deepEqual holds for configs that never carried it.
    const fragmentSurfaceTerm = rp?.get('fragmentSurface')?.[0]
    const fragmentSurface = fragmentSurfaceTerm?.type === 'iri' ? fragmentSurfaceTerm.value : undefined
    const surfaceMode = lit(rp, 'surfaceMode') as SurfaceRegionMode | null
    const surfaceRole = lit(rp, 'surfaceRole') as SurfaceRegionRole | null
    regions[id] = {
      id,
      label: lit(rp, RDFS_LABEL) ?? '',
      childRegion: iriRef(rp, 'childRegion'),
      order: intOf(lit(rp, 'order')),
      splitOrientation: (lit(rp, 'splitOrientation') ?? 'vertical') as SplitOrientation,
      collapsible: boolOf(lit(rp, 'collapsible')),
      resizable: boolOf(lit(rp, 'resizable')),
      sizeFraction: numOrNull(lit(rp, 'sizeFraction')),
      dockState: (lit(rp, 'dockState') as DockState | null) ?? null,
      docksPanel,
      renderedByComponent: lit(rp, 'renderedByComponent'),
      ...(surfaceMode !== null ? { surfaceMode } : {}),
      ...(surfaceRole !== null ? { surfaceRole } : {}),
      ...(fragmentSurface !== undefined ? { fragmentSurface } : {}),
    }
  }

  // Panels
  const panels: Record<string, PanelConfig> = {}
  for (const iri of (wp.get('hasPanel') ?? []).filter(isIri).map((t) => t.value)) {
    const pp = bySubject.get(iri)
    const id = localId(iri)
    panels[id] = {
      id,
      label: lit(pp, RDFS_LABEL) ?? '',
      renderedByComponent: lit(pp, 'renderedByComponent') ?? '',
      dockState: (lit(pp, 'dockState') as DockState) ?? 'docked',
      defaultVisible: boolOf(lit(pp, 'defaultVisible')),
    }
  }

  // Dimensions + values (values sorted by ordinalIndex)
  const dimensions: Record<string, ConfigDimension> = {}
  for (const iri of (wp.get('hasDimension') ?? []).filter(isIri).map((t) => t.value)) {
    const dp = bySubject.get(iri)
    const id = localId(iri)
    const values: Array<ConfigDimensionValue & { _ord: number }> = []
    for (const viri of (dp?.get('hasValue') ?? []).filter(isIri).map((t) => t.value)) {
      const vp = bySubject.get(viri)
      values.push({
        id: localId(viri),
        literalValue: lit(vp, 'literalValue') ?? '',
        appliesAttribute: lit(vp, 'appliesAttribute') ?? '',
        _ord: intOf(lit(vp, 'ordinalIndex')),
      })
    }
    values.sort((a, b) => a._ord - b._ord || a.literalValue.localeCompare(b.literalValue))
    dimensions[id] = {
      id,
      label: lit(dp, RDFS_LABEL) ?? '',
      defaultValue: lit(dp, 'defaultValue') ?? '',
      values: values.map(({ _ord, ...v }) => v),
    }
  }

  // rootRegions — explicit ordered RootEntry nodes (inverse of serialize).
  const rootArr: string[] = []
  for (const iri of (wp.get('hasRootEntry') ?? []).filter(isIri).map((t) => t.value)) {
    const ep = bySubject.get(iri)
    const region = iriRef(ep, 'rootRegion')
    if (region !== null) rootArr[intOf(lit(ep, 'atIndex'))] = region
  }
  const rootRegions = rootArr.filter((x) => x !== undefined)

  // appRootRegions — from indexed AppRootEntry nodes (omit the key if none).
  const appRootRegions: Record<AppId, string[]> = {}
  for (const iri of (wp.get('hasAppRootEntry') ?? []).filter(isIri).map((t) => t.value)) {
    const ep = bySubject.get(iri)
    const app = lit(ep, 'forApp')
    const region = iriRef(ep, 'rootRegion')
    const at = intOf(lit(ep, 'atIndex'))
    if (app === null || region === null) continue
    ;(appRootRegions[app] ??= [])[at] = region
  }
  const appKeys = Object.keys(appRootRegions)

  // edges — indexed ConfigEdge nodes (inverse of serialize). from/to come back
  // through iriRef → localId, which strips the sux: prefix ('face:editor');
  // face nodes carry no localId triple, so the prefix-strip fallback applies.
  // Index by atIndex and drop holes (a partial/dropped entry never appears).
  const edgeArr: ConfigEdge[] = []
  for (const iri of (wp.get('hasConfigEdge') ?? []).filter(isIri).map((t) => t.value)) {
    const ep = bySubject.get(iri)
    const from = iriRef(ep, 'from')
    const to = iriRef(ep, 'to')
    const predicate = lit(ep, 'predicate')
    if (from === null || to === null || predicate === null) continue
    edgeArr[intOf(lit(ep, 'atIndex'))] = { from, to, predicate }
  }
  const edges = edgeArr.filter((x) => x !== undefined)

  const config: WorkspaceConfig = {
    id: lit(wp, 'localId') ?? localId(W),
    label: lit(wp, RDFS_LABEL) ?? '',
    renderedByComponent: lit(wp, 'renderedByComponent') ?? '',
    regions,
    panels,
    dimensions,
    rootRegions,
    ...(appKeys.length
      ? { appRootRegions: Object.fromEntries(appKeys.map((k) => [k, appRootRegions[k].filter((x) => x !== undefined)])) }
      : {}),
    ...(edges.length ? { edges } : {}),
  }
  return config
}

// ── small coercions / guards ─────────────────────────────────────────────────

function intOf(s: string | null): number {
  return s === null ? 0 : Math.trunc(Number(s))
}
function boolOf(s: string | null): boolean {
  return s === 'true'
}
function numOrNull(s: string | null): number | null {
  return s === null ? null : Number(s)
}
