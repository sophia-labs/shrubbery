/**
 * session-store-validation.test.ts — Atelier's live READ boundary applies the
 * SAME invariants as the write/commit gate (grow.ts → validateConfig). NO MOCKS:
 * we drive the real production read path end-to-end over real N-Triples bodies —
 * serializeConfigToTriples → triplesToNT → (dumpUxConfig) → parseNT →
 * parseTriplesToConfig → validateConfig — through loadConfigFromCell and the
 * reactive store.
 *
 * A VALID config still loads and reports 'ready'. An INVALID config (here a
 * cyclic childRegion spine — the planFor stack-overflow the write gate's I2
 * rejects) is surfaced VERBATIM through the honest read-status channel
 * (status='error', error='config rejected: I2 …'), never returned as a
 * renderable config and never a silent fallback.
 */
import { describe, expect, it } from 'vitest'
import {
  GARDEN_DEFAULT,
  serializeConfigToTriples,
  triplesToNT,
  validateConfig,
  type WorkspaceConfig,
} from '@shrubbery/nucleus'
import type { GardendContract } from '../gardend-contract.js'
import { createSessionStore, loadConfigFromCell } from '../session-store.js'

/** Minimal cell contract whose only exercised surface is dumpUxConfig → { data: nt }. */
function fakeContract(nt: string): GardendContract {
  return {
    restConcrete: {
      dumpUxConfig: async () => ({ data: nt }),
    },
  } as unknown as GardendContract
}

/** N-Triples body for a config, via the REAL serializer the write path uses. */
const ntFor = (config: WorkspaceConfig): string => triplesToNT(serializeConfigToTriples(config))

/**
 * A config with a cyclic childRegion spine (region-a ⇄ region-b). Both edge
 * targets exist (so I3 passes) — the cycle is what validateConfig I2 catches,
 * the same walk that stops planFor from stack-overflowing on read.
 */
const CYCLIC_CONFIG: WorkspaceConfig = {
  id: 'CyclicUnderTest',
  label: 'Cyclic Under Test',
  renderedByComponent: 'app-shell',
  regions: {
    'region-a': {
      id: 'region-a',
      label: 'A',
      childRegion: 'region-b',
      order: 0,
      splitOrientation: 'vertical',
      collapsible: false,
      resizable: true,
      sizeFraction: 0.5,
      dockState: null,
      docksPanel: [],
      renderedByComponent: 'mn-top-bar',
    },
    'region-b': {
      id: 'region-b',
      label: 'B',
      childRegion: 'region-a',
      order: 1,
      splitOrientation: 'vertical',
      collapsible: false,
      resizable: false,
      sizeFraction: 0.5,
      dockState: null,
      docksPanel: [],
      renderedByComponent: 'mn-bottom-bar',
    },
  },
  panels: {},
  dimensions: {},
  rootRegions: [],
}

describe('atelier loadConfigFromCell — validation parity with the write gate', () => {
  it('a VALID config (GARDEN_DEFAULT) loads through the real read path and reports ready', async () => {
    const store = createSessionStore({ contract: fakeContract(ntFor(GARDEN_DEFAULT)), graphId: 'valid' })
    await store.refresh()

    const state = store.getState()
    expect(state.status).toBe('ready')
    expect(state.error).toBeNull()
    expect(state.read?.config.id).toBe(GARDEN_DEFAULT.id)
    expect(Object.keys(state.read?.config.regions ?? {}).length).toBe(
      Object.keys(GARDEN_DEFAULT.regions).length,
    )
  })

  it('an INVALID (cyclic) config surfaces the I2 verdict verbatim through the error channel, not a renderable config', async () => {
    const verdict = validateConfig(CYCLIC_CONFIG)
    expect(verdict.ok).toBe(false)

    const store = createSessionStore({ contract: fakeContract(ntFor(CYCLIC_CONFIG)), graphId: 'cyclic' })
    await store.refresh()

    const state = store.getState()
    expect(state.status).toBe('error')
    expect(state.read).toBeNull()
    expect(state.error).toBe(`config rejected: ${verdict.ok ? '' : verdict.error}`)
    expect(state.error).toContain('I2 cyclic childRegion spine')
  })

  it('loadConfigFromCell throws the verbatim verdict on an invalid config (unit-level)', async () => {
    await expect(loadConfigFromCell(fakeContract(ntFor(CYCLIC_CONFIG)), 'cyclic')).rejects.toThrow(
      /^config rejected: I2 cyclic childRegion spine/,
    )
  })
})
