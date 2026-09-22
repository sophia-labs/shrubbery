import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  parseNT,
  parseTriplesToConfig,
  planFor,
  resolveSurfaceTag,
  serializeConfigToTriples,
  validateConfig,
} from '@shrubbery/nucleus'
import { engineRegionRole, renderWorkspace, workspaceSurfaceReady } from '@shrubbery/runtime'
import type { MnPhanesControlEditor } from '../phanes-control-editor.js'
import { createPhanesControlWorkspaceFeature } from '../shell-features.js'
import { createShellContext } from '../shell-context.js'

const seedPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../seeds/phanes-control-workspace.ux.nt',
)

function seedConfig() {
  return parseTriplesToConfig(parseNT(readFileSync(seedPath, 'utf8')))
}

function context(host: HTMLElement, graphId: string, rawMcp: object) {
  return createShellContext({
    host,
    graphId,
    documentId: null,
    app: 'garden',
    source: 'CELL_LIVE',
    deploymentMode: 'hosted',
    contract: { rawMcp },
    location: new URL(`https://canary.test/g/${graphId}`),
    rerender: vi.fn(),
  })
}

describe('Phanes control graph-authored Shrubbery workspace', () => {
  it('parses through the production path and plans top bar + full control body + bottom bar', () => {
    const config = seedConfig()
    expect(config.id).toBe('PhanesControlWorkspace')
    expect(validateConfig(config)).toEqual({ ok: true })
    expect(resolveSurfaceTag(config, 'region-phanes-control')).toBe('mn-phanes-control-editor')

    const plan = planFor(config)
    expect(plan.topChrome).toEqual(['region-top-bar'])
    expect(plan.spineHeadId).toBe('region-phanes-control')
    expect(plan.bottomChrome).toEqual(['region-bottom-bar'])
    expect(config.regions['region-phanes-control'].surfaceMode).toBe('configured')
    expect(config.regions['region-phanes-control'].surfaceRole).toBe('center')
    expect(engineRegionRole(config, 'region-phanes-control')).toBe('center')
  })

  it('round-trips losslessly through the canonical sux serializer', () => {
    const config = seedConfig()
    expect(parseTriplesToConfig(serializeConfigToTriples(config))).toEqual(config)
  })

  it('keeps its configured center over hosted Garden home and binds authority only in phanes-control', async () => {
    const container = renderWorkspace(seedConfig(), {
      surface: true,
      home: { graphId: 'phanes-control', graphTitle: 'Phanes control' },
    })
    await workspaceSurfaceReady(container)
    const editor = container.querySelector<MnPhanesControlEditor>('mn-phanes-control-editor')
    expect(editor).not.toBeNull()
    expect(container.querySelector('mn-home-view')).toBeNull()
    expect(editor!.parentElement?.getAttribute('role')).toBe('main')

    const rawMcp = { callTool: vi.fn(async () => ({})) }
    const feature = createPhanesControlWorkspaceFeature()
    feature.afterWorkspaceRender!(context(container, 'phanes-control', rawMcp), {})
    expect(editor!.workspaceSurface).toBe(true)
    expect(editor!.api).not.toBeNull()

    feature.afterWorkspaceRender!(context(container, 'copied-control-shape', rawMcp), {})
    expect(editor!.api).toBeNull()
  })

  it('keeps the same configured-center ownership on the legacy render path', () => {
    const container = renderWorkspace(seedConfig(), {
      home: { graphId: 'phanes-control', graphTitle: 'Phanes control' },
    })
    expect(container.querySelector('mn-phanes-control-editor')).not.toBeNull()
    expect(container.querySelector('mn-home-view')).toBeNull()
  })
})
