import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseNT,
  parseTriplesToConfig,
  planFor,
  resolveSurfaceTag,
  serializeConfigToTriples,
  validateConfig,
} from '@shrubbery/nucleus'
import { renderWorkspace, workspaceSurfaceReady } from '@shrubbery/runtime'
import { describe, expect, it, vi } from 'vitest'
import type { MnAgentStudioEditor } from '../agent-studio-editor.js'
import { createShellContext } from '../shell-context.js'
import { createAgentStudioWorkspaceFeature } from '../shell-features.js'

const seedPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../seeds/sophia-cluster-workspace.ux.nt')

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

describe('Sophia Cluster graph-authored Agent Studio workspace', () => {
  it('round-trips through the production workspace parser and keeps Agent Studio in the center', () => {
    const config = seedConfig()
    expect(config.id).toBe('SophiaClusterWorkspace')
    expect(validateConfig(config)).toEqual({ ok: true })
    expect(resolveSurfaceTag(config, 'region-agent-studio')).toBe('mn-agent-studio-editor')
    expect(planFor(config)).toMatchObject({
      topChrome: ['region-top-bar'],
      spineHeadId: 'region-agent-studio',
      bottomChrome: ['region-bottom-bar'],
    })
    expect(parseTriplesToConfig(serializeConfigToTriples(config))).toEqual(config)
  })

  it('binds the host-owned MCP capability only in sophia-cluster', async () => {
    const container = renderWorkspace(seedConfig(), {
      surface: true,
      home: { graphId: 'sophia-cluster', graphTitle: 'Sophia Cluster' },
    })
    await workspaceSurfaceReady(container)
    const editor = container.querySelector<MnAgentStudioEditor>('mn-agent-studio-editor')
    expect(editor).not.toBeNull()

    const rawMcp = { callTool: vi.fn(async () => ({})) }
    const feature = createAgentStudioWorkspaceFeature()
    feature.afterWorkspaceRender!(context(container, 'sophia-cluster', rawMcp), {})
    expect(editor!.workspaceSurface).toBe(true)
    expect(editor!.api).not.toBeNull()

    feature.afterWorkspaceRender!(context(container, 'copied-agent-studio', rawMcp), {})
    expect(editor!.api).toBeNull()
  })
})
