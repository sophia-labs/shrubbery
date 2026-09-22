/**
 * set-appearance.test.ts — pure tests for the Atelier's first agent affordance,
 * `set_vtuber_appearance` (S2). No DOM, no cell: the gate is a pure verdict
 * (overlay + spec in, verdict out), exactly like grow-verbs.test.ts proves the
 * :ux:config verbs. The REAL-cell wiring (sparql_update against a live gardend)
 * is a shell concern, out of scope here.
 */

import { describe, it, expect } from 'vitest'
import type { VtuberControlOverlay } from '@shrubbery/nucleus'
import {
  applySetVtuberAppearance,
  growVtuberAppearance,
  makeAppearanceGrowCell,
  sparqlUpdateArgs,
  type AppearanceGrowCell,
  type SetVtuberAppearanceSpec,
} from '../set-appearance.js'
import { grow, type GrowCell } from '../grow.js'
import {
  minimalTextPanelConfig,
  serializeConfigToTriples,
  parseTriplesToConfig,
  triplesToNT,
  parseNT,
  type VerbSpec,
  type WorkspaceConfig,
  type Triple,
} from '@shrubbery/nucleus'

const GRAPH_ID = 'g-abc'

/** A minimal overlay: one channel bound to a panel, one bound only to a region. */
function overlayFixture(): VtuberControlOverlay {
  return {
    channels: {
      'vtuber-main': {
        id: 'vtuber-main',
        targetComponent: 'mn-vtuber',
        targetPanel: 'panel-avatar',
        targetRegion: null,
      },
      'vtuber-side': {
        id: 'vtuber-side',
        targetComponent: 'mn-vtuber',
        targetPanel: null,
        targetRegion: 'region-side',
      },
    },
  }
}

describe('applySetVtuberAppearance — target resolution', () => {
  const overlay = overlayFixture()

  it('resolves directly by channelId', () => {
    const res = applySetVtuberAppearance(overlay, GRAPH_ID, {
      verb: 'set_vtuber_appearance',
      target: { channelId: 'vtuber-main' },
      appearance: { expression: 'excited' },
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.channelId).toBe('vtuber-main')
  })

  it('resolves via panelId (selectVtuberControlChannel)', () => {
    const res = applySetVtuberAppearance(overlay, GRAPH_ID, {
      verb: 'set_vtuber_appearance',
      target: { panelId: 'panel-avatar' },
      appearance: { expression: 'focused' },
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.channelId).toBe('vtuber-main')
  })

  it('resolves via regionId when no panel binding exists', () => {
    const res = applySetVtuberAppearance(overlay, GRAPH_ID, {
      verb: 'set_vtuber_appearance',
      target: { regionId: 'region-side' },
      appearance: { expression: 'neutral' },
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.channelId).toBe('vtuber-side')
  })

  it('REJECTS an unknown channelId', () => {
    const res = applySetVtuberAppearance(overlay, GRAPH_ID, {
      verb: 'set_vtuber_appearance',
      target: { channelId: 'vtuber-nope' },
      appearance: { expression: 'excited' },
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.gate).toBe('target')
    expect(res.error).toContain('unknown channel')
  })

  it('REJECTS a panel/region with no bound channel', () => {
    const res = applySetVtuberAppearance(overlay, GRAPH_ID, {
      verb: 'set_vtuber_appearance',
      target: { panelId: 'panel-missing' },
      appearance: { expression: 'excited' },
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.gate).toBe('target')
    expect(res.error).toContain('no channel bound to')
  })

  it('REJECTS an absent target (no channelId/panelId/regionId)', () => {
    const res = applySetVtuberAppearance(overlay, GRAPH_ID, {
      verb: 'set_vtuber_appearance',
      target: {},
      appearance: { expression: 'excited' },
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.gate).toBe('target')
    expect(res.error).toContain('absent channel target')
  })

  it('treats an empty-string target field as absent', () => {
    const res = applySetVtuberAppearance(overlay, GRAPH_ID, {
      verb: 'set_vtuber_appearance',
      target: { channelId: '  ' },
      appearance: { expression: 'excited' },
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('absent channel target')
  })

  it('REJECTS (never throws) a forged payload with `target` omitted entirely', () => {
    const forged = { verb: 'set_vtuber_appearance', appearance: { expression: 'excited' } } as unknown as SetVtuberAppearanceSpec
    let res: ReturnType<typeof applySetVtuberAppearance> | undefined
    expect(() => {
      res = applySetVtuberAppearance(overlay, GRAPH_ID, forged)
    }).not.toThrow()
    expect(res?.ok).toBe(false)
    if (!res || res.ok) return
    expect(res.gate).toBe('target')
    expect(res.error).toContain('absent channel target')
  })
})

describe('applySetVtuberAppearance — styling field validation', () => {
  const overlay = overlayFixture()
  const target = { channelId: 'vtuber-main' }

  it('REJECTS an empty appearance edit', () => {
    const res = applySetVtuberAppearance(overlay, GRAPH_ID, {
      verb: 'set_vtuber_appearance',
      target,
      appearance: {},
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.gate).toBe('fields')
    expect(res.error).toContain('empty appearance edit')
  })

  it.each(['accentTint', 'eyeTint', 'hairTint', 'outfitTint'] as const)(
    'REJECTS a malformed %s hex value',
    (field) => {
      const res = applySetVtuberAppearance(overlay, GRAPH_ID, {
        verb: 'set_vtuber_appearance',
        target,
        appearance: { [field]: 'not-a-color' } as SetVtuberAppearanceSpec['appearance'],
      })
      expect(res.ok).toBe(false)
      if (res.ok) return
      expect(res.gate).toBe('fields')
      expect(res.error).toContain('malformed hex color')
      expect(res.error).toContain(field)
    },
  )

  it('REJECTS 3-digit shorthand hex (only 6-digit #RRGGBB is admitted)', () => {
    const res = applySetVtuberAppearance(overlay, GRAPH_ID, {
      verb: 'set_vtuber_appearance',
      target,
      appearance: { accentTint: '#fff' },
    })
    expect(res.ok).toBe(false)
  })

  it('accepts upper- and lower-case 6-digit hex', () => {
    const lower = applySetVtuberAppearance(overlay, GRAPH_ID, {
      verb: 'set_vtuber_appearance',
      target,
      appearance: { accentTint: '#aabbcc' },
    })
    const upper = applySetVtuberAppearance(overlay, GRAPH_ID, {
      verb: 'set_vtuber_appearance',
      target,
      appearance: { accentTint: '#AABBCC' },
    })
    expect(lower.ok).toBe(true)
    expect(upper.ok).toBe(true)
  })

  it.each([-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY])(
    'REJECTS skinWarmth out of [0,1]: %s',
    (value) => {
      const res = applySetVtuberAppearance(overlay, GRAPH_ID, {
        verb: 'set_vtuber_appearance',
        target,
        appearance: { skinWarmth: value },
      })
      expect(res.ok).toBe(false)
      if (res.ok) return
      expect(res.gate).toBe('fields')
      expect(res.error).toContain('skinWarmth out of range')
    },
  )

  it.each([0, 0.5, 1])('accepts skinWarmth at/within the [0,1] bound: %s', (value) => {
    const res = applySetVtuberAppearance(overlay, GRAPH_ID, {
      verb: 'set_vtuber_appearance',
      target,
      appearance: { skinWarmth: value },
    })
    expect(res.ok).toBe(true)
  })

  it('REJECTS an expression outside the closed preset vocab', () => {
    const res = applySetVtuberAppearance(overlay, GRAPH_ID, {
      verb: 'set_vtuber_appearance',
      target,
      appearance: { expression: 'giddy' as SetVtuberAppearanceSpec['appearance']['expression'] },
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.gate).toBe('fields')
    expect(res.error).toContain('not in the closed preset vocab')
  })

  it.each(['neutral', 'focused', 'excited', 'strained'] as const)('accepts expression preset %s', (preset) => {
    const res = applySetVtuberAppearance(overlay, GRAPH_ID, {
      verb: 'set_vtuber_appearance',
      target,
      appearance: { expression: preset },
    })
    expect(res.ok).toBe(true)
  })

  it('REJECTS a smuggled predicate outside the closed field set (forged payload)', () => {
    const forged = { accentTint: '#112233', modelUrl: 'https://evil.example/model.vrm' } as unknown as SetVtuberAppearanceSpec['appearance']
    const res = applySetVtuberAppearance(overlay, GRAPH_ID, {
      verb: 'set_vtuber_appearance',
      target,
      appearance: forged,
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.gate).toBe('fields')
    expect(res.error).toContain('unexpected field(s)')
    expect(res.error).toContain('modelUrl')
  })

  it('REJECTS (never throws) a forged payload with `appearance` omitted entirely', () => {
    const forged = { verb: 'set_vtuber_appearance', target } as unknown as SetVtuberAppearanceSpec
    let res: ReturnType<typeof applySetVtuberAppearance> | undefined
    expect(() => {
      res = applySetVtuberAppearance(overlay, GRAPH_ID, forged)
    }).not.toThrow()
    expect(res?.ok).toBe(false)
    if (!res || res.ok) return
    expect(res.gate).toBe('fields')
    expect(res.error).toContain('empty appearance edit')
  })
})

describe('applySetVtuberAppearance — scope guard (SPARQL-injection defence)', () => {
  const overlay = overlayFixture()
  const target = { channelId: 'vtuber-main' }

  it('REJECTS a graphId containing an IRIREF-breaking character', () => {
    const hostile = 'g-abc> } } ; DROP ALL ; # '
    const res = applySetVtuberAppearance(overlay, hostile, {
      verb: 'set_vtuber_appearance',
      target,
      appearance: { expression: 'excited' },
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.gate).toBe('scope')
    expect(res.error).toContain('graphId')
  })

  it('REJECTS a channel whose sux:localId literal contains an IRIREF-breaking character', () => {
    const hostileOverlay: VtuberControlOverlay = {
      channels: {
        'vtuber-evil': {
          id: 'vtuber-evil> } } ; DROP ALL ; # ',
          targetComponent: 'mn-vtuber',
          targetPanel: null,
          targetRegion: null,
        },
      },
    }
    const res = applySetVtuberAppearance(hostileOverlay, GRAPH_ID, {
      verb: 'set_vtuber_appearance',
      target: { channelId: 'vtuber-evil' },
      appearance: { expression: 'excited' },
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.gate).toBe('scope')
    expect(res.error).toContain('channel id')
  })

  it('the generated SPARQL never contains an unescaped GRAPH-clause breakout for well-formed ids', () => {
    const res = applySetVtuberAppearance(overlay, GRAPH_ID, {
      verb: 'set_vtuber_appearance',
      target,
      appearance: { expression: 'excited' },
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.update).not.toMatch(/DROP ALL|CLEAR ALL/)
  })
})

describe('applySetVtuberAppearance — the exact generated mutation payload', () => {
  it('emits a byte-exact scoped DELETE/INSERT/WHERE for a representative multi-field call', () => {
    const overlay = overlayFixture()
    const res = applySetVtuberAppearance(overlay, 'g-abc', {
      verb: 'set_vtuber_appearance',
      target: { channelId: 'vtuber-main' },
      appearance: { expression: 'excited', accentTint: '#112233', skinWarmth: 0.4 },
    })

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.channelId).toBe('vtuber-main')
    expect(res.channelIri).toBe('http://sophia.ai/ux#vtuber-main')

    const expected = [
      'DELETE {',
      '  GRAPH <urn:mnemosyne:local:graph:g-abc:ux:control> {',
      '    <http://sophia.ai/ux#vtuber-main> <http://sophia.ai/ux#expression> ?v0 .',
      '    <http://sophia.ai/ux#vtuber-main> <http://sophia.ai/ux#accentTint> ?v1 .',
      '    <http://sophia.ai/ux#vtuber-main> <http://sophia.ai/ux#skinWarmth> ?v2 .',
      '  }',
      '}',
      'INSERT {',
      '  GRAPH <urn:mnemosyne:local:graph:g-abc:ux:control> {',
      '    <http://sophia.ai/ux#vtuber-main> <http://sophia.ai/ux#expression> "excited" .',
      '    <http://sophia.ai/ux#vtuber-main> <http://sophia.ai/ux#accentTint> "#112233" .',
      '    <http://sophia.ai/ux#vtuber-main> <http://sophia.ai/ux#skinWarmth> "0.4"^^<http://www.w3.org/2001/XMLSchema#decimal> .',
      '  }',
      '}',
      'WHERE {',
      '  OPTIONAL { GRAPH <urn:mnemosyne:local:graph:g-abc:ux:control> { <http://sophia.ai/ux#vtuber-main> <http://sophia.ai/ux#expression> ?v0 } }',
      '  OPTIONAL { GRAPH <urn:mnemosyne:local:graph:g-abc:ux:control> { <http://sophia.ai/ux#vtuber-main> <http://sophia.ai/ux#accentTint> ?v1 } }',
      '  OPTIONAL { GRAPH <urn:mnemosyne:local:graph:g-abc:ux:control> { <http://sophia.ai/ux#vtuber-main> <http://sophia.ai/ux#skinWarmth> ?v2 } }',
      '}',
    ].join('\n')

    expect(res.update).toBe(expected)
  })

  it('a single-field edit emits exactly one DELETE/INSERT/WHERE triple-line each', () => {
    const overlay = overlayFixture()
    const res = applySetVtuberAppearance(overlay, 'g-solo', {
      verb: 'set_vtuber_appearance',
      target: { channelId: 'vtuber-side' },
      appearance: { hairTint: '#2e3440' },
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.update).toBe(
      [
        'DELETE {',
        '  GRAPH <urn:mnemosyne:local:graph:g-solo:ux:control> {',
        '    <http://sophia.ai/ux#vtuber-side> <http://sophia.ai/ux#hairTint> ?v0 .',
        '  }',
        '}',
        'INSERT {',
        '  GRAPH <urn:mnemosyne:local:graph:g-solo:ux:control> {',
        '    <http://sophia.ai/ux#vtuber-side> <http://sophia.ai/ux#hairTint> "#2e3440" .',
        '  }',
        '}',
        'WHERE {',
        '  OPTIONAL { GRAPH <urn:mnemosyne:local:graph:g-solo:ux:control> { <http://sophia.ai/ux#vtuber-side> <http://sophia.ai/ux#hairTint> ?v0 } }',
        '}',
      ].join('\n'),
    )
  })
})

describe('growVtuberAppearance — the READ → gate → WRITE cycle', () => {
  /** A REAL in-memory AppearanceGrowCell — no vi.fn, an honest recorder port. */
  function makeInMemoryAppearanceCell(overlay: VtuberControlOverlay): {
    port: AppearanceGrowCell
    calls: Array<{ graphId: string; update: string }>
  } {
    const calls: Array<{ graphId: string; update: string }> = []
    const port = makeAppearanceGrowCell({
      readControlOverlay: async (_graphId: string) => overlay,
      mutateGraph: async (graphId: string, update: string) => {
        calls.push({ graphId, update })
      },
    })
    return { port, calls }
  }

  it('on a gate pass, writes EXACTLY the payload the pure gate computed, exactly once', async () => {
    const overlay = overlayFixture()
    const cell = makeInMemoryAppearanceCell(overlay)
    const spec: SetVtuberAppearanceSpec = {
      verb: 'set_vtuber_appearance',
      target: { channelId: 'vtuber-main' },
      appearance: { expression: 'strained', outfitTint: '#49636f' },
    }

    const expected = applySetVtuberAppearance(overlay, GRAPH_ID, spec)
    expect(expected.ok).toBe(true)

    const res = await growVtuberAppearance(cell.port, GRAPH_ID, spec)
    expect(res.ok).toBe(true)
    if (!res.ok || !expected.ok) return
    expect(res.update).toBe(expected.update)

    expect(cell.calls).toHaveLength(1)
    expect(cell.calls[0]).toEqual({ graphId: GRAPH_ID, update: expected.update })
  })

  it('on a rejection, NEVER calls mutateGraph', async () => {
    const overlay = overlayFixture()
    const cell = makeInMemoryAppearanceCell(overlay)
    const spec: SetVtuberAppearanceSpec = {
      verb: 'set_vtuber_appearance',
      target: { channelId: 'vtuber-does-not-exist' },
      appearance: { expression: 'excited' },
    }

    const res = await growVtuberAppearance(cell.port, GRAPH_ID, spec)
    expect(res.ok).toBe(false)
    expect(cell.calls).toHaveLength(0)
  })

  it('sparqlUpdateArgs is the exact tool-call arg shape (graphId, update — no targetGraphIri)', () => {
    expect(sparqlUpdateArgs('g-1', 'DELETE {} INSERT {} WHERE {}')).toEqual({
      graphId: 'g-1',
      update: 'DELETE {} INSERT {} WHERE {}',
    })
  })
})

describe(':ux:config-path verbs are UNTOUCHED by this addition', () => {
  /** Canonical N-Triples line of one triple (set-membership key, like grow's). */
  const lineOf = (t: Triple): string => triplesToNT([t])

  /** The SAME in-memory GrowCell pattern used by the existing grow tests (no mocks). */
  function makeInMemoryConfigCell(seed: WorkspaceConfig): GrowCell {
    let lines = new Set<string>(serializeConfigToTriples(seed).map(lineOf))
    return {
      readConfig: async (_graphId: string): Promise<WorkspaceConfig> =>
        parseTriplesToConfig(parseNT([...lines].join('\n'))),
      loadDelta: async (_graphId: string, nt: string, _targetGraphIri: string): Promise<void> => {
        const next = new Set(lines)
        for (const t of parseNT(nt)) next.add(lineOf(t))
        lines = next
      },
    }
  }

  it('an ordinary add_root_region grow() still runs its full catalog+spine+additive cycle unaffected', async () => {
    const port = makeInMemoryConfigCell(minimalTextPanelConfig())
    const verbSpec: VerbSpec = { verb: 'add_root_region', regionId: 'region-top-bar', component: 'mn-top-bar' }
    const res = await grow(port, GRAPH_ID, verbSpec)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.config.rootRegions).toContain('region-top-bar')
  })
})
