/**
 * workspace-fragments.test.ts — real, no-mock proof of the Surface-unification
 * shell controller (`WorkspaceFragmentsController`), the wiring that REPLACED
 * the retired nested-interpreter dashboard mount:
 *
 *   - GRAPH-AUTHORED boot: a store carrying one `ux:layoutJson` literal loads
 *     into a `ready` fragment state (source of truth for the spliced render).
 *   - PERSIST-ON-COMMIT: an `input`-phase change only updates the held doc; a
 *     `commit` change durably REPLACES the stored literal through the real
 *     persister/sink — the store lands on exactly ONE literal whose split
 *     ratio moved.
 *   - ERROR surfacing: a uniqueness violation (two ux:layoutJson rows) becomes
 *     an explicit error state, never a silent fallback; an UNAUTHORED
 *     non-default surface is an honest error, not a canned substitution.
 *   - SESSION scoping: a graph switch resets to a fresh load.
 *
 * The store double is the same REAL store-backed in-memory `RestClient` the
 * retired mount test built (an actual per-subject list of literals, so a
 * non-replacing write would genuinely trip the reader's uniqueness throw).
 * No vi.* anywhere.
 */
import { describe, expect, it } from 'vitest'
import { GARDEN_DEFAULT, type WorkspaceConfig } from '@shrubbery/nucleus'
import type { RestClient } from '@shrubbery/nucleus/contract'
import { createSophiaHomeDescriptor, type LayoutDocument } from '@shrubbery/nucleus/layout'
import { LAYOUT_DASHBOARD_COMPONENT, makeQueryBlockService } from '@shrubbery/runtime'
import { uxConfigGraphIri } from '@shrubbery/nucleus'
import { OBSERVATORY_UX_SURFACE_IRI } from '../harness/observatory-layout-source.js'
import {
  WorkspaceFragmentsController,
  configDeclaresDashboardCenter,
  configDeclaresObservatoryCenter,
  fragmentRegionsOf,
} from './workspace-fragments.js'
import { createObservatoryFreshnessAttachment } from './observatory-freshness-attachment.js'

const GRAPH_ID = 'workspace-fragments-test'
const CUSTOM_SURFACE_IRI = 'urn:sophia:ux:surface:another-surface'

/** Store-backed in-memory RestClient (verbatim pattern from the retired mount test). */
class InMemoryLayoutConfigStore implements RestClient {
  private readonly triples = new Map<string, string[]>()
  private readonly themes = new Map<string, string[]>()
  updateCount = 0

  private key(graphIri: string, subject: string): string {
    return `${graphIri} ${subject}`
  }

  seed(graphId: string, subject: string, value: string): void {
    const key = this.key(uxConfigGraphIri(graphId), subject)
    this.triples.set(key, [...(this.triples.get(key) ?? []), value])
  }

  replace(graphId: string, subject: string, value: string): void {
    this.triples.set(this.key(uxConfigGraphIri(graphId), subject), [value])
  }

  /** Seed a sibling `ux:vegaTheme` literal — its own map, since it is a genuinely separate triple from `ux:layoutJson`. */
  seedTheme(graphId: string, subject: string, value: string): void {
    const key = this.key(uxConfigGraphIri(graphId), subject)
    this.themes.set(key, [...(this.themes.get(key) ?? []), value])
  }

  storedValues(graphId: string, subject: string): readonly string[] {
    return this.triples.get(this.key(uxConfigGraphIri(graphId), subject)) ?? []
  }

  async graphs(): Promise<unknown> {
    throw new Error('not used')
  }

  async query(_graphId: string, sparql: string): Promise<unknown> {
    // The controller's #load() fires a sibling ux:vegaTheme query in
    // parallel with the ux:layoutJson one (workspace-fragments.ts) — routed
    // here to its own `themes` map (empty by default: an honest 'fallback',
    // never an error, unless a test explicitly `seedTheme`s one).
    if (sparql.includes('ux:vegaTheme')) {
      const graphIri = firstGraphIri(sparql)
      const subject = firstVegaThemeSubject(sparql)
      const values = this.themes.get(this.key(graphIri, subject)) ?? []
      return { rows: values.map((value) => ({ vegaTheme: { type: 'literal', value } })) }
    }
    const graphIri = firstGraphIri(sparql)
    const subject = firstSubject(sparql)
    const values = this.triples.get(this.key(graphIri, subject)) ?? []
    return { rows: values.map((value) => ({ layoutJson: { type: 'literal', value } })) }
  }

  async update(_graphId: string, sparql: string): Promise<void> {
    this.updateCount += 1
    const deleteIdx = sparql.indexOf('DELETE WHERE')
    const insertIdx = sparql.indexOf('INSERT DATA')

    if (deleteIdx >= 0) {
      const region = sparql.slice(deleteIdx, insertIdx >= 0 ? insertIdx : undefined)
      this.triples.delete(this.key(firstGraphIri(region), firstSubject(region)))
    }
    if (insertIdx >= 0) {
      const region = sparql.slice(insertIdx)
      const marker = `ux:layoutJson "`
      const markerIdx = region.indexOf(marker)
      if (markerIdx < 0) throw new Error('store: INSERT DATA missing ux:layoutJson literal')
      const value = scanSparqlLiteral(region, markerIdx + marker.length - 1)
      const key = this.key(firstGraphIri(region), firstSubject(region))
      this.triples.set(key, [...(this.triples.get(key) ?? []), value])
    }
  }
}

function firstGraphIri(sparql: string): string {
  const match = /GRAPH\s+<([^>]+)>/.exec(sparql)
  if (!match) throw new Error('store: no GRAPH <iri> in SPARQL')
  return match[1]
}

function firstSubject(sparql: string): string {
  const match = /<([^>]+)>\s+ux:layoutJson/.exec(sparql)
  if (!match) throw new Error('store: no <subject> ux:layoutJson in SPARQL')
  return match[1]
}

function firstVegaThemeSubject(sparql: string): string {
  const match = /<([^>]+)>\s+ux:vegaTheme/.exec(sparql)
  if (!match) throw new Error('store: no <subject> ux:vegaTheme in SPARQL')
  return match[1]
}

function scanSparqlLiteral(text: string, openQuoteIdx: number): string {
  let out = ''
  let i = openQuoteIdx + 1
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\\') {
      const next = text[i + 1]
      out += next === 'n' ? '\n' : next === 'r' ? '\r' : next === 't' ? '\t' : next
      i += 2
      continue
    }
    if (ch === '"') return out
    out += ch
    i += 1
  }
  throw new Error('store: unterminated SPARQL string literal')
}

/** GARDEN_DEFAULT with its center region re-declared as a fragment region. */
function markerConfig(fragmentSurface?: string): WorkspaceConfig {
  return {
    ...GARDEN_DEFAULT,
    regions: {
      ...GARDEN_DEFAULT.regions,
      'region-center': {
        ...GARDEN_DEFAULT.regions['region-center'],
        renderedByComponent: LAYOUT_DASHBOARD_COMPONENT,
        ...(fragmentSurface !== undefined ? { fragmentSurface } : {}),
      },
    },
  }
}

/** A minimal valid fragment (split of stat.scalar + sophia.home). */
function fragmentDoc(): LayoutDocument {
  return {
    schemaVersion: 1,
    layoutId: 'authored-fragment',
    scope: 'workspace',
    graphId: GRAPH_ID,
    rootNodeId: 'root',
    nodes: {
      root: {
        kind: 'split',
        id: 'root',
        axis: 'horizontal',
        startNodeId: 'stat',
        endNodeId: 'home',
        startBasisPoints: 4000,
      },
      stat: {
        kind: 'leaf',
        id: 'stat',
        descriptorRevision: 0,
        descriptor: {
          schemaVersion: 1,
          faceId: 'stat.scalar',
          resource: { kind: 'query', graphId: GRAPH_ID, queryId: 'SELECT (1 AS ?n) WHERE { }' },
          params: { label: 'One' },
        },
      },
      home: { kind: 'leaf', id: 'home', descriptorRevision: 0, descriptor: createSophiaHomeDescriptor() },
    },
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
  }
}

function makeController(): {
  readonly controller: WorkspaceFragmentsController
  readonly renders: () => number
  readonly persistErrors: unknown[]
} {
  let renderCount = 0
  const persistErrors: unknown[] = []
  const controller = new WorkspaceFragmentsController({
    requestRender: () => {
      renderCount += 1
    },
    onPersistError: (error) => persistErrors.push(error),
  })
  return { controller, renders: () => renderCount, persistErrors }
}

describe('fragmentRegionsOf / configDeclaresDashboardCenter', () => {
  it('finds marker regions and applies the default surface IRI when the vocab is absent', () => {
    expect(fragmentRegionsOf(GARDEN_DEFAULT)).toEqual([])
    expect(configDeclaresDashboardCenter(GARDEN_DEFAULT)).toBe(false)
    expect(fragmentRegionsOf(markerConfig())).toEqual([
      { regionId: 'region-center', surfaceIri: OBSERVATORY_UX_SURFACE_IRI },
    ])
    expect(configDeclaresDashboardCenter(markerConfig())).toBe(true)
    expect(configDeclaresObservatoryCenter(markerConfig())).toBe(true)
  })

  it('honors an explicit sux:fragmentSurface verbatim', () => {
    expect(fragmentRegionsOf(markerConfig(CUSTOM_SURFACE_IRI))).toEqual([
      { regionId: 'region-center', surfaceIri: CUSTOM_SURFACE_IRI },
    ])
    expect(configDeclaresDashboardCenter(markerConfig(CUSTOM_SURFACE_IRI))).toBe(true)
    expect(configDeclaresObservatoryCenter(markerConfig(CUSTOM_SURFACE_IRI))).toBe(false)
  })
})

describe('WorkspaceFragmentsController', () => {
  it('loads a graph-authored fragment: loading → ready, one render request', async () => {
    const rest = new InMemoryLayoutConfigStore()
    rest.seed(GRAPH_ID, OBSERVATORY_UX_SURFACE_IRI, JSON.stringify(fragmentDoc()))
    const { controller, renders } = makeController()

    const first = controller.optionsFor(markerConfig(), { rest, graphId: GRAPH_ID })
    expect(first).not.toBeNull()
    expect(first!.regions!['region-center'].state.status).toBe('loading')
    expect(first!.queryService).not.toBeNull()

    await controller.whenLoaded()
    expect(renders()).toBe(1)

    const second = controller.optionsFor(markerConfig(), { rest, graphId: GRAPH_ID })
    const state = second!.regions!['region-center'].state
    expect(state.status).toBe('ready')
    if (state.status !== 'ready') throw new Error('unreachable')
    expect(state.doc.layoutId).toBe('authored-fragment')
  })

  it('reloads graph-authored source/config when its content revision changes, without a loading flash', async () => {
    const rest = new InMemoryLayoutConfigStore()
    rest.seed(GRAPH_ID, OBSERVATORY_UX_SURFACE_IRI, JSON.stringify(fragmentDoc()))
    const { controller, renders } = makeController()
    const config = markerConfig()

    controller.optionsFor(config, { rest, graphId: GRAPH_ID, configRevision: 'r1' })
    await controller.whenLoaded()
    expect(renders()).toBe(1)

    const revised = { ...fragmentDoc(), layoutId: 'authored-fragment-r2' }
    rest.replace(GRAPH_ID, OBSERVATORY_UX_SURFACE_IRI, JSON.stringify(revised))
    const refreshing = controller.optionsFor(config, {
      rest,
      graphId: GRAPH_ID,
      configRevision: 'r2',
    })!.regions!['region-center'].state
    expect(refreshing.status).toBe('ready')
    if (refreshing.status !== 'ready') throw new Error('unreachable')
    expect(refreshing.doc.layoutId).toBe('authored-fragment')

    await controller.whenLoaded()
    const refreshed = controller.optionsFor(config, {
      rest,
      graphId: GRAPH_ID,
      configRevision: 'r2',
    })!.regions!['region-center'].state
    expect(refreshed.status).toBe('ready')
    if (refreshed.status !== 'ready') throw new Error('unreachable')
    expect(refreshed.doc.layoutId).toBe('authored-fragment-r2')
    expect(renders()).toBe(2)

    // Re-rendering from an unchanged poll is content-idempotent: no query,
    // no replacement load, and no extra render request.
    controller.optionsFor(config, { rest, graphId: GRAPH_ID, configRevision: 'r2' })
    await controller.whenLoaded()
    expect(renders()).toBe(2)
  })

  it('theme-as-data: a sibling ux:vegaTheme literal rides on the REGION state (scoped, never a global)', async () => {
    const rest = new InMemoryLayoutConfigStore()
    rest.seed(GRAPH_ID, OBSERVATORY_UX_SURFACE_IRI, JSON.stringify(fragmentDoc()))
    rest.seedTheme(GRAPH_ID, OBSERVATORY_UX_SURFACE_IRI, JSON.stringify({ axis: { gridColor: '#ff00ff' } }))
    const { controller } = makeController()

    controller.optionsFor(markerConfig(), { rest, graphId: GRAPH_ID })
    await controller.whenLoaded()

    const region = controller.optionsFor(markerConfig(), { rest, graphId: GRAPH_ID })!.regions!['region-center']
    expect(region.state.status).toBe('ready')
    expect(region.vegaTheme).toEqual({ axis: { gridColor: '#ff00ff' } })
  })

  it('theme-as-data: no ux:vegaTheme triple means a null region theme — the house default, nothing bled from anywhere', async () => {
    const rest = new InMemoryLayoutConfigStore()
    rest.seed(GRAPH_ID, OBSERVATORY_UX_SURFACE_IRI, JSON.stringify(fragmentDoc()))
    const { controller } = makeController()

    controller.optionsFor(markerConfig(), { rest, graphId: GRAPH_ID })
    await controller.whenLoaded()

    const region = controller.optionsFor(markerConfig(), { rest, graphId: GRAPH_ID })!.regions!['region-center']
    expect(region.state.status).toBe('ready')
    expect(region.vegaTheme).toBeNull()
  })

  it('theme-as-data: TWO marker regions each carry their OWN surface\'s theme — per-region, no cross-contamination', async () => {
    const config: WorkspaceConfig = {
      ...GARDEN_DEFAULT,
      regions: {
        ...GARDEN_DEFAULT.regions,
        'region-center': {
          ...GARDEN_DEFAULT.regions['region-center'],
          renderedByComponent: LAYOUT_DASHBOARD_COMPONENT,
        },
        'region-right-rail': {
          ...GARDEN_DEFAULT.regions['region-right-rail'],
          renderedByComponent: LAYOUT_DASHBOARD_COMPONENT,
          fragmentSurface: CUSTOM_SURFACE_IRI,
        },
      },
    }
    const rest = new InMemoryLayoutConfigStore()
    rest.seed(GRAPH_ID, OBSERVATORY_UX_SURFACE_IRI, JSON.stringify(fragmentDoc()))
    rest.seed(GRAPH_ID, CUSTOM_SURFACE_IRI, JSON.stringify(fragmentDoc()))
    rest.seedTheme(GRAPH_ID, OBSERVATORY_UX_SURFACE_IRI, JSON.stringify({ axis: { gridColor: '#ff00ff' } }))
    rest.seedTheme(GRAPH_ID, CUSTOM_SURFACE_IRI, JSON.stringify({ legend: { orient: 'top' } }))
    const { controller } = makeController()

    controller.optionsFor(config, { rest, graphId: GRAPH_ID })
    await controller.whenLoaded()

    const regions = controller.optionsFor(config, { rest, graphId: GRAPH_ID })!.regions!
    expect(regions['region-center'].vegaTheme).toEqual({ axis: { gridColor: '#ff00ff' } })
    expect(regions['region-right-rail'].vegaTheme).toEqual({ legend: { orient: 'top' } })
  })

  it('theme-as-data: a session reset (graph switch) drops the previous region themes with the regions themselves', async () => {
    const rest = new InMemoryLayoutConfigStore()
    rest.seed(GRAPH_ID, OBSERVATORY_UX_SURFACE_IRI, JSON.stringify(fragmentDoc()))
    rest.seedTheme(GRAPH_ID, OBSERVATORY_UX_SURFACE_IRI, JSON.stringify({ axis: { gridColor: '#ff00ff' } }))
    const { controller } = makeController()

    controller.optionsFor(markerConfig(), { rest, graphId: GRAPH_ID })
    await controller.whenLoaded()
    expect(
      controller.optionsFor(markerConfig(), { rest, graphId: GRAPH_ID })!.regions!['region-center'].vegaTheme,
    ).toEqual({ axis: { gridColor: '#ff00ff' } })

    // Switch graphs: 'another-graph' has no fragment doc → the default
    // surface falls back to the canned document and carries NO theme — the
    // previous graph's theme must not survive the reset.
    controller.optionsFor(markerConfig(), { rest, graphId: 'another-graph' })
    await controller.whenLoaded()
    const region = controller.optionsFor(markerConfig(), { rest, graphId: 'another-graph' })!.regions!['region-center']
    expect(region.state.status).toBe('ready')
    expect(region.vegaTheme).toBeNull()
  })

  it('persists ONLY at commit: input updates the held doc, commit replaces the single literal', async () => {
    const rest = new InMemoryLayoutConfigStore()
    rest.seed(GRAPH_ID, OBSERVATORY_UX_SURFACE_IRI, JSON.stringify(fragmentDoc()))
    const { controller } = makeController()

    const options = controller.optionsFor(markerConfig(), { rest, graphId: GRAPH_ID })
    await controller.whenLoaded()

    const doc = fragmentDoc()
    const dragged: LayoutDocument = {
      ...doc,
      nodes: { ...doc.nodes, root: { ...doc.nodes.root, kind: 'split', id: 'root', axis: 'horizontal', startNodeId: 'stat', endNodeId: 'home', startBasisPoints: 5500 } },
    }
    options!.onFragmentChange!({
      regionId: 'region-center',
      surfaceIri: OBSERVATORY_UX_SURFACE_IRI,
      doc: dragged,
      phase: 'input',
      source: 'pointer',
    })
    // No durable write yet — the held state moved, the store did not.
    expect(rest.updateCount).toBe(0)
    const held = controller.optionsFor(markerConfig(), { rest, graphId: GRAPH_ID })!.regions!['region-center'].state
    if (held.status !== 'ready') throw new Error('expected held ready state')
    const heldRoot = held.doc.nodes.root
    if (heldRoot.kind !== 'split') throw new Error('unreachable')
    expect(heldRoot.startBasisPoints).toBe(5500)

    options!.onFragmentChange!({
      regionId: 'region-center',
      surfaceIri: OBSERVATORY_UX_SURFACE_IRI,
      doc: dragged,
      phase: 'commit',
      source: 'pointer',
    })
    await controller.whenPersisted()
    expect(rest.updateCount).toBe(1)
    // Exactly ONE literal (replace, never append) with the moved ratio.
    const stored = rest.storedValues(GRAPH_ID, OBSERVATORY_UX_SURFACE_IRI)
    expect(stored).toHaveLength(1)
    const persisted = JSON.parse(stored[0]) as LayoutDocument
    const persistedRoot = persisted.nodes.root
    if (persistedRoot.kind !== 'split') throw new Error('unreachable')
    expect(persistedRoot.startBasisPoints).toBe(5500)
  })

  it('surfaces a uniqueness violation as an honest error state (never a silent pick)', async () => {
    const rest = new InMemoryLayoutConfigStore()
    rest.seed(GRAPH_ID, OBSERVATORY_UX_SURFACE_IRI, '{}')
    rest.seed(GRAPH_ID, OBSERVATORY_UX_SURFACE_IRI, '{}')
    const { controller } = makeController()

    controller.optionsFor(markerConfig(), { rest, graphId: GRAPH_ID })
    await controller.whenLoaded()
    const state = controller.optionsFor(markerConfig(), { rest, graphId: GRAPH_ID })!.regions!['region-center'].state
    expect(state.status).toBe('error')
    if (state.status !== 'error') throw new Error('unreachable')
    expect(state.error).toContain('more than one')
  })

  it('falls back to the canned observatory document ONLY for the default surface', async () => {
    const rest = new InMemoryLayoutConfigStore()
    const { controller } = makeController()
    controller.optionsFor(markerConfig(), { rest, graphId: GRAPH_ID })
    await controller.whenLoaded()
    const state = controller.optionsFor(markerConfig(), { rest, graphId: GRAPH_ID })!.regions!['region-center'].state
    expect(state.status).toBe('ready')
  })

  it('an UNAUTHORED non-default surface is an honest error, never the observatory substitute', async () => {
    const rest = new InMemoryLayoutConfigStore()
    const { controller } = makeController()
    controller.optionsFor(markerConfig(CUSTOM_SURFACE_IRI), { rest, graphId: GRAPH_ID })
    await controller.whenLoaded()
    const state = controller.optionsFor(markerConfig(CUSTOM_SURFACE_IRI), {
      rest,
      graphId: GRAPH_ID,
    })!.regions!['region-center'].state
    expect(state.status).toBe('error')
    if (state.status !== 'error') throw new Error('unreachable')
    expect(state.error).toContain('has not been authored')
  })

  it('a session change (new graph) resets to a fresh load; no marker/no session yields null', async () => {
    const rest = new InMemoryLayoutConfigStore()
    rest.seed(GRAPH_ID, OBSERVATORY_UX_SURFACE_IRI, JSON.stringify(fragmentDoc()))
    const { controller } = makeController()

    controller.optionsFor(markerConfig(), { rest, graphId: GRAPH_ID })
    await controller.whenLoaded()
    const other = controller.optionsFor(markerConfig(), { rest, graphId: 'another-graph' })
    expect(other!.regions!['region-center'].state.status).toBe('loading')

    expect(controller.optionsFor(GARDEN_DEFAULT, { rest, graphId: GRAPH_ID })).toBeNull()
    expect(controller.optionsFor(markerConfig(), null)).toBeNull()
  })

  it('a mirror query-service rotation keeps the loaded fragment while rotating Surface resources', async () => {
    const rest = new InMemoryLayoutConfigStore()
    rest.seed(GRAPH_ID, OBSERVATORY_UX_SURFACE_IRI, JSON.stringify(fragmentDoc()))
    const { controller, renders } = makeController()
    const firstService = makeQueryBlockService(rest)

    controller.optionsFor(markerConfig(), { rest, graphId: GRAPH_ID, queryService: firstService })
    await controller.whenLoaded()
    const rendersAfterLoad = renders()

    // SourceMirrorRuntime intentionally changes this identity at a mirror
    // epoch. That invalidates engine resource stores, but it must not turn an
    // already-rendered authored tabs fragment back into a loading document.
    const rotatedService = makeQueryBlockService(rest)
    const rotated = controller.optionsFor(markerConfig(), {
      rest,
      graphId: GRAPH_ID,
      queryService: rotatedService,
    })
    expect(rotated!.queryService).toBe(rotatedService)
    expect(rotated!.regions!['region-center'].state.status).toBe('ready')
    expect(renders()).toBe(rendersAfterLoad)
  })
})

// ── P3b — the freshness governor's hosted attachment ────────────────────────
//
// `stampEl` is a plain injected `<div>` here, not the real `document
// .documentElement` — the SAME "inject the stamp element" convention P3a's
// own governor tests use, so these tests never touch (or leak state onto)
// the actual global `<html>` element. The contract's own "no data-freshness
// on `<html>`" language describes the PRODUCTION wiring (`main.ts` passes
// `document.documentElement`); this fake stands in for it under test.
//
// `InMemoryLayoutConfigStore` only understands `ux:layoutJson`/`ux:vegaTheme`
// SPARQL shapes (this file's own fixture, above) — the freshness governor's
// OWN query (`obs:ProjectionRun`) is a different shape it does not recognize,
// so every read here lands in the honest 'unknown' tone. That is
// deliberate and sufficient for H1/H2: both tests are about the ATTACHMENT's
// mount/gate/teardown wiring, not about a successful freshness read (P3a's
// own suite already proves the read path against a service that understands
// the query).
class CountingRestClient implements RestClient {
  queryCount = 0
  constructor(private readonly inner: RestClient) {}
  async graphs(): Promise<unknown> {
    return this.inner.graphs()
  }
  async query(graphId: string, sparql: string): Promise<unknown> {
    this.queryCount += 1
    return this.inner.query(graphId, sparql)
  }
  async update(graphId: string, sparql: string): Promise<void> {
    return this.inner.update(graphId, sparql)
  }
}

const flushAsync = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('createObservatoryFreshnessAttachment (P3b — the freshness governor, hosted)', () => {
  it('H1: the governor mounts iff configDeclaresDashboardCenter is true — a non-Observatory workspace gets no strip and no data-freshness on the stamp element', async () => {
    const rest = new InMemoryLayoutConfigStore()
    rest.seed(GRAPH_ID, OBSERVATORY_UX_SURFACE_IRI, JSON.stringify(fragmentDoc()))
    const hostEl = document.createElement('div')
    const stampEl = document.createElement('div')
    const attachment = createObservatoryFreshnessAttachment({ hostEl, stampEl })

    // Non-Observatory workspace: GARDEN_DEFAULT declares no marker region.
    attachment.sync(GARDEN_DEFAULT, { rest, graphId: GRAPH_ID })
    expect(attachment.current()).toBeNull()
    expect(hostEl.querySelector('.obs-freshness')).toBeNull()
    expect(stampEl.dataset.freshness).toBeUndefined()

    // Observatory workspace: the marker region is declared — the governor mounts.
    attachment.sync(markerConfig(), { rest, graphId: GRAPH_ID })
    expect(attachment.current()).not.toBeNull()
    expect(hostEl.querySelector('.obs-freshness')).not.toBeNull()
    await flushAsync()
    expect(stampEl.dataset.freshness).toBeDefined()

    // A different graph-authored dashboard is not an Observatory and gets no
    // Observatory-specific projector testimony.
    attachment.sync(markerConfig(CUSTOM_SURFACE_IRI), { rest, graphId: GRAPH_ID })
    expect(attachment.current()).toBeNull()
    expect(hostEl.querySelector('.obs-freshness')).toBeNull()

    // Losing the marker (config reverts) tears the governor back down.
    attachment.sync(GARDEN_DEFAULT, { rest, graphId: GRAPH_ID })
    expect(attachment.current()).toBeNull()
    expect(hostEl.querySelector('.obs-freshness')).toBeNull()
    expect(stampEl.dataset.freshness).toBeUndefined()

    attachment.dispose()
  })

  it('H2: teardown disposes the governor — no further queries after dispose, and every published attribute is gone', async () => {
    const inner = new InMemoryLayoutConfigStore()
    inner.seed(GRAPH_ID, OBSERVATORY_UX_SURFACE_IRI, JSON.stringify(fragmentDoc()))
    const rest = new CountingRestClient(inner)
    const hostEl = document.createElement('div')
    const stampEl = document.createElement('div')
    const attachment = createObservatoryFreshnessAttachment({ hostEl, stampEl })

    attachment.sync(markerConfig(), { rest, graphId: GRAPH_ID })
    await flushAsync()
    expect(rest.queryCount).toBeGreaterThan(0)
    expect(stampEl.getAttributeNames().length).toBeGreaterThan(0)
    expect(hostEl.querySelector('.obs-freshness')).not.toBeNull()

    const queriesBeforeDispose = rest.queryCount
    attachment.dispose()

    expect(attachment.current()).toBeNull()
    expect(hostEl.querySelector('.obs-freshness')).toBeNull()
    expect(stampEl.getAttributeNames()).toEqual([])

    // No timer/listener survives teardown to fire a further query.
    await flushAsync()
    expect(rest.queryCount).toBe(queriesBeforeDispose)
  })
})
