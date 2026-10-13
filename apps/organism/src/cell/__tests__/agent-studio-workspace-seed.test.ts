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
import {
  makeLocalChatService,
  renderWorkspace,
  type ShChatHost,
  workspaceSurfaceReady,
} from '@shrubbery/runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Sophia Cluster graph-authored Agent Studio workspace', () => {
  it('round-trips through the production workspace parser and keeps Agent Studio in the center', () => {
    const config = seedConfig()
    expect(config.id).toBe('SophiaClusterWorkspace')
    expect(validateConfig(config)).toEqual({ ok: true })
    expect(config.rootRegions).toEqual(['region-top-bar', 'region-agent-studio', 'region-bottom-bar'])
    expect(config.regions['region-agent-studio']).toMatchObject({
      childRegion: 'region-chat-rail',
      order: 1,
      sizeFraction: 0.72,
      surfaceRole: 'center',
    })
    expect(config.regions['region-chat-rail']).toMatchObject({
      childRegion: null,
      collapsible: true,
      docksPanel: ['panel-chat'],
      order: 2,
      resizable: true,
      sizeFraction: 0.28,
      surfaceRole: 'right',
    })
    expect(config.panels['panel-chat']).toMatchObject({
      defaultVisible: true,
      dockState: 'stacked',
      renderedByComponent: 'mn-chat-panel',
    })
    expect(resolveSurfaceTag(config, 'region-agent-studio')).toBe('mn-agent-studio-editor')
    expect(resolveSurfaceTag(config, 'region-chat-rail')).toBe('mn-chat-panel')
    expect(planFor(config)).toEqual({
      topChrome: ['region-top-bar'],
      spineHeadId: 'region-agent-studio',
      bottomChrome: ['region-bottom-bar'],
      spine: {
        kind: 'split',
        regionId: 'region-agent-studio',
        position: 72,
        child: { kind: 'leaf', regionId: 'region-chat-rail' },
      },
    })
    expect(parseTriplesToConfig(serializeConfigToTriples(config))).toEqual(config)
  })

  it('lifts exactly one real chat host through the shell-owned ChatService seam and completes a turn', async () => {
    const service = makeLocalChatService()
    const session = await service.createSession({ title: 'Sophia-1 workspace chat', graphId: 'sophia-cluster' })
    const container = renderWorkspace(seedConfig(), {
      surface: true,
      home: { graphId: 'sophia-cluster', graphTitle: 'Sophia Cluster' },
      chrome: { rightPanel: 'chat' },
      chatHost: { service, sessionId: session.id },
    })
    document.body.appendChild(container)
    await workspaceSurfaceReady(container)

    const hosts = container.querySelectorAll<ShChatHost>('sh-chat-host')
    expect(container.querySelectorAll('mn-agent-studio-editor')).toHaveLength(1)
    expect(hosts).toHaveLength(1)
    expect(container.querySelectorAll('mn-chat-panel')).toHaveLength(0)
    const host = hosts[0]
    await settleChat(host)
    expect(host.service).toBe(service)
    expect(host.sessionId).toBe(session.id)
    expect(host.panel?.tagName.toLowerCase()).toBe('sh-chat-panel')
    expect(host.shadowRoot?.querySelectorAll('sh-chat-panel')).toHaveLength(1)

    host.panel?.onSend?.('hello from Sophia Cluster')
    await until(() => host.panel?.querySelectorAll('.message').length === 2)
    expect(host.panel?.querySelector('.message.user')?.textContent).toContain('hello from Sophia Cluster')
    expect(host.panel?.querySelector('.message.assistant')?.textContent).toContain('You said: hello from Sophia Cluster')
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

async function settleChat(host: ShChatHost): Promise<void> {
  await host.updateComplete
  await Promise.resolve()
  await Promise.resolve()
  await host.updateComplete
}

async function until(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('chat round-trip timed out')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}
