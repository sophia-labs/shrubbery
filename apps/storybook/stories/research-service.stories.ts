/**
 * Sophia Research Service - Shrubbery-native layered stories.
 *
 * The SRS surface is expressed as real Shrubbery pieces:
 * - atom: mn-research-source-chip;
 * - molecules: mn-research-source-card and mn-research-run-trace;
 * - organism: mn-research-workspace with slotted sidebar/chat/source/workflow;
 * - story: the complete SRS composition using existing chat/source/canvas lifts.
 *
 * Papers integration is intentionally stubbed as host-owned data. No story-local
 * API client, store, retrieval service, or duplicate chat shell is introduced.
 */

import type { Meta, StoryObj } from '@storybook/web-components'

import '@shrubbery/components'
import {
  ShChatPanel,
  type ChatComposerControl,
  type ChatComposerControlChangeDetail,
  type ChatEmptySuggestion,
  type ChatMessage,
  type ChatPromptCard,
  type ChatPromptSubmitDetail,
} from '@shrubbery/chat-kernel'
import type {
  MnExcalidrawCanvas,
  MnResearchRunStep,
  MnResearchRunTrace,
  MnResearchSource,
  MnResearchSourceCard,
  MnResearchSourceChip,
  MnResearchWorkspace,
  MnResearchWorkspaceModeDetail,
  MnSidebarPanel,
  MnSidebarSection,
  MnZoteroSourceAnnotation,
  MnZoteroSourceIncomingWire,
  MnZoteroSourceItem,
  MnZoteroSourceWorkbench,
} from '@shrubbery/components'

void ShChatPanel

const meta: Meta = {
  title: 'Research/SRS',
  globals: { skin: 'research' },
  parameters: { layout: 'fullscreen' },
}
export default meta
type Story = StoryObj

let messageCounter = 0

function nextId(prefix: string): string {
  messageCounter += 1
  return `${prefix}-${messageCounter}`
}

function user(content: string): ChatMessage {
  return {
    id: nextId('user'),
    role: 'user',
    content,
    parts: [{ type: 'text', content }],
    isStreaming: false,
    toolCalls: [],
    createdAt: Date.now(),
  }
}

function assistant(content: string, tools: ChatMessage['toolCalls'] = []): ChatMessage {
  return {
    id: nextId('assistant'),
    role: 'assistant',
    content,
    parts: [
      { type: 'text', content },
      ...tools.map((tool) => ({ type: 'tool' as const, toolCallId: tool.id })),
    ],
    isStreaming: false,
    toolCalls: tools,
    createdAt: Date.now(),
  }
}

const researchSuggestions: readonly ChatEmptySuggestion[] = [
  {
    id: 'survey-literature',
    icon: 'P',
    label: 'Survey papers',
    prompt: 'Survey recent paper and arXiv-wrapper services for agent research workflows.',
  },
  {
    id: 'ground-claim',
    icon: 'G',
    label: 'Ground a claim',
    prompt: 'Find sources that support or weaken this claim, then show the evidence trail.',
  },
  {
    id: 'synthesize-brief',
    icon: 'S',
    label: 'Draft synthesis',
    prompt: 'Turn the selected sources into a short, citation-aware research brief.',
  },
]

const initialControls: readonly ChatComposerControl[] = [
  {
    id: 'depth',
    label: 'Depth',
    value: 'standard',
    options: [
      { id: 'quick', label: 'Quick' },
      { id: 'standard', label: 'Standard' },
      { id: 'deep', label: 'Deep', description: 'Spend more time gathering and checking sources.' },
    ],
  },
  {
    id: 'reach',
    label: 'Reach',
    value: 'papers',
    options: [
      { id: 'workspace', label: 'Workspace' },
      { id: 'papers', label: 'Papers' },
      { id: 'web', label: 'Web', disabled: true, description: 'Deferred to the host browsing service.' },
    ],
  },
]

const calibrationPromptCards: readonly ChatPromptCard[] = [
  {
    id: 'calibration-purpose',
    header: 'Calibration',
    question: 'What should this research optimize for?',
    mode: 'collect',
    multi: true,
    freeformPlaceholder: 'Add a constraint...',
    submitLabel: 'Use these',
    options: [
      {
        id: 'understanding',
        label: 'Understanding',
        description: 'Build a trustworthy mental model.',
        compose: 'Optimize for my own understanding.',
      },
      {
        id: 'citation',
        label: 'Citation',
        description: 'Prioritize precise attribution and bibliography shape.',
        compose: 'Optimize for material I can cite.',
      },
      {
        id: 'decision',
        label: 'Decision',
        description: 'Surface the practical bottom line and tradeoffs.',
        compose: 'Optimize for a decision I need to make.',
      },
    ],
  },
  {
    id: 'calibration-shape',
    header: 'Shape',
    question: 'Which investigation structure should SRS use?',
    mode: 'compose',
    options: [
      {
        id: 'thematic',
        label: 'Thematic',
        description: 'Group by major positions and disagreements.',
        compose: 'Structure the investigation thematically.',
        preview: ['1. Framing', '2. Major positions', '3. Where they collide', '4. Open questions'].join('\n'),
      },
      {
        id: 'adversarial',
        label: 'Adversarial',
        description: 'Steelman each side before giving a verdict.',
        compose: 'Structure it adversarially: strongest case for, strongest case against, then judge.',
        preview: ['1. Sharpen question', '2. Case for', '3. Case against', '4. Cruxes', '5. Verdict'].join('\n'),
      },
    ],
  },
]

const paperSources: readonly MnResearchSource[] = [
  {
    id: 'paper-wrapper-survey',
    title: 'Paper Adapter Survey for Agent Research Workflows',
    kind: 'preprint',
    status: 'ready',
    adapter: 'papers.search',
    authors: ['SRS stub'],
    year: '2026',
    venue: 'Research service note',
    abstract:
      'A shell-owned source record standing in for arXiv, Paperpile, Paperclip, Zotero, or another paper adapter.',
    tags: ['papers', 'adapter', 'srs'],
    score: 0.88,
    citationCount: 12,
    url: '#paper-wrapper-survey',
    note: 'The component renders resolved data; the host owns retrieval and materialization.',
  },
  {
    id: 'arxiv-wrapper-interface',
    title: 'Adapter-shaped arXiv Query Interfaces',
    kind: 'paper',
    status: 'searching',
    adapter: 'arxiv.stub',
    authors: ['Scout agent'],
    year: '2026',
    abstract: 'A candidate source row used to exercise queued/searching source states.',
    tags: ['arxiv', 'wrapper'],
    score: 0.71,
  },
]

const runSteps: readonly MnResearchRunStep[] = [
  {
    id: 'commission',
    label: 'Commission',
    status: 'completed',
    description: 'Capture the research question and output shape.',
    tool: 'research.plan',
  },
  {
    id: 'scope',
    label: 'Scope',
    status: 'completed',
    description: 'Constrain depth, reach, and source posture.',
    tool: 'search_blocks',
    meta: 'sophia-code-lab',
  },
  {
    id: 'search',
    label: 'Search',
    status: 'running',
    description: 'Query the stubbed paper adapter and graph notes.',
    tool: 'papers.search',
    meta: '3 candidates',
  },
  {
    id: 'synthesize',
    label: 'Synthesize',
    status: 'idle',
    description: 'Prepare a citation-aware brief from selected evidence.',
    tool: 'research.synthesize',
  },
]

const sourceItem: MnZoteroSourceItem = {
  key: 'paper-wrapper-survey',
  title: 'Paper Adapter Survey for Agent Research Workflows',
  creatorSummary: 'SRS stub',
  year: '2026',
  itemType: 'preprint',
  abstractNote:
    'A shell-owned source record standing in for arXiv, Paperpile, Paperclip, Zotero, or another paper adapter. The component only renders resolved data and emits intents.',
  tags: ['papers', 'adapter', 'srs'],
}

const sourceAnnotations: readonly MnZoteroSourceAnnotation[] = [
  {
    key: 'ann-adapter',
    kind: 'note',
    comment: 'Treat paper search as a host service that materializes source records for Shrubbery views.',
    page: '1',
  },
  {
    key: 'ann-evidence',
    kind: 'highlight',
    text: 'The chat surface should show provenance without owning retrieval.',
    comment: 'Maps directly to chat tool calls plus right-pane source workbench.',
    page: '2',
  },
]

const incomingWires: readonly MnZoteroSourceIncomingWire[] = [
  {
    id: 'wire-srs-requirements',
    predicateLabel: 'grounds',
    otherDocumentId: 'srs-backend-requirements',
    otherTitle: 'SRS backend requirements',
    otherSnippet: 'Papers integration stays adapter-shaped and host-owned.',
  },
]

const sections: readonly MnSidebarSection[] = [
  {
    id: 'threads',
    label: 'Research',
    icon: 'message-square',
    nodes: [
      { id: 'paper-trail', label: 'Paper trail', kind: 'document', selected: true, badge: 'live' },
      { id: 'claim-map', label: 'Claim map', kind: 'document' },
      {
        id: 'source-queue',
        label: 'Source queue',
        kind: 'folder',
        expanded: true,
        children: [
          { id: 'paper-wrapper-survey', label: 'Paper adapter survey', kind: 'artifact', badge: 'stub' },
          { id: 'arxiv-wrapper-interface', label: 'arXiv wrapper interface', kind: 'artifact' },
        ],
      },
    ],
  },
  {
    id: 'agents',
    label: 'Agents',
    icon: 'bot',
    nodes: [
      { id: 'scout', label: 'Scout', kind: 'tag', count: 3 },
      { id: 'synthesist', label: 'Synthesist', kind: 'tag', count: 1 },
      { id: 'critic', label: 'Critic', kind: 'tag' },
    ],
  },
]

function cloneControls(controls: readonly ChatComposerControl[]): ChatComposerControl[] {
  return controls.map((control) => ({ ...control, options: [...control.options] }))
}

function controlValue(controls: readonly ChatComposerControl[], id: string): string {
  return controls.find((control) => control.id === id)?.value ?? ''
}

function traceTools(depth: string, reach: string): ChatMessage['toolCalls'] {
  return [
    {
      id: nextId('tool-papers'),
      tool: 'papers.search',
      status: 'completed',
      input: { query: 'arXiv wrapper services', reach },
      output: 'Stubbed paper adapter returned 3 candidate source records.',
    },
    {
      id: nextId('tool-graph'),
      tool: 'search_blocks',
      status: 'completed',
      input: { graph_id: 'sophia-code-lab', query: 'SRS requirements' },
      output: 'Found SRS interface stories and backend requirements in the coordination graph.',
    },
    {
      id: nextId('tool-synthesis'),
      tool: 'research.synthesize',
      status: depth === 'deep' ? 'running' : 'completed',
      input: { depth },
      output: depth === 'deep' ? null : 'Prepared a short claim/evidence/action outline.',
    },
  ]
}

function seedMessages(): ChatMessage[] {
  return [
    user('Look for paper wrapper services and tell me how SRS should integrate them.'),
    assistant(
      [
        'I will treat papers as a shell-owned source adapter, not as chat-local state.',
        '',
        'The chat panel can show the investigation trace through ordinary tool calls, while the right pane owns the selected source record.',
      ].join('\n'),
      traceTools('standard', 'papers'),
    ),
  ]
}

function mountResearchChat(seed = true): ShChatPanel {
  messageCounter = 0
  const el = document.createElement('sh-chat-panel') as ShChatPanel
  let controls = cloneControls(initialControls)
  let promptCards = [...calibrationPromptCards]

  el.assistantLabel = 'SRS'
  el.sessionTitle = 'Paper trail'
  el.theme = 'light'
  el.models = [
    { id: 'gpt-5.2', label: 'GPT-5.2' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  ]
  el.currentModel = 'gpt-5.2'
  el.emptyIcon = 'SRS'
  el.emptyTitle = 'Start a research run'
  el.emptyDescription = 'Choose a starting posture or ask directly.'
  el.emptySuggestions = researchSuggestions
  el.composerControls = controls
  el.promptCards = promptCards
  el.composerPlaceholder = 'Ask SRS to investigate...'
  el.messages = seed ? seedMessages() : []
  el.formatModelAnnotation = (msg) => (msg.role === 'assistant' ? 'research trace attached' : null)
  el.onSuggestionUse = (suggestion) => {
    el.title = `suggestion:${suggestion.id ?? suggestion.label}`
  }
  el.onComposerControlChange = (detail: ChatComposerControlChangeDetail) => {
    controls = controls.map((control) =>
      control.id === detail.controlId ? { ...control, value: detail.value } : control,
    )
    el.composerControls = controls
    el.title = `${detail.controlId}:${detail.value}`
  }
  el.onPromptOptionUse = (detail) => {
    el.title = `prompt:${detail.promptId}:${detail.value}`
  }
  el.onPromptSubmit = (detail: ChatPromptSubmitDetail) => {
    promptCards = promptCards.filter((prompt) => prompt.id !== detail.promptId)
    el.promptCards = promptCards
    el.messages = [
      ...el.messages,
      user(detail.summary),
      assistant(
        'Got it. I will carry those constraints into the next research pass.',
        traceTools(controlValue(controls, 'depth'), controlValue(controls, 'reach')),
      ),
    ]
  }
  el.onSend = (text) => {
    const depth = controlValue(controls, 'depth')
    const reach = controlValue(controls, 'reach')
    el.messages = [
      ...el.messages,
      user(text),
      assistant(
        `I am running a ${depth || 'standard'} research pass scoped to ${reach || 'workspace'} sources.`,
        traceTools(depth, reach),
      ),
    ]
  }
  el.onHeaderAction = async (action) => {
    el.title = `header:${action}`
  }
  return el
}

function mountSourceChipAtom(): HTMLElement {
  const wrap = document.createElement('div')
  wrap.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:24px;'
  for (const source of paperSources) {
    const chip = document.createElement('mn-research-source-chip') as MnResearchSourceChip
    chip.sourceId = source.id
    chip.label = source.adapter ?? source.kind ?? 'source'
    chip.kind = source.kind ?? 'paper'
    chip.status = source.status ?? 'ready'
    chip.score = source.score ?? null
    chip.interactive = true
    chip.addEventListener('mn-research-source-chip-select', () => {
      wrap.title = `source:${source.id}`
    })
    wrap.append(chip)
  }
  return wrap
}

function mountSourceCard(source = paperSources[0], compact = false): MnResearchSourceCard {
  const card = document.createElement('mn-research-source-card') as MnResearchSourceCard
  card.source = source
  card.selected = source.id === 'paper-wrapper-survey'
  card.compact = compact
  card.addEventListener('mn-research-source-open', (event) => {
    card.title = `open:${(event as CustomEvent<{ sourceId: string }>).detail.sourceId}`
  })
  card.addEventListener('mn-research-source-select', (event) => {
    card.title = `select:${(event as CustomEvent<{ sourceId: string }>).detail.sourceId}`
  })
  card.addEventListener('mn-research-source-promote', (event) => {
    card.title = `promote:${(event as CustomEvent<{ sourceId: string }>).detail.sourceId}`
  })
  return card
}

function mountRunTrace(): MnResearchRunTrace {
  const trace = document.createElement('mn-research-run-trace') as MnResearchRunTrace
  trace.title = 'Paper trail'
  trace.activeId = 'search'
  trace.steps = runSteps
  trace.addEventListener('mn-research-step-open', (event) => {
    trace.title = `step:${(event as CustomEvent<{ stepId: string }>).detail.stepId}`
  })
  return trace
}

function mountSourceWorkbench(): MnZoteroSourceWorkbench {
  const source = document.createElement('mn-zotero-source-workbench') as MnZoteroSourceWorkbench
  source.graphId = 'sophia-code-lab'
  source.artifactId = 'paper-wrapper-survey'
  source.item = sourceItem
  source.annotations = sourceAnnotations
  source.incomingWires = incomingWires
  return source
}

function dataSvg(markup: string): string {
  return `data:image/svg+xml,${encodeURIComponent(markup)}`
}

function mountWorkflowWorkbench(): MnExcalidrawCanvas {
  const scene = document.createElement('mn-excalidraw-canvas') as MnExcalidrawCanvas
  scene.graphId = 'sophia-code-lab'
  scene.artifactId = 'srs-workflow-draft'
  scene.title = 'SRS research workflow'
  scene.status = 'ready'
  scene.saveStatus = 'saved'
  scene.projectionStatus = 'ready'
  scene.syncStatus = 'success'
  scene.hydrateStatus = 'idle'
  scene.previewUrl = dataSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" width="960" height="560" viewBox="0 0 960 560">
      <rect width="960" height="560" fill="#f8fafc"/>
      <g fill="#fff" stroke="#334155" stroke-width="3" font-family="system-ui" font-size="22">
        <rect x="80" y="80" width="190" height="78" rx="14"/>
        <text x="175" y="127" text-anchor="middle" fill="#0f172a">Commission</text>
        <rect x="385" y="80" width="190" height="78" rx="14"/>
        <text x="480" y="127" text-anchor="middle" fill="#0f172a">Scope</text>
        <rect x="690" y="80" width="190" height="78" rx="14"/>
        <text x="785" y="127" text-anchor="middle" fill="#0f172a">Search</text>
        <rect x="232" y="300" width="190" height="78" rx="14"/>
        <text x="327" y="347" text-anchor="middle" fill="#0f172a">Read</text>
        <rect x="537" y="300" width="190" height="78" rx="14"/>
        <text x="632" y="347" text-anchor="middle" fill="#0f172a">Synthesize</text>
      </g>
      <g stroke="#2563eb" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <path d="M270 119 H385"/>
        <path d="M575 119 H690"/>
        <path d="M785 158 C782 244 420 220 327 300"/>
        <path d="M422 339 H537"/>
      </g>
      <g fill="#2563eb">
        <path d="M383 110 L401 119 L383 128z"/>
        <path d="M688 110 L706 119 L688 128z"/>
        <path d="M330 291 L327 310 L313 297z"/>
        <path d="M535 330 L553 339 L535 348z"/>
      </g>
    </svg>
  `)
  scene.projection = {
    anchors: 5,
    arrows: 4,
    wireCandidates: 3,
    text: 5,
    frames: 0,
    diagnostics: 1,
    searchText: 'Commission Scope Search Read Synthesize',
  }
  scene.wireSummary = {
    missing: 1,
    hydratable: 3,
    hydrated: 2,
    created: 4,
    lastMessage: 'Three workflow links are ready to sync into the graph.',
  }
  scene.selectedElement = {
    id: 'node-search',
    type: 'rectangle',
    label: 'Search',
    linkKind: 'document',
    linkTargetId: 'paper-wrapper-survey',
    linkTitle: 'Paper adapter survey',
    predicate: 'usesSourceAdapter',
    canOpenLink: true,
    canLink: true,
  }
  scene.predicateOptions = [
    { value: 'usesSourceAdapter', label: 'uses source adapter' },
    { value: 'groundsClaim', label: 'grounds claim' },
    { value: 'producesArtifact', label: 'produces artifact' },
  ]
  scene.diagnostics = [
    {
      code: 'missing-source-wire',
      message: 'Search node should be linked to the selected paper source record.',
      severity: 'warning',
      sceneElementId: 'node-search',
    },
  ]
  scene.linkCandidates = [
    { kind: 'artifact', id: 'paper-wrapper-survey', title: 'Paper adapter survey', mimeType: 'application/json', iconName: 'package' },
    { kind: 'document', id: 'srs-backend-requirements', title: 'SRS backend requirements', iconName: 'file-text' },
  ]
  return scene
}

function mountSidebar(): MnSidebarPanel {
  const sidebar = document.createElement('mn-sidebar-panel') as MnSidebarPanel
  sidebar.sections = sections
  sidebar.searchPlaceholder = 'Search research'
  sidebar.selectedId = 'paper-trail'
  sidebar.addEventListener('mn-sidebar-node-open', (event) => {
    const detail = (event as CustomEvent<{ id: string }>).detail
    sidebar.selectedId = detail.id
  })
  return sidebar
}

function mountSourcePane(): HTMLElement {
  const pane = document.createElement('div')
  pane.slot = 'source'
  pane.className = 'srs-source-pane'
  pane.innerHTML = `
    <style>
      .srs-source-pane {
        display: grid;
        height: 100%;
        min-height: 0;
        grid-template-rows: auto minmax(0, 1fr);
        overflow: hidden;
        background: var(--mn-color-surface-base, #fff);
      }
      .srs-source-cards {
        display: grid;
        gap: 8px;
        padding: 12px;
        border-bottom: 1px solid var(--mn-color-border-default, #e5e7eb);
      }
      .srs-source-workbench {
        min-height: 0;
        overflow: hidden;
      }
      .srs-source-workbench > mn-zotero-source-workbench {
        height: 100%;
      }
    </style>
  `
  const cardStack = document.createElement('div')
  cardStack.className = 'srs-source-cards'
  cardStack.append(mountSourceCard(paperSources[0], true), mountSourceCard(paperSources[1], true))
  const workbenchWrap = document.createElement('div')
  workbenchWrap.className = 'srs-source-workbench'
  workbenchWrap.append(mountSourceWorkbench())
  pane.append(cardStack, workbenchWrap)
  return pane
}

function mountResearchWorkspace(mode: 'source' | 'workflow' = 'source'): MnResearchWorkspace {
  const workspace = document.createElement('mn-research-workspace') as MnResearchWorkspace
  workspace.subtitle = 'Paper adapters -> citation-aware brief'
  workspace.mode = mode
  workspace.addEventListener('mn-research-workspace-mode-change', (event) => {
    workspace.title = `SRS:${(event as CustomEvent<MnResearchWorkspaceModeDetail>).detail.mode}`
  })

  const headerChip = document.createElement('mn-research-source-chip') as MnResearchSourceChip
  headerChip.slot = 'header-actions'
  headerChip.sourceId = 'paper-wrapper-survey'
  headerChip.label = 'papers.search'
  headerChip.kind = 'preprint'
  headerChip.status = 'selected'
  headerChip.score = 0.88

  const sidebar = mountSidebar()
  sidebar.slot = 'sidebar'
  const chat = mountResearchChat()
  chat.slot = 'chat'
  const workflow = mountWorkflowWorkbench()
  workflow.slot = 'workflow'
  const trace = mountRunTrace()
  trace.slot = 'trace'

  workspace.append(headerChip, sidebar, chat, mountSourcePane(), workflow, trace)
  return workspace
}

function fullHeight(child: HTMLElement): HTMLElement {
  const wrap = document.createElement('div')
  wrap.style.height = '100vh'
  wrap.style.minHeight = '0'
  wrap.append(child)
  return wrap
}

export const AtomsSourceChip: Story = {
  name: 'Atom / Source chip',
  render: () => mountSourceChipAtom(),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const chip = canvasElement.querySelector('mn-research-source-chip') as MnResearchSourceChip | null
    if (!chip) throw new Error('AtomsSourceChip.play: missing source chip')
    await chip.updateComplete
    let selected = ''
    chip.addEventListener('mn-research-source-chip-select', (event) => {
      selected = (event as CustomEvent<{ id: string }>).detail.id
    }, { once: true })
    chip.shadowRoot?.querySelector<HTMLButtonElement>('button')?.click()
    if (!selected) {
      throw new Error('AtomsSourceChip.play: source chip select did not emit')
    }
  },
}

export const MoleculesSourceCard: Story = {
  name: 'Molecule / Source card',
  render: () => {
    const wrap = document.createElement('div')
    wrap.style.cssText = 'max-width:520px;padding:24px;'
    wrap.append(mountSourceCard())
    return wrap
  },
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const card = canvasElement.querySelector('mn-research-source-card') as MnResearchSourceCard | null
    if (!card) throw new Error('MoleculesSourceCard.play: missing source card')
    await card.updateComplete
    const open = card.shadowRoot?.querySelector<HTMLButtonElement>('[aria-label="Open source"]')
    if (!open) throw new Error('MoleculesSourceCard.play: missing open button')
    open.click()
    if (card.title !== 'open:paper-wrapper-survey') {
      throw new Error(`MoleculesSourceCard.play: expected open intent, got ${card.title}`)
    }
  },
}

export const MoleculesRunTrace: Story = {
  name: 'Molecule / Run trace',
  render: () => {
    const wrap = document.createElement('div')
    wrap.style.cssText = 'max-width:440px;padding:24px;'
    wrap.append(mountRunTrace())
    return wrap
  },
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const trace = canvasElement.querySelector('mn-research-run-trace') as MnResearchRunTrace | null
    if (!trace) throw new Error('MoleculesRunTrace.play: missing run trace')
    await trace.updateComplete
    const step = trace.shadowRoot?.querySelector<HTMLButtonElement>('[data-step-id="search"]')
    if (!step) throw new Error('MoleculesRunTrace.play: missing search step')
    step.click()
    if (trace.title !== 'step:search') throw new Error(`MoleculesRunTrace.play: step did not emit, got ${trace.title}`)
  },
}

export const OrganismsWorkspace: Story = {
  name: 'Organism / Workspace',
  render: () => fullHeight(mountResearchWorkspace()),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const workspace = canvasElement.querySelector('mn-research-workspace') as MnResearchWorkspace | null
    if (!workspace) throw new Error('OrganismsWorkspace.play: workspace did not mount')
    await workspace.updateComplete
    const workflow = workspace.shadowRoot?.querySelectorAll<HTMLButtonElement>('.mode-button')[1]
    if (!workflow) throw new Error('OrganismsWorkspace.play: missing workflow mode')
    workflow.click()
    await workspace.updateComplete
    if (workspace.mode !== 'workflow') throw new Error('OrganismsWorkspace.play: mode switch failed')
  },
}

export const StorySidebarChat: Story = {
  name: 'Story / Sidebar chat',
  render: () => mountResearchChat(),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const chat = (canvasElement.querySelector('sh-chat-panel') ?? canvasElement) as ShChatPanel
    await chat.updateComplete

    const deep = chat.querySelector<HTMLButtonElement>('[data-control-option="deep"]')
    if (!deep) throw new Error('StorySidebarChat.play: missing Deep composer control')
    deep.click()
    await chat.updateComplete
    if (chat.title !== 'depth:deep') throw new Error(`StorySidebarChat.play: expected depth change, got ${chat.title}`)

    const citation = chat.querySelector<HTMLButtonElement>('[data-prompt-option="citation"]')
    if (!citation) throw new Error('StorySidebarChat.play: missing Citation prompt option')
    citation.click()
    await chat.updateComplete
    const useThese = chat.querySelector<HTMLButtonElement>('.prompt-submit')
    if (!useThese || useThese.disabled) throw new Error('StorySidebarChat.play: prompt submit unavailable')
    const beforePrompt = chat.messages.length
    useThese.click()
    await chat.updateComplete
    if (chat.messages.length <= beforePrompt) throw new Error('StorySidebarChat.play: prompt submit did not append messages')

    chat.draft = 'Focus on wrappers that expose an API surface.'
    await chat.updateComplete
    const hoja = chat.querySelector('hoja-editor[posture="composer"]') as HTMLElement & {
      updateComplete: Promise<boolean>
    }
    if (!hoja) throw new Error('StorySidebarChat.play: missing Hoja composer')
    await hoja.updateComplete
    const input = hoja.querySelector('.ProseMirror') as HTMLElement
    if (!input) throw new Error('StorySidebarChat.play: missing Hoja ProseMirror')
    const before = chat.messages.length
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await chat.updateComplete
    if (chat.messages.length <= before) throw new Error('StorySidebarChat.play: send did not append messages')
  },
}

export const StoryPaperSourceWorkbench: Story = {
  name: 'Story / Paper source workbench',
  render: () => fullHeight(mountSourceWorkbench()),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const source = canvasElement.querySelector('mn-zotero-source-workbench') as MnZoteroSourceWorkbench | null
    if (!source) throw new Error('StoryPaperSourceWorkbench.play: source workbench did not mount')
    await source.updateComplete
    if (source.item?.key !== 'paper-wrapper-survey') {
      throw new Error('StoryPaperSourceWorkbench.play: expected stubbed paper source data')
    }
  },
}

export const StoryWorkflowWorkbench: Story = {
  name: 'Story / Workflow workbench',
  render: () => fullHeight(mountWorkflowWorkbench()),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const workflow = canvasElement.querySelector('mn-excalidraw-canvas') as MnExcalidrawCanvas | null
    if (!workflow) throw new Error('StoryWorkflowWorkbench.play: workflow workbench did not mount')
    await workflow.updateComplete
    if (workflow.projection?.wireCandidates !== 3) {
      throw new Error('StoryWorkflowWorkbench.play: expected workflow projection summary')
    }
  },
}

export const StoryCompleteSurface: Story = {
  name: 'Story / Complete surface',
  render: () => fullHeight(mountResearchWorkspace()),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const workspace = canvasElement.querySelector('mn-research-workspace') as MnResearchWorkspace | null
    const sidebar = canvasElement.querySelector('mn-sidebar-panel') as MnSidebarPanel | null
    const chat = canvasElement.querySelector('sh-chat-panel') as ShChatPanel | null
    const source = canvasElement.querySelector('mn-zotero-source-workbench') as MnZoteroSourceWorkbench | null
    const trace = canvasElement.querySelector('mn-research-run-trace') as MnResearchRunTrace | null
    if (!workspace || !sidebar || !chat || !source || !trace) {
      throw new Error('StoryCompleteSurface.play: composed SRS surface did not mount')
    }
    await workspace.updateComplete
    await chat.updateComplete
    await source.updateComplete
    await trace.updateComplete

    const papers = chat.querySelector<HTMLButtonElement>('[data-control-option="papers"]')
    if (!papers?.classList.contains('selected')) {
      throw new Error('StoryCompleteSurface.play: expected Papers reach to be selected')
    }
    if (source.item?.key !== 'paper-wrapper-survey') {
      throw new Error('StoryCompleteSurface.play: source workbench did not receive the stubbed paper record')
    }
    if (trace.steps.length !== runSteps.length) {
      throw new Error('StoryCompleteSurface.play: trace did not receive run steps')
    }
  },
}
