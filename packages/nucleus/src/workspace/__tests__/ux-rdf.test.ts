/**
 * WP0.1 — WorkspaceConfig ↔ RDF round-trip.
 *
 * The load-bearing equivalence: the build-time GARDEN_DEFAULT literal and the
 * server-seeded `:ux:config` subgraph are the SAME data in two encodings. This
 * pins serialize→parse as a faithful inverse (modulo deepFreeze), and the
 * deterministic ordering the gateway seed (WP5.1) relies on for idempotency.
 *
 * Pure: no DOM, no stores, no network.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, it, expect } from 'vitest'
import {
  NoWorkspaceNodeError,
  isNoWorkspaceNodeError,
  serializeConfigToTriples,
  parseTriplesToConfig,
  uxConfigGraphIri,
  uxWfStateGraphIri,
  triplesToNT,
} from '../ux-rdf.js'
import { compareTriples } from '../rdf-model.js'
import { GARDEN_DEFAULT } from '../garden-default.js'
import type { RegionConfig, WorkspaceConfig } from '../types.js'

const CHOREO_CENTER: RegionConfig = {
  id: 'region-choreo-center',
  label: 'Choreograph Center',
  childRegion: null,
  order: 2,
  splitOrientation: 'vertical',
  collapsible: false,
  resizable: true,
  sizeFraction: 0.8,
  dockState: null,
  docksPanel: [],
  renderedByComponent: 'wf-mission-control',
}

const TWO_APP: WorkspaceConfig = {
  ...GARDEN_DEFAULT,
  regions: { ...GARDEN_DEFAULT.regions, 'region-choreo-center': CHOREO_CENTER },
  rootRegions: GARDEN_DEFAULT.rootRegions,
  appRootRegions: {
    garden: ['region-top-bar', 'region-left-rail', 'region-bottom-bar'],
    choreograph: ['region-top-bar', 'region-choreo-center', 'region-bottom-bar'],
  },
}

// A synthetic edges-bearing config exercising the three TIER-A slice-1 couplings,
// authored inline here (rather than reusing GARDEN_DEFAULT's now-seeded edges) so
// the round-trip pins the edge codec against a fixture this test fully controls.
// `from` values collide by design (comments drives + reveals) to prove per-edge
// identity survives the minted-IRI scheme rather than the from/to pair.
const WITH_EDGES: WorkspaceConfig = {
  ...GARDEN_DEFAULT,
  edges: [
    { from: 'face:comments', to: 'face:inspector', predicate: 'drivesSelection' },
    { from: 'face:graph', to: 'face:editor', predicate: 'reveals' },
    { from: 'face:comments', to: 'face:editor', predicate: 'reveals' },
  ],
}

describe('WP0.1 — ux-rdf round-trip', () => {
  it('GARDEN_DEFAULT → serialize → parse → deepEqual (modulo freeze)', () => {
    const triples = serializeConfigToTriples(GARDEN_DEFAULT)
    const back = parseTriplesToConfig(triples)
    expect(back).toEqual(GARDEN_DEFAULT)
    // P0: GARDEN_DEFAULT now carries the choreograph region-set → the per-app
    // AppRootEntry nodes round-trip back into appRootRegions.choreograph.
    expect(back.appRootRegions).toBeDefined()
    expect(back.appRootRegions?.choreograph).toEqual([
      'region-top-bar',
      'region-choreo-center',
      'region-bottom-bar',
    ])
  })

  it('multi-app config (appRootRegions) round-trips faithfully', () => {
    const back = parseTriplesToConfig(serializeConfigToTriples(TWO_APP))
    expect(back).toEqual(TWO_APP)
    expect(back.appRootRegions?.choreograph).toEqual([
      'region-top-bar',
      'region-choreo-center',
      'region-bottom-bar',
    ])
  })

  it('edges-bearing config round-trips faithfully (semantic edge overlay, slice 1)', () => {
    const back = parseTriplesToConfig(serializeConfigToTriples(WITH_EDGES))
    expect(back).toEqual(WITH_EDGES)
    // Order and per-edge identity survive: the two `face:comments` sources are
    // distinct edges, kept apart by their minted atIndex, not merged.
    expect(back.edges).toEqual([
      { from: 'face:comments', to: 'face:inspector', predicate: 'drivesSelection' },
      { from: 'face:graph', to: 'face:editor', predicate: 'reveals' },
      { from: 'face:comments', to: 'face:editor', predicate: 'reveals' },
    ])
  })

  it('sux:fragmentSurface round-trips verbatim as an IRI object (Surface unification vocab)', () => {
    const withFragmentSurface: WorkspaceConfig = {
      ...GARDEN_DEFAULT,
      regions: {
        ...GARDEN_DEFAULT.regions,
        'region-frag-center': {
          ...CHOREO_CENTER,
          id: 'region-frag-center',
          label: 'Fragment Center',
          renderedByComponent: 'sh-layout-dashboard',
          fragmentSurface: 'urn:sophia:ux:surface:observatory-dashboard',
        },
      },
    }
    const triples = serializeConfigToTriples(withFragmentSurface)
    const back = parseTriplesToConfig(triples)
    expect(back).toEqual(withFragmentSurface)
    // The IRI is emitted VERBATIM (its own urn: space, never sux:-minted) …
    expect(triplesToNT(triples)).toContain(
      '<http://sophia.ai/ux#region-frag-center> ' +
        '<http://sophia.ai/ux#fragmentSurface> <urn:sophia:ux:surface:observatory-dashboard> .',
    )
    // … and parses back verbatim, never localId-shortened.
    expect(back.regions['region-frag-center'].fragmentSurface).toBe(
      'urn:sophia:ux:surface:observatory-dashboard',
    )
    // A config that never carried the predicate stays key-ABSENT (deepEqual
    // with the original — the round-trip adds nothing).
    const plain = parseTriplesToConfig(serializeConfigToTriples(GARDEN_DEFAULT))
    expect('fragmentSurface' in plain.regions['region-center']).toBe(false)
  })

  it('sux:surfaceRole and sux:surfaceMode round-trip as independent semantic facts', () => {
    const withConfiguredCenter: WorkspaceConfig = {
      ...GARDEN_DEFAULT,
      regions: {
        ...GARDEN_DEFAULT.regions,
        'region-center': {
          ...GARDEN_DEFAULT.regions['region-center'],
          surfaceRole: 'center',
          surfaceMode: 'configured',
        },
      },
    }
    const triples = serializeConfigToTriples(withConfiguredCenter)
    const back = parseTriplesToConfig(triples)
    expect(back).toEqual(withConfiguredCenter)
    expect(triplesToNT(triples)).toContain(
      '<http://sophia.ai/ux#region-center> ' +
        '<http://sophia.ai/ux#surfaceMode> "configured" .',
    )
    expect(back.regions['region-center']).toMatchObject({
      surfaceRole: 'center',
      surfaceMode: 'configured',
    })
  })

  it('an edge is a minted IRI subject (never a blank node) typed sux:ConfigEdge', () => {
    const nt = triplesToNT(serializeConfigToTriples(WITH_EDGES))
    // Subject is the minted `${id}-edge-${idx}` IRI in the sux: space — no `_:`
    // blank-node syntax anywhere (rdf-model Term is iri|literal only).
    expect(nt).toContain(
      '<http://sophia.ai/ux#GardenDefault-edge-0> ' +
        '<http://www.w3.org/1999/02/22-rdf-syntax-ns#type> ' +
        '<http://sophia.ai/ux#ConfigEdge> .',
    )
    // from/to are sux:face: IRIs; predicate is a PLAIN literal (no datatype).
    expect(nt).toContain(
      '<http://sophia.ai/ux#GardenDefault-edge-0> ' +
        '<http://sophia.ai/ux#from> <http://sophia.ai/ux#face:comments> .',
    )
    expect(nt).toContain(
      '<http://sophia.ai/ux#GardenDefault-edge-0> ' +
        '<http://sophia.ai/ux#predicate> "drivesSelection" .',
    )
    expect(nt).not.toContain('_:')
  })

  it('edges serialize in canonical compareTriples byte-order (idempotent seed)', () => {
    const triples = serializeConfigToTriples(WITH_EDGES)
    // The emitted list is already in the total (s, p, object-key) order the seed
    // relies on — re-sorting is a no-op, byte-for-byte.
    expect(triplesToNT(triples)).toBe(triplesToNT([...triples].sort(compareTriples)))
    // And it is stable run-to-run.
    expect(triplesToNT(triples)).toBe(triplesToNT(serializeConfigToTriples(WITH_EDGES)))
  })

  it('serialization is deterministic (stable triple order for the idempotent seed)', () => {
    // Same input → byte-identical N-Triples on every run (what the seed relies on).
    const a = serializeConfigToTriples(GARDEN_DEFAULT)
    const b = serializeConfigToTriples(GARDEN_DEFAULT)
    expect(triplesToNT(a)).toBe(triplesToNT(b))
    expect(a.length).toBe(b.length)
  })

  it('named-graph IRIs follow the cell scheme (non-reserved, parallel to :user:rdf)', () => {
    expect(uxConfigGraphIri('g-abc')).toBe('urn:mnemosyne:local:graph:g-abc:ux:config')
    expect(uxWfStateGraphIri('g-abc')).toBe('urn:mnemosyne:local:graph:g-abc:ux:wfstate')
  })

  it('parse throws when no Workspace node is present', () => {
    expect(() => parseTriplesToConfig([])).toThrow(/no sux:Workspace/)
  })

  it('the absent-Workspace throw is the TYPED signal, distinct from every other error', () => {
    // The absent case (fresh/imported/legacy graphs) is recognizable so shells
    // can map it to a default; nothing else may match the guard.
    let thrown: unknown
    try {
      parseTriplesToConfig([])
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(NoWorkspaceNodeError)
    expect(isNoWorkspaceNodeError(thrown)).toBe(true)
    // The message is pinned VERBATIM (fossil-conformance surfaces it unsoftened).
    expect((thrown as Error).message).toBe('parseTriplesToConfig: no sux:Workspace node found')
    // Negative space: a generic error with a similar message is NOT the signal.
    expect(isNoWorkspaceNodeError(new Error('parseTriplesToConfig: no sux:Workspace node found'))).toBe(false)
    expect(isNoWorkspaceNodeError(undefined)).toBe(false)
  })

  it('N-Triples rendering is well-formed (every line ends with " .")', () => {
    const nt = triplesToNT(serializeConfigToTriples(GARDEN_DEFAULT))
    const lines = nt.split('\n')
    expect(lines.length).toBeGreaterThan(40)
    expect(lines.every((l) => l.endsWith(' .'))).toBe(true)
  })

  // ── WP0.2 — committed seed artifact must equal the live serialization ──────
  it('the committed seed artifact equals triplesToNT(serialize(GARDEN_DEFAULT))', () => {
    // The generator (scripts/generate-garden-default.mts) writes a committed
    // .nt artifact. It must never drift from the live serialization of the
    // canonical literal — if this fails, run `pnpm generate:ux-seed`.
    const artifactPath = resolve(
      process.cwd(),
      'src/workspace/__generated__/garden-default.ux.nt',
    )
    const artifact = readFileSync(artifactPath, 'utf8')
    // The artifact body is the file with its '#'-comment header lines stripped
    // and the trailing newline removed (header is metadata, not seed triples).
    const body = artifact
      .split('\n')
      .filter((l) => !l.startsWith('#'))
      .join('\n')
      .replace(/\n+$/, '')
    const live = triplesToNT(serializeConfigToTriples(GARDEN_DEFAULT))
    expect(body).toBe(live)
  })
})
