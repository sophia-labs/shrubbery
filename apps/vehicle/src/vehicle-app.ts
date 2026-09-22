import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { LitElement, css, html, nothing, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { classMap } from 'lit/directives/class-map.js'
import { repeat } from 'lit/directives/repeat.js'

import '@shrubbery/components'
import {
  ShEditorHost,
  type EditorHostBinding,
  type EditorHostState,
} from '@shrubbery/runtime'
import {
  ShChatPanel,
  type ChatComposerControl,
  type ChatComposerControlChangeDetail,
  type ChatEmptySuggestion,
  type ChatMessage,
  type ChatPromptCard,
  type ChatPromptOptionUseDetail,
  type ChatPromptSubmitDetail,
} from '@shrubbery/chat-kernel'
import type {
  MnGraphEdge,
  MnGraphNode,
  MnResearchRunStep,
  MnResearchWorkspaceMode,
  MnResearchWorkspaceModeDetail,
  MnSidebarNodeDetail,
  MnSidebarNode,
  MnSidebarSection,
} from '@shrubbery/components'

import type {
  BridgeLine,
  BridgeOperation,
  BridgeProjection,
  JsonRecord,
  VehicleActivityItem,
  VehicleAgentRecord,
  VehicleAgentSessionEvent,
  VehicleAgentWorldResponse,
  VehicleConfig,
  VehicleRoomTab,
  VehicleRunSummary,
  VehicleSession,
  VehicleTurnContextPreview,
  VehicleWorkflowRecord,
} from './types.js'
import { projectVehicleChatMessages } from './chat-projection.js'
import {
  ROOM_TABS,
  activityItems,
  agentJournalItems,
  agentDisplayName,
  agentSelector,
  arrayAt,
  asRecord,
  compactJson,
  conversationMessages,
  createVehicleService,
  driverLabel,
  knownAgentModel,
  modelFromRecord,
  projectWorkflowOntology,
  readVehicleConfig,
  stringAt,
  truncate,
  valueAt,
  workflowName,
  type VehicleTurnContextOverride,
  type VehicleService,
} from './vehicle-service.js'

void ShEditorHost
void ShChatPanel

type ComposerControlId = 'role' | 'visibility'
type MainPaneMode = 'agent' | 'workflow' | 'chat'
type AgentGraphDimension = '2d' | '3d'
type AgentModelOption = { readonly id: string; readonly label: string; readonly provider: string }
type AgentModelGroup = { readonly provider: string; readonly models: readonly AgentModelOption[] }
export type AgentPresenceTone = 'live' | 'held' | 'dormant'

export interface AgentPresenceReference {
  readonly label: string
  readonly value: string
}

export interface AgentPresenceModel {
  readonly value: string
  readonly observedAt?: number
  readonly observer?: string
}

export interface AgentPresenceViewModel {
  readonly identity: {
    readonly name: string
    readonly kindLine: string
  }
  readonly state: {
    readonly lifecycle: string
    readonly tone: AgentPresenceTone
  }
  readonly model: AgentPresenceModel
  readonly references: readonly AgentPresenceReference[]
  readonly meta: readonly AgentPresenceReference[]
}

export interface AgentPresenceInput {
  readonly name: string
  readonly kindLine?: string | null
  readonly lifecycle?: string | null
  readonly model: string
  readonly driver: string
  readonly graph: string
  readonly runId: string
  readonly sessionId: string
  readonly updatedAt: string
  readonly events?: readonly VehicleAgentSessionEvent[]
}
type WorkflowGrimoireEntry = VehicleWorkflowRecord & {
  readonly runs: readonly VehicleRunSummary[]
  readonly agents: readonly VehicleAgentRecord[]
}

const MODEL_PROVIDER_ORDER = ['DeepSeek', 'OpenAI', 'Anthropic', 'Google', 'Moonshot', 'Other'] as const

const MODEL_LABELS: Record<string, string> = {
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
  'deepseek-v4-flash': 'DeepSeek V4 Flash',
  'gpt-5': 'GPT-5',
  'claude-sonnet': 'Claude Sonnet',
}

function modelLabel(modelId: string | null | undefined): string {
  if (!modelId) return 'Select model'
  return MODEL_LABELS[modelId] ?? modelId
}

function modelProvider(modelId: string): string {
  const lower = modelId.toLowerCase()
  if (lower.includes('deepseek')) return 'DeepSeek'
  if (/^gpt-|^o[13]-/.test(lower)) return 'OpenAI'
  if (/^claude-/.test(lower)) return 'Anthropic'
  if (/^gemini-/.test(lower)) return 'Google'
  if (/^kimi-/.test(lower)) return 'Moonshot'
  return 'Other'
}

function providerRank(provider: string): number {
  const index = MODEL_PROVIDER_ORDER.indexOf(provider as (typeof MODEL_PROVIDER_ORDER)[number])
  return index < 0 ? MODEL_PROVIDER_ORDER.length : index
}

function agentPresenceTone(lifecycle: string): AgentPresenceTone {
  if (lifecycle === 'running') return 'live'
  if (lifecycle === 'paused') return 'held'
  return 'dormant'
}

function latestModelChangeEvent(
  model: string,
  events: readonly VehicleAgentSessionEvent[] = [],
): VehicleAgentSessionEvent | null {
  return (
    events
      .filter((event) => event.type === 'agent.model.changed' && stringAt(event.payload, ['model']) === model)
      .sort((left, right) => right.ts - left.ts)[0] ?? null
  )
}

export function buildAgentPresence(input: AgentPresenceInput): AgentPresenceViewModel {
  const rawLifecycle = input.lifecycle?.trim()
  const lifecycle = rawLifecycle && rawLifecycle !== '-' ? rawLifecycle : 'unknown'
  const modelEvent = latestModelChangeEvent(input.model, input.events)
  const observer = modelEvent
    ? stringAt(modelEvent.payload, ['authorId']) ??
      stringAt(modelEvent.payload, ['observer']) ??
      stringAt(modelEvent.payload, ['clientId'])
    : undefined

  return {
    identity: {
      name: input.name,
      kindLine: input.kindLine?.trim() || '',
    },
    state: {
      lifecycle,
      tone: agentPresenceTone(lifecycle),
    },
    model: {
      value: input.model,
      ...(modelEvent ? { observedAt: modelEvent.ts } : {}),
      ...(observer ? { observer } : {}),
    },
    references: [
      { label: 'driver', value: input.driver },
      { label: 'graph', value: input.graph },
    ],
    meta: [
      { label: 'run', value: input.runId },
      { label: 'session', value: input.sessionId },
      { label: 'updated', value: input.updatedAt },
    ],
  }
}

function workflowNodeId(name: string): string {
  return `workflow:${encodeURIComponent(name)}`
}

function workflowNameFromNodeId(id: string): string {
  return decodeURIComponent(id.slice('workflow:'.length))
}

function workflowChildNodeId(prefix: 'workflow-run:' | 'workflow-agent:', workflow: string, target: string): string {
  return `${prefix}${encodeURIComponent(workflow)}:${encodeURIComponent(target)}`
}

function workflowChildFromNodeId(prefix: 'workflow-run:' | 'workflow-agent:', id: string): { workflow: string; target: string } {
  const [workflow = '', target = ''] = id.slice(prefix.length).split(':')
  return { workflow: decodeURIComponent(workflow), target: decodeURIComponent(target) }
}

const EMPTY_SUGGESTIONS: readonly ChatEmptySuggestion[] = [
  {
    id: 'start-fresh',
    icon: 'N',
    label: 'Start fresh',
    prompt: '/new Re-open the current objective with a clean conversation room.',
  },
  {
    id: 'claim-driver',
    icon: 'D',
    label: 'Claim driver',
    prompt: '/driver claim',
  },
  {
    id: 'steer-room',
    icon: 'S',
    label: 'Steer',
    prompt: '/steer Slow down and explain the next action before taking it.',
  },
]

const PROMPT_CARDS: readonly ChatPromptCard[] = [
  {
    id: 'vehicle-room-commands',
    header: 'Greenhouse',
    question: 'Choose a room command to stage in the composer.',
    mode: 'compose',
    options: [
      {
        id: 'refresh',
        label: 'Refresh',
        description: 'Re-read the AgentWorld projection and event cursor.',
        compose: '/refresh',
      },
      {
        id: 'comment',
        label: 'Comment',
        description: 'Post a human-only Codex room comment.',
        compose: '/comment Note for collaborators: ',
      },
      {
        id: 'steer',
        label: 'Steer',
        description: 'Append a steering command to the driver queue.',
        compose: '/steer ',
      },
    ],
  },
]

const ROOM_TAB_LABELS: Record<VehicleRoomTab, string> = {
  activity: 'Now',
  tools: 'Tools',
  comments: 'Notes',
  world: 'State',
  cockpit: 'Cockpit',
  bridge: 'Bridge',
  prompt: 'Prompt',
  schema: 'Schema',
  debug: 'Debug',
}

const LOW_FREQUENCY_TABS = new Set<VehicleRoomTab>(['cockpit', 'bridge', 'prompt', 'schema', 'debug'])

type PromptEditorProvider = NonNullable<EditorHostState['provider']>

class LocalEditorHostBinding implements EditorHostBinding {
  private state: EditorHostState
  private readonly subscribers = new Set<(value: EditorHostState) => void>()

  constructor(state: EditorHostState) {
    this.state = state
  }

  get(): EditorHostState {
    return this.state
  }

  subscribe(callback: (value: EditorHostState) => void): () => void {
    this.subscribers.add(callback)
    return () => this.subscribers.delete(callback)
  }

  set(value: EditorHostState): void {
    this.state = value
    for (const callback of this.subscribers) callback(value)
  }
}

function createPromptEditorProvider(): PromptEditorProvider {
  const doc = new Y.Doc()
  const awareness = new Awareness(doc)
  return {
    doc,
    awareness,
    lifecycle: {
      get: () => ({ connection: 'connected' as const, synchronized: true, shouldConnect: true }),
      subscribe: () => () => {},
    },
    whenRenderable: Promise.resolve(),
    whenEditable: Promise.resolve(),
    whenSynced: Promise.resolve(),
    renderSource: Promise.resolve('live'),
    destroy: () => {
      awareness.destroy()
      doc.destroy()
    },
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function promptTextToHtml(text: string): string {
  const blocks = text.trim() ? text.split(/\n{2,}/) : ['']
  return blocks
    .map((block, index) => {
      const body = escapeHtml(block).replaceAll('\n', '<br>')
      return `<p data-block-id="system-prompt-${index + 1}">${body || '<br>'}</p>`
    })
    .join('')
}

function hashText(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

function firstNonBlank(...values: readonly unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed) return trimmed
  }
  return null
}

@customElement('vehicle-app')
export class VehicleApp extends LitElement {
  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      color: var(--mn-color-text-primary, #111827);
      background: var(--mn-color-surface-base, #f6f4ef);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-sm, 13px);
    }

    mn-research-workspace {
      height: 100%;
    }

    .header-actions {
      display: inline-flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
    }

    .badge {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      max-width: 240px;
      box-sizing: border-box;
      padding: 0 var(--mn-space-2, 8px);
      overflow: hidden;
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-xs, 12px);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: var(--mn-control-height, 30px);
      gap: var(--mn-space-1-5, 6px);
      box-sizing: border-box;
      padding: 0 var(--mn-space-3, 12px);
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-primary, #111827);
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-text-xs, 12px);
      white-space: nowrap;
    }

    .button:hover,
    .button:focus-visible {
      border-color: var(--mn-color-accent, #586f93);
      background: var(--mn-color-surface-hover, #f3f4f6);
      outline: none;
    }

    .button.primary {
      border-color: color-mix(in srgb, var(--mn-color-accent, #586f93) 48%, transparent);
      background: color-mix(in srgb, var(--mn-color-accent, #586f93) 12%, var(--mn-color-surface-raised, #fff));
      color: var(--mn-color-text-accent, var(--mn-color-accent, #586f93));
      font-weight: 650;
    }

    .button.active {
      border-color: var(--mn-color-border-accent, var(--mn-color-accent, #586f93));
      background: var(--mn-color-interactive-selected, rgba(88, 111, 147, 0.12));
      color: var(--mn-color-text-accent, var(--mn-color-accent, #586f93));
      font-weight: 700;
    }

    .chat-wrap,
    .sidebar-wrap,
    .detail-wrap {
      display: block;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }

    .agent-main-wrap {
      display: block;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      overflow: auto;
      box-sizing: border-box;
      padding: var(--mn-space-4, 16px);
      background: var(--mn-color-surface-base, #fff);
    }

    .agent-graph-pane {
      display: grid;
      height: 100%;
      min-height: 0;
      grid-template-rows: auto minmax(180px, 1fr) auto;
      background: var(--mn-color-surface-base, #fff);
    }

    .graph-head,
    .journal-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mn-space-2, 8px);
      padding: var(--mn-space-3, 12px);
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-surface-raised, #fff);
    }

    .graph-head-main {
      display: grid;
      min-width: 0;
      gap: 2px;
    }

    .graph-title,
    .journal-title {
      color: var(--mn-color-text-primary, #111827);
      font-weight: 750;
    }

    .graph-meta,
    .journal-meta {
      min-width: 0;
      overflow: hidden;
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-2xs, 10px);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .graph-mode-toggle {
      display: inline-flex;
      flex: 0 0 auto;
      overflow: hidden;
      border: 1px solid var(--mn-color-border-subtle, #d8e2dc);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-base, #fff);
    }

    .graph-mode-button {
      min-width: 34px;
      min-height: 24px;
      padding: 0 var(--mn-space-2, 8px);
      border: 0;
      border-inline-end: 1px solid var(--mn-color-border-subtle, #d8e2dc);
      background: transparent;
      color: var(--mn-color-text-secondary, #4b5563);
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 750;
    }

    .graph-mode-button:last-child {
      border-inline-end: 0;
    }

    .graph-mode-button:hover,
    .graph-mode-button:focus-visible {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
      outline: none;
    }

    .graph-mode-button.active {
      background: var(--mn-color-interactive-selected, rgba(47, 125, 95, 0.12));
      color: var(--mn-color-text-accent, var(--mn-color-accent, #2f7d5f));
    }

    .graph-canvas {
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      padding: var(--mn-space-3, 12px);
      background:
        linear-gradient(180deg, color-mix(in srgb, var(--mn-color-accent, #2f7d5f) 5%, transparent), transparent 140px),
        var(--mn-color-surface-sunken, #f8fafc);
    }

    .graph-canvas mn-graph-three {
      display: block;
      width: 100%;
      height: 100%;
      min-height: 260px;
    }

    .graph-info {
      max-height: 36%;
      min-height: 118px;
      overflow: auto;
      padding: var(--mn-space-3, 12px);
      border-top: 1px solid var(--mn-color-border-default, #e5e7eb);
      background: var(--mn-color-surface-raised, #fff);
    }

    .graph-info-model {
      display: grid;
      gap: 2px;
      margin-block-end: var(--mn-space-3, 12px);
      padding: var(--mn-space-2, 8px);
      border: 1px solid color-mix(in srgb, var(--mn-color-accent, #2f7d5f) 26%, var(--mn-color-border-subtle, #e5e7eb));
      border-radius: var(--mn-radius-control, 6px);
      background: color-mix(in srgb, var(--mn-color-accent, #2f7d5f) 8%, var(--mn-color-surface-raised, #fff));
    }

    .graph-info-model-label {
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 750;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .graph-info-model-value {
      color: var(--mn-color-text-primary, #111827);
      font-size: var(--mn-text-sm, 13px);
      font-weight: 760;
      line-height: 1.25;
    }

    .graph-info-model-id {
      color: var(--mn-color-text-tertiary, #6b7280);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
      overflow-wrap: anywhere;
    }

    .agent-journal {
      display: grid;
      min-height: 0;
      gap: var(--mn-space-2, 8px);
    }

    .journal-list {
      display: grid;
      gap: var(--mn-space-2, 8px);
    }

    .journal-item {
      display: grid;
      grid-template-columns: 38px minmax(0, 1fr);
      gap: var(--mn-space-2, 8px);
      padding: var(--mn-space-2, 8px);
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-raised, #fff);
    }

    .journal-seq {
      color: var(--mn-color-text-tertiary, #6b7280);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
    }

    .journal-main {
      display: grid;
      min-width: 0;
      gap: 2px;
    }

    .journal-event {
      overflow-wrap: anywhere;
      color: var(--mn-color-text-primary, #111827);
      font-weight: 650;
    }

    .journal-detail,
    .journal-time {
      overflow-wrap: anywhere;
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.35;
    }

    .journal-time {
      color: var(--mn-color-text-tertiary, #6b7280);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
    }

    sh-chat-panel {
      height: 100%;
      min-height: 0;
    }

    .sidebar-wrap {
      display: grid;
      grid-template-rows: minmax(0, 1fr) auto;
      background: var(--mn-color-panel-bg, var(--mn-color-surface-base, #fff));
    }

    .lobby-footer {
      display: grid;
      gap: var(--mn-space-2, 8px);
      padding: var(--mn-space-3, 12px);
      border-top: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-surface-sunken, #f8fafc);
    }

    .status {
      min-width: 0;
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.4;
    }

    .status.error {
      color: var(--mn-color-danger, #be123c);
    }

    .button-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--mn-space-2, 8px);
    }

    .button-grid .button {
      width: 100%;
      padding-inline: var(--mn-space-2, 8px);
    }

    .provenance {
      padding: var(--mn-space-2, 8px);
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-surface, 8px);
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-2xs, 11px);
      line-height: 1.35;
    }

    .room-pane {
      display: grid;
      height: 100%;
      min-height: 0;
      grid-template-rows: auto minmax(0, 1fr);
      background: var(--mn-color-surface-base, #fff);
    }

    .tabs {
      display: flex;
      min-width: 0;
      gap: 2px;
      padding: var(--mn-space-2, 8px);
      overflow-x: auto;
      border-bottom: 1px solid var(--mn-color-border-default, #e5e7eb);
      background: var(--mn-color-surface-sunken, #f8fafc);
    }

    .tab {
      flex: 0 0 auto;
      min-height: 30px;
      padding: 0 var(--mn-space-2, 8px);
      border: 1px solid transparent;
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: var(--mn-color-text-secondary, #4b5563);
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-text-xs, 12px);
      text-transform: capitalize;
      white-space: nowrap;
    }

    .tab.low-frequency:not(.active) {
      color: var(--mn-color-text-tertiary, #6b7280);
    }

    .tab:hover,
    .tab:focus-visible,
    .tab.active {
      border-color: var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-primary, #111827);
      outline: none;
    }

    .button:focus-visible,
    .tab:focus-visible,
    .activity-row:focus-visible,
    .bridge-line:focus-visible {
      box-shadow: var(--mn-focus-ring, 0 0 0 2px rgba(47, 125, 95, 0.4));
    }

    .tab.active {
      border-color: var(--mn-color-border-accent, var(--mn-color-accent, #586f93));
      color: var(--mn-color-text-accent, var(--mn-color-accent, #586f93));
      font-weight: 700;
    }

    .pane-body {
      min-width: 0;
      min-height: 0;
      overflow: auto;
      padding: var(--mn-space-3, 12px);
    }

    .activity-list {
      display: grid;
      gap: var(--mn-space-2, 8px);
    }

    .activity-row {
      display: grid;
      grid-template-columns: 42px minmax(0, 1fr);
      gap: var(--mn-space-2, 8px);
      width: 100%;
      box-sizing: border-box;
      padding: var(--mn-space-2, 8px);
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-surface, 8px);
      background: var(--mn-color-surface-raised, #fff);
      color: inherit;
      cursor: pointer;
      font: inherit;
      text-align: left;
    }

    .activity-row:hover,
    .activity-row:focus-visible,
    .activity-row.active {
      border-color: var(--mn-color-border-default, #d1d5db);
      background: var(--mn-color-surface-hover, #f3f4f6);
      outline: none;
    }

    .seq {
      color: var(--mn-color-text-tertiary, #6b7280);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
    }

    .activity-main {
      display: grid;
      min-width: 0;
      gap: 2px;
    }

    .activity-title,
    .field-value,
    .json-block {
      overflow-wrap: anywhere;
    }

    .activity-title {
      color: var(--mn-color-text-primary, #111827);
      font-weight: 650;
    }

    .activity-detail,
    .field-label {
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.35;
    }

    .activity-detail {
      overflow: hidden;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }

    .status-running .activity-title {
      color: var(--mn-color-warning, #d97706);
    }

    .status-error .activity-title,
    .status-blocked .activity-title {
      color: var(--mn-color-danger, #be123c);
    }

    .status-completed .activity-title {
      color: var(--mn-color-success, #16a34a);
    }

    .fields {
      display: grid;
      gap: var(--mn-space-2, 8px);
    }

    .toolbar {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--mn-space-2, 8px);
      margin-bottom: var(--mn-space-3, 12px);
    }

    .pane-grid {
      display: grid;
      gap: var(--mn-space-2, 8px);
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    }

    .pane-card,
    .bridge-line {
      display: grid;
      gap: var(--mn-space-1-5, 6px);
      box-sizing: border-box;
      padding: var(--mn-space-3, 12px);
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-surface, 8px);
      background: var(--mn-color-surface-raised, #fff);
    }

    .agent-screen {
      display: grid;
      gap: var(--mn-space-3, 12px);
    }

    .workflow-screen {
      display: grid;
      gap: var(--mn-space-3, 12px);
    }

    .workflow-hero {
      display: grid;
      grid-template-columns: minmax(0, 1.45fr) minmax(260px, 0.55fr);
      gap: var(--mn-space-4, 16px);
      box-sizing: border-box;
      padding: var(--mn-space-4, 16px);
      border: 1px solid color-mix(in srgb, var(--mn-color-accent, #2f7d5f) 30%, var(--mn-color-border-subtle, #e5e7eb));
      border-radius: var(--mn-radius-surface, 8px);
      background:
        linear-gradient(135deg, color-mix(in srgb, var(--mn-color-accent, #2f7d5f) 10%, transparent), transparent 60%),
        var(--mn-color-surface-raised, #fff);
    }

    .workflow-hero-main,
    .workflow-hero-actions {
      display: grid;
      gap: var(--mn-space-3, 12px);
      min-width: 0;
      align-content: start;
    }

    .workflow-kicker {
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 780;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .workflow-description {
      margin: 0;
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-sm, 13px);
      line-height: 1.45;
      overflow-wrap: anywhere;
    }

    .workflow-chip-row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mn-space-1-5, 6px);
      min-width: 0;
    }

    .workflow-chip {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      max-width: 100%;
      padding: 0 var(--mn-space-2, 8px);
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-secondary, #4b5563);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
      overflow-wrap: anywhere;
    }

    .workflow-chip.good {
      border-color: color-mix(in srgb, var(--mn-color-success, #16a34a) 30%, var(--mn-color-border-subtle, #e5e7eb));
      color: var(--mn-color-success, #16a34a);
    }

    .workflow-chip.warning {
      border-color: color-mix(in srgb, var(--mn-color-warning, #d97706) 34%, var(--mn-color-border-subtle, #e5e7eb));
      color: var(--mn-color-warning, #d97706);
    }

    .workflow-command-row {
      display: grid;
      gap: var(--mn-space-2, 8px);
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
    }

    .workflow-metric-strip {
      display: grid;
      gap: var(--mn-space-2, 8px);
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .workflow-metric {
      display: grid;
      gap: 2px;
      min-width: 0;
      padding: var(--mn-space-2, 8px);
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-control, 6px);
      background: color-mix(in srgb, var(--mn-color-surface-raised, #fff) 92%, var(--mn-color-accent, #2f7d5f));
    }

    .workflow-metric-value {
      color: var(--mn-color-text-primary, #111827);
      font-size: var(--mn-text-lg, 18px);
      font-weight: 780;
      line-height: 1.1;
      overflow-wrap: anywhere;
    }

    .workflow-metric-label {
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 750;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .workflow-metric-note {
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-2xs, 10px);
      line-height: 1.25;
      overflow-wrap: anywhere;
    }

    .workflow-stage-map {
      display: grid;
      gap: var(--mn-space-2, 8px);
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .workflow-stage {
      position: relative;
      display: grid;
      gap: var(--mn-space-1, 4px);
      min-width: 0;
      padding: var(--mn-space-3, 12px);
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-surface, 8px);
      background: var(--mn-color-surface-raised, #fff);
    }

    .workflow-stage::before {
      content: '';
      position: absolute;
      top: var(--mn-space-3, 12px);
      left: var(--mn-space-3, 12px);
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--mn-color-text-tertiary, #9ca3af);
    }

    .workflow-stage.good::before {
      background: var(--mn-color-success, #16a34a);
    }

    .workflow-stage.warning::before {
      background: var(--mn-color-warning, #d97706);
    }

    .workflow-stage.danger::before {
      background: var(--mn-color-danger, #be123c);
    }

    .workflow-stage-title,
    .workflow-row-title {
      min-width: 0;
      padding-inline-start: var(--mn-space-4, 16px);
      color: var(--mn-color-text-primary, #111827);
      font-weight: 760;
      overflow-wrap: anywhere;
    }

    .workflow-stage-title {
      font-size: var(--mn-text-sm, 13px);
    }

    .workflow-stage-detail {
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.35;
      overflow-wrap: anywhere;
    }

    .workflow-card-grid {
      display: grid;
      gap: var(--mn-space-3, 12px);
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    }

    .workflow-card {
      display: grid;
      gap: var(--mn-space-3, 12px);
      box-sizing: border-box;
      padding: var(--mn-space-3, 12px);
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-surface, 8px);
      background: var(--mn-color-surface-raised, #fff);
    }

    .workflow-card.primary {
      border-color: color-mix(in srgb, var(--mn-color-accent, #2f7d5f) 28%, var(--mn-color-border-subtle, #e5e7eb));
      background:
        linear-gradient(135deg, color-mix(in srgb, var(--mn-color-accent, #2f7d5f) 9%, transparent), transparent 62%),
        var(--mn-color-surface-raised, #fff);
    }

    .workflow-card.wide {
      grid-column: span 2;
    }

    .workflow-card-head {
      display: grid;
      gap: 2px;
      min-width: 0;
    }

    .workflow-title {
      margin: 0;
      color: var(--mn-color-text-primary, #111827);
      font-size: var(--mn-text-lg, 18px);
      line-height: 1.15;
    }

    .workflow-subtitle {
      margin: var(--mn-space-1, 4px) 0 0;
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-xs, 12px);
      overflow-wrap: anywhere;
    }

    .workflow-fact-grid {
      display: grid;
      gap: var(--mn-space-2, 8px);
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    }

    .workflow-fact {
      display: grid;
      gap: 2px;
      min-width: 0;
      padding: var(--mn-space-2, 8px);
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-base, #fff);
    }

    .workflow-fact.good {
      border-color: color-mix(in srgb, var(--mn-color-success, #16a34a) 28%, var(--mn-color-border-subtle, #e5e7eb));
      background: color-mix(in srgb, var(--mn-color-success, #16a34a) 7%, var(--mn-color-surface-base, #fff));
    }

    .workflow-fact.warning,
    .workflow-fact.danger {
      border-color: color-mix(in srgb, var(--mn-color-danger, #be123c) 32%, var(--mn-color-border-subtle, #e5e7eb));
      background: color-mix(in srgb, var(--mn-color-danger, #be123c) 7%, var(--mn-color-surface-base, #fff));
    }

    .workflow-fact-label {
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 750;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .workflow-fact-value {
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.35;
      overflow-wrap: anywhere;
    }

    .workflow-row-list {
      display: grid;
      gap: var(--mn-space-2, 8px);
      min-width: 0;
    }

    .workflow-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--mn-space-2, 8px);
      min-width: 0;
      align-items: center;
      padding: var(--mn-space-2, 8px);
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-base, #fff);
    }

    .workflow-row-main {
      display: grid;
      min-width: 0;
      gap: 2px;
    }

    .workflow-row-title {
      padding-inline-start: 0;
      font-size: var(--mn-text-xs, 12px);
    }

    .workflow-row-detail,
    .workflow-row-meta {
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.35;
      overflow-wrap: anywhere;
    }

    .workflow-row-meta {
      color: var(--mn-color-text-tertiary, #6b7280);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
    }

    .workflow-row-badge {
      justify-self: end;
      max-width: 130px;
      overflow: hidden;
      padding: 2px var(--mn-space-2, 8px);
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-control, 6px);
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-2xs, 10px);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .workflow-row-badge.good {
      border-color: color-mix(in srgb, var(--mn-color-success, #16a34a) 30%, var(--mn-color-border-subtle, #e5e7eb));
      color: var(--mn-color-success, #16a34a);
    }

    .workflow-row-badge.warning {
      border-color: color-mix(in srgb, var(--mn-color-warning, #d97706) 34%, var(--mn-color-border-subtle, #e5e7eb));
      color: var(--mn-color-warning, #d97706);
    }

    .workflow-schema-pair {
      display: grid;
      gap: var(--mn-space-2, 8px);
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .workflow-schema-box {
      display: grid;
      min-width: 0;
      gap: var(--mn-space-1, 4px);
    }

    .workflow-schema-title {
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 750;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .workflow-query {
      padding: var(--mn-space-2, 8px);
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-sunken, #f8fafc);
      color: var(--mn-color-text-secondary, #4b5563);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
      line-height: 1.35;
      overflow-wrap: anywhere;
    }

    .ontology-node-list {
      display: grid;
      gap: var(--mn-space-2, 8px);
    }

    .ontology-node-row {
      display: grid;
      gap: 2px;
      width: 100%;
      padding-block-end: var(--mn-space-2, 8px);
      border: 0;
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
      text-align: left;
    }

    .ontology-node-row:hover,
    .ontology-node-row:focus-visible {
      color: var(--mn-color-text-accent, var(--mn-color-accent, #2f7d5f));
      outline: none;
    }

    .ontology-node-row.active {
      border-bottom-color: var(--mn-color-border-accent, var(--mn-color-accent, #2f7d5f));
    }

    .ontology-node-label {
      color: var(--mn-color-text-primary, #111827);
      font-weight: 750;
    }

    .ontology-node-note {
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-xs, 12px);
      overflow-wrap: anywhere;
    }

    .agent-card {
      display: grid;
      gap: var(--mn-space-3, 12px);
      box-sizing: border-box;
      padding: var(--mn-space-3, 12px);
      border: 1px solid var(--mn-color-border-strong, #cbd5e1);
      border-radius: var(--mn-radius-surface, 8px);
      background:
        linear-gradient(135deg, color-mix(in srgb, var(--mn-color-accent, #2f7d5f) 10%, transparent), transparent 58%),
        var(--mn-color-surface-raised, #fff);
      box-shadow: var(--mn-shadow-card, none);
    }

    .agent-topline {
      display: grid;
      grid-template-columns: 54px minmax(0, 1fr);
      align-items: center;
      gap: var(--mn-space-3, 12px);
      min-width: 0;
    }

    .agent-avatar {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 54px;
      height: 54px;
      border: 1px solid var(--mn-color-border-accent, #b9d8c8);
      border-radius: var(--mn-radius-surface, 8px);
      background: var(--mn-color-surface-accent, #e8f4ee);
      color: var(--mn-color-text-accent-strong, #1f553f);
      font-size: var(--mn-text-xl, 20px);
      font-weight: 800;
      line-height: 1;
      text-transform: uppercase;
    }

    .agent-name {
      margin: 0;
      overflow-wrap: anywhere;
      color: var(--mn-color-text-primary, #111827);
      font-size: var(--mn-text-lg, 18px);
      line-height: 1.1;
    }

    .agent-line {
      margin: var(--mn-space-1, 4px) 0 0;
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.35;
      overflow-wrap: anywhere;
    }

    .stat-grid {
      display: grid;
      gap: var(--mn-space-2, 8px);
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .stat {
      position: relative;
      display: grid;
      gap: 2px;
      min-width: 0;
      padding: var(--mn-space-2, 8px);
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-control, 6px);
      background: color-mix(in srgb, var(--mn-color-surface-raised, #fff) 76%, var(--mn-color-surface-sunken, #f8fafc));
    }

    .stat-label {
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 700;
      text-transform: uppercase;
    }

    .stat-value {
      min-width: 0;
      overflow: hidden;
      color: var(--mn-color-text-primary, #111827);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 650;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .presence-strip {
      display: grid;
      gap: var(--mn-space-2, 8px);
      min-width: 0;
      padding: var(--mn-space-4, 16px);
      border: 1px solid var(--mn-top-bar-border, var(--mn-color-border-subtle, #cfe0d6));
      border-radius: var(--mn-radius-surface, 8px);
      background: var(--mn-top-bar-bg, var(--mn-color-surface-raised, #e9f1ec));
      color: var(--mn-top-bar-text, var(--mn-color-text-primary, #213f33));
      font-family: var(--mn-font-chrome, var(--greenhouse-font-sans, Inter, system-ui, sans-serif));
    }

    .presence-sentence {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.35rem;
      min-width: 0;
      color: var(--mn-top-bar-text, var(--mn-color-text-primary, #213f33));
      font-size: var(--mn-text-base, 15px);
      line-height: 1.35;
    }

    .presence-name {
      color: var(--mn-color-text-primary, var(--mn-top-bar-text, #18231e));
      font-family: var(--mn-font-display, var(--greenhouse-font-sans, Inter, system-ui, sans-serif));
      font-size: var(--mn-text-2xl, 24px);
      font-weight: var(--mn-font-weight-bold, 700);
      letter-spacing: 0;
      line-height: 1.12;
      overflow-wrap: anywhere;
    }

    .presence-predicate,
    .presence-separator {
      color: var(--mn-top-bar-text-muted, var(--mn-color-text-secondary, #60746a));
    }

    .presence-dot {
      flex: 0 0 auto;
      width: 10px;
      height: 10px;
      margin-right: 0.1rem;
      border-radius: 999px;
      transform: translateY(-1px);
    }

    .presence-dot-live {
      background: var(--mn-color-accent, #2f7d5f);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--mn-color-accent, #2f7d5f) 18%, transparent);
    }

    .presence-dot-held {
      background: var(--mn-color-warning, #d97706);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--mn-color-warning, #d97706) 16%, transparent);
    }

    .presence-dot-dormant {
      background: var(--mn-color-text-muted, #94a09a);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--mn-color-text-muted, #94a09a) 14%, transparent);
    }

    @media (prefers-reduced-motion: no-preference) {
      .presence-dot-live {
        animation: presence-live-pulse 2s ease-in-out infinite;
      }
    }

    @keyframes presence-live-pulse {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.42;
      }
    }

    .presence-ref {
      color: var(--mn-top-bar-text-muted, var(--mn-color-text-secondary, #60746a));
      text-decoration: none;
      transition:
        color 0.12s ease,
        text-decoration-color 0.12s ease;
    }

    .presence-ref:hover {
      color: var(--mn-color-accent, #2f7d5f);
      text-decoration: underline;
      text-decoration-color: currentColor;
      text-underline-offset: 0.18em;
    }

    .presence-meta {
      min-width: 0;
      overflow: hidden;
      color: var(--mn-color-text-muted, var(--mn-top-bar-text-muted, #94a09a));
      font-family: var(--mn-font-utility, var(--greenhouse-font-sans, Inter, system-ui, sans-serif));
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.35;
      text-overflow: ellipsis;
      user-select: text;
      white-space: nowrap;
    }

    .presence-model {
      position: relative;
      display: inline-flex;
      min-width: 0;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
    }

    .presence-model .agent-model-trigger {
      display: inline-flex;
      width: auto;
      min-height: 0;
      align-items: baseline;
      gap: 0.2rem;
      color: var(--mn-top-bar-text, var(--mn-color-text-primary, #213f33));
      font-size: var(--mn-text-base, 15px);
      font-weight: var(--mn-font-weight-semibold, 600);
      line-height: 1.35;
    }

    .presence-model .agent-model-trigger:hover {
      color: var(--mn-color-accent, #2f7d5f);
    }

    .presence-model .agent-model-caret {
      color: var(--mn-top-bar-text-muted, var(--mn-color-text-secondary, #60746a));
      font-size: var(--mn-text-xs, 12px);
    }

    .presence-model-attribution {
      align-self: center;
      color: var(--mn-top-bar-text-muted, var(--mn-color-text-secondary, #60746a));
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.35;
      white-space: nowrap;
    }

    .model-stat.open {
      z-index: 10;
    }

    .agent-model-trigger {
      display: grid;
      width: 100%;
      min-width: 0;
      min-height: 22px;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: var(--mn-space-1, 4px);
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--mn-color-text-primary, #111827);
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-text-xs, 12px);
      font-weight: 700;
      text-align: left;
    }

    .agent-model-trigger:focus-visible {
      border-radius: var(--mn-radius-control, 6px);
      box-shadow: var(--mn-focus-ring, 0 0 0 2px rgba(47, 125, 95, 0.4));
      outline: none;
    }

    .agent-model-name,
    .agent-model-option-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .agent-model-caret {
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-2xs, 10px);
      transition: transform 0.12s ease;
    }

    .model-stat.open .agent-model-caret {
      transform: rotate(180deg);
    }

    .agent-model-picker {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      z-index: 30;
      display: grid;
      grid-template-columns: 112px minmax(172px, 1fr);
      width: min(360px, calc(100vw - 40px));
      min-height: 176px;
      max-height: 260px;
      overflow: hidden;
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-surface, 8px);
      background: var(--mn-color-surface-raised, #fff);
      box-shadow: var(--mn-shadow-popover, 0 12px 32px rgba(0, 0, 0, 0.14));
    }

    .agent-model-providers,
    .agent-model-models {
      min-height: 0;
      overflow-y: auto;
      padding: var(--mn-space-1-5, 6px) 0;
    }

    .agent-model-providers {
      border-right: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-surface-sunken, #f8fafc);
    }

    .agent-model-models {
      background: var(--mn-color-surface-base, #fff);
    }

    .agent-model-provider,
    .agent-model-option {
      display: block;
      width: 100%;
      min-height: 34px;
      box-sizing: border-box;
      border: 0;
      background: transparent;
      color: var(--mn-color-text-secondary, #4b5563);
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-text-xs, 12px);
      text-align: left;
    }

    .agent-model-provider {
      padding: 8px var(--mn-space-3, 12px);
    }

    .agent-model-option {
      display: flex;
      align-items: center;
      padding: 8px var(--mn-space-3, 12px);
      color: var(--mn-color-text-primary, #111827);
    }

    .agent-model-provider:hover,
    .agent-model-provider:focus-visible,
    .agent-model-provider.active,
    .agent-model-option:hover,
    .agent-model-option:focus-visible {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
      outline: none;
    }

    .agent-model-provider.selected,
    .agent-model-option.selected {
      color: var(--mn-color-text-accent, var(--mn-color-accent, #586f93));
      font-weight: 750;
    }

    .agent-model-option.selected {
      background: var(--mn-color-interactive-selected, rgba(88, 111, 147, 0.12));
    }

    .editor-card {
      display: grid;
      gap: var(--mn-space-2, 8px);
      padding: var(--mn-space-3, 12px);
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-surface, 8px);
      background: var(--mn-color-surface-raised, #fff);
    }

    .editor-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      min-width: 0;
      gap: var(--mn-space-2, 8px);
    }

    .editor-title {
      color: var(--mn-color-text-primary, #111827);
      font-weight: 750;
    }

    .editor-meta {
      min-width: 0;
      overflow: hidden;
      color: var(--mn-color-text-tertiary, #6b7280);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .text-input {
      width: 100%;
      min-width: 0;
      box-sizing: border-box;
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-primary, #111827);
      font: inherit;
      font-size: var(--mn-text-xs, 12px);
    }

    .text-input {
      min-height: var(--mn-control-height, 32px);
      padding: 0 var(--mn-space-2, 8px);
    }

    .prompt-editor-main {
      position: relative;
      min-width: 0;
      min-height: 320px;
      overflow: hidden;
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-surface, 8px);
      background: var(--mn-color-surface-editor, var(--mn-color-surface-base, #fffdf8));
    }

    .prompt-editor-anchor {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }

    sh-editor-host.prompt-editor-host {
      --editor-x: 0px;
      --editor-y: 0px;
      --editor-w: 100%;
      --editor-h: 100%;
    }

    .context-preview-grid {
      display: grid;
      gap: var(--mn-space-2, 8px);
      grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
    }

    .context-preview-column {
      display: grid;
      min-width: 0;
      gap: var(--mn-space-2, 8px);
    }

    .context-label {
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 750;
      text-transform: uppercase;
    }

    .context-textarea {
      width: 100%;
      min-width: 0;
      box-sizing: border-box;
      padding: var(--mn-space-2, 8px);
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-primary, #111827);
      font: inherit;
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.45;
      resize: vertical;
    }

    .context-textarea.code {
      min-height: 220px;
      font-family: var(--mn-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
      font-size: var(--mn-text-2xs, 11px);
      white-space: pre;
      tab-size: 2;
    }

    .context-textarea.turn {
      min-height: 360px;
    }

    .context-meta-grid {
      display: grid;
      gap: var(--mn-space-1, 4px);
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      color: var(--mn-color-text-tertiary, #6b7280);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
    }

    .text-input:focus {
      border-color: var(--mn-color-border-focus, #2f7d5f);
      box-shadow: var(--mn-focus-ring, 0 0 0 2px rgba(47, 125, 95, 0.4));
      outline: none;
    }

    .form-row {
      display: grid;
      gap: var(--mn-space-2, 8px);
      grid-template-columns: minmax(0, 1fr) auto auto;
      align-items: center;
    }

    .form-actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mn-space-2, 8px);
      align-items: center;
    }

    .button:disabled {
      cursor: not-allowed;
      opacity: 0.56;
    }

    .pane-card-title,
    .bridge-title {
      color: var(--mn-color-text-primary, #111827);
      font-weight: 700;
    }

    .pane-card-meta,
    .bridge-meta {
      color: var(--mn-color-text-tertiary, #6b7280);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
      overflow-wrap: anywhere;
    }

    .pane-card-output,
    .bridge-text {
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.45;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
    }

    .bridge-line {
      width: 100%;
      color: inherit;
      cursor: pointer;
      font: inherit;
      text-align: left;
    }

    .bridge-line.active,
    .bridge-line:hover,
    .bridge-line:focus-visible {
      border-color: var(--mn-color-accent, #586f93);
      background: var(--mn-color-surface-hover, #f3f4f6);
      outline: none;
    }

    .field {
      display: grid;
      gap: 2px;
      padding-block-end: var(--mn-space-2, 8px);
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
    }

    .field-label {
      font-family: var(--mn-font-utility, var(--mn-font-chrome, system-ui, sans-serif));
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .field-value {
      color: var(--mn-color-text-primary, #111827);
      line-height: 1.45;
      white-space: pre-wrap;
    }

    .json-block {
      margin: 0;
      padding: var(--mn-space-3, 12px);
      overflow: auto;
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-surface, 8px);
      background: var(--mn-color-surface-sunken, #f8fafc);
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.45;
      white-space: pre-wrap;
    }

    .empty {
      padding: var(--mn-space-4, 16px);
      color: var(--mn-color-text-tertiary, #6b7280);
      font-style: italic;
    }

    mn-research-run-trace {
      display: block;
    }

    @media (max-width: 760px) {
      .header-actions {
        width: 100%;
        justify-content: space-between;
      }

      .badge {
        min-width: 0;
        flex: 1 1 auto;
      }

      .button-grid {
        grid-template-columns: 1fr;
      }

      .form-row,
      .stat-grid {
        grid-template-columns: 1fr;
      }

      .workflow-hero,
      .workflow-command-row,
      .workflow-metric-strip,
      .workflow-stage-map,
      .workflow-schema-pair,
      .context-preview-grid {
        grid-template-columns: 1fr;
      }

      .workflow-card.wide {
        grid-column: auto;
      }
    }
  `

  @property({ attribute: false }) service: VehicleService | null = null
  @property({ attribute: false }) config: VehicleConfig | null = null

  @state() private agents: readonly VehicleAgentRecord[] = []
  @state() private workflows: readonly VehicleWorkflowRecord[] = []
  @state() private runs: readonly VehicleRunSummary[] = []
  @state() private world: VehicleAgentWorldResponse | null = null
  @state() private vehicleSession: VehicleSession | null = null
  @state() private bridgeProjection: BridgeProjection | null = null
  @state() private events: readonly VehicleAgentSessionEvent[] = []
  @state() private selectedAgentId = ''
  @state() private selectedRunId = ''
  @state() private selectedWorkflowName = ''
  @state() private cursor = -1
  @state() private roomTab: VehicleRoomTab = 'activity'
  @state() private mainPane: MainPaneMode = 'agent'
  @state() private workspaceMode: MnResearchWorkspaceMode = 'source'
  @state() private selectedActivityId = ''
  @state() private selectedBridgeBlockId = ''
  @state() private supplementalStatus = ''
  @state() private status = 'Booting Greenhouse...'
  @state() private error = ''
  @state() private loading = false
  @state() private messageRole = 'user'
  @state() private visibility = 'agent-visible'
  @state() private newConversationObjective = ''
  @state() private systemPromptDraft = ''
  @state() private systemPromptDirty = false
  @state() private promptStatus = ''
  @state() private turnContextPreview: VehicleTurnContextPreview | null = null
  @state() private turnContextPromptDraft = ''
  @state() private turnContextPacketDraft = ''
  @state() private turnContextDirty = false
  @state() private turnContextStatus = ''
  @state() private selectedAgentGraphNodeId = 'agent'
  @state() private selectedWorkflowOntologyNodeId = 'wf:Run'
  @state() private agentModelPickerOpen = false
  @state() private agentModelProvider: string | null = null
  @state() private agentGraphDimension: AgentGraphDimension = '2d'

  private pollTimer: ReturnType<typeof setInterval> | null = null
  private booted = false
  private promptEditorBinding: LocalEditorHostBinding | null = null
  private promptEditorProvider: PromptEditorProvider | null = null
  private promptEditorKey = ''
  private promptSeedToken = 0
  private turnContextPreviewTimer: ReturnType<typeof setTimeout> | null = null

  connectedCallback(): void {
    super.connectedCallback()
    if (!this.config) this.config = readVehicleConfig()
    if (!this.service) this.service = createVehicleService(this.config)
    this.messageRole = this.config.role
    this.start()
  }

  disconnectedCallback(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    this.destroyPromptEditorProvider()
    if (this.turnContextPreviewTimer) {
      clearTimeout(this.turnContextPreviewTimer)
      this.turnContextPreviewTimer = null
    }
    super.disconnectedCallback()
  }

  private start(): void {
    if (this.booted) return
    this.booted = true
    void this.refreshLobby({ openFirst: true })
    const pollMs = Math.max(1000, this.config?.pollMs ?? 5000)
    this.pollTimer = setInterval(() => {
      void this.pollWorld()
    }, pollMs)
  }

  private async refreshLobby(opts: { openFirst?: boolean } = {}): Promise<void> {
    const service = this.requireService()
    this.loading = true
    this.error = ''
    try {
      const [agents, workflows, runs] = await Promise.all([
        service.listAgents(100),
        service.listWorkflows(50),
        service.listRuns(20),
      ])
      this.agents = agents.agents
      this.workflows = workflows.workflows
      this.runs = runs.runs
      this.status = `${service.mode} lobby: ${workflows.count} workflows, ${agents.count} agents, ${runs.count} runs`
      if (opts.openFirst && !this.selectedAgentId && this.agents[0]) {
        await this.openAgent(agentSelector(this.preferredStartupAgent(this.agents)))
      }
    } catch (error) {
      this.setError(error)
    } finally {
      this.loading = false
    }
  }

  private async openAgent(
    agentId: string,
    opts: { pane?: MainPaneMode; selectedRunId?: string; selectedWorkflowName?: string } = {},
  ): Promise<void> {
    if (!agentId) return
    const service = this.requireService()
    this.loading = true
    this.error = ''
    try {
      this.selectedAgentId = agentId
      this.cursor = -1
      this.events = []
      this.selectedActivityId = ''
      this.mainPane = opts.pane ?? 'agent'
      this.workspaceMode = 'source'
      const world = await service.readAgentWorld(agentId)
      this.world = world
      this.syncSystemPromptDraft(true)
      const selectedAgent = this.selectedAgent()
      this.selectedRunId = opts.selectedRunId ?? world.run?.runId ?? stringAt(world.worldDoc.status, ['activeRunId']) ?? ''
      this.selectedWorkflowName =
        opts.selectedWorkflowName ??
        world.run?.workflowName ??
        world.session?.workflowName ??
        workflowName(selectedAgent ?? ({} as VehicleAgentRecord)) ??
        this.selectedWorkflowName
      await this.refreshVehicleSurfaces()
      await this.pollWorld()
      await this.refreshTurnContextPreview(true)
      this.status = `opened ${this.agentHandle()}`
    } catch (error) {
      this.setError(error)
    } finally {
      this.loading = false
    }
  }

  private async openRun(
    runId: string,
    opts: { pane?: MainPaneMode; selectedWorkflowName?: string } = {},
  ): Promise<void> {
    if (!runId) return
    const service = this.requireService()
    this.loading = true
    try {
      this.selectedRunId = runId
      const response = await service.listRunAgents(runId)
      this.selectedWorkflowName = opts.selectedWorkflowName ?? response.run.workflowName ?? this.selectedWorkflowName
      const agentId = response.agents[0]?.agentId ?? response.agents[0]?.label ?? response.agents[0]?.sessionId
      if (agentId) {
        await this.openAgent(agentId, {
          pane: opts.pane ?? 'workflow',
          selectedRunId: runId,
          selectedWorkflowName: this.selectedWorkflowName,
        })
      } else {
        this.mainPane = opts.pane ?? 'workflow'
        this.status = `run ${runId} has no agent sessions`
      }
    } catch (error) {
      this.setError(error)
    } finally {
      this.loading = false
    }
  }

  private async openWorkflow(workflowId: string): Promise<void> {
    if (!workflowId) return
    const entry = this.workflowGrimoire().find((item) => item.workflowId === workflowId || item.label === workflowId)
    this.selectedWorkflowName = workflowId
    this.mainPane = 'workflow'
    this.workspaceMode = 'source'
    const run = entry?.runs.find((item) => item.runId === this.selectedRunId) ?? entry?.runs[0]
    if (run) {
      await this.openRun(run.runId, { pane: 'workflow', selectedWorkflowName: workflowId })
      return
    }
    const agent = entry?.agents[0]
    if (agent) {
      await this.openAgent(agentSelector(agent), { pane: 'workflow', selectedWorkflowName: workflowId })
      return
    }
    this.status = `workflow ${workflowId} has no local agents or runs`
  }

  private async pollWorld(): Promise<void> {
    if (!this.selectedAgentId || !this.service) return
    try {
      const fresh = await this.service.pollAgentWorld(this.selectedAgentId, this.cursor)
      this.world = fresh
      this.syncSystemPromptDraft(false)
      if (fresh.events.length) {
        const seen = new Set(this.events.map((event) => event.seq))
        const next = [...this.events, ...fresh.events.filter((event) => !seen.has(event.seq))]
        this.events = next.sort((a, b) => a.seq - b.seq)
        this.cursor = Math.max(fresh.nextCursor, ...fresh.events.map((event) => event.seq))
        this.selectedActivityId ||= activityItems(this.events).at(-1)?.id ?? ''
        await this.refreshVehicleSurfaces()
        this.status = `received ${fresh.events.length} event(s); cursor=${this.cursor}`
      } else {
        this.cursor = Math.max(this.cursor, fresh.nextCursor)
      }
      this.error = ''
    } catch (error) {
      this.setError(error, 'poll failed')
    }
  }

  private async refreshVehicleSurfaces(): Promise<void> {
    const service = this.requireService()
    const notes: string[] = []
    try {
      this.vehicleSession = await service.readVehicleSession(this.activeSessionId())
    } catch (error) {
      this.vehicleSession = null
      notes.push(error instanceof Error ? error.message : String(error))
    }
    try {
      this.bridgeProjection = await service.readBridgeProjection()
      this.selectedBridgeBlockId ||= this.bridgeProjection.lines[0]?.blockId ?? ''
    } catch (error) {
      this.bridgeProjection = null
      notes.push(error instanceof Error ? error.message : String(error))
    }
    this.supplementalStatus = notes.join(' ')
  }

  private async send(text: string): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed || !this.selectedAgentId) return
    if (trimmed.startsWith('/')) {
      await this.handleCommand(trimmed.slice(1).trim())
      return
    }

    try {
      this.world = await this.requireService().postMessage(this.selectedAgentId, {
        authorId: this.config?.authorId ?? 'vera',
        role: this.messageRole,
        visibility: this.visibility,
        text: trimmed,
      })
      this.status = 'message posted to AgentWorld'
      await this.pollWorld()
    } catch (error) {
      this.setError(error, 'send failed')
    }
  }

  private scheduleTurnContextPreviewRefresh(): void {
    if (this.turnContextPreviewTimer) clearTimeout(this.turnContextPreviewTimer)
    this.turnContextPreviewTimer = setTimeout(() => {
      this.turnContextPreviewTimer = null
      void this.refreshTurnContextPreview(!this.turnContextDirty)
    }, 350)
  }

  private async refreshTurnContextPreview(force = true): Promise<void> {
    if (!this.selectedAgentId || !this.service) return
    if (!force && this.turnContextDirty) return
    const text =
      this.newConversationObjective.trim() ||
      stringAt(this.turnContextPreview?.latestMessage, ['text']) ||
      `Preview the next ${this.agentHandle()} AgentWorld turn.`
    try {
      const response = await this.service.previewTurnContext(this.selectedAgentId, {
        authorId: this.config?.authorId ?? 'vera',
        role: this.messageRole,
        visibility: this.visibility,
        text,
      })
      this.turnContextPreview = response.preview
      this.turnContextPromptDraft = response.preview.turnPrompt
      this.turnContextPacketDraft = JSON.stringify(response.preview.agentVisiblePacket ?? {}, null, 2)
      this.turnContextDirty = false
      this.turnContextStatus = 'Context preview refreshed.'
    } catch (error) {
      this.turnContextStatus = error instanceof Error ? error.message : String(error)
    }
  }

  private currentTurnContextOverride(): VehicleTurnContextOverride | null {
    let packet: unknown
    try {
      packet = this.turnContextPacketDraft.trim() ? JSON.parse(this.turnContextPacketDraft) : {}
    } catch (error) {
      this.turnContextStatus = `Packet JSON is invalid: ${error instanceof Error ? error.message : String(error)}`
      return null
    }
    const text =
      this.newConversationObjective.trim() ||
      stringAt(this.turnContextPreview?.latestMessage, ['text']) ||
      `Preview the next ${this.agentHandle()} AgentWorld turn.`
    const systemPrompt = this.readPromptEditorText().trimEnd() || this.turnContextPreview?.systemPrompt || ''
    return {
      systemPrompt,
      latestMessage: {
        ...asRecord(this.turnContextPreview?.latestMessage),
        authorId: this.config?.authorId ?? 'vera',
        role: this.messageRole,
        visibility: this.visibility,
        text,
      },
      agentVisiblePacket: packet,
      turnPrompt: this.turnContextPromptDraft.trimEnd(),
    }
  }

  private async sendReviewedTurn(): Promise<void> {
    if (!this.selectedAgentId) return
    if (!this.turnContextPreview) {
      await this.refreshTurnContextPreview(true)
    }
    if (!this.turnContextPreview) {
      this.turnContextStatus = 'Context preview unavailable.'
      return
    }
    const contextPreview = this.currentTurnContextOverride()
    if (!contextPreview) return
    const text =
      stringAt(contextPreview.latestMessage, ['text'])?.trim() ||
      this.newConversationObjective.trim() ||
      `Preview the next ${this.agentHandle()} AgentWorld turn.`
    try {
      this.world = await this.requireService().postMessage(this.selectedAgentId, {
        authorId: this.config?.authorId ?? 'vera',
        role: this.messageRole,
        visibility: this.visibility,
        text,
        contextPreview,
      })
      this.turnContextDirty = false
      this.turnContextStatus = 'Reviewed context sent.'
      this.status = 'reviewed AgentWorld turn posted'
      await this.pollWorld()
    } catch (error) {
      this.setError(error, 'reviewed turn failed')
    }
  }

  private async handleCommand(command: string): Promise<void> {
    const normalized = command.toLowerCase()
    if (normalized === 'help') {
      this.status =
        '/agent /chat /activity /cockpit /bridge /world /tools /prompt /schema /comments /debug | /new OBJECTIVE | /comment TEXT | /driver claim|release | /steer TEXT'
      return
    }
    if (normalized === 'refresh') {
      await this.refreshLobby()
      await this.pollWorld()
      this.status = 'refreshed AgentWorld'
      return
    }
    if (normalized === 'agent') {
      this.mainPane = 'agent'
      return
    }
    if (normalized === 'chat') {
      this.mainPane = 'chat'
      return
    }
    const tab = ROOM_TABS.find((item) => item === normalized)
    if (tab) {
      this.roomTab = tab
      this.workspaceMode = 'source'
      return
    }
    if (normalized === 'new' || normalized.startsWith('new ')) {
      await this.startConversation(command.slice(3).trim())
      return
    }
    if (normalized.startsWith('comment ')) {
      await this.postComment(command.slice(8).trim())
      return
    }
    if (normalized === 'driver claim' || normalized === 'claim') {
      await this.claimDriver(false)
      return
    }
    if (normalized === 'driver release' || normalized === 'release') {
      await this.claimDriver(true)
      return
    }
    if (normalized.startsWith('steer ')) {
      await this.steer(command.slice(6).trim())
      return
    }
    this.status = `unknown room command: /${command}`
  }

  private async startConversation(objective: string): Promise<void> {
    const agent = this.agents.find((item) => agentSelector(item) === this.selectedAgentId) ?? this.agents[0]
    if (!agent) return
    const text = objective || `Continue the ${agentDisplayName(agent)} room from a clean conversation.`
    try {
      const run = await this.requireService().startConversation(agent, text)
      this.status = `started run ${run.runId || '-'}`
      this.newConversationObjective = ''
      await this.refreshLobby()
      this.selectedWorkflowName = run.workflowId || workflowName(agent) || this.selectedWorkflowName
      await this.openAgent(agentSelector(agent), {
        selectedRunId: run.runId,
        selectedWorkflowName: this.selectedWorkflowName,
      })
      this.mainPane = 'chat'
    } catch (error) {
      this.setError(error, 'start failed')
    }
  }

  private async startSelectedWorkflow(objective: string): Promise<void> {
    const workflow = this.selectedWorkflow()
    if (!workflow) return
    const agent = workflow.agents.find((item) => agentSelector(item) === this.selectedAgentId) ?? this.selectedAgent() ?? workflow.agents[0] ?? null
    const text = objective || `Run ${workflow.label}.`
    try {
      const run = await this.requireService().startWorkflow(workflow, text, agent)
      this.status = `started workflow run ${run.runId || '-'}`
      this.newConversationObjective = ''
      this.selectedWorkflowName = run.workflowId || workflow.workflowId
      this.selectedRunId = run.runId
      await this.refreshLobby()
      if (agent) {
        await this.openAgent(agentSelector(agent), {
          pane: 'workflow',
          selectedRunId: run.runId,
          selectedWorkflowName: this.selectedWorkflowName,
        })
      }
    } catch (error) {
      this.setError(error, 'workflow start failed')
    }
  }

  private async postComment(text: string): Promise<void> {
    if (!text || !this.selectedAgentId) return
    try {
      this.world = await this.requireService().postComment(this.selectedAgentId, {
        authorId: this.config?.authorId ?? 'vera',
        text,
        visibility: 'human-only',
        kind: 'comment',
      })
      this.status = 'comment posted for collaborators'
      this.roomTab = 'comments'
      await this.pollWorld()
    } catch (error) {
      this.setError(error, 'comment failed')
    }
  }

  private async claimDriver(release: boolean): Promise<void> {
    if (!this.selectedAgentId) return
    try {
      const control = await this.requireService().claimDriver(
        this.selectedAgentId,
        this.config?.clientId ?? 'vehicle-web',
        release,
      )
      this.status = control.applied
        ? release
          ? 'driver lease released'
          : `driver lease claimed by ${this.config?.clientId ?? 'vehicle-web'}`
        : control.reason || 'driver change was not applied'
      await this.pollWorld()
    } catch (error) {
      this.setError(error, 'driver command failed')
    }
  }

  private async steer(text: string): Promise<void> {
    if (!text || !this.selectedAgentId) return
    try {
      const control = await this.requireService().steer(
        this.selectedAgentId,
        this.config?.clientId ?? 'vehicle-web',
        text,
      )
      this.status = control.applied ? 'steering command queued' : control.reason || 'steering was not applied'
      await this.pollWorld()
    } catch (error) {
      this.setError(error, 'steer failed')
    }
  }

  private async submitCockpitInput(text: string): Promise<void> {
    try {
      this.vehicleSession = await this.requireService().submitCockpitInput(
        this.config?.clientId ?? 'vehicle-web',
        text,
        this.activeSessionId(),
      )
      this.status = 'cockpit input submitted through Greenhouse control-plane model'
      await this.pollWorld()
    } catch (error) {
      this.setError(error, 'cockpit failed')
    }
  }

  private async applyBridgeOperation(operation: BridgeOperation): Promise<void> {
    try {
      this.bridgeProjection = await this.requireService().applyBridgeOperation(operation)
      this.selectedBridgeBlockId =
        'blockId' in operation && typeof operation.blockId === 'string'
          ? operation.blockId
          : this.bridgeProjection.lines[0]?.blockId ?? ''
      this.status = `bridge operation applied: ${operation.type}`
      await this.pollWorld()
    } catch (error) {
      this.setError(error, 'bridge failed')
    }
  }

  private async saveSystemPrompt(): Promise<void> {
    if (!this.selectedAgentId) return
    const text = this.readPromptEditorText().trimEnd()
    this.systemPromptDraft = text
    if (!text.trim()) {
      this.promptStatus = 'System prompt cannot be empty.'
      return
    }
    try {
      this.world = await this.requireService().saveSystemPrompt(this.selectedAgentId, {
        authorId: this.config?.authorId ?? 'vera',
        title: stringAt(this.world?.worldDoc.prompts, ['system', 'title']) ?? 'System prompt',
        text,
      })
      this.syncSystemPromptDraft(true)
      this.promptStatus = 'System prompt saved.'
      this.status = 'system prompt saved'
      await this.pollWorld()
      await this.refreshTurnContextPreview(true)
    } catch (error) {
      this.promptStatus = error instanceof Error ? error.message : String(error)
      this.setError(error, 'prompt save failed')
    }
  }

  private async promoteSystemPrompt(): Promise<void> {
    if (!this.selectedAgentId) return
    try {
      this.world = await this.requireService().promoteSystemPrompt(this.selectedAgentId, this.graphId())
      this.syncSystemPromptDraft(true)
      this.promptStatus = 'System prompt promoted.'
      this.status = 'system prompt promoted'
      await this.pollWorld()
      await this.refreshTurnContextPreview(true)
    } catch (error) {
      this.promptStatus = error instanceof Error ? error.message : String(error)
      this.setError(error, 'prompt promote failed')
    }
  }

  private requireService(): VehicleService {
    if (!this.service) throw new Error('Greenhouse service was not configured')
    return this.service
  }

  private setError(error: unknown, prefix = 'error'): void {
    const message = error instanceof Error ? error.message : String(error)
    this.error = `${prefix}: ${message}`
    this.status = this.error
  }

  private onSidebarNode(event: CustomEvent<MnSidebarNodeDetail>): void {
    const id = event.detail.id
    if (id.startsWith('workflow-run:')) {
      const child = workflowChildFromNodeId('workflow-run:', id)
      void this.openRun(child.target, { pane: 'workflow', selectedWorkflowName: child.workflow })
    } else if (id.startsWith('workflow-agent:')) {
      const child = workflowChildFromNodeId('workflow-agent:', id)
      void this.openAgent(child.target, { pane: 'workflow', selectedWorkflowName: child.workflow })
    } else if (id.startsWith('workflow:')) {
      void this.openWorkflow(workflowNameFromNodeId(id))
    } else if (id.startsWith('agent:')) {
      void this.openAgent(id.slice('agent:'.length))
    } else if (id.startsWith('run:')) {
      void this.openRun(id.slice('run:'.length), { pane: 'workflow' })
    }
  }

  private onWorkspaceMode(event: CustomEvent<MnResearchWorkspaceModeDetail>): void {
    this.workspaceMode = event.detail.mode
  }

  private onComposerControlChange(detail: ChatComposerControlChangeDetail): void {
    const id = detail.controlId as ComposerControlId
    if (id === 'role') this.messageRole = detail.value
    if (id === 'visibility') this.visibility = detail.value
  }

  private onPromptOptionUse(detail: ChatPromptOptionUseDetail): void {
    this.status = `staged: ${detail.option.label}`
  }

  private onPromptSubmit(detail: ChatPromptSubmitDetail): void {
    this.status = detail.summary ? `prompt captured: ${detail.summary}` : `prompt ${detail.promptId} captured`
  }

  private agentHandle(): string {
    return (
        stringAt(this.world?.worldDoc.agent, ['handle']) ??
        stringAt(this.world?.agent, ['handle']) ??
        (this.selectedAgentId || 'agent')
    )
  }

  private graphId(): string {
    return (
      stringAt(this.world?.worldDoc.status, ['graphId']) ??
      stringAt(this.world?.worldDoc.agent, ['graphId']) ??
      this.world?.session?.graphId ??
      this.world?.run?.graphId ??
      '-'
    )
  }

  private driver(): string {
    return driverLabel(valueAt(this.world?.worldDoc.control, ['driverLease'])) ?? '-'
  }

  private selectedAgent(): VehicleAgentRecord | null {
    return this.agents.find((item) => agentSelector(item) === this.selectedAgentId) ?? this.agents[0] ?? null
  }

  private systemPromptRecord(): JsonRecord {
    return asRecord(valueAt(this.world?.worldDoc.prompts, ['system']))
  }

  private systemPromptText(): string {
    return stringAt(this.systemPromptRecord(), ['text']) ?? ''
  }

  private syncSystemPromptDraft(force: boolean): void {
    if (!force && this.systemPromptDirty) return
    const text = this.systemPromptText()
    this.systemPromptDraft = text
    this.systemPromptDirty = false
    this.syncPromptEditor(force, text)
  }

  private destroyPromptEditorProvider(): void {
    this.promptEditorProvider?.destroy()
    this.promptEditorProvider = null
    this.promptEditorBinding = null
    this.promptEditorKey = ''
  }

  private syncPromptEditor(force: boolean, text: string): void {
    const key = `${this.selectedAgentId}:${stringAt(this.systemPromptRecord(), ['digest']) ?? hashText(text)}`
    if (!force && this.promptEditorBinding && this.promptEditorKey === key) return
    this.promptEditorProvider?.destroy()
    const provider = createPromptEditorProvider()
    const graphId = this.graphId() === '-' ? 'agent-world' : this.graphId()
    const documentId = `system-prompt:${this.selectedAgentId || 'agent'}`
    const state: EditorHostState = {
      centerMode: 'document',
      graphId,
      documentId,
      status: 'ready',
      error: null,
      provider,
    }
    this.promptEditorProvider = provider
    this.promptEditorBinding = new LocalEditorHostBinding(state)
    this.promptEditorKey = key
    void this.seedPromptEditor(text)
  }

  private promptEditorHost(): ShEditorHost | null {
    return this.renderRoot.querySelector<ShEditorHost>('sh-editor-host.prompt-editor-host')
  }

  private async seedPromptEditor(text: string): Promise<void> {
    const token = ++this.promptSeedToken
    await this.updateComplete
    for (let i = 0; i < 24; i += 1) {
      if (token !== this.promptSeedToken) return
      const host = this.promptEditorHost()
      const editor = host?.liveEditor
      if (editor) {
        editor.restoreHtml(promptTextToHtml(text))
        this.systemPromptDraft = editor.getText() || text
        this.systemPromptDirty = false
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 16))
    }
  }

  private readPromptEditorText(): string {
    return this.promptEditorHost()?.liveEditor?.getText() ?? this.systemPromptDraft
  }

  private onPromptEditorChange(): void {
    window.setTimeout(() => {
      const text = this.readPromptEditorText()
      this.systemPromptDraft = text
      this.systemPromptDirty = text !== this.systemPromptText()
      this.promptStatus = this.systemPromptDirty ? 'Unsaved changes' : ''
    }, 0)
  }

  private agentInitials(): string {
    const label = this.agentHandle()
    const parts = label.split(/[-_\s]+/).filter(Boolean)
    const chars = parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : label.slice(0, 2)
    return chars || 'AG'
  }

  private workspaceSubtitle(): string {
    return [this.agentHandle(), this.graphId()].filter((item) => item && item !== '-').join(' · ') || 'AgentWorld'
  }

  private connectionLabel(): string {
    if (this.service?.mode === 'fetch') return 'live stack'
    if (this.service?.mode === 'fixture') return 'fixture'
    return 'booting'
  }

  private connectionDetail(): string {
    if (this.service?.mode === 'fetch') {
      return `Live local stack via ${this.service.baseUrl}. AgentWorld, runs, and cockpit session are Choreograph-backed; bridge editing remains local until a document bridge endpoint lands.`
    }
    if (this.service?.mode === 'fixture') {
      return 'Fixture data: AgentWorld, cockpit session, bridge document, and room mutations are local in-memory data.'
    }
    return 'Greenhouse is binding its AgentWorld service.'
  }

  private activeSessionId(): string | null {
    if (this.vehicleSession?.sessionId) return this.vehicleSession.sessionId
    if (this.world?.session?.sessionId) return this.world.session.sessionId
    const agent = this.agents.find((item) => agentSelector(item) === this.selectedAgentId)
    return agent?.activeSessionId ?? null
  }

  private preferredStartupAgent(agents: readonly VehicleAgentRecord[]): VehicleAgentRecord {
    return (
      agents.find((agent) => {
        const terms = [agent.agentId, agent.handle, agent.agentType, agent.workflowName, agent.agentUri]
          .filter((value): value is string => !!value)
          .map((value) => value.toLowerCase())
        return terms.some((value) => value === 'learner-1' || value.includes('learner-1'))
      }) ??
      agents[0]
    )
  }

  private currentModel(): string {
    const agent = this.selectedAgent()
    return firstNonBlank(
      agent ? modelFromRecord(asRecord(agent)) : null,
      modelFromRecord(asRecord(this.world?.agent)),
      modelFromRecord(this.world?.worldDoc.status),
      modelFromRecord(this.world?.worldDoc.agent),
      modelFromRecord(asRecord(valueAt(this.world?.worldDoc.prompts, ['system', 'binding']))),
      knownAgentModel([
        agent?.handle,
        agent?.workflowName,
        agent?.agentId,
        this.world?.session?.workflowName,
        this.world?.session?.label,
        this.vehicleSession?.workflowName,
        this.vehicleSession?.agentLabel,
      ]),
      modelFromRecord(asRecord(this.world?.session ?? {})),
      this.vehicleSession?.model,
      'gpt-5',
    ) ?? 'gpt-5'
  }

  private runtimeModel(): string | null {
    return firstNonBlank(
      this.vehicleSession?.model,
      modelFromRecord(asRecord(this.world?.session ?? {})),
      modelFromRecord(asRecord(valueAt(this.world?.session, ['result']))),
    )
  }

  private modelForAgent(agent: VehicleAgentRecord | null | undefined): string | null {
    return firstNonBlank(
      agent ? modelFromRecord(asRecord(agent)) : null,
      agent && agentSelector(agent) === this.selectedAgentId ? this.currentModel() : null,
      knownAgentModel([agent?.handle, agent?.workflowName, agent?.agentId]),
    )
  }

  private modelOptions(): readonly { readonly id: string; readonly label: string }[] {
    const ids = [this.currentModel(), 'deepseek-v4-pro', 'deepseek-v4-flash', 'gpt-5', 'claude-sonnet']
    return Array.from(new Set(ids.filter(Boolean))).map((id) => ({
      id,
      label: modelLabel(id),
    }))
  }

  private agentModelOptions(): readonly AgentModelOption[] {
    return this.modelOptions().map((model) => ({
      ...model,
      provider: modelProvider(model.id),
    }))
  }

  private agentModelGroups(): readonly AgentModelGroup[] {
    const grouped = new Map<string, AgentModelOption[]>()
    for (const model of this.agentModelOptions()) {
      const list = grouped.get(model.provider) ?? []
      list.push(model)
      grouped.set(model.provider, list)
    }
    return [...grouped.entries()]
      .sort(([left], [right]) => providerRank(left) - providerRank(right))
      .map(([provider, models]) => ({
        provider,
        models: models.slice().sort((left, right) => left.label.localeCompare(right.label)),
      }))
  }

  private activeAgentModelProvider(groups = this.agentModelGroups()): string | null {
    if (this.agentModelProvider && groups.some((group) => group.provider === this.agentModelProvider)) {
      return this.agentModelProvider
    }
    return groups.find((group) => group.models.some((model) => model.id === this.currentModel()))?.provider ?? groups[0]?.provider ?? null
  }

  private toggleAgentModelPicker(): void {
    const groups = this.agentModelGroups()
    this.agentModelProvider = this.activeAgentModelProvider(groups)
    this.agentModelPickerOpen = !this.agentModelPickerOpen
  }

  private async changeAgentModel(modelId: string): Promise<void> {
    if (!this.selectedAgentId || !modelId || modelId === this.currentModel()) {
      this.agentModelPickerOpen = false
      return
    }
    this.loading = true
    this.error = ''
    try {
      this.world = await this.requireService().setAgentModel(this.selectedAgentId, {
        authorId: this.config?.authorId ?? 'vera',
        model: modelId,
        provider: modelProvider(modelId).toLowerCase(),
      })
      this.agents = this.agents.map((agent) =>
        agentSelector(agent) === this.selectedAgentId
          ? { ...agent, model: modelId, provider: modelProvider(modelId).toLowerCase(), updatedAt: Date.now() }
          : agent,
      )
      this.agentModelPickerOpen = false
      this.status = `agent model changed to ${modelLabel(modelId)}`
      await this.pollWorld()
    } catch (error) {
      this.setError(error)
    } finally {
      this.loading = false
    }
  }

  private provenanceLabel(): string {
    if (this.service?.mode === 'fetch') {
      return 'Live Choreograph data. Bridge edits are local.'
    }
    return 'Fixture data: local room, cockpit, bridge, and mutations.'
  }

  private currentWorkflowName(): string {
    return (
      this.selectedWorkflowName ||
      this.world?.run?.workflowName ||
      this.world?.session?.workflowName ||
      workflowName(this.selectedAgent() ?? ({} as VehicleAgentRecord)) ||
      ''
    )
  }

  private workflowGrimoire(): readonly WorkflowGrimoireEntry[] {
    return this.workflows
      .map((workflow) => {
        const runs = this.runs
          .filter((run) => workflow.runIds.includes(run.runId) || run.workflowName === workflow.workflowId || run.workflowName === workflow.label)
          .sort((a, b) => (b.updatedAt ?? b.startedAt ?? 0) - (a.updatedAt ?? a.startedAt ?? 0))
        const agents = this.agents
          .filter((agent) => workflow.agentIds.includes(agentSelector(agent)) || workflowName(agent) === workflow.workflowId || workflowName(agent) === workflow.label)
          .sort((a, b) => agentDisplayName(a).localeCompare(agentDisplayName(b)))
        return { ...workflow, runs, agents }
      })
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.label.localeCompare(b.label))
  }

  private selectedWorkflow(): WorkflowGrimoireEntry | null {
    const selected = this.currentWorkflowName()
    return (
      this.workflowGrimoire().find((workflow) => workflow.workflowId === selected || workflow.label === selected) ??
      this.workflowGrimoire()[0] ??
      null
    )
  }

  private sidebarSelectedId(): string | null {
    if (this.mainPane === 'workflow' && this.currentWorkflowName()) return workflowNodeId(this.currentWorkflowName())
    if (this.selectedAgentId) return `agent:${this.selectedAgentId}`
    if (this.selectedRunId) return `run:${this.selectedRunId}`
    return null
  }

  private sidebarSections(): readonly MnSidebarSection[] {
    const selectedWorkflow = this.currentWorkflowName()
    const workflowNodes: MnSidebarNode[] = this.workflowGrimoire().map((entry) => {
      const selected = selectedWorkflow === entry.workflowId || selectedWorkflow === entry.label
      const childAgents: MnSidebarNode[] = entry.agents.map((agent) => ({
        id: workflowChildNodeId('workflow-agent:', entry.workflowId, agentSelector(agent)),
        label: `agent: ${agentDisplayName(agent)}`,
        kind: 'document',
        icon: 'bot',
        badge: this.modelForAgent(agent) || null,
        selected: selected && agentSelector(agent) === this.selectedAgentId,
        active: selected && agentSelector(agent) === this.selectedAgentId,
        status: [agent.lifecycle || agent.status, agent.graphId].filter(Boolean).join(' · '),
      }))
      const childRuns: MnSidebarNode[] = entry.runs.map((run) => ({
        id: workflowChildNodeId('workflow-run:', entry.workflowId, run.runId),
        label: `run: ${run.runId}`,
        kind: 'artifact',
        icon: 'network',
        badge: run.status || null,
        selected: selected && run.runId === this.selectedRunId,
        active: selected && run.runId === this.selectedRunId,
        status: [run.graphId, run.agentCount ? `${run.agentCount} agents` : null].filter(Boolean).join(' · '),
        count: run.totalTokens ?? null,
      }))
      return {
        id: workflowNodeId(entry.workflowId),
        label: entry.label,
        kind: 'folder',
        icon: 'book-open',
        badge: entry.status,
        selected,
        active: selected,
        expanded: selected,
        status: `${entry.runCount} run${entry.runCount === 1 ? '' : 's'} · ${entry.agentCount} agent${entry.agentCount === 1 ? '' : 's'} · ${entry.sourceKind}/${entry.identityKind}`,
        count: entry.runs.length || null,
        children: [...childAgents, ...childRuns],
      }
    })
    return [
      {
        id: 'workflow-grimoire',
        label: 'Workflow Grimoire',
        icon: 'book-open',
        count: workflowNodes.length,
        emptyLabel: 'No workflows',
        nodes: workflowNodes,
      },
      {
        id: 'agents',
        label: 'Agents',
        icon: 'bot',
        count: this.agents.length,
        nodes: this.agents.map((agent) => ({
          id: `agent:${agentSelector(agent)}`,
          label: agentDisplayName(agent),
          kind: 'document',
          icon: 'bot',
          badge: agent.lifecycle || agent.status || null,
          selected: agentSelector(agent) === this.selectedAgentId,
          active: agentSelector(agent) === this.selectedAgentId,
          status: [this.modelForAgent(agent), agent.graphId].filter(Boolean).join(' · '),
        })),
      },
      {
        id: 'runs',
        label: 'Runs',
        icon: 'network',
        count: this.runs.length,
        nodes: this.runs.map((run) => ({
          id: `run:${run.runId}`,
          label: run.workflowName || run.runId,
          kind: 'artifact',
          icon: 'network',
          badge: run.status || null,
          selected: run.runId === this.selectedRunId,
          active: run.runId === this.selectedRunId,
          status: `${run.runId} · ${run.graphId}`,
          count: run.totalTokens ?? null,
        })),
      },
    ]
  }

  private composerControls(): readonly ChatComposerControl[] {
    return [
      {
        id: 'role',
        label: 'Role',
        value: this.messageRole,
        options: [
          { id: 'user', label: 'User' },
          { id: 'codex', label: 'Codex' },
          { id: 'system', label: 'System' },
        ],
      },
      {
        id: 'visibility',
        label: 'Visibility',
        value: this.visibility,
        options: [
          { id: 'agent-visible', label: 'Agent' },
          { id: 'human-only', label: 'Human' },
        ],
      },
    ]
  }

  private chatMessages(): ChatMessage[] {
    return projectVehicleChatMessages(this.world, this.events, {
      authorId: this.config?.authorId ?? 'vera',
    })
  }

  private traceSteps(): readonly MnResearchRunStep[] {
    return activityItems(this.events).map((item) => ({
      id: item.id,
      label: `${item.label}: ${item.title}`,
      status: item.status,
      description: item.detail,
      tool: item.event.type,
      meta: `seq ${item.seq}`,
    }))
  }

  private selectedActivity(): VehicleActivityItem | null {
    const items = activityItems(this.events)
    return items.find((item) => item.id === this.selectedActivityId) ?? items.at(-1) ?? null
  }

  private agentJournalItems(): VehicleActivityItem[] {
    return agentJournalItems({
      world: this.world,
      agent: this.selectedAgent(),
      events: this.events,
    })
  }

  override render(): TemplateResult {
    const subtitle = this.workspaceSubtitle()
    const messages = this.chatMessages()
    const streaming = messages.some((message) => message.isStreaming)
    return html`
      <mn-research-workspace
        title="Greenhouse"
        subtitle=${subtitle}
        sourceLabel="Workspace"
        workflowLabel="Trace"
        .mode=${this.workspaceMode}
        @mn-research-workspace-mode-change=${this.onWorkspaceMode}
      >
        <div slot="header-actions" class="header-actions">
          <span class="badge connection" title=${this.connectionDetail()}>${this.connectionLabel()} · driver ${this.driver()}</span>
          <button
            class=${classMap({ button: true, active: this.mainPane === 'agent' })}
            type="button"
            aria-pressed=${this.mainPane === 'agent' ? 'true' : 'false'}
            @click=${() => (this.mainPane = 'agent')}
          >
            Agent
          </button>
          <button
            class=${classMap({ button: true, active: this.mainPane === 'workflow' })}
            type="button"
            aria-pressed=${this.mainPane === 'workflow' ? 'true' : 'false'}
            @click=${() => (this.mainPane = 'workflow')}
          >
            Workflow
          </button>
          <button
            class=${classMap({ button: true, active: this.mainPane === 'chat' })}
            type="button"
            aria-pressed=${this.mainPane === 'chat' ? 'true' : 'false'}
            @click=${() => (this.mainPane = 'chat')}
          >
            Chat
          </button>
          <button class="button" type="button" @click=${() => this.refreshLobby()}>Refresh</button>
        </div>
        <div slot="sidebar" class="sidebar-wrap">
          <mn-sidebar-panel
            .sections=${this.sidebarSections()}
            .selectedId=${this.sidebarSelectedId()}
            searchPlaceholder="Find"
            @mn-sidebar-node-open=${this.onSidebarNode}
          ></mn-sidebar-panel>
          <div class="lobby-footer">
            <div class=${classMap({ status: true, error: !!this.error })}>
              ${this.loading ? 'Loading... ' : ''}${this.error || this.status}
            </div>
            <div class="provenance">${this.provenanceLabel()}</div>
            <div class="button-grid">
              <button class="button primary" type="button" @click=${() => this.claimDriver(false)}>Claim</button>
              <button class="button" type="button" @click=${() => this.claimDriver(true)}>Release</button>
            </div>
          </div>
        </div>
        <div slot="chat" class="chat-wrap">${this.renderMainPane(messages, streaming)}</div>
        <div slot="source" class="detail-wrap">
          ${this.mainPane === 'agent'
            ? this.renderAgentGraphPane()
            : this.mainPane === 'workflow'
              ? this.renderWorkflowOntologyPane()
              : this.renderRoomPane()}
        </div>
        <div slot="workflow" class="detail-wrap">${this.renderWorkflowPane()}</div>
        <div slot="trace">
          ${this.mainPane === 'agent'
            ? this.renderAgentJournal()
            : this.mainPane === 'workflow'
              ? this.renderWorkflowJournal()
              : this.renderTrace()}
        </div>
      </mn-research-workspace>
    `
  }

  private renderTrace(): TemplateResult {
    return html`
      <mn-research-run-trace
        title="AgentWorld events"
        .steps=${this.traceSteps()}
        .activeId=${this.selectedActivityId}
        @mn-research-step-open=${(event: CustomEvent<{ stepId: string }>) => {
          this.selectedActivityId = event.detail.stepId
          this.roomTab = 'activity'
          this.workspaceMode = 'source'
        }}
      ></mn-research-run-trace>
    `
  }

  private agentGraph(): { nodes: MnGraphNode[]; edges: MnGraphEdge[] } {
    const prompt = this.systemPromptRecord()
    const toolbelt = this.world?.worldDoc.toolbelt ?? {}
    const toolCount = arrayAt<JsonRecord>(toolbelt, ['tools']).length
    const messageCount = conversationMessages(this.world).length
    const eventCount = this.events.length
    const runId = this.world?.run?.runId ?? stringAt(this.world?.worldDoc.status, ['activeRunId']) ?? 'run'
    const sessionId = this.activeSessionId() ?? 'session'
    const model = this.currentModel()
    const nodes: MnGraphNode[] = [
      { id: 'agent', label: 'Agent', note: `${this.agentHandle()} · ${model}` },
      { id: 'model', label: model, note: 'LLM model' },
      { id: 'prompt', label: 'Prompt', note: stringAt(prompt, ['digest']) ?? 'system prompt' },
      { id: 'graph', label: 'Graph', note: this.graphId() },
      { id: 'run', label: 'Run', note: runId },
      { id: 'session', label: 'Session', note: sessionId },
      { id: 'tools', label: 'Tools', note: `${toolCount} declared` },
      { id: 'conversation', label: 'Conversation', note: `${messageCount} messages` },
      { id: 'driver', label: 'Driver', note: this.driver() },
      { id: 'journal', label: 'Journal', note: `${eventCount} events` },
    ]
    const edges: MnGraphEdge[] = [
      { from: 'agent', to: 'model', predicate: 'uses', kind: 'predicate' },
      { from: 'agent', to: 'prompt', predicate: 'runs with', kind: 'predicate' },
      { from: 'agent', to: 'graph', predicate: 'works in', kind: 'predicate' },
      { from: 'agent', to: 'run', predicate: 'active run', kind: 'predicate' },
      { from: 'run', to: 'session', predicate: 'session', kind: 'predicate' },
      { from: 'agent', to: 'tools', predicate: 'mounts', kind: 'wire' },
      { from: 'agent', to: 'conversation', predicate: 'speaks in', kind: 'wire' },
      { from: 'driver', to: 'agent', predicate: 'steers', kind: 'wire' },
      { from: 'agent', to: 'journal', predicate: 'emits', kind: 'wire' },
    ]
    return { nodes, edges }
  }

  private workflowOntology() {
    const workflow = this.selectedWorkflow()
    if (!this.world) return this.mergeWorkflowDefinitionOntology(projectWorkflowOntology(null, this.selectedAgent()), workflow)
    const selectedRun =
      workflow?.runs.find((run) => run.runId === this.selectedRunId) ??
      this.runs.find((run) => run.runId === this.selectedRunId)
    const ontology = asRecord(this.world.worldDoc.ontology)
    const activeSessionUri = stringAt(ontology, ['activeSessionUri'])
    const projected = projectWorkflowOntology(
      {
        ...this.world,
        run: selectedRun ?? this.world.run,
        worldDoc: {
          ...this.world.worldDoc,
          status: {
            ...this.world.worldDoc.status,
            activeRunId: selectedRun?.runId ?? this.world.run?.runId ?? stringAt(this.world.worldDoc.status, ['activeRunId']),
          },
          runtime: {
            ...this.world.worldDoc.runtime,
            workflowName: workflow?.workflowId ?? stringAt(this.world.worldDoc.runtime, ['workflowName']),
          },
          ontology: {
            ...this.world.worldDoc.ontology,
            activeRunUri: selectedRun
              ? activeSessionUri
                ? `${activeSessionUri}:run:${selectedRun.runId}`
                : stringAt(ontology, ['activeRunUri'])
              : stringAt(ontology, ['activeRunUri']),
            workflowDefinition: workflow
              ? {
                  workflowId: workflow.workflowId,
                  definitionSubject: workflow.definitionSubject,
                  sourceKind: workflow.sourceKind,
                  identityKind: workflow.identityKind,
                }
              : valueAt(ontology, ['workflowDefinition']),
          },
        },
      },
      this.selectedAgent(),
    )
    return this.mergeWorkflowDefinitionOntology(projected, workflow)
  }

  private mergeWorkflowDefinitionOntology(base: ReturnType<typeof projectWorkflowOntology>, workflow: WorkflowGrimoireEntry | null) {
    if (!workflow) return base
    const nodes = [...base.nodes]
    const edges = [...base.edges]
    const facts = [
      { label: 'definition', value: workflow.definitionSubject },
      { label: 'source kind', value: workflow.sourceKind },
      { label: 'identity kind', value: workflow.identityKind },
      { label: 'draft', value: workflow.draft?.runnable ? 'runnable' : 'incomplete', tone: workflow.draft?.runnable ? 'good' : 'warning' },
      { label: 'binding', value: workflow.binding?.workflowName ?? 'unbound', tone: workflow.binding ? 'good' : 'warning' },
      ...base.facts,
    ] as const
    const upsertNode = (node: (typeof nodes)[number]): void => {
      const index = nodes.findIndex((item) => item.id === node.id)
      if (index >= 0) nodes[index] = { ...nodes[index], ...node }
      else nodes.push(node)
    }
    const addEdge = (edge: (typeof edges)[number]): void => {
      if (!edges.some((item) => item.from === edge.from && item.to === edge.to && item.predicate === edge.predicate)) {
        edges.push(edge)
      }
    }

    upsertNode({
      id: 'wf:Workflow',
      label: 'wf:Workflow',
      note: workflow.label,
      className: 'wf:Workflow',
      evidence: {
        workflowId: workflow.workflowId,
        definitionSubject: workflow.definitionSubject,
        description: workflow.description,
        whenToUse: workflow.whenToUse,
        sourceKind: workflow.sourceKind,
        identityKind: workflow.identityKind,
      },
    })
    upsertNode({
      id: 'wf:Phase',
      label: 'wf:Phase',
      note: `${workflow.phaseCount ?? 0} phase(s)`,
      className: 'wf:Phase',
      evidence: { phaseCount: workflow.phaseCount ?? 0, requiredBy: 'wf:Workflow' },
    })
    upsertNode({
      id: 'wf:AgentNode',
      label: 'wf:AgentNode',
      note: `${workflow.agentNodeCount ?? 0} node(s)`,
      className: 'wf:AgentNode',
      evidence: { agentNodeCount: workflow.agentNodeCount ?? 0 },
    })
    upsertNode({
      id: 'wf:WorkflowBinding',
      label: 'Workflow Binding',
      note: workflow.binding?.workflowName ?? 'unbound',
      className: 'wf:WorkflowBinding',
      evidence: workflow.binding ?? { missing: true },
    })
    upsertNode({
      id: 'wf:Draft',
      label: 'wf:Draft',
      note: workflow.draft?.runnable ? 'runnable' : `${workflow.draft?.gaps.length ?? 0} gap(s)`,
      className: 'wf:Draft',
      evidence: workflow.draft ?? { runnable: true },
    })
    upsertNode({
      id: 'wf:RunStatistics',
      label: 'Run Statistics',
      note: `${workflow.runStatistics?.runCount ?? workflow.runCount} run(s)`,
      className: 'wf:RunStatistics',
      evidence: workflow.runStatistics ?? { runCount: workflow.runCount },
    })
    if (workflow.archetypeUris.length) {
      upsertNode({
        id: 'wf:Archetype',
        label: 'wf:Archetype',
        note: workflow.archetypeUris.join(', '),
        className: 'wf:Archetype',
        evidence: { seededFrom: workflow.archetypeUris },
      })
      addEdge({ from: 'wf:Workflow', to: 'wf:Archetype', predicate: 'wf:seededFrom', kind: 'predicate' })
    }
    if (workflow.draft?.gaps.length) {
      upsertNode({
        id: 'wf:CompletenessGap',
        label: 'Completeness Gap',
        note: `${workflow.draft.gaps.filter((gap) => gap.gapBlocking).length} blocking`,
        className: 'wf:CompletenessGap',
        evidence: { gaps: workflow.draft.gaps },
      })
      addEdge({ from: 'wf:Draft', to: 'wf:CompletenessGap', predicate: 'wf:hasCompletenessGap', kind: 'predicate' })
    }
    addEdge({ from: 'wf:Workflow', to: 'wf:Phase', predicate: 'wf:phase', kind: 'predicate' })
    addEdge({ from: 'wf:Phase', to: 'wf:AgentNode', predicate: 'wf:agentNode', kind: 'predicate' })
    addEdge({ from: 'wf:Workflow', to: 'wf:WorkflowBinding', predicate: 'wf:binding', kind: 'predicate' })
    addEdge({ from: 'wf:Workflow', to: 'wf:Draft', predicate: 'wf:derivedDraft', kind: 'wire' })
    addEdge({ from: 'wf:Workflow', to: 'wf:RunStatistics', predicate: 'wf:runStatistics', kind: 'wire' })
    return { ...base, nodes, edges, facts }
  }

  private renderAgentGraphPane(): TemplateResult {
    const graph = this.agentGraph()
    const selected = graph.nodes.find((node) => node.id === this.selectedAgentGraphNodeId) ?? graph.nodes[0]
    return html`
      <section class="agent-graph-pane" aria-label="Agent graph">
        <header class="graph-head">
          <span class="graph-head-main">
            <span class="graph-title">Agent Network</span>
            <span class="graph-meta">${graph.nodes.length} nodes · click a node for info</span>
          </span>
          <span class="graph-mode-toggle" role="group" aria-label="Network dimension">
            ${(['2d', '3d'] as const).map(
              (mode) => html`
                <button
                  class=${classMap({ 'graph-mode-button': true, active: this.agentGraphDimension === mode })}
                  type="button"
                  aria-pressed=${this.agentGraphDimension === mode ? 'true' : 'false'}
                  @click=${() => (this.agentGraphDimension = mode)}
                >
                  ${mode.toUpperCase()}
                </button>
              `,
            )}
          </span>
        </header>
        <div class="graph-canvas">
          <mn-graph-three
            .nodes=${graph.nodes}
            .edges=${graph.edges}
            .dimension=${this.agentGraphDimension}
            interactive
            fullscreenable
            hint=${`Agent network ${this.agentGraphDimension.toUpperCase()}`}
            @mn-graph-node-select=${(event: CustomEvent<MnGraphNode>) => {
              this.selectedAgentGraphNodeId = event.detail.id
            }}
          ></mn-graph-three>
        </div>
        <div class="graph-info">
          ${this.renderAgentGraphModelSummary()}
          ${selected ? this.renderAgentGraphNodeInfo(selected.id) : html`<div class="empty">Select a node.</div>`}
        </div>
      </section>
    `
  }

  private renderAgentGraphModelSummary(): TemplateResult {
    const model = this.currentModel()
    return html`
      <div class="graph-info-model" aria-label="Current agent model">
        <span class="graph-info-model-label">Current Model</span>
        <span class="graph-info-model-value">${modelLabel(model)}</span>
        <span class="graph-info-model-id">${model}</span>
      </div>
    `
  }

  private renderAgentGraphNodeInfo(nodeId: string): TemplateResult {
    const prompt = this.systemPromptRecord()
    const tools = arrayAt<JsonRecord>(this.world?.worldDoc.toolbelt, ['tools'])
    const messages = conversationMessages(this.world)
    const latestMessage = messages.at(-1)
    switch (nodeId) {
      case 'agent':
        return this.renderFields([
          ['node', 'Agent'],
          ['handle', this.agentHandle()],
          ['model', this.currentModel()],
          ['lifecycle', stringAt(this.world?.worldDoc.status, ['lifecycle'])],
          ['runtime', stringAt(this.world?.worldDoc.status, ['runtimeStatus'])],
        ])
      case 'model':
        return this.renderFields([
          ['node', 'Model'],
          ['model', this.currentModel()],
          ['provider', this.selectedAgent()?.provider ?? stringAt(this.world?.agent, ['provider'])],
          ['ontology source', this.selectedAgent()?.model ? 'agent list' : stringAt(this.world?.worldDoc.status, ['model']) ? 'AgentWorld status' : 'AgentWorld fallback'],
          ['runtime model', this.runtimeModel()],
        ])
      case 'prompt':
        return this.renderFields([
          ['node', 'System prompt'],
          ['title', stringAt(prompt, ['title'])],
          ['digest', stringAt(prompt, ['digest'])],
          ['characters', String(this.systemPromptText().length)],
          ['dirty', String(this.systemPromptDirty)],
        ])
      case 'graph':
        return this.renderFields([
          ['node', 'Graph'],
          ['graph', this.graphId()],
          ['memory queue', stringAt(this.world?.worldDoc.memory, ['queueDepth'])],
          ['schema', this.world?.worldDoc.schema],
        ])
      case 'run':
        return this.renderFields([
          ['node', 'Run'],
          ['run', this.world?.run?.runId ?? stringAt(this.world?.worldDoc.status, ['activeRunId'])],
          ['workflow', this.world?.run?.workflowName ?? workflowName(this.selectedAgent() ?? ({} as VehicleAgentRecord))],
          ['status', this.world?.run?.status ?? stringAt(this.world?.worldDoc.status, ['lifecycle'])],
          ['tokens', this.world?.run?.totalTokens ?? null],
        ])
      case 'session':
        return this.renderFields([
          ['node', 'Session'],
          ['session', this.activeSessionId()],
          ['sandbox', stringAt(this.world?.worldDoc.status, ['activeSandboxId'])],
          ['driver', this.driver()],
        ])
      case 'tools':
        return this.renderFields([
          ['node', 'Tools'],
          ['manifest', stringAt(this.world?.worldDoc.toolbelt, ['manifestId'])],
          ['mode', stringAt(this.world?.worldDoc.toolbelt, ['toolMode'])],
          ['declared', String(tools.length)],
          ['available', String(tools.filter((tool) => valueAt(tool, ['available']) !== false).length)],
        ])
      case 'conversation':
        return this.renderFields([
          ['node', 'Conversation'],
          ['messages', String(messages.length)],
          ['latest author', stringAt(latestMessage, ['authorId'])],
          ['latest text', stringAt(latestMessage, ['text'])],
        ])
      case 'driver':
        return this.renderFields([
          ['node', 'Driver'],
          ['lease', this.driver()],
          ['queue', String(arrayAt<JsonRecord>(this.world?.worldDoc.control, ['steeringQueue']).length)],
          ['client', this.config?.clientId ?? 'vehicle-web'],
        ])
      case 'journal':
        const journalItems = this.agentJournalItems()
        return this.renderFields([
          ['node', 'Journal'],
          ['events', String(journalItems.length)],
          ['cursor', String(this.cursor)],
          ['latest', journalItems.at(-1)?.event.type ?? '-'],
        ])
    }
    return this.renderFields([['node', nodeId]])
  }

  private renderWorkflowOntologyPane(): TemplateResult {
    const ontology = this.workflowOntology()
    const selected = ontology.nodes.find((node) => node.id === this.selectedWorkflowOntologyNodeId) ?? ontology.nodes[0]
    if (!ontology.nodes.length) return html`<div class="empty">No workflow ontology loaded.</div>`
    return html`
      <section class="agent-graph-pane" aria-label="Workflow ontology graph">
        <header class="graph-head">
          <span class="graph-head-main">
            <span class="graph-title">Workflow Ontology</span>
            <span class="graph-meta">${ontology.nodes.length} nodes · ${ontology.edges.length} edges · click a node for evidence</span>
          </span>
          <span class="graph-mode-toggle" role="group" aria-label="Network dimension">
            ${(['2d', '3d'] as const).map(
              (mode) => html`
                <button
                  class=${classMap({ 'graph-mode-button': true, active: this.agentGraphDimension === mode })}
                  type="button"
                  aria-pressed=${this.agentGraphDimension === mode ? 'true' : 'false'}
                  @click=${() => (this.agentGraphDimension = mode)}
                >
                  ${mode.toUpperCase()}
                </button>
              `,
            )}
          </span>
        </header>
        <div class="graph-canvas">
          <mn-graph-three
            .nodes=${ontology.nodes}
            .edges=${ontology.edges}
            .dimension=${this.agentGraphDimension}
            interactive
            fullscreenable
            hint=${`Workflow ontology ${this.agentGraphDimension.toUpperCase()}`}
            @mn-graph-node-select=${(event: CustomEvent<MnGraphNode>) => {
              this.selectedWorkflowOntologyNodeId = event.detail.id
            }}
          ></mn-graph-three>
        </div>
        <div class="graph-info">
          ${this.renderWorkflowGraphSummary()}
          ${selected ? this.renderWorkflowOntologyNodeInfo(selected.id) : html`<div class="empty">Select a workflow node.</div>`}
        </div>
      </section>
    `
  }

  private renderWorkflowGraphSummary(): TemplateResult {
    const ontology = this.workflowOntology()
    const contract = ontology.facts.find((fact) => fact.label === 'contract')?.value ?? '-'
    const gate = ontology.facts.find((fact) => fact.label === 'shape gate')?.value ?? '-'
    return html`
      <div class="graph-info-model" aria-label="Workflow conformance">
        <span class="graph-info-model-label">AgentWorld Contract</span>
        <span class="graph-info-model-value">${gate}</span>
        <span class="graph-info-model-id">${contract}</span>
      </div>
    `
  }

  private renderWorkflowOntologyNodeInfo(nodeId: string): TemplateResult {
    const node = this.workflowOntology().nodes.find((item) => item.id === nodeId)
    if (!node) return html`<div class="empty">Select a workflow node.</div>`
    const evidence = Object.entries(asRecord(node.evidence)).map(
      ([key, value]) =>
        [
          key,
          typeof value === 'object' && value !== null ? this.renderJson(value) : value,
        ] as const,
    )
    return this.renderFields([
      ['node', node.label ?? node.id],
      ['class', node.className ?? node.id],
      ['note', node.note],
      ...evidence,
    ])
  }

  private renderWorkflowJournal(): TemplateResult {
    const items = this.agentJournalItems().filter((item) => {
      const key = `${item.event.type} ${item.label} ${item.title}`.toLowerCase()
      return /workflow|run|session|prompt|tool|model|conversation|turn|control/.test(key)
    })
    return html`
      <section class="agent-journal" aria-label="Workflow journal">
        <header class="journal-head">
          <span class="journal-title">Workflow Ontology Journal</span>
          <span class="journal-meta">${items.length} facts · drag corner to resize</span>
        </header>
        ${items.length
          ? html`
              <div class="journal-list">
                ${repeat(
                  items.slice().reverse(),
                  (item) => item.id,
                  (item) => html`
                    <article class="journal-item">
                      <span class="journal-seq">#${item.seq}</span>
                      <span class="journal-main">
                        <span class="journal-event">${item.label} · ${item.title}</span>
                        <span class="journal-detail">${item.detail || item.event.type}</span>
                        <span class="journal-time">
                          ${item.origin === 'projection' ? 'projected · ' : ''}${item.event.ts ? new Date(item.event.ts).toLocaleString() : '-'}
                        </span>
                      </span>
                    </article>
                  `,
                )}
              </div>
            `
          : html`<div class="empty">No workflow ontology history yet.</div>`}
      </section>
    `
  }

  private renderAgentJournal(): TemplateResult {
    const items = this.agentJournalItems()
    return html`
      <section class="agent-journal" aria-label="Agent journal">
        <header class="journal-head">
          <span class="journal-title">Agent Ontology Journal</span>
          <span class="journal-meta">${items.length} facts · drag corner to resize</span>
        </header>
        ${items.length
          ? html`
              <div class="journal-list">
                ${repeat(
                  items.slice().reverse(),
                  (item) => item.id,
                  (item) => html`
                    <article class="journal-item">
                      <span class="journal-seq">#${item.seq}</span>
                      <span class="journal-main">
                        <span class="journal-event">${item.label} · ${item.title}</span>
                        <span class="journal-detail">${item.detail || item.event.type}</span>
                        <span class="journal-time">
                          ${item.origin === 'projection' ? 'projected · ' : ''}${item.event.ts ? new Date(item.event.ts).toLocaleString() : '-'}
                        </span>
                      </span>
                    </article>
                  `,
                )}
              </div>
            `
          : html`<div class="empty">No agent ontology history yet.</div>`}
      </section>
    `
  }

  private renderMainPane(messages: ChatMessage[], streaming: boolean): TemplateResult {
    if (this.mainPane === 'agent') {
      return html`<div class="agent-main-wrap">${this.renderAgentScreen()}</div>`
    }
    if (this.mainPane === 'workflow') {
      return html`<div class="agent-main-wrap">${this.renderWorkflowIdeScreen()}</div>`
    }
    return this.renderChatPanel(messages, streaming)
  }

  private renderChatPanel(messages: ChatMessage[], streaming: boolean): TemplateResult {
    return html`
      <sh-chat-panel
        assistantLabel="Greenhouse"
        sessionTitle=${this.agentHandle()}
        composerPlaceholder="Message the AgentWorld, or type /help"
        emptyIcon="G"
        emptyTitle=${this.world ? 'No room messages yet' : 'Open an AgentWorld'}
        emptyDescription=${this.world
          ? 'Use the composer or a room command to write into the AgentWorld conversation.'
          : 'Greenhouse rooms speak through the shared Shrubbery chat panel.'}
        .messages=${messages}
        .streaming=${streaming}
        .emptySuggestions=${EMPTY_SUGGESTIONS}
        .composerControls=${this.composerControls()}
        .promptCards=${PROMPT_CARDS}
        .formatModelAnnotation=${(message: ChatMessage) =>
          message.toolCalls.length
            ? `${message.toolCalls.length} tool${message.toolCalls.length === 1 ? '' : 's'} inline`
            : null}
        .toolsExpandedByDefault=${true}
        .onSend=${(text: string) => void this.send(text)}
        .onComposerControlChange=${(detail: ChatComposerControlChangeDetail) =>
          this.onComposerControlChange(detail)}
        .onSuggestionUse=${(suggestion: ChatEmptySuggestion) => {
          this.status = `staged suggestion: ${suggestion.label}`
        }}
        .onPromptOptionUse=${(detail: ChatPromptOptionUseDetail) => this.onPromptOptionUse(detail)}
        .onPromptSubmit=${(detail: ChatPromptSubmitDetail) => this.onPromptSubmit(detail)}
        .onHeaderAction=${() => this.pollWorld()}
        .onModelChange=${(modelId: string) => void this.changeAgentModel(modelId)}
        .models=${this.modelOptions()}
        currentModel=${this.currentModel()}
        theme="light"
      ></sh-chat-panel>
    `
  }

  private renderRoomPane(): TemplateResult {
    return html`
      <section class="room-pane" aria-label="Greenhouse workspace">
        <nav class="tabs" aria-label="Workspace tabs">
          ${ROOM_TABS.map(
            (tab) => html`
              <button
                class=${classMap({ tab: true, active: this.roomTab === tab, 'low-frequency': LOW_FREQUENCY_TABS.has(tab) })}
                type="button"
                title=${tab}
                aria-pressed=${this.roomTab === tab ? 'true' : 'false'}
                @click=${() => {
                  this.roomTab = tab
                  this.workspaceMode = 'source'
                }}
              >
                ${ROOM_TAB_LABELS[tab]}
              </button>
            `,
          )}
        </nav>
        <div class="pane-body">${this.renderActiveTab()}</div>
      </section>
    `
  }

  private renderActiveTab(): TemplateResult {
    if (!this.world) return html`<div class="empty">No AgentWorld selected.</div>`
    switch (this.roomTab) {
      case 'activity':
        return this.renderActivity()
      case 'cockpit':
        return this.renderCockpit()
      case 'bridge':
        return this.renderBridge()
      case 'world':
        return this.renderFields([
          ['schema', this.world.worldDoc.schema],
          ['lifecycle', stringAt(this.world.worldDoc.status, ['lifecycle'])],
          ['runtime', stringAt(this.world.worldDoc.status, ['runtimeStatus'])],
          ['session', this.world.session?.sessionId ?? stringAt(this.world.worldDoc.status, ['activeSessionId'])],
          ['run', this.world.run?.runId ?? stringAt(this.world.worldDoc.status, ['activeRunId'])],
          ['sandbox', stringAt(this.world.worldDoc.status, ['activeSandboxId'])],
          ['graph', this.graphId()],
          ['summary', stringAt(this.world.worldDoc.status, ['summary'])],
        ])
      case 'tools':
        return this.renderTools(this.world.worldDoc.toolbelt)
      case 'prompt':
        return this.renderJsonSections(this.world.worldDoc.prompts)
      case 'schema':
        return this.renderJsonSections(this.world.worldDoc.schemas)
      case 'comments':
        return this.renderComments(this.world.worldDoc.codex)
      case 'debug':
        return this.renderDebug()
    }
    return html`<div class="empty">No tab renderer for ${this.roomTab}.</div>`
  }

  private renderAgentScreen(): TemplateResult {
    const world = this.world
    if (!world) return html`<div class="empty">No AgentWorld selected.</div>`
    const agent = this.selectedAgent()
    const prompt = this.systemPromptRecord()
    const promptDigest = stringAt(prompt, ['digest']) ?? stringAt(world.worldDoc.prompts, ['effectivePromptDigest']) ?? '-'
    const updatedAt = agent?.updatedAt ? new Date(agent.updatedAt).toLocaleString() : '-'
    const workflowLabel = agent?.workflowName ?? agent?.agentType ?? '-'
    const model = this.currentModel()
    const presence = buildAgentPresence({
      name: this.agentHandle(),
      kindLine: [agent?.agentType, agent?.workflowName].filter(Boolean).join(' · '),
      lifecycle: agent?.lifecycle || stringAt(world.worldDoc.status, ['lifecycle']) || '-',
      model,
      driver: this.driver(),
      graph: this.graphId(),
      runId: world.run?.runId ?? stringAt(world.worldDoc.status, ['activeRunId']) ?? '-',
      sessionId: this.activeSessionId() ?? '-',
      updatedAt,
      events: this.events,
    })
    return html`
      <div class="agent-screen">
        <article class="agent-card" aria-label="Agent card">
          ${this.renderPresenceStrip(presence)}
        </article>

        <section class="editor-card" aria-label="New conversation">
          <div class="editor-head">
            <div class="editor-title">New Conversation</div>
            <div class="editor-meta">${workflowLabel}</div>
          </div>
          <div class="form-row">
            <input
              class="text-input"
              type="text"
              .value=${this.newConversationObjective}
              placeholder="Objective"
              @input=${(event: Event) => {
                this.newConversationObjective = (event.currentTarget as HTMLInputElement).value
                this.scheduleTurnContextPreviewRefresh()
              }}
            />
            <button class="button" type="button" @click=${() => this.refreshTurnContextPreview(true)}>
              Preview
            </button>
            <button class="button primary" type="button" @click=${() => this.sendReviewedTurn()}>
              Start Reviewed Turn
            </button>
          </div>
        </section>

        ${this.renderTurnContextPreview()}

        <section class="editor-card" aria-label="System prompt">
          <div class="editor-head">
            <div class="editor-title">System Prompt</div>
            <div class="editor-meta">${promptDigest}</div>
          </div>
          <div class="prompt-editor-main main" aria-label="System prompt document editor">
            <div class="prompt-editor-anchor" id="mn-main-editor" data-center-slot></div>
            ${this.promptEditorBinding
              ? html`<sh-editor-host
                  class="prompt-editor-host"
                  .binding=${this.promptEditorBinding}
                  @input=${() => this.onPromptEditorChange()}
                  @keyup=${() => this.onPromptEditorChange()}
                  @paste=${() => this.onPromptEditorChange()}
                  @blur=${() => this.onPromptEditorChange()}
                ></sh-editor-host>`
              : html`<div class="empty">System prompt editor is opening.</div>`}
          </div>
          <div class="form-actions">
            <button
              class="button primary"
              type="button"
              ?disabled=${!this.systemPromptDirty || this.loading}
              @click=${() => this.saveSystemPrompt()}
            >
              Save Prompt
            </button>
            <button class="button" type="button" ?disabled=${this.loading} @click=${() => this.promoteSystemPrompt()}>
              Promote Graph
            </button>
            <span class="status">${this.promptStatus}</span>
          </div>
        </section>
      </div>
    `
  }

  private renderTurnContextPreview(): TemplateResult {
    const preview = this.turnContextPreview
    const meta = [
      ['prompt', preview?.promptDigest ?? '-'],
      ['packet', preview?.packetDigest ?? '-'],
      ['turn', preview?.turnPromptDigest ?? '-'],
      ['tools', String(preview?.tools?.length ?? 0)],
      ['constraints', String(preview?.constraints?.length ?? 0)],
    ]
    return html`
      <section class="editor-card" aria-label="Agent context preview">
        <div class="editor-head">
          <div class="editor-title">Context Preview</div>
          <div class="editor-meta">${preview?.mode ?? 'agent-world-room-turn'}</div>
        </div>
        <textarea
          class="context-textarea"
          rows="3"
          .value=${this.newConversationObjective}
          placeholder="Latest message"
          @input=${(event: Event) => {
            this.newConversationObjective = (event.currentTarget as HTMLTextAreaElement).value
            this.scheduleTurnContextPreviewRefresh()
          }}
        ></textarea>
        <div class="context-meta-grid">
          ${meta.map(([label, value]) => html`<span>${label}: ${value}</span>`)}
        </div>
        <div class="context-preview-grid">
          <div class="context-preview-column">
            <label class="context-label" for="turn-packet-json">Agent-visible packet</label>
            <textarea
              id="turn-packet-json"
              class="context-textarea code"
              .value=${this.turnContextPacketDraft}
              @input=${(event: Event) => {
                this.turnContextPacketDraft = (event.currentTarget as HTMLTextAreaElement).value
                this.turnContextDirty = true
                this.turnContextStatus = 'Unsaved context edits'
              }}
            ></textarea>
          </div>
          <div class="context-preview-column">
            <label class="context-label" for="turn-prompt-text">Turn prompt</label>
            <textarea
              id="turn-prompt-text"
              class="context-textarea code turn"
              .value=${this.turnContextPromptDraft}
              @input=${(event: Event) => {
                this.turnContextPromptDraft = (event.currentTarget as HTMLTextAreaElement).value
                this.turnContextDirty = true
                this.turnContextStatus = 'Unsaved context edits'
              }}
            ></textarea>
          </div>
        </div>
        <div class="form-actions">
          <button class="button" type="button" ?disabled=${this.loading} @click=${() => this.refreshTurnContextPreview(true)}>
            Refresh Context
          </button>
          <button class="button primary" type="button" ?disabled=${this.loading} @click=${() => this.sendReviewedTurn()}>
            Start Reviewed Turn
          </button>
          <span class="status">${this.turnContextStatus}</span>
        </div>
      </section>
    `
  }

  private renderWorkflowIdeScreen(): TemplateResult {
    if (!this.world) return html`<div class="empty">No AgentWorld selected.</div>`
    const ontology = this.workflowOntology()
    const workflow = this.selectedWorkflow()
    return html`
      <div class="workflow-screen">
        ${workflow ? this.renderWorkflowHero(workflow, ontology) : this.renderWorkflowEmptyHero(ontology)}
        ${workflow ? this.renderWorkflowStageMap(workflow) : nothing}

        <div class="workflow-card-grid">
          ${workflow ? this.renderWorkflowDefinitionCard(workflow) : nothing}
          ${workflow ? this.renderWorkflowAuthoringCard(workflow) : nothing}
          ${workflow ? this.renderWorkflowBindingCard(workflow) : nothing}
          ${workflow ? this.renderWorkflowStatisticsCard(workflow) : nothing}
          ${workflow ? this.renderWorkflowAgentsCard(workflow) : nothing}
          ${this.renderWorkflowMoIndexCard(ontology)}
        </div>
      </div>
    `
  }

  private renderWorkflowHero(
    workflow: WorkflowGrimoireEntry,
    ontology: ReturnType<typeof projectWorkflowOntology>,
  ): TemplateResult {
    const latestStatus = workflow.runStatistics?.latestRunStatus ?? workflow.status
    const latestRun = workflow.runs[0]
    return html`
      <article class="workflow-hero" aria-label="Workflow definition overview">
        <div class="workflow-hero-main">
          <span class="workflow-kicker">Workflow Definition</span>
          <div class="workflow-card-head">
            <h3 class="workflow-title">${workflow.label}</h3>
            <p class="workflow-subtitle">${workflow.definitionSubject}</p>
          </div>
          ${workflow.description ? html`<p class="workflow-description">${workflow.description}</p>` : nothing}
          ${workflow.whenToUse ? html`<p class="workflow-description">${workflow.whenToUse}</p>` : nothing}
          <div class="workflow-chip-row" aria-label="Workflow meaningful-object facts">
            ${this.renderWorkflowChip('wf:Workflow', 'good')}
            ${this.renderWorkflowChip(workflow.sourceKind)}
            ${this.renderWorkflowChip(workflow.identityKind)}
            ${this.renderWorkflowChip(workflow.binding ? 'wf:WorkflowBinding' : 'unbound', workflow.binding ? 'good' : 'warning')}
            ${this.renderWorkflowChip(workflow.draft?.runnable ? 'wf:Draft runnable' : 'wf:Draft incomplete', workflow.draft?.runnable ? 'good' : 'warning')}
            ${this.renderWorkflowChip(`graph:${this.graphId()}`)}
          </div>
          <div class="workflow-metric-strip" aria-label="Workflow metrics">
            ${this.renderWorkflowMetric('Phases', String(workflow.phaseCount ?? 0), 'wf:phase')}
            ${this.renderWorkflowMetric('Agent Nodes', String(workflow.agentNodeCount ?? 0), 'wf:AgentNode')}
            ${this.renderWorkflowMetric('Runs', String(workflow.runStatistics?.runCount ?? workflow.runCount), latestRun?.runId ?? 'wf:Run')}
            ${this.renderWorkflowMetric('Latest', latestStatus ?? '-', workflow.runStatistics?.lastRunAt ? new Date(workflow.runStatistics.lastRunAt).toLocaleString() : 'status')}
          </div>
        </div>

        <div class="workflow-hero-actions">
          <span class="workflow-kicker">Run</span>
          <div class="workflow-command-row">
            <input
              class="text-input"
              type="text"
              .value=${this.newConversationObjective}
              placeholder="Workflow objective"
              aria-label="Workflow objective"
              @input=${(event: Event) => {
                this.newConversationObjective = (event.currentTarget as HTMLInputElement).value
              }}
            />
            <button class="button primary" type="button" @click=${() => this.startSelectedWorkflow(this.newConversationObjective)}>
              Run Workflow
            </button>
          </div>
          <div class="workflow-fact-grid" aria-label="Workflow conformance facts">
            ${ontology.facts.slice(0, 6).map((fact) => this.renderWorkflowFact(fact))}
          </div>
        </div>
      </article>
    `
  }

  private renderWorkflowEmptyHero(ontology: ReturnType<typeof projectWorkflowOntology>): TemplateResult {
    return html`
      <article class="workflow-hero" aria-label="Workflow definition overview">
        <div class="workflow-hero-main">
          <span class="workflow-kicker">Workflow Definition</span>
          <div class="workflow-card-head">
            <h3 class="workflow-title">Workflow IDE</h3>
            <p class="workflow-subtitle">Select a workflow from the grimoire.</p>
          </div>
        </div>
        <div class="workflow-hero-actions">
          <div class="workflow-fact-grid">${ontology.facts.map((fact) => this.renderWorkflowFact(fact))}</div>
        </div>
      </article>
    `
  }

  private renderWorkflowStageMap(workflow: WorkflowGrimoireEntry): TemplateResult {
    const blockingGaps = workflow.draft?.gaps.filter((gap) => gap.gapBlocking).length ?? 0
    const latestRun = workflow.runs[0]
    return html`
      <section class="workflow-stage-map" aria-label="Workflow readiness map">
        ${this.renderWorkflowStage('Definition', `${workflow.sourceKind} / ${workflow.identityKind}`, 'good')}
        ${this.renderWorkflowStage(
          'Draft',
          workflow.draft?.runnable ? 'runnable virtual wf:Draft' : `${blockingGaps} blocking completeness gap(s)`,
          workflow.draft?.runnable ? 'good' : 'warning',
        )}
        ${this.renderWorkflowStage(
          'Binding',
          workflow.binding ? `${workflow.binding.executor} · ${workflow.binding.workflowName}` : 'no invocation binding indexed',
          workflow.binding ? 'good' : 'warning',
        )}
        ${this.renderWorkflowStage(
          'History',
          latestRun
            ? `${latestRun.status} · ${latestRun.runId}`
            : `${workflow.runStatistics?.runCount ?? workflow.runCount} retained run(s)`,
          latestRun?.status === 'failed' ? 'danger' : 'good',
        )}
      </section>
    `
  }

  private renderWorkflowDefinitionCard(workflow: WorkflowGrimoireEntry): TemplateResult {
    return html`
      <section class="workflow-card wide" aria-label="Workflow definition">
        <div class="workflow-card-head">
          <h3 class="workflow-title">Definition Authority</h3>
          <p class="workflow-subtitle">Emporium workflow pack · current-state Meaningful Object</p>
        </div>
        <div class="workflow-row-list">
          ${this.renderWorkflowRow('wf:name', workflow.workflowId, workflow.label)}
          ${this.renderWorkflowRow('wf:definitionSubject', workflow.definitionSubject, 'doc subject / authoritative definition URI')}
          ${this.renderWorkflowRow('wf:description', workflow.description ?? '-', 'display copy')}
          ${this.renderWorkflowRow('wf:whenToUse', workflow.whenToUse ?? '-', 'selection guidance')}
          ${this.renderWorkflowRow('store mode', `${workflow.sourceKind} / ${workflow.identityKind}`, 'Emporium identity contract')}
        </div>
        <div class="workflow-card-head">
          <h3 class="workflow-title">Seed Lineage</h3>
          <p class="workflow-subtitle">wf:seededFrom archetypes</p>
        </div>
        ${workflow.archetypeUris.length
          ? html`<div class="workflow-row-list">
              ${workflow.archetypeUris.map((uri) => this.renderWorkflowRow('wf:seededFrom', uri, 'workflow archetype'))}
            </div>`
          : html`<div class="empty">No wf:seededFrom archetype recorded.</div>`}
      </section>
    `
  }

  private renderWorkflowAuthoringCard(workflow: WorkflowGrimoireEntry): TemplateResult {
    const gaps = workflow.draft?.gaps ?? []
    const warnings = workflow.draft?.warnings ?? []
    return html`
      <section class="workflow-card" aria-label="Workflow authoring draft">
        <div class="workflow-card-head">
          <h3 class="workflow-title">Workflow Readiness</h3>
          <p class="workflow-subtitle">wf:Draft · wf:CompletenessGap · resolve-by-query</p>
        </div>
        <div class="workflow-row-list">
          ${this.renderWorkflowRow('wf:runnable', workflow.draft?.runnable ? 'true' : 'false', `${workflow.phaseCount ?? 0} phase(s), ${workflow.agentNodeCount ?? 0} agent node(s)`, workflow.draft?.runnable ? 'ready' : 'blocked', workflow.draft?.runnable ? 'good' : 'warning')}
          ${gaps.length
            ? gaps.map((gap) =>
                this.renderWorkflowRow(
                  gap.gapKind,
                  gap.gapTarget,
                  gap.rationale ?? 'Completeness gap from workflow authoring projection.',
                  gap.gapBlocking ? 'blocking' : 'advisory',
                  gap.gapBlocking ? 'warning' : undefined,
                ),
              )
            : this.renderWorkflowRow('wf:CompletenessGap', 'none', 'The virtual draft has no blocking completeness gaps.', 'clear', 'good')}
          ${warnings.map((warning) => this.renderWorkflowRow('wf:DraftWarning', warning, 'non-blocking authoring warning', 'warning', 'warning'))}
        </div>
        <div class="workflow-query">${workflow.draft?.derivedFromQuery ?? 'workflow_authoring_session.draft(definition subject, composition events, workflow contract)'}</div>
      </section>
    `
  }

  private renderWorkflowBindingCard(workflow: WorkflowGrimoireEntry): TemplateResult {
    return html`
      <section class="workflow-card wide" aria-label="Workflow invocation binding">
        <div class="workflow-card-head">
          <h3 class="workflow-title">I/O Contract</h3>
          <p class="workflow-subtitle">wf:WorkflowBinding · operation seam · verbatim JSON Schema</p>
        </div>
        ${workflow.binding
          ? html`
              <div class="workflow-row-list">
                ${this.renderWorkflowRow('wf:bindsOperation', workflow.binding.operationId ?? '-', workflow.binding.bindingId)}
                ${this.renderWorkflowRow('wf:executor', workflow.binding.executor, workflow.binding.workflowName)}
                ${this.renderWorkflowRow('wf:requiresAuth', String(workflow.binding.requiresAuth ?? false), 'invocation authorization boundary', workflow.binding.requiresAuth ? 'auth' : 'open', workflow.binding.requiresAuth ? 'warning' : 'good')}
              </div>
              <div class="workflow-schema-pair">
                <div class="workflow-schema-box">
                  <span class="workflow-schema-title">Input Schema</span>
                  ${this.renderJson(workflow.binding.inputSchema ?? {})}
                </div>
                <div class="workflow-schema-box">
                  <span class="workflow-schema-title">Output Schema</span>
                  ${this.renderJson(workflow.binding.outputSchema ?? {})}
                </div>
              </div>
            `
          : html`<div class="empty">No wf:WorkflowBinding indexed yet.</div>`}
      </section>
    `
  }

  private renderWorkflowStatisticsCard(workflow: WorkflowGrimoireEntry): TemplateResult {
    const recentRuns = workflow.runs.slice(0, 4)
    return html`
      <section class="workflow-card" aria-label="Workflow run statistics">
        <div class="workflow-card-head">
          <h3 class="workflow-title">Recent Runs</h3>
          <p class="workflow-subtitle">wf:RunStatistics · derived from wf:Run/wf:AgentRun</p>
        </div>
        <div class="workflow-row-list">
          ${this.renderWorkflowRow('run count', String(workflow.runStatistics?.runCount ?? workflow.runCount), `median tokens ${workflow.runStatistics?.medianRunTokens ?? workflow.totalTokens ?? 0}`)}
          ${this.renderWorkflowRow('latest status', workflow.runStatistics?.latestRunStatus ?? workflow.status, workflow.runStatistics?.lastRunAt ? new Date(workflow.runStatistics.lastRunAt).toLocaleString() : 'no retained run time')}
          ${recentRuns.length
            ? recentRuns.map((run) =>
                this.renderWorkflowRow(run.runId, run.workflowName, `${run.status} · ${run.updatedAt ? new Date(run.updatedAt).toLocaleString() : 'no update time'}`, run.status, run.status === 'failed' ? 'warning' : 'good'),
              )
            : this.renderWorkflowRow('wf:Run', 'none retained', 'Run history will appear here after execution.')}
        </div>
        <div class="workflow-query">${workflow.runStatistics?.derivedFromQuery ?? 'workflow_book.runStatistics(wf:Run, wf:AgentRun, wf:PageTurnDecision history for workflow)'}</div>
      </section>
    `
  }

  private renderWorkflowAgentsCard(workflow: WorkflowGrimoireEntry): TemplateResult {
    const agents = workflow.agents.length ? workflow.agents : this.agents.filter((agent) => workflowName(agent) === workflow.workflowId)
    return html`
      <section class="workflow-card" aria-label="Workflow eligible agents">
        <div class="workflow-card-head">
          <h3 class="workflow-title">Eligible Agents</h3>
          <p class="workflow-subtitle">agt:Agent bindings projected from workflowName / agentIds</p>
        </div>
        ${agents.length
          ? html`<div class="workflow-row-list">
              ${agents.map((agent) =>
                this.renderWorkflowRow(
                  agentDisplayName(agent),
                  agent.agentUri ?? agent.agentId,
                  [agent.lifecycle, modelLabel(modelFromRecord(asRecord(agent))), agent.graphId].filter(Boolean).join(' · '),
                  workflowName(agent) ?? 'agent',
                  agent.lifecycle === 'active' ? 'good' : undefined,
                ),
              )}
            </div>`
          : html`<div class="empty">No agent currently advertises this workflow binding.</div>`}
      </section>
    `
  }

  private renderWorkflowMoIndexCard(ontology: ReturnType<typeof projectWorkflowOntology>): TemplateResult {
    const nodeIds = [
      'wf:Workflow',
      'wf:Phase',
      'wf:AgentNode',
      'wf:WorkflowBinding',
      'wf:Draft',
      'wf:CompletenessGap',
      'wf:Run',
      'wf:AgentRun',
      'agt:Session',
      'agt:PromptBinding',
      'agt:ToolManifest',
      'contract:AgentWorld',
      'shape:Gate',
    ]
    return html`
      <section class="workflow-card wide" aria-label="Workflow Meaningful Object index">
        <div class="workflow-card-head">
          <h3 class="workflow-title">MO Object Index</h3>
          <p class="workflow-subtitle">Emporium workflow pack classes plus AgentWorld runtime projections</p>
        </div>
        ${this.renderOntologyNodeList(nodeIds)}
        ${ontology.shapeFailures.length
          ? this.renderField('shape failures', this.renderJson(ontology.shapeFailures))
          : this.renderField('shape failures', 'none')}
      </section>
    `
  }

  private renderWorkflowMetric(label: string, value: string, note?: string): TemplateResult {
    return html`
      <div class="workflow-metric">
        <span class="workflow-metric-value">${value}</span>
        <span class="workflow-metric-label">${label}</span>
        ${note ? html`<span class="workflow-metric-note">${note}</span>` : nothing}
      </div>
    `
  }

  private renderWorkflowChip(label: string, tone?: string): TemplateResult {
    return html`
      <span
        class=${classMap({
          'workflow-chip': true,
          good: tone === 'good',
          warning: tone === 'warning',
        })}
      >
        ${label}
      </span>
    `
  }

  private renderWorkflowStage(title: string, detail: string, tone?: string): TemplateResult {
    return html`
      <article
        class=${classMap({
          'workflow-stage': true,
          good: tone === 'good',
          warning: tone === 'warning',
          danger: tone === 'danger',
        })}
      >
        <span class="workflow-stage-title">${title}</span>
        <span class="workflow-stage-detail">${detail}</span>
      </article>
    `
  }

  private renderWorkflowRow(label: string, value: unknown, detail?: unknown, badge?: string, tone?: string): TemplateResult {
    return html`
      <div class="workflow-row">
        <span class="workflow-row-main">
          <span class="workflow-row-title">${label}</span>
          <span class="workflow-row-detail">${isTemplateResult(value) ? value : String(value)}</span>
          ${detail !== undefined ? html`<span class="workflow-row-meta">${isTemplateResult(detail) ? detail : String(detail)}</span>` : nothing}
        </span>
        ${badge
          ? html`
              <span
                class=${classMap({
                  'workflow-row-badge': true,
                  good: tone === 'good',
                  warning: tone === 'warning',
                })}
              >
                ${badge}
              </span>
            `
          : nothing}
      </div>
    `
  }

  private renderWorkflowFact(fact: { readonly label: string; readonly value: string; readonly tone?: string }): TemplateResult {
    return html`
      <div
        class=${classMap({
          'workflow-fact': true,
          good: fact.tone === 'good',
          warning: fact.tone === 'warning',
          danger: fact.tone === 'danger',
        })}
      >
        <span class="workflow-fact-label">${fact.label}</span>
        <span class="workflow-fact-value">${fact.value}</span>
      </div>
    `
  }

  private renderOntologyNodeList(ids: readonly string[]): TemplateResult {
    const ontology = this.workflowOntology()
    const nodes = ids.flatMap((id) => {
      const node = ontology.nodes.find((item) => item.id === id)
      return node ? [node] : []
    })
    if (!nodes.length) return html`<div class="empty">No ontology nodes.</div>`
    return html`
      <div class="ontology-node-list">
        ${nodes.map(
          (node) => html`
            <button
              class=${classMap({
                'ontology-node-row': true,
                active: this.selectedWorkflowOntologyNodeId === node.id,
              })}
              type="button"
              @click=${() => {
                this.selectedWorkflowOntologyNodeId = node.id
                this.workspaceMode = 'source'
              }}
            >
              <span class="ontology-node-label">${node.label ?? node.id}</span>
              <span class="ontology-node-note">${node.note ?? node.className ?? node.id}</span>
            </button>
          `,
        )}
      </div>
    `
  }

  private renderPresenceStrip(presence: AgentPresenceViewModel): TemplateResult {
    const driver = presence.references.find((reference) => reference.label === 'driver')
    const graph = presence.references.find((reference) => reference.label === 'graph')
    return html`
      <div class="presence-strip" aria-label=${presence.identity.kindLine || 'Agent identity'}>
        <div class="presence-sentence">
          ${this.renderPresenceDot(presence.state)}
          <span class="presence-name">${presence.identity.name}</span>
          <span class="presence-predicate">— ${presence.state.lifecycle} on</span>
          ${this.renderAgentModelPicker(presence.model)}
          ${driver ? this.renderPresenceSentenceReference('driven by', driver) : nothing}
          ${graph ? this.renderPresenceSentenceReference('in', graph) : nothing}
        </div>
        ${this.renderPresenceMetaLine(presence.meta)}
      </div>
    `
  }

  private renderPresenceDot(state: AgentPresenceViewModel['state']): TemplateResult {
    return html`
      <span
        class=${classMap({
          'presence-dot': true,
          [`presence-dot-${state.tone}`]: true,
        })}
        aria-label=${state.lifecycle}
        title=${state.lifecycle}
      ></span>
    `
  }

  private renderPresenceSentenceReference(prefix: string, reference: AgentPresenceReference): TemplateResult {
    return html`
      <span class="presence-separator">· ${prefix}</span>
      <span class="presence-ref" title=${reference.label}>${reference.value}</span>
    `
  }

  private renderPresenceMetaLine(meta: readonly AgentPresenceReference[]): TemplateResult {
    const line = meta.map((item) => (item.label === 'updated' ? `updated ${item.value}` : item.value)).join(' · ')
    return html`<div class="presence-meta" title=${line}>${line}</div>`
  }

  private renderAgentModelPicker(model: AgentPresenceModel): TemplateResult {
    const modelValue = model.value
    const groups = this.agentModelGroups()
    const activeProvider = this.activeAgentModelProvider(groups)
    const activeModels = groups.find((group) => group.provider === activeProvider)?.models ?? []
    const observedAt = model.observedAt ? new Date(model.observedAt) : null
    const observedTime = observedAt?.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    const observedTitle = observedAt
      ? model.observer
        ? `set by ${model.observer} at ${observedAt.toLocaleString()}`
        : `set at ${observedAt.toLocaleString()}`
      : ''
    return html`
      <div
        class=${classMap({ 'presence-model': true, 'model-stat': true, open: this.agentModelPickerOpen })}
        @keydown=${(event: KeyboardEvent) => {
          if (event.key === 'Escape') this.agentModelPickerOpen = false
        }}
      >
        <button
          class="agent-model-trigger"
          type="button"
          aria-haspopup="listbox"
          aria-expanded=${this.agentModelPickerOpen ? 'true' : 'false'}
          title=${modelValue}
          @click=${() => this.toggleAgentModelPicker()}
        >
          <span class="agent-model-name">${modelLabel(modelValue)}</span>
          <span class="agent-model-caret" aria-hidden="true">v</span>
        </button>
        ${observedAt && observedTime
          ? html`<span class="presence-model-attribution" title=${observedTitle}>set ${observedTime}</span>`
          : nothing}
        ${this.agentModelPickerOpen
          ? html`
              <div class="agent-model-picker" role="listbox" aria-label="Agent model picker">
                <div class="agent-model-providers" role="group" aria-label="Model providers">
                  ${groups.map((group) => {
                    const active = group.provider === activeProvider
                    const selected = group.models.some((item) => item.id === modelValue)
                    return html`
                      <button
                        class=${classMap({
                          'agent-model-provider': true,
                          active,
                          selected,
                        })}
                        type="button"
                        aria-pressed=${active ? 'true' : 'false'}
                        @mouseenter=${() => (this.agentModelProvider = group.provider)}
                        @focus=${() => (this.agentModelProvider = group.provider)}
                        @click=${() => (this.agentModelProvider = group.provider)}
                      >
                        ${group.provider}
                      </button>
                    `
                  })}
                </div>
                <div class="agent-model-models">
                  ${activeModels.map(
                    (item) => html`
                      <button
                        class=${classMap({
                          'agent-model-option': true,
                          selected: item.id === modelValue,
                        })}
                        type="button"
                        role="option"
                        aria-selected=${item.id === modelValue ? 'true' : 'false'}
                        @click=${() => void this.changeAgentModel(item.id)}
                      >
                        <span class="agent-model-option-name">${item.label}</span>
                      </button>
                    `,
                  )}
                </div>
              </div>
            `
          : nothing}
      </div>
    `
  }

  private renderStat(label: string, value: unknown): TemplateResult {
    return html`
      <div class="stat">
        <span class="stat-label">${label}</span>
        <span class="stat-value" title=${String(value ?? '-')}>${String(value ?? '-')}</span>
      </div>
    `
  }

  private renderActivity(): TemplateResult {
    const items = activityItems(this.events)
    if (!items.length) return html`<div class="empty">No turn activity yet.</div>`
    return html`
      <div class="activity-list">
        ${repeat(
          items,
          (item) => item.id,
          (item) => html`
            <button
              type="button"
              class=${classMap({
                'activity-row': true,
                active: item.id === this.selectedActivityId,
                [`status-${item.status}`]: true,
              })}
              @click=${() => (this.selectedActivityId = item.id)}
            >
              <span class="seq">#${item.seq}</span>
              <span class="activity-main">
                <span class="activity-title">${item.label} · ${item.title}</span>
                <span class="activity-detail">${item.detail || item.event.type}</span>
              </span>
            </button>
          `,
        )}
        ${this.renderActivityDetail()}
      </div>
    `
  }

  private renderActivityDetail(): TemplateResult {
    const item = this.selectedActivity()
    if (!item) return html`${nothing}`
    return html`
      <div class="fields">
        ${this.renderField('selected event', `#${item.seq} ${item.event.type}`)}
        ${this.renderField('summary', item.detail || '-')}
        ${this.renderField('timestamp', item.event.ts ? new Date(item.event.ts).toLocaleString() : '-')}
        ${this.renderField('payload', this.renderJson(item.event.payload))}
      </div>
    `
  }

  private renderTools(toolbelt: JsonRecord): TemplateResult {
    const tools = arrayAt<JsonRecord>(toolbelt, ['tools'])
    return html`
      <div class="fields">
        ${this.renderField('manifest', stringAt(toolbelt, ['manifestId']) ?? '-')}
        ${this.renderField('mode', stringAt(toolbelt, ['toolMode']) ?? '-')}
        ${this.renderField('mcp', stringAt(toolbelt, ['mcpProfile']) ?? '-')}
        ${this.renderField(
          'counts',
          `declared ${stringAt(toolbelt, ['counts', 'declared']) ?? '-'} · mounted ${
            stringAt(toolbelt, ['counts', 'mounted']) ?? '-'
          } · used ${stringAt(toolbelt, ['counts', 'used']) ?? '0'} · failed ${
            stringAt(toolbelt, ['counts', 'failed']) ?? '0'
          }`,
        )}
        ${tools.length
          ? tools.map((tool) =>
              this.renderField(
                stringAt(tool, ['name']) ?? 'tool',
                `${stringAt(tool, ['state']) ?? 'declared'} · ${stringAt(tool, ['access']) ?? '-'} · ${
                  stringAt(tool, ['risk']) ?? '-'
                }\n${stringAt(tool, ['description']) ?? compactJson(tool, 220)}`,
              ),
            )
          : html`<div class="empty">Toolbelt is empty.</div>`}
      </div>
    `
  }

  private renderComments(codex: JsonRecord): TemplateResult {
    const comments = arrayAt<JsonRecord>(codex, ['comments'])
    if (!comments.length) return html`<div class="empty">No Codex comments yet.</div>`
    return html`
      <div class="fields">
        ${comments.map((comment) =>
          this.renderField(
            stringAt(comment, ['authorId']) ?? stringAt(comment, ['author']) ?? 'comment',
            stringAt(comment, ['text']) ?? compactJson(comment, 240),
          ),
        )}
      </div>
    `
  }

  private renderCockpit(): TemplateResult {
    if (!this.vehicleSession) {
      return html`
        <div class="fields">
          ${this.renderField('cockpit source', this.service?.mode === 'fetch' ? 'waiting for active Choreograph agent session' : 'unavailable')}
          ${this.renderField('status', this.supplementalStatus || 'No cockpit session loaded.')}
        </div>
      `
    }
    const model = this.runtimeModel() ?? '-'
    return html`
      <div class="toolbar">
        <span class="badge">driver ${this.vehicleSession.driver.holder} · epoch ${this.vehicleSession.driver.epoch}</span>
        <button class="button primary" type="button" @click=${() => this.submitCockpitInput('inspect the current Greenhouse room')}>
          Send cockpit input
        </button>
      </div>
      <div class="fields">
        ${this.renderField('session', this.vehicleSession.sessionId)}
        ${this.renderField('run', this.vehicleSession.runId ?? '-')}
        ${this.renderField('workflow', this.vehicleSession.workflowName ?? '-')}
        ${this.renderField(
          'agent',
          [this.vehicleSession.agentLabel, this.vehicleSession.agentId].filter(Boolean).join(' · ') || '-',
        )}
        ${this.renderField('graph', this.vehicleSession.graphId)}
        ${this.renderField('runtime', [this.vehicleSession.status, model].filter(Boolean).join(' · ') || '-')}
        ${this.renderField('sandbox', this.vehicleSession.sandboxId ?? '-')}
        ${this.renderField('revision', this.vehicleSession.revision ?? '-')}
        ${this.renderField('presence', this.vehicleSession.presences.map((presence) => `${presence.displayName}:${presence.focus}`).join(' · '))}
      </div>
      ${this.vehicleSession.pendingControlEvents.length
        ? html`
            <h3 class="field-label">Control Queue</h3>
            <div class="fields">
              ${this.vehicleSession.pendingControlEvents.map((event, index) =>
                this.renderField(`#${index + 1} ${event.actor}`, event.text),
              )}
            </div>
          `
        : nothing}
      <h3 class="field-label">Panes</h3>
      <div class="pane-grid">
        ${this.vehicleSession.panes.map(
          (pane) => html`
            <article class="pane-card">
              <div class="pane-card-title">${pane.title}</div>
              <div class="pane-card-meta">${pane.kind} ${pane.mode ? `· ${pane.mode}` : ''}</div>
              <div class="pane-card-meta">${[pane.command, ...(pane.args ?? [])].filter(Boolean).join(' ')}</div>
              <div class="pane-card-output">${pane.output || pane.state || 'idle'}</div>
            </article>
          `,
        )}
      </div>
      <h3 class="field-label">Transcript</h3>
      <div class="fields">
        ${this.vehicleSession.transcript.map((event) =>
          this.renderField(`#${event.seq} ${event.source}`, event.text),
        )}
      </div>
    `
  }

  private renderBridge(): TemplateResult {
    if (!this.bridgeProjection) {
      return html`
        <div class="fields">
          ${this.renderField('bridge source', this.service?.mode === 'fetch' ? 'not served by live Choreograph HTTP' : 'unavailable')}
          ${this.renderField('status', this.supplementalStatus || 'No bridge projection loaded.')}
        </div>
      `
    }
    const selected = this.selectedBridgeLine()
    return html`
      <div class="toolbar">
        <span class="badge">${this.bridgeProjection.title} · rev ${this.bridgeProjection.revision}</span>
        <button
          class="button primary"
          type="button"
          ?disabled=${!selected || selected.support !== 'editable-text'}
          @click=${() =>
            selected &&
            this.applyBridgeOperation({
              type: 'replace-block-text',
              blockId: selected.blockId,
              text: `${selected.text.replace(/\s+\[edited\]$/, '')} [edited]`,
            })}
        >
          Replace text
        </button>
        <button
          class="button"
          type="button"
          ?disabled=${!selected || selected.support !== 'editable-text'}
          @click=${() =>
            selected &&
            this.applyBridgeOperation({
              type: 'split-block',
              blockId: selected.blockId,
              offsetUtf16: Math.max(1, Math.floor(selected.text.length / 2)),
              newBlockId: `${selected.blockId}-split`,
            })}
        >
          Split block
        </button>
      </div>
      <div class="fields">
        ${this.renderField('document', this.bridgeProjection.documentId)}
        ${this.renderField('format', `bridge-v${this.bridgeProjection.formatVersion}`)}
        ${this.renderField('unsupported', this.bridgeProjection.unsupported.length ? this.bridgeProjection.unsupported.map((item) => `${item.nodeType}:${item.reason}`).join('\n') : 'none')}
      </div>
      <div class="activity-list">
        ${this.bridgeProjection.lines.map(
          (line) => html`
            <button
              class=${classMap({ 'bridge-line': true, active: line.blockId === (selected?.blockId ?? '') })}
              type="button"
              @click=${() => (this.selectedBridgeBlockId = line.blockId)}
            >
              <span class="bridge-title">${line.blockId}</span>
              <span class="bridge-meta">${line.nodeType} · ${line.support}</span>
              <span class="bridge-text">${line.text || '(opaque)'}</span>
            </button>
          `,
        )}
      </div>
      ${selected ? this.renderField('TipTap projection', this.renderJson(this.bridgeProjection.tiptapJson)) : nothing}
    `
  }

  private renderDebug(): TemplateResult {
    return this.renderFields([
      ['baseUrl', this.service?.baseUrl ?? '-'],
      ['service', this.service?.mode ?? '-'],
      ['agentId', this.selectedAgentId || '-'],
      ['authorId', this.config?.authorId ?? '-'],
      ['clientId', this.config?.clientId ?? '-'],
      ['cursor', String(this.cursor)],
      ['events', String(this.events.length)],
      ['data provenance', this.provenanceLabel()],
      ['supplemental', this.supplementalStatus || 'loaded'],
      ['control', this.renderJson(this.world?.worldDoc.control ?? {})],
      ['status', this.renderJson(this.world?.worldDoc.status ?? {})],
    ])
  }

  private renderWorkflowPane(): TemplateResult {
    const item = this.selectedActivity()
    return html`
      <section class="room-pane" aria-label="Greenhouse trace detail">
        <nav class="tabs">
          <span class="badge">${this.world?.run?.workflowName ?? workflowName(this.agents[0] ?? ({} as VehicleAgentRecord)) ?? 'workflow'}</span>
          <button class="button" type="button" @click=${() => this.steer('Pause after the next tool call and summarize.')}>
            Steer pause
          </button>
        </nav>
        <div class="pane-body">
          ${item
            ? html`<div class="fields">
                ${this.renderField('event', `#${item.seq} ${item.event.type}`)}
                ${this.renderField('summary', item.detail || '-')}
                ${this.renderField('raw', this.renderJson(item.event.payload))}
              </div>`
            : html`<div class="empty">Select an event from the trace.</div>`}
        </div>
      </section>
    `
  }

  private renderJsonSections(record: JsonRecord): TemplateResult {
    const entries = Object.entries(record)
    if (!entries.length) return html`<div class="empty">No data.</div>`
    return html`<div class="fields">${entries.map(([key, value]) => this.renderField(key, this.renderJson(value)))}</div>`
  }

  private renderFields(entries: readonly (readonly [string, unknown])[]): TemplateResult {
    const filtered = entries.filter(([, value]) => value !== null && value !== undefined && value !== '')
    if (!filtered.length) return html`<div class="empty">No data.</div>`
    return html`<div class="fields">${filtered.map(([key, value]) => this.renderField(key, value))}</div>`
  }

  private renderField(label: string, value: unknown): TemplateResult {
    return html`
      <div class="field">
        <div class="field-label">${label}</div>
        <div class="field-value">${isTemplateResult(value) ? value : String(value)}</div>
      </div>
    `
  }

  private renderJson(value: unknown): TemplateResult {
    return html`<pre class="json-block">${JSON.stringify(value ?? null, null, 2)}</pre>`
  }

  private selectedBridgeLine(): BridgeLine | null {
    if (!this.bridgeProjection) return null
    return (
      this.bridgeProjection.lines.find((line) => line.blockId === this.selectedBridgeBlockId) ??
      this.bridgeProjection.lines[0] ??
      null
    )
  }
}

function isTemplateResult(value: unknown): value is TemplateResult {
  return Boolean(value && typeof value === 'object' && '_$litType$' in value)
}

declare global {
  interface HTMLElementTagNameMap {
    'vehicle-app': VehicleApp
  }
}
