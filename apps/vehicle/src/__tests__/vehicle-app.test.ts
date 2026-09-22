// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'

import '../vehicle-app.js'
import { buildAgentPresence } from '../vehicle-app.js'
import { FixtureVehicleService } from '../vehicle-service.js'
import type { VehicleApp } from '../vehicle-app.js'
import type { MnSidebarSection } from '@shrubbery/components'

describe('<vehicle-app>', () => {
  it('builds an agent presence view model with lifecycle tone semantics', () => {
    expect(
      buildAgentPresence({
        name: 'research-room',
        kindLine: 'research · sophia-research-service',
        lifecycle: 'running',
        model: 'gpt-5',
        driver: 'vera',
        graph: 'sophia-code-lab',
        runId: 'run-srs-vehicle',
        sessionId: 'session-research-1',
        updatedAt: '7/4/2026, 12:00:00 PM',
        events: [
          {
            sessionId: 'session-research-1',
            seq: 12,
            ts: 1783177200000,
            type: 'agent.model.changed',
            payload: { authorId: 'vera', model: 'gpt-5' },
          },
        ],
      }),
    ).toEqual({
      identity: {
        name: 'research-room',
        kindLine: 'research · sophia-research-service',
      },
      state: {
        lifecycle: 'running',
        tone: 'live',
      },
      model: {
        value: 'gpt-5',
        observedAt: 1783177200000,
        observer: 'vera',
      },
      references: [
        { label: 'driver', value: 'vera' },
        { label: 'graph', value: 'sophia-code-lab' },
      ],
      meta: [
        { label: 'run', value: 'run-srs-vehicle' },
        { label: 'session', value: 'session-research-1' },
        { label: 'updated', value: '7/4/2026, 12:00:00 PM' },
      ],
    })

    expect(
      buildAgentPresence({
        name: 'paper-scout',
        lifecycle: 'paused',
        model: 'claude-sonnet',
        driver: 'vehicle-test',
        graph: 'sophia-code-lab',
        runId: 'run-paper-scout',
        sessionId: 'session-scout-2',
        updatedAt: '-',
      }).state.tone,
    ).toBe('held')
    expect(
      buildAgentPresence({
        name: 'paper-scout',
        lifecycle: null,
        model: 'claude-sonnet',
        driver: 'vehicle-test',
        graph: 'sophia-code-lab',
        runId: 'run-paper-scout',
        sessionId: 'session-scout-2',
        updatedAt: '-',
      }).state,
    ).toEqual({ lifecycle: 'unknown', tone: 'dormant' })
    expect(
      buildAgentPresence({
        name: 'paper-scout',
        lifecycle: '-',
        model: 'claude-sonnet',
        driver: 'vehicle-test',
        graph: 'sophia-code-lab',
        runId: 'run-paper-scout',
        sessionId: 'session-scout-2',
        updatedAt: '-',
      }).state,
    ).toEqual({ lifecycle: 'unknown', tone: 'dormant' })
  })

  it('renders a real SRS-shaped Greenhouse cockpit from the fixture service', async () => {
    const el = document.createElement('vehicle-app') as VehicleApp
    el.service = new FixtureVehicleService()
    el.config = {
      baseUrl: '',
      fixture: true,
      clientId: 'vehicle-test',
      authorId: 'vera',
      role: 'user',
      pollMs: 60000,
      auth: {},
    }
    document.body.append(el)

    await el.updateComplete
    await new Promise((resolve) => setTimeout(resolve, 0))
    await el.updateComplete

    const root = el.shadowRoot
    const workspace = root?.querySelector('mn-research-workspace') as HTMLElement & { title?: string }
    const sidebar = root?.querySelector('mn-sidebar-panel') as
      | (HTMLElement & { sections?: readonly MnSidebarSection[]; selectedId?: string | null })
      | null
    expect(workspace).not.toBeNull()
    expect(workspace?.title).toBe('Greenhouse')
    expect(sidebar).not.toBeNull()
    expect(sidebar?.sections?.[0]?.label).toBe('Workflow Grimoire')
    expect(sidebar?.sections?.[0]?.nodes?.map((node) => node.label)).toEqual(
      expect.arrayContaining(['Do a chat turn', 'Read a book', 'Sophia Research Service', 'Paper Adapter Scout']),
    )
    expect(root?.querySelector('sh-chat-panel')).toBeNull()
    expect(root?.querySelector('mn-research-run-trace')).toBeNull()
    expect(root?.textContent).toContain('driver')
    expect(root?.textContent).toContain('New Conversation')
    expect(root?.textContent).toContain('System Prompt')
    expect(root?.textContent).toContain('Agent Network')
    expect(root?.textContent).toContain('Agent Ontology Journal')
    expect(root?.textContent).toContain('Workflow')
    expect(root?.textContent).toContain('projected')
    expect(root?.textContent).toContain('gpt-5')
    expect(root?.querySelector('.graph-info-model')?.textContent).toContain('GPT-5')
    expect(root?.querySelector('.graph-info-model')?.textContent).toContain('gpt-5')
    expect(root?.querySelector('.agent-model-trigger')?.textContent).toContain('GPT-5')
    expect(root?.querySelector('.stat-grid')).toBeNull()
    expect(root?.querySelector('.presence-strip')?.textContent).toContain('research-room')
    expect(root?.querySelector('.presence-dot-live')).not.toBeNull()
    expect(root?.querySelector('.presence-meta')?.textContent).toContain('run-srs-vehicle')
    expect(root?.querySelector('.presence-meta')?.textContent).toContain('vehicle-local-session')
    expect(root?.querySelector('.agent-card')).not.toBeNull()
    expect(root?.querySelector('sh-editor-host.prompt-editor-host')).not.toBeNull()
    let graph = root?.querySelector('mn-graph-three') as
      | (HTMLElement & { nodes?: readonly { id: string; label?: string }[]; dimension?: string })
      | null
    expect(graph).not.toBeNull()
    expect(graph?.nodes?.some((node) => node.id === 'model' && node.label === 'gpt-5')).toBe(true)
    expect(graph?.dimension).toBe('2d')
    const mode3d = Array.from(root?.querySelectorAll('.graph-mode-button') ?? []).find(
      (button) => button.textContent?.trim() === '3D',
    ) as HTMLButtonElement | undefined
    mode3d?.click()
    await el.updateComplete
    expect((root?.querySelector('mn-graph-three') as HTMLElement & { dimension?: string } | null)?.dimension).toBe('3d')
    const trigger = root?.querySelector('.agent-model-trigger') as HTMLButtonElement | null
    trigger?.click()
    await el.updateComplete
    expect(root?.querySelector('.agent-model-picker')).not.toBeNull()
    const deepseekProvider = Array.from(root?.querySelectorAll('.agent-model-provider') ?? []).find((button) =>
      button.textContent?.includes('DeepSeek'),
    ) as HTMLButtonElement | undefined
    deepseekProvider?.click()
    await el.updateComplete
    expect(root?.textContent).toContain('DeepSeek V4 Pro')
    const deepseekOption = Array.from(root?.querySelectorAll('.agent-model-option') ?? []).find((button) =>
      button.textContent?.includes('DeepSeek V4 Pro'),
    ) as HTMLButtonElement | undefined
    deepseekOption?.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await el.updateComplete
    expect(root?.querySelector('.agent-model-trigger')?.textContent).toContain('DeepSeek V4 Pro')
    const modelAttribution = root?.querySelector('.presence-model-attribution') as HTMLElement | null
    expect(modelAttribution).not.toBeNull()
    expect(modelAttribution?.textContent).toMatch(/^set \d{1,2}:\d{2}/)
    expect(modelAttribution?.title).toContain('vera')
    expect(modelAttribution?.title).toContain('set by')
    graph = root?.querySelector('mn-graph-three') as
      | (HTMLElement & { nodes?: readonly { id: string; label?: string }[]; dimension?: string })
      | null
    graph?.dispatchEvent(
      new CustomEvent('mn-graph-node-select', {
        detail: { id: 'tools', label: 'Tools' },
        bubbles: true,
        composed: true,
      }),
    )
    await el.updateComplete
    expect(root?.textContent).toContain('manifest')
    sidebar?.dispatchEvent(
      new CustomEvent('mn-sidebar-node-open', {
        detail: {
          id: 'workflow:sophia-research-service',
          node: { id: 'workflow:sophia-research-service', label: 'sophia-research-service' },
        },
        bubbles: true,
        composed: true,
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    await el.updateComplete
    expect(sidebar?.selectedId).toBe('workflow:sophia-research-service')
    expect(root?.textContent).toContain('Sophia Research Service')
    expect(root?.textContent).toContain('Workflow Definition')
    expect(root?.textContent).toContain('Definition Authority')
    expect(root?.textContent).toContain('Emporium workflow pack')
    expect(root?.textContent).toContain('current-state')
    expect(root?.textContent).toContain('doc-uri')
    expect(root?.textContent).toContain('Workflow Readiness')
    expect(root?.textContent).toContain('I/O Contract')
    expect(root?.textContent).toContain('Recent Runs')
    expect(root?.textContent).toContain('Eligible Agents')
    expect(root?.textContent).toContain('Seed Lineage')
    expect(root?.textContent).toContain('wf:WorkflowBinding')
    expect(root?.textContent).toContain('MO Object Index')
    expect(root?.textContent).toContain('Workflow Ontology')
    expect(root?.textContent).toContain('Workflow Ontology Journal')
    expect(root?.textContent).toContain('AgentWorld Contract')
    expect(root?.querySelector('.workflow-hero')).not.toBeNull()
    expect(root?.querySelector('.workflow-stage-map')).not.toBeNull()
    expect(root?.querySelector('.workflow-schema-pair')).not.toBeNull()
    expect(root?.querySelector('.workflow-row-list')).not.toBeNull()
    expect(root?.querySelector('.workflow-query')?.textContent).toContain('workflow_authoring_session.draft')
    const workflowGraph = root?.querySelector('mn-graph-three') as
      | (HTMLElement & { nodes?: readonly { id: string; label?: string }[]; dimension?: string })
      | null
    expect(workflowGraph?.dimension).toBe('3d')
    expect(workflowGraph?.nodes?.some((node) => node.id === 'wf:Run')).toBe(true)
    expect(workflowGraph?.nodes?.some((node) => node.id === 'wf:Phase')).toBe(true)
    expect(workflowGraph?.nodes?.some((node) => node.id === 'wf:WorkflowBinding')).toBe(true)
    expect(workflowGraph?.nodes?.some((node) => node.id === 'wf:Draft')).toBe(true)
    expect(workflowGraph?.nodes?.some((node) => node.id === 'agt:Session')).toBe(true)
    workflowGraph?.dispatchEvent(
      new CustomEvent('mn-graph-node-select', {
        detail: { id: 'agt:Session', label: 'agt:Session' },
        bubbles: true,
        composed: true,
      }),
    )
    await el.updateComplete
    expect(root?.textContent).toContain('urn:sophia:agent:agent-research-1:session:session-research-1')
    el.remove()
  })

  it('renders tool use inline in the shared chat panel', async () => {
    const el = document.createElement('vehicle-app') as VehicleApp
    el.service = new FixtureVehicleService()
    el.config = {
      baseUrl: '',
      fixture: true,
      clientId: 'vehicle-test',
      authorId: 'vera',
      role: 'user',
      pollMs: 60000,
      auth: {},
    }
    document.body.append(el)

    await el.updateComplete
    await new Promise((resolve) => setTimeout(resolve, 0))
    await el.updateComplete
    const chatButton = Array.from(el.shadowRoot?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent?.trim() === 'Chat',
    )
    chatButton?.click()
    await el.updateComplete
    const panel = el.shadowRoot?.querySelector('sh-chat-panel') as
      | (HTMLElement & { updateComplete?: Promise<unknown> })
      | null
    await panel?.updateComplete

    expect(panel?.querySelector('.tool-call-name')?.textContent).toBe('search_blocks')
    expect(panel?.querySelector('.tool-status-icon[data-status="completed"]')).not.toBeNull()
    expect(panel?.textContent).toContain('1 tool inline')
    el.remove()
  })
})
