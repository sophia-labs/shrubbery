/**
 * grow-verbs unit tests — the RUNG G1 add verbs + the catalog gate + the
 * additivity invariant that silently broke before this rung.
 *
 * Pure tests (no DOM, no cell): the verbs are pure config→config; the gate is a
 * pure verdict; the additivity proof is a pure serialize→compare. The REAL-cell
 * grow + DOM-grow assertions live in @shrubbery/atelier (where the gardend binary
 * + every render package are available). Here we prove the structural laws.
 */

import { describe, it, expect } from 'vitest'
import {
  addPanel,
  addRegion,
  addRootRegion,
} from '../mutations.js'
import { applyVerb, type VerbSpec } from '../apply-verb.js'
import { KNOWN_COMPONENTS, isKnownComponent } from '../known-components.js'
import { validateConfig } from '../validate.js'
import {
  serializeConfigToTriples,
  parseTriplesToConfig,
  triplesToNT,
  type Triple,
} from '../ux-rdf.js'
import { minimalTextPanelConfig } from '../minimal-text-panel.js'
import type { PanelConfig, RegionConfig } from '../types.js'

/** Canonical N-Triples line of a single triple (for set membership). */
const lineOf = (t: Triple): string => triplesToNT([t])

/** A non-resizable chrome region (the shape addRootRegion roots). */
function chromeRegion(id: string, order: number, component: string): RegionConfig {
  return {
    id,
    label: id,
    childRegion: null,
    order,
    splitOrientation: 'horizontal',
    collapsible: false,
    resizable: false,
    sizeFraction: null,
    dockState: null,
    docksPanel: [],
    renderedByComponent: component,
  }
}

describe('add verbs — immutability + freezing', () => {
  it('every add verb returns a deep-frozen config and does not mutate the input', () => {
    const seed = minimalTextPanelConfig()
    const before = JSON.stringify(seed)

    const panel: PanelConfig = {
      id: 'panel-chat',
      label: 'Chat',
      renderedByComponent: 'sh-chat-panel',
      dockState: 'docked',
      defaultVisible: true,
    }
    const a = addPanel(seed, panel)
    const b = addRegion(seed, chromeRegion('region-bottom-bar', 9, 'mn-bottom-bar'))
    const c = addRootRegion(seed, chromeRegion('region-top-bar2', 0, 'mn-top-bar'))

    for (const cfg of [a, b, c]) {
      expect(Object.isFrozen(cfg)).toBe(true)
      expect(Object.isFrozen(cfg.regions)).toBe(true)
      expect(Object.isFrozen(cfg.panels)).toBe(true)
    }
    expect(JSON.stringify(seed)).toBe(before) // input untouched
  })
})

describe('add verbs — round-trip through serialize → parse', () => {
  it('addPanel survives serialize→parse', () => {
    const seed = minimalTextPanelConfig()
    const grown = addPanel(seed, {
      id: 'panel-chat',
      label: 'Chat',
      renderedByComponent: 'sh-chat-panel',
      dockState: 'docked',
      defaultVisible: true,
    })
    const round = parseTriplesToConfig(serializeConfigToTriples(grown))
    expect(round.panels['panel-chat']?.renderedByComponent).toBe('sh-chat-panel')
    // The seed's panel survives too (additive).
    expect(round.panels['panel-text']?.renderedByComponent).toBe('mn-card')
  })

  it('addRootRegion survives serialize→parse with the bar now rooted', () => {
    const seed = minimalTextPanelConfig()
    const grown = addRootRegion(seed, chromeRegion('region-top-bar2', 0, 'mn-top-bar'))
    const round = parseTriplesToConfig(serializeConfigToTriples(grown))
    expect([...round.rootRegions].sort()).toEqual(['region-center', 'region-top-bar2'])
    expect(round.regions['region-top-bar2']?.renderedByComponent).toBe('mn-top-bar')
    // The seed's resizable head is still rooted (additive).
    expect(round.regions['region-center']?.resizable).toBe(true)
  })

  it('addRegion (child placement) splices into the spine and round-trips', () => {
    const seed = minimalTextPanelConfig()
    // Splice a new content region under region-center; it adopts center's former
    // child (null) and becomes center's child.
    const grown = addRegion(
      seed,
      {
        ...chromeRegion('region-inset', 3, 'mn-card'),
        resizable: true,
        sizeFraction: 0.5,
        renderedByComponent: null,
        docksPanel: ['panel-text'],
      },
      'region-center',
    )
    expect(grown.regions['region-center']?.childRegion).toBe('region-inset')
    expect(grown.regions['region-inset']?.childRegion).toBeNull()
    const round = parseTriplesToConfig(serializeConfigToTriples(grown))
    expect(round.regions['region-center']?.childRegion).toBe('region-inset')
  })
})

describe('KNOWN_COMPONENTS — the frozen catalog', () => {
  it('is a frozen Set that cannot be mutated', () => {
    expect(Object.isFrozen(KNOWN_COMPONENTS)).toBe(true)
    // A frozen Set rejects mutation (throws in strict mode, which ESM modules are).
    expect(() => (KNOWN_COMPONENTS as Set<string>).add('mn-evil')).toThrow()
  })

  it('⊇ every tag the minimal seed config uses', () => {
    const seed = minimalTextPanelConfig()
    const seedTags = new Set<string>()
    for (const r of Object.values(seed.regions)) {
      if (r.renderedByComponent) seedTags.add(r.renderedByComponent)
    }
    for (const p of Object.values(seed.panels)) {
      if (p.renderedByComponent) seedTags.add(p.renderedByComponent)
    }
    // The seed uses mn-top-bar (chrome) + mn-card (panel) — both must be allowlisted.
    expect([...seedTags].sort()).toEqual(['mn-card', 'mn-top-bar'])
    for (const tag of seedTags) {
      expect(isKnownComponent(tag)).toBe(true)
    }
  })

  it('⊇ every tag the demo grows plus serialized runtime-substitution anchors', () => {
    // The demo grows the top bar (W0), and the C-rung chat organism: the chat host
    // mounts <sh-chat-host> → <sh-chat-panel>; the editor lift mounts <sh-editor-host>.
    // Garden-default right-rail config still serializes mn-chat-panel/mn-wires-panel,
    // which renderWorkspace substitutes with sh-* hosts when services are present.
    const demoGrows = [
      'mn-top-bar',
      'mn-bottom-bar',
      'mn-card',
      'mn-chat-panel',
      'mn-wires-panel',
      'sh-chat-host',
      'sh-chat-panel',
      'sh-editor-host',
      'mn-document-editor',
      'mn-graph-panel',
    ]
    for (const tag of demoGrows) {
      expect(isKnownComponent(tag)).toBe(true)
    }
  })

  it('rejects an off-list tag', () => {
    expect(isKnownComponent('mn-evil')).toBe(false)
    expect(isKnownComponent('script')).toBe(false)
    expect(isKnownComponent('')).toBe(false)
  })
})

describe('applyVerb — the catalog gate (security layer 2)', () => {
  const seed = minimalTextPanelConfig()

  it('admits an in-catalog add_root_region and append-order roots it', () => {
    const spec: VerbSpec = { verb: 'add_root_region', regionId: 'region-top-bar2', component: 'mn-top-bar' }
    const res = applyVerb(seed, spec)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    // APPEND-ORDER: the new root is at the END, seed head stays index 0.
    expect(res.config.rootRegions).toEqual(['region-center', 'region-top-bar2'])
    // Built as non-resizable chrome (I1 preserved).
    expect(res.config.regions['region-top-bar2']?.resizable).toBe(false)
    expect(validateConfig(res.config).ok).toBe(true)
  })

  it('roots an EXISTING present-but-unrooted region WITHOUT rebuilding its body (additive)', () => {
    // The seed carries region-top-bar in the map (sizeFraction 0.04, order 0) but
    // unrooted. add_root_region must ROOT IT UNCHANGED — not overwrite its body —
    // else the grow delta would have to delete the seed's region triples.
    const res = applyVerb(seed, { verb: 'add_root_region', regionId: 'region-top-bar', component: 'mn-top-bar' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    // The body is byte-identical to the seed's (not rebuilt).
    expect(res.config.regions['region-top-bar']).toEqual(seed.regions['region-top-bar'])
    // It is now rooted (append-order).
    expect(res.config.rootRegions).toEqual(['region-center', 'region-top-bar'])
    // Strict-superset additive: the serialized seed triples all survive.
    const seedLines = new Set(serializeConfigToTriples(seed).map(lineOf))
    const grownLines = new Set(serializeConfigToTriples(res.config).map(lineOf))
    for (const line of seedLines) expect(grownLines.has(line)).toBe(true)
  })

  it('REJECTS rooting an EXISTING resizable region as a 2nd spine head (I1, pre-write)', () => {
    // region-center is the resizable seed head; rooting it again would be a 2nd
    // resizable root. The catalog/shape layer rejects it before any write.
    const res = applyVerb(seed, { verb: 'add_root_region', regionId: 'region-center', component: 'mn-card' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('I1')
  })

  it('REJECTS an off-catalog component BEFORE construction — nothing built', () => {
    const spec: VerbSpec = { verb: 'add_root_region', regionId: 'region-evil', component: 'mn-evil' }
    const res = applyVerb(seed, spec)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('mn-evil')
    expect(res.error).toContain('KNOWN_COMPONENTS')
    // The region was never built into any config (applyVerb returns no config).
    expect('config' in res).toBe(false)
  })

  it('REJECTS an off-catalog add_panel component', () => {
    const res = applyVerb(seed, { verb: 'add_panel', panelId: 'panel-x', component: '<img onerror=alert(1)>' })
    expect(res.ok).toBe(false)
  })

  it('admits add_panel for an in-catalog component', () => {
    const res = applyVerb(seed, { verb: 'add_panel', panelId: 'panel-chat', component: 'sh-chat-panel' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.config.panels['panel-chat']?.renderedByComponent).toBe('sh-chat-panel')
  })

  it('admits add_panel for runtime-substituted serialized anchors', () => {
    const chat = applyVerb(seed, { verb: 'add_panel', panelId: 'panel-chat-alias', component: 'mn-chat-panel' })
    const wires = applyVerb(seed, { verb: 'add_panel', panelId: 'panel-wires-alias', component: 'mn-wires-panel' })
    expect(chat.ok).toBe(true)
    expect(wires.ok).toBe(true)
    if (!chat.ok || !wires.ok) return
    expect(chat.config.panels['panel-chat-alias']?.renderedByComponent).toBe('mn-chat-panel')
    expect(wires.config.panels['panel-wires-alias']?.renderedByComponent).toBe('mn-wires-panel')
  })

  it('dock_panel rejects a missing region or panel, and is idempotent when already docked', () => {
    expect(applyVerb(seed, { verb: 'dock_panel', regionId: 'nope', panelId: 'panel-text' }).ok).toBe(false)
    expect(applyVerb(seed, { verb: 'dock_panel', regionId: 'region-center', panelId: 'nope' }).ok).toBe(false)
    const already = applyVerb(seed, { verb: 'dock_panel', regionId: 'region-center', panelId: 'panel-text' })
    expect(already.ok).toBe(true) // already docked → idempotent ok
  })

  it('a forged verb discriminant is rejected by the exhaustive default arm', () => {
    const forged = { verb: 'eval_sparql', payload: 'DROP ALL' } as unknown as VerbSpec
    const res = applyVerb(seed, forged)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('unknown verb')
  })
})

describe('CRUCIAL ADDITIVITY — the case that silently broke', () => {
  /**
   * Inline strict-superset check (the same law growDeltaNT enforces): the grown
   * config must CONTAIN every seed triple, else the grow would need to
   * delete/overwrite a seed triple — which the additive rdf_load cannot do.
   */
  function assertAdditiveSuperset(
    seed: import('../types.js').WorkspaceConfig,
    grown: import('../types.js').WorkspaceConfig,
  ): void {
    const seedLines = new Set(serializeConfigToTriples(seed).map(lineOf))
    const grownLines = new Set(serializeConfigToTriples(grown).map(lineOf))
    for (const line of seedLines) {
      if (!grownLines.has(line)) {
        throw new Error(`grow is not additive — seed triple would be lost:\n${line}`)
      }
    }
  }

  it('addRootRegion of a LOWER-order new root then a serialize-superset does NOT throw', () => {
    const seed = minimalTextPanelConfig() // root-0 = region-center (resizable head)
    // The NEW root has order 0 — LOWER than region-center's order 2. This is EXACTLY
    // the case that would silently break under deriveRootRegions order-sort (the new
    // low-order root would take index 0, overwriting the seed's root-0 rootRegion).
    const grown = addRootRegion(seed, chromeRegion('region-top-bar2', 0, 'mn-top-bar'))

    // APPEND-ORDER kept region-center at index 0.
    expect(grown.rootRegions).toEqual(['region-center', 'region-top-bar2'])
    // The additive guard does NOT throw.
    expect(() => assertAdditiveSuperset(seed, grown)).not.toThrow()
    // And the candidate is a valid spine.
    expect(validateConfig(grown).ok).toBe(true)
  })

  it('the POSITIONAL RootEntry index→region mapping is a strict SUPERSET (no index changed value)', () => {
    const seed = minimalTextPanelConfig()
    const grown = addRootRegion(seed, chromeRegion('region-top-bar2', 0, 'mn-top-bar'))

    const rootEntryMap = (cfg: import('../types.js').WorkspaceConfig): Map<number, string> => {
      const triples = serializeConfigToTriples(cfg)
      const idx = new Map<string, number>() // RootEntry IRI → atIndex
      const region = new Map<string, string>() // RootEntry IRI → rootRegion IRI
      for (const t of triples) {
        if (t.p.endsWith('#atIndex') && t.o.type === 'literal') idx.set(t.s, Number(t.o.value))
        if (t.p.endsWith('#rootRegion') && t.o.type === 'iri') region.set(t.s, t.o.value)
      }
      const m = new Map<number, string>()
      for (const [re, i] of idx) m.set(i, region.get(re)!)
      return m
    }

    const seedMap = grownMapSubsetCheck(rootEntryMap(seed), rootEntryMap(grown))
    expect(seedMap).toBe(true)
  })

  /** Every (index → region) pair in `seed` must appear UNCHANGED in `grown`. */
  function grownMapSubsetCheck(seed: Map<number, string>, grown: Map<number, string>): boolean {
    for (const [i, region] of seed) {
      if (grown.get(i) !== region) return false
    }
    return true
  }

  it('COUNTER-PROOF: order-sorting the SAME new root WOULD lose the seed root-0 triple', () => {
    // Demonstrate the fatal flaw the append-order fix avoids: a hand-built grown
    // config that put the low-order new root at index 0 (as deriveRootRegions would)
    // overwrites the seed's root-0 rootRegion → the additive guard MUST throw.
    const seed = minimalTextPanelConfig() // rootRegions = ['region-center']
    const orderSortedGrown = addRootRegion(seed, chromeRegion('region-top-bar2', 0, 'mn-top-bar'))
    // Simulate the order-sort: region-top-bar2 (order 0) before region-center (order 2).
    const reordered = {
      ...orderSortedGrown,
      rootRegions: ['region-top-bar2', 'region-center'],
    }
    expect(() => assertAdditiveSuperset(seed, reordered)).toThrow(/not additive/)
  })
})
