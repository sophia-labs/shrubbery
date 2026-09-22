/**
 * Organism shell-feature composition root.
 *
 * Add independent feature controllers to this list. `main.ts` is already wired
 * to the resulting host at every lifecycle boundary, so feature work does not
 * need to edit the monolithic shell again.
 */

import type {
  ChromePresenceFollowDetail,
  ChromePresenceOpenDetail,
  ChromePresenceSelfUpdateDetail,
  MnBottomBar,
  MnSettingsActionDetail,
  MnSettingsSelectChangeDetail,
  MnSettingsToggleChangeDetail,
  WfGraphIntentDetail,
  WfRunCompareDetail,
  WfRunConnectDetail,
  WfRunDetail,
  WfStudioGraphDetail,
  WfStudioScreenChangeDetail,
  WfStudioShell,
  WfWorkflowLaunchDetail,
  WfWorkflowRequestDetail,
} from '@shrubbery/components'
import type { ShrubberyContract } from '@shrubbery/nucleus'
import type { RenderWorkspaceOptions, SidebarNode } from '@shrubbery/runtime'
import {
  applyEditorMaterial,
  applySkin,
  applyTheme,
  isVisualIdentitySkin,
  type Theme,
  type VisualIdentitySkin,
} from '@shrubbery/tokens'
import {
  type AccessGrantGateway,
  type AccessGrantUi,
  OrganismAccessGrantController,
} from './access-grant-controller.js'
import {
  ChoreographStudioController,
  ChoreographStudioService,
  type ChoreographStudioSnapshot,
} from './choreograph-studio-service.js'
import {
  OrganismChromeController,
  revealFollowedPresenceCursor,
} from './chrome-controller.js'
import { PRESENCE_COLORS } from './crdt-presence.js'
import { GardendLocalAiSettings } from './local-ai-settings.js'
import { OrganismOriginalFileController } from './original-file-controller.js'
import {
  PHANES_CONTROL_GRAPH_ID,
  PhanesControlApi,
  type PhanesControlMcp,
} from './phanes-control-api.js'
import type { ProviderSecretStore } from './provider-secret-store.js'
import { GardendSettingsOperations } from './settings-operations.js'
import {
  createDefaultSettingsService,
  readAppearancePreferences,
  readEditorMaterialPreference,
  resolveThemePreference,
} from './settings-service.js'
import type { ShellContext } from './shell-context.js'
import {
  createShellFeatureHost,
  type ShellFeature,
  type ShellFeatureHost,
} from './shell-feature-host.js'
import {
  makeSidebarDocumentEditable,
  type SidebarMutationMcp,
} from './sidebar-mutations.js'
import { OrganismTtsController, type TtsEditorHost } from './tts-controller.js'
import './phanes-control-editor.js'
import {
  AGENT_STUDIO_GRAPH_ID,
  AgentStudioApi,
} from './agent-studio-api.js'
import type { MnPhanesControlEditor } from './phanes-control-editor.js'
import './agent-studio-editor.js'
import type { MnAgentStudioEditor } from './agent-studio-editor.js'

interface FeatureContract {
  readonly auth?: {
    userId(): string
    signOut?(): Promise<void>
  }
  readonly runtime?: {
    graphBaseUrl(graphId: string): string
  }
  readonly providerSecrets?: ProviderSecretStore
  readonly rawMcp?: PhanesControlMcp
}

const phanesControlApis = new WeakMap<object, PhanesControlApi>()
const agentStudioApis = new WeakMap<object, AgentStudioApi>()

/** One stable cross-graph control capability per authenticated cell contract. */
function phanesControlApiFor(value: unknown): PhanesControlApi | undefined {
  if (!value || typeof value !== 'object') return undefined
  const rawMcp = (value as Partial<FeatureContract>).rawMcp
  if (!rawMcp || typeof rawMcp !== 'object') return undefined
  const key = rawMcp as object
  let api = phanesControlApis.get(key)
  if (!api) {
    api = new PhanesControlApi(rawMcp)
    phanesControlApis.set(key, api)
  }
  return api
}

function agentStudioApiFor(value: unknown): AgentStudioApi | undefined {
  if (!value || typeof value !== 'object') return undefined
  const rawMcp = (value as Partial<FeatureContract>).rawMcp
  if (!rawMcp || typeof rawMcp !== 'object') return undefined
  const key = rawMcp as object
  let api = agentStudioApis.get(key)
  if (!api) {
    api = new AgentStudioApi(rawMcp)
    agentStudioApis.set(key, api)
  }
  return api
}

export const ORGANISM_APPEARANCE_CHANGE_EVENT = 'mn-organism-appearance-change'

export interface OrganismAppearanceChangeDetail {
  readonly skin?: VisualIdentitySkin
  readonly theme?: Theme
}

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

interface TauriGlobal {
  readonly __TAURI_INTERNALS__?: { readonly invoke?: TauriInvoke }
}

function browserStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'object' ? globalThis.localStorage : null
  } catch {
    return null
  }
}

function nativeInvoke(): TauriInvoke | undefined {
  return (globalThis as TauriGlobal).__TAURI_INTERNALS__?.invoke
}

function findNode(nodes: readonly SidebarNode[], id: string): SidebarNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const nested = findNode(node.children ?? [], id)
    if (nested) return nested
  }
  return null
}

function documentTitle(options: Readonly<RenderWorkspaceOptions>, documentId: string | null): string | null {
  if (!documentId) return null
  for (const section of options.sidebar?.sections ?? []) {
    const node = findNode(section.nodes ?? [], documentId)
    if (node) return node.label
  }
  return null
}

function editorText(context: ShellContext<unknown>): string | null {
  const host = context.host.querySelector('#mn-editor-host') as {
    liveEditor?: { getText(): string } | null
  } | null
  return host?.liveEditor?.getText() ?? null
}

function editorHost(context: ShellContext<unknown>): TtsEditorHost | null {
  return context.host.querySelector('#mn-editor-host') as TtsEditorHost | null
}

type OriginalFileContract = Pick<ShrubberyContract, 'auth' | 'runtime'>
type ImportedDocumentContract = OriginalFileContract & { readonly mcp?: SidebarMutationMcp }

function originalFileContract(value: unknown): OriginalFileContract | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<OriginalFileContract>
  const auth = candidate.auth
  const runtime = candidate.runtime
  return auth
    && typeof auth.token === 'function'
    && typeof auth.userId === 'function'
    && typeof auth.whenReady === 'function'
    && runtime
    && typeof runtime.graphBaseUrl === 'function'
    ? candidate as OriginalFileContract
    : null
}

type SettingsOperationsContract = Pick<ShrubberyContract, 'auth' | 'runtime' | 'ui'>
type ChoreographStudioContract = Pick<ShrubberyContract, 'auth' | 'runtime' | 'rest'>

function settingsOperationsContract(value: unknown): SettingsOperationsContract | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<SettingsOperationsContract>
  return candidate.auth
    && typeof candidate.auth.token === 'function'
    && typeof candidate.auth.userId === 'function'
    && candidate.runtime
    && typeof candidate.runtime.graphBaseUrl === 'function'
    && candidate.ui
    && typeof candidate.ui.confirm === 'function'
    ? candidate as SettingsOperationsContract
    : null
}

function choreographStudioContract(value: unknown): ChoreographStudioContract | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<ChoreographStudioContract>
  return candidate.auth
    && typeof candidate.auth.token === 'function'
    && typeof candidate.auth.userId === 'function'
    && typeof candidate.auth.whenReady === 'function'
    && candidate.runtime
    && typeof candidate.runtime.graphBaseUrl === 'function'
    && candidate.rest
    && typeof candidate.rest.query === 'function'
    ? candidate as ChoreographStudioContract
    : null
}

interface HostedAccessContract {
  readonly auth: { userId(): string }
  readonly gateway: AccessGrantGateway
  readonly ui: AccessGrantUi
}

function hostedAccessContract(value: unknown): HostedAccessContract | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<HostedAccessContract>
  return candidate.auth
    && typeof candidate.auth.userId === 'function'
    && candidate.gateway
    && typeof candidate.gateway.access === 'function'
    && typeof candidate.gateway.putAccess === 'function'
    && typeof candidate.gateway.deleteAccess === 'function'
    && candidate.ui
    && typeof candidate.ui.confirm === 'function'
    ? candidate as HostedAccessContract
    : null
}

function applyPreference(
  detail: MnSettingsToggleChangeDetail | MnSettingsSelectChangeDetail,
): void {
  const root = document.documentElement
  if ('value' in detail && detail.settingId === 'theme') {
    const preference = detail.value === 'light' || detail.value === 'dark'
      ? detail.value
      : 'system'
    const theme = resolveThemePreference(preference)
    applyTheme({ theme, target: root })
    applyTheme({ theme, target: document.body })
    document.dispatchEvent(new CustomEvent<OrganismAppearanceChangeDetail>(
      ORGANISM_APPEARANCE_CHANGE_EVENT,
      { detail: { theme } },
    ))
  } else if ('value' in detail && detail.settingId === 'skin') {
    const skin = isVisualIdentitySkin(detail.value) ? detail.value : 'garden'
    applySkin({ skin, target: root })
    applySkin({ skin, target: document.body })
    document.dispatchEvent(new CustomEvent<OrganismAppearanceChangeDetail>(
      ORGANISM_APPEARANCE_CHANGE_EVENT,
      { detail: { skin } },
    ))
  } else if ('checked' in detail && detail.settingId === 'reducedMotion') {
    root.toggleAttribute('data-reduced-motion', detail.checked)
  } else if ('value' in detail && detail.settingId === 'editorMaterial') {
    const material = detail.value === 'paper' || detail.value === 'classic-word'
      ? detail.value
      : 'continuous'
    applyEditorMaterial({ material, target: root })
  } else if ('checked' in detail && detail.settingId === 'panelLabels') {
    root.toggleAttribute('data-panel-labels', detail.checked)
  }
}

function applyStoredAppearance(): void {
  const appearance = readAppearancePreferences(browserStorage())
  const theme = resolveThemePreference(appearance.theme)
  for (const target of [document.documentElement, document.body]) {
    applySkin({ skin: appearance.skin, target })
    applyTheme({ theme, target })
  }
}

async function settingsAction(
  context: ShellContext<unknown>,
  detail: MnSettingsActionDetail,
  apiBaseUrl: string,
  mcpUrl: string,
): Promise<void> {
  const contract = context.contract as FeatureContract | null
  if (detail.actionId === 'sign-out' && contract?.auth?.signOut) {
    await contract.auth.signOut()
    globalThis.location?.assign('/signin')
    return
  }
  if (detail.actionId === 'copy-api-url' || detail.actionId === 'copy-mcp-url') {
    const value = detail.actionId === 'copy-api-url' ? apiBaseUrl : mcpUrl
    await globalThis.navigator?.clipboard?.writeText(value)
    return
  }
  if (detail.actionId === 'open-history' && context.documentId) {
    document.dispatchEvent(new CustomEvent('mn-editor-history-open', {
      detail: { documentId: context.documentId },
      bubbles: true,
      composed: true,
    }))
  }
}

const SETTINGS_ACTIONS = new Set(['sign-out', 'copy-api-url', 'copy-mcp-url', 'open-history'])

function settingsFeature<TContract>(): ShellFeature<TContract> {
  return {
    id: 'settings-controller',
    workspaceSnapshot() {
      applyStoredAppearance()
      applyEditorMaterial({
        material: readEditorMaterialPreference(browserStorage()),
        target: document.documentElement,
      })
    },
    routeOptions(context) {
      applyStoredAppearance()
      applyEditorMaterial({
        material: readEditorMaterialPreference(browserStorage()),
        target: document.documentElement,
      })
      const contract = context.contract as FeatureContract | null
      const runtimeMode = context.deploymentMode === 'hosted' ? 'hosted' : 'local'
      const base = contract?.runtime?.graphBaseUrl(context.graphId) ?? ''
      const invoke = nativeInvoke()
      const operationsContract = settingsOperationsContract(context.contract)
      const operations = operationsContract
        ? new GardendSettingsOperations(
            operationsContract,
            context.graphId,
            context.documentId,
            runtimeMode,
          )
        : undefined
      const localAi = operationsContract && runtimeMode === 'local'
        ? new GardendLocalAiSettings(operationsContract, context.graphId)
        : undefined
      const phanesControl = phanesControlApiFor(context.contract)
      return {
        settingsService: createDefaultSettingsService({
          runtimeMode,
          userName: contract?.auth?.userId() ?? (runtimeMode === 'local' ? 'Local user' : ''),
          apiBaseUrl: base,
          mcpUrl: base ? `${base.replace(/\/$/, '')}/mcp` : '',
          storage: browserStorage(),
          invoke,
          providerSecrets: contract?.providerSecrets,
          operations,
          localAi,
          phanesControl,
          onPreferenceChange: applyPreference,
          isActionAvailable: actionId => SETTINGS_ACTIONS.has(actionId) && (
            actionId !== 'sign-out' || typeof contract?.auth?.signOut === 'function'
          ) && (actionId !== 'open-history' || Boolean(context.documentId)),
          onAction: detail => settingsAction(context, detail, base, base ? `${base.replace(/\/$/, '')}/mcp` : ''),
        }),
      }
    },
  }
}

/**
 * Bind the graph-authored Phanes workspace stamp to its host-owned authority.
 * The graph chooses the admitted presentation tag; code fixes the target graph
 * and refuses to hand the cross-graph capability to the same tag in any other
 * workspace.
 */
export function createPhanesControlWorkspaceFeature<TContract>(): ShellFeature<TContract> {
  return {
    id: 'phanes-control-workspace',
    afterWorkspaceRender(context) {
      const controls = context.host.querySelectorAll<MnPhanesControlEditor>('mn-phanes-control-editor')
      const api = context.graphId === PHANES_CONTROL_GRAPH_ID
        ? phanesControlApiFor(context.contract)
        : undefined
      for (const control of controls) {
        control.workspaceSurface = true
        control.api = api ?? null
      }
    },
  }
}

export function createAgentStudioWorkspaceFeature<TContract>(): ShellFeature<TContract> {
  return {
    id: 'agent-studio-workspace',
    afterWorkspaceRender(context) {
      const editors = context.host.querySelectorAll<MnAgentStudioEditor>('mn-agent-studio-editor')
      const api = context.graphId === AGENT_STUDIO_GRAPH_ID
        ? agentStudioApiFor(context.contract)
        : undefined
      for (const editor of editors) {
        editor.workspaceSurface = true
        editor.api = api ?? null
      }
    },
  }
}

function chromeFeature<TContract>(): ShellFeature<TContract> {
  let controller: OrganismChromeController | null = null
  let listeningRoot: HTMLElement | null = null
  const ensure = (context: ShellContext<TContract>): OrganismChromeController => {
    controller ??= new OrganismChromeController({
      runtimeMode: context.deploymentMode === 'hosted' ? 'hosted' : 'local',
      requestRender: context.rerender,
    })
    return controller
  }
  const onPresenceOpen = (event: Event): void => {
    const detail = (event as CustomEvent<ChromePresenceOpenDetail>).detail
    if (detail?.person?.id) controller?.openPresence(detail.person.id)
  }
  const onPresenceClose = (): void => controller?.closePresence()
  const onPresenceFollow = (event: Event): void => {
    const detail = (event as CustomEvent<ChromePresenceFollowDetail>).detail
    if (!detail?.session?.clientId) return
    controller?.setFollowedPresenceClient(detail.session.clientId, detail.following)
  }
  const onPresenceSelfUpdate = (event: Event): void => {
    const detail = (event as CustomEvent<ChromePresenceSelfUpdateDetail>).detail
    if (!detail?.person?.id) return
    controller?.updateSelfPresence(detail.person.id, {
      ...(detail.name === undefined ? {} : { name: detail.name }),
      ...(detail.color === undefined ? {} : { color: detail.color }),
    })
  }
  const onPresenceOverflowToggle = (event: Event): void => {
    const detail = (event as CustomEvent<{ readonly open?: boolean }>).detail
    controller?.setPresenceOverflowOpen(Boolean(detail?.open))
  }
  const listen = (root: HTMLElement): void => {
    if (listeningRoot === root) return
    if (listeningRoot) {
      listeningRoot.removeEventListener('mn-presence-open', onPresenceOpen)
      listeningRoot.removeEventListener('mn-presence-close', onPresenceClose)
      listeningRoot.removeEventListener('mn-presence-follow', onPresenceFollow)
      listeningRoot.removeEventListener('mn-presence-self-update', onPresenceSelfUpdate)
      listeningRoot.removeEventListener('mn-presence-overflow-toggle', onPresenceOverflowToggle)
    }
    listeningRoot = root
    root.addEventListener('mn-presence-open', onPresenceOpen)
    root.addEventListener('mn-presence-close', onPresenceClose)
    root.addEventListener('mn-presence-follow', onPresenceFollow)
    root.addEventListener('mn-presence-self-update', onPresenceSelfUpdate)
    root.addEventListener('mn-presence-overflow-toggle', onPresenceOverflowToggle)
  }
  return {
    id: 'workspace-chrome-controller',
    bindProvider(provider, context) {
      ensure(context).bindProvider(provider)
      return () => controller?.bindProvider(null)
    },
    workspaceSnapshot(context, snapshot) {
      const projection = ensure(context).snapshot({
        graphId: context.graphId,
        documentId: context.documentId,
        documentTitle: documentTitle(snapshot, context.documentId),
        sidebarSections: snapshot.sidebar?.sections,
        editorText: editorText(context as ShellContext<unknown>),
      })
      return {
        chrome: {
          ...snapshot.chrome,
          ...projection,
          documentExportAvailable: Boolean(context.documentId),
          onBreadcrumbOpen: ({ breadcrumb }) => {
            if (breadcrumb.kind === 'graph') {
              context.host.dispatchEvent(new CustomEvent('mn-navigate-home', {
                bubbles: true,
                composed: true,
              }))
            }
          },
          onBreadcrumbMenuOpen: (detail) => {
            context.host.dispatchEvent(new CustomEvent('mn-breadcrumb-menu-open', {
              detail,
              bubbles: true,
              composed: true,
            }))
          },
        },
      }
    },
    afterWorkspaceRender(context) {
      listen(context.host)
      const bar = context.host.querySelector('mn-bottom-bar') as MnBottomBar | null
      const interaction = controller?.interactionState()
      if (bar && interaction) {
        bar.openPresenceId = interaction.openPresenceId
        bar.followedPresenceClientId = interaction.followedPresenceClientId
        bar.selfPresenceEditable = interaction.selfPresenceEditable
        bar.presenceColors = PRESENCE_COLORS
        bar.presenceOverflowOpen = interaction.presenceOverflowOpen
      }
      revealFollowedPresenceCursor(
        context.host,
        interaction?.followedPresenceClientId ?? null,
      )
    },
    destroy() {
      if (listeningRoot) {
        listeningRoot.removeEventListener('mn-presence-open', onPresenceOpen)
        listeningRoot.removeEventListener('mn-presence-close', onPresenceClose)
        listeningRoot.removeEventListener('mn-presence-follow', onPresenceFollow)
        listeningRoot.removeEventListener('mn-presence-self-update', onPresenceSelfUpdate)
        listeningRoot.removeEventListener('mn-presence-overflow-toggle', onPresenceOverflowToggle)
      }
      controller?.destroy()
      controller = null
      listeningRoot = null
    },
  }
}

function hostedAccessFeature<TContract>(): ShellFeature<TContract> {
  let controller: OrganismAccessGrantController | null = null
  const ensure = (context: ShellContext<TContract>): OrganismAccessGrantController => {
    controller ??= new OrganismAccessGrantController({ requestRender: context.rerender })
    return controller
  }
  return {
    id: 'hosted-access-grants',
    workspaceSnapshot(context, snapshot) {
      const contract = context.deploymentMode === 'hosted'
        ? hostedAccessContract(context.contract)
        : null
      const currentUserId = contract?.auth.userId().trim() ?? ''
      if (!contract || !currentUserId || !context.graphId.trim()) {
        controller?.setScope(null)
        return {
          chrome: {
            ...snapshot.chrome,
            access: null,
          },
        }
      }
      const workspace = snapshot.chrome?.workspaces?.find(item => item.graphId === context.graphId)
      const graphCrumb = snapshot.chrome?.breadcrumbs?.find(item => item.kind === 'graph')
      const active = ensure(context)
      active.setScope({
        gateway: contract.gateway,
        ui: contract.ui,
        graphId: context.graphId,
        graphTitle: workspace?.title || graphCrumb?.label || context.graphId,
        currentUserId,
        roleHint: workspace?.role ?? 'unknown',
      })
      return {
        chrome: {
          ...snapshot.chrome,
          access: active.snapshot(),
        },
      }
    },
    destroy() {
      controller?.destroy()
      controller = null
    },
  }
}

function ttsFeature<TContract>(): ShellFeature<TContract> {
  let controller: OrganismTtsController | null = null
  const ensure = (context: ShellContext<TContract>): OrganismTtsController => {
    controller ??= new OrganismTtsController({ requestRender: context.rerender })
    return controller
  }
  return {
    id: 'browser-tts-controller',
    bindProvider(_provider, context) {
      const active = ensure(context)
      active.setScope(context.graphId, context.documentId)
      // Provider cleanup can run inside Organism's authoritative render path;
      // reset synchronously without recursively requesting another render.
      return () => active.stop(false)
    },
    workspaceSnapshot(context) {
      const active = ensure(context)
      active.setScope(context.graphId, context.documentId)
      active.setEditorHost(editorHost(context as ShellContext<unknown>))
      return { tts: active.snapshot() }
    },
    afterWorkspaceRender(context) {
      ensure(context).setEditorHost(editorHost(context as ShellContext<unknown>))
    },
    destroy() {
      controller?.destroy()
      controller = null
    },
  }
}

/**
 * Connect the Choreograph app branch to its host-owned run controller.
 *
 * `wf-studio-shell` is deliberately a controlled component: it never reaches
 * into a cell by itself.  The normal workspace app-switcher stamps that
 * component through the RDF layout interpreter, so this feature is the missing
 * host seam that gives it the same authenticated graph-scoped behavior as the
 * standalone `/choreograph` route.
 */
export function createChoreographStudioFeature<TContract = unknown>(): ShellFeature<TContract> {
  let controller: ChoreographStudioController | null = null
  let controllerContract: ChoreographStudioContract | null = null
  let unsubscribe: (() => void) | null = null
  let root: HTMLElement | null = null
  let studio: WfStudioShell | null = null
  let context: ShellContext<TContract> | null = null
  let graphId = ''
  let snapshot: ChoreographStudioSnapshot | null = null

  const applySnapshot = (): void => {
    if (!studio || !snapshot) return
    studio.graphId = graphId
    studio.historyStatus = snapshot.historyStatus
    studio.historyError = snapshot.historyError
    studio.historyRuns = snapshot.historyRuns
    studio.monitorStatus = snapshot.monitorStatus
    studio.monitorError = snapshot.monitorError
    studio.provenance = snapshot.provenance
    studio.telemetry = snapshot.telemetry
    studio.liveMessage = snapshot.liveMessage
    studio.workflowStatus = snapshot.workflowStatus
    studio.workflowError = snapshot.workflowError
    studio.workflows = snapshot.workflows
    studio.selectedWorkflowName = snapshot.selectedWorkflowName
    studio.launchPending = snapshot.launchPending
    studio.launchError = snapshot.launchError
    studio.launchedRunId = snapshot.launchedRunId
    studio.anatomyStatus = snapshot.anatomyStatus
    studio.anatomyError = snapshot.anatomyError
    studio.anatomy = snapshot.anatomy
    studio.gatesStatus = snapshot.gatesStatus
    studio.gatesError = snapshot.gatesError
    studio.gates = snapshot.gates
    studio.compareStatus = snapshot.compareStatus
    studio.compareError = snapshot.compareError
    studio.comparePending = snapshot.comparePending
    studio.comparison = snapshot.comparison
  }

  const destroyController = (): void => {
    unsubscribe?.()
    unsubscribe = null
    controller?.destroy()
    controller = null
    controllerContract = null
    snapshot = null
  }

  const isCurrentStudioEvent = (event: Event): boolean =>
    Boolean(controller && studio && context?.app === 'choreograph' && event.composedPath().includes(studio))

  const requestedGraph = (value: string | null | undefined): string =>
    value?.trim() || graphId || context?.graphId.trim() || ''

  const onRefresh = (event: Event): void => {
    if (!isCurrentStudioEvent(event)) return
    const detail = (event as CustomEvent<WfGraphIntentDetail>).detail
    void controller?.refreshHistory(requestedGraph(detail.graphId))
  }

  const onRunConnect = (event: Event): void => {
    if (!isCurrentStudioEvent(event)) return
    const detail = (event as CustomEvent<WfRunConnectDetail>).detail
    void controller?.openRun(requestedGraph(detail.graphId), detail.runId)
  }

  const onWorkflowsRefresh = (event: Event): void => {
    if (!isCurrentStudioEvent(event)) return
    const detail = (event as CustomEvent<WfStudioGraphDetail>).detail
    void controller?.refreshWorkflows(requestedGraph(detail.graphId))
  }

  const onWorkflowLaunch = (event: Event): void => {
    if (!isCurrentStudioEvent(event)) return
    const detail = (event as CustomEvent<WfWorkflowLaunchDetail>).detail
    void controller?.launchWorkflow({
      ...detail,
      graphId: requestedGraph(detail.graphId),
    })
  }

  const onAnatomyRequest = (event: Event): void => {
    if (!isCurrentStudioEvent(event)) return
    const detail = (event as CustomEvent<WfWorkflowRequestDetail>).detail
    void controller?.loadAnatomy(requestedGraph(detail.graphId), detail.workflowName)
  }

  const onGatesRequest = (event: Event): void => {
    if (!isCurrentStudioEvent(event)) return
    const detail = (event as CustomEvent<WfWorkflowRequestDetail>).detail
    controller?.loadGates(requestedGraph(detail.graphId), detail.workflowName)
  }

  const onRunCompare = (event: Event): void => {
    if (!isCurrentStudioEvent(event)) return
    const detail = (event as CustomEvent<WfRunCompareDetail>).detail
    void controller?.compareRuns(
      requestedGraph(detail.graphId),
      detail.leftRunId,
      detail.rightRunId,
    )
  }

  const onRetry = (event: Event): void => {
    if (!isCurrentStudioEvent(event)) return
    controller?.retry()
  }

  const onReplay = (event: Event): void => {
    if (!isCurrentStudioEvent(event)) return
    const detail = (event as CustomEvent<WfRunDetail>).detail
    void controller?.openRun(graphId, detail.runId)
  }

  const onProvenanceRefresh = (event: Event): void => {
    if (!isCurrentStudioEvent(event)) return
    void controller?.refreshProvenance()
  }

  const onScreenChange = (event: Event): void => {
    if (!isCurrentStudioEvent(event)) return
    const detail = (event as CustomEvent<WfStudioScreenChangeDetail>).detail
    const targetGraph = requestedGraph(detail.graphId)
    if (detail.screen === 'run' && detail.runId) {
      void controller?.openRun(targetGraph, detail.runId)
    } else if (detail.screen === 'home' || detail.screen === 'runs') {
      void controller?.refreshHistory(targetGraph)
    }
  }

  const stopListening = (): void => {
    if (!root) return
    root.removeEventListener('choreo-refresh', onRefresh)
    root.removeEventListener('choreo-workflows-refresh', onWorkflowsRefresh)
    root.removeEventListener('choreo-workflow-launch', onWorkflowLaunch)
    root.removeEventListener('choreo-anatomy-request', onAnatomyRequest)
    root.removeEventListener('choreo-gates-request', onGatesRequest)
    root.removeEventListener('choreo-run-compare', onRunCompare)
    root.removeEventListener('choreo-run-connect', onRunConnect)
    root.removeEventListener('choreo-retry', onRetry)
    root.removeEventListener('choreo-replay', onReplay)
    root.removeEventListener('choreo-provenance-refresh', onProvenanceRefresh)
    root.removeEventListener('choreo-screen-change', onScreenChange)
    root = null
  }

  const listen = (nextRoot: HTMLElement): void => {
    if (root === nextRoot) return
    stopListening()
    root = nextRoot
    root.addEventListener('choreo-refresh', onRefresh)
    root.addEventListener('choreo-workflows-refresh', onWorkflowsRefresh)
    root.addEventListener('choreo-workflow-launch', onWorkflowLaunch)
    root.addEventListener('choreo-anatomy-request', onAnatomyRequest)
    root.addEventListener('choreo-gates-request', onGatesRequest)
    root.addEventListener('choreo-run-compare', onRunCompare)
    root.addEventListener('choreo-run-connect', onRunConnect)
    root.addEventListener('choreo-retry', onRetry)
    root.addEventListener('choreo-replay', onReplay)
    root.addEventListener('choreo-provenance-refresh', onProvenanceRefresh)
    root.addEventListener('choreo-screen-change', onScreenChange)
  }

  const release = (): void => {
    stopListening()
    destroyController()
    studio = null
    context = null
    graphId = ''
  }

  return {
    id: 'choreograph-studio-controller',
    afterWorkspaceRender(nextContext) {
      const nextStudio = nextContext.app === 'choreograph'
        ? nextContext.host.querySelector<WfStudioShell>('wf-studio-shell')
        : null
      const contract = choreographStudioContract(nextContext.contract)
      const nextGraphId = nextContext.graphId.trim()
      if (!nextStudio || !contract || !nextGraphId) {
        release()
        return
      }

      context = nextContext
      listen(nextContext.host)
      let controllerChanged = false
      if (!controller || controllerContract !== contract) {
        destroyController()
        controllerContract = contract
        const nextController = new ChoreographStudioController(new ChoreographStudioService(contract))
        controller = nextController
        controllerChanged = true
        unsubscribe = nextController.subscribe((nextSnapshot) => {
          if (controller !== nextController) return
          snapshot = nextSnapshot
          applySnapshot()
        })
      }

      const graphChanged = graphId !== nextGraphId
      graphId = nextGraphId
      studio = nextStudio
      applySnapshot()
      if (graphChanged || controllerChanged) void controller.start('home', graphId, '')
    },
    destroy() {
      release()
    },
  }
}

function originalFileFeature<TContract>(): ShellFeature<TContract> {
  let controller: OrganismOriginalFileController | null = null
  let latestContext: ShellContext<TContract> | null = null
  let listeningRoot: HTMLElement | null = null
  let assignedHost: (HTMLElement & { originalFileView?: unknown }) | null = null
  let renderQueued = false
  let latestSnapshot: Readonly<RenderWorkspaceOptions> | null = null
  let mutationScope = ''
  let makeEditableStatus: 'idle' | 'saving' | 'error' = 'idle'
  let makeEditableError = ''
  const madeEditable = new Set<string>()

  const requestRender = (): void => {
    if (renderQueued) return
    renderQueued = true
    queueMicrotask(() => {
      renderQueued = false
      latestContext?.rerender()
    })
  }
  const ensure = (): OrganismOriginalFileController => {
    controller ??= new OrganismOriginalFileController({
      requestRender,
      fetch: (input, init) => {
        const harnessFetch = (latestContext?.contract as { fetch?: typeof fetch } | null)?.fetch
        return harnessFetch ? harnessFetch(input, init) : globalThis.fetch(input, init)
      },
    })
    return controller
  }
  const onToggle = (): void => { void controller?.toggle() }
  const onReload = (): void => { void controller?.reload() }
  const onDownload = (): void => controller?.download()
  const onOpenExternal = (): void => controller?.openExternal()
  const onChapterSelect = (event: Event): void => {
    const chapterId = (event as CustomEvent<{ chapterId?: string }>).detail?.chapterId?.trim()
    if (chapterId) controller?.selectChapter(chapterId)
  }
  const currentDocumentNode = (): SidebarNode | null => {
    const documentId = latestContext?.documentId
    if (!documentId) return null
    for (const section of latestSnapshot?.sidebar?.sections ?? []) {
      const node = findNode(section.nodes ?? [], documentId)
      if (node?.kind === 'document') return node
    }
    return null
  }
  const onMakeEditable = (): void => {
    const context = latestContext
    const node = currentDocumentNode()
    if (!context?.documentId || !node?.readOnly || makeEditableStatus === 'saving') return
    const mcp = (context.contract as ImportedDocumentContract | null)?.mcp
    if (!mcp || typeof mcp.toolsCall !== 'function') {
      makeEditableStatus = 'error'
      makeEditableError = 'This backend does not expose the authoritative Make Editable operation.'
      requestRender()
      return
    }
    const graphId = context.graphId
    const documentId = context.documentId
    const scope = `${graphId}\u0000${documentId}`
    mutationScope = scope
    makeEditableStatus = 'saving'
    makeEditableError = ''
    requestRender()
    void makeSidebarDocumentEditable(mcp, { graphId, documentId }).then(() => {
      madeEditable.add(scope)
      if (mutationScope === scope) {
        makeEditableStatus = 'idle'
        makeEditableError = ''
      }
      requestRender()
    }).catch((error: unknown) => {
      if (mutationScope !== scope) return
      makeEditableStatus = 'error'
      makeEditableError = error instanceof Error ? error.message : String(error)
      requestRender()
    })
  }
  const listen = (root: HTMLElement): void => {
    if (listeningRoot === root) return
    if (listeningRoot) {
      listeningRoot.removeEventListener('mn-editor-original-view-toggle', onToggle)
      listeningRoot.removeEventListener('mn-original-viewer-reload', onReload)
      listeningRoot.removeEventListener('mn-original-viewer-download', onDownload)
      listeningRoot.removeEventListener('mn-original-viewer-open-external', onOpenExternal)
      listeningRoot.removeEventListener('mn-original-viewer-chapter-select', onChapterSelect)
      listeningRoot.removeEventListener('mn-editor-make-editable', onMakeEditable)
    }
    listeningRoot = root
    root.addEventListener('mn-editor-original-view-toggle', onToggle)
    root.addEventListener('mn-original-viewer-reload', onReload)
    root.addEventListener('mn-original-viewer-download', onDownload)
    root.addEventListener('mn-original-viewer-open-external', onOpenExternal)
    root.addEventListener('mn-original-viewer-chapter-select', onChapterSelect)
    root.addEventListener('mn-editor-make-editable', onMakeEditable)
  }

  return {
    id: 'original-file-controller',
    bindProvider(_provider, context) {
      latestContext = context
      const contract = originalFileContract(context.contract)
      ensure().setScope(contract, context.graphId, context.documentId)
      return () => controller?.releaseScope(context.graphId, context.documentId)
    },
    workspaceSnapshot(context, snapshot) {
      latestContext = context
      latestSnapshot = snapshot
      const node = currentDocumentNode()
      const scope = context.documentId ? `${context.graphId}\u0000${context.documentId}` : ''
      if (scope !== mutationScope) {
        mutationScope = scope
        makeEditableStatus = 'idle'
        makeEditableError = ''
      }
      if (node && !node.readOnly) madeEditable.delete(scope)
      ensure().setScope(
        originalFileContract(context.contract),
        context.graphId,
        context.documentId,
        node?.sourceFile ?? null,
      )
      return {
        editorDocumentAccess: context.documentId
          ? {
              readOnly: Boolean(node?.readOnly) && !madeEditable.has(scope),
              makeEditableStatus,
              makeEditableError,
            }
          : null,
      }
    },
    afterWorkspaceRender(context) {
      latestContext = context
      listen(context.host)
      const host = context.host.querySelector('#mn-editor-host') as
        | (HTMLElement & { originalFileView?: unknown })
        | null
      if (assignedHost && assignedHost !== host) assignedHost.originalFileView = null
      assignedHost = host
      if (host) host.originalFileView = ensure().snapshot()
    },
    destroy() {
      if (listeningRoot) {
        listeningRoot.removeEventListener('mn-editor-original-view-toggle', onToggle)
        listeningRoot.removeEventListener('mn-original-viewer-reload', onReload)
        listeningRoot.removeEventListener('mn-original-viewer-download', onDownload)
        listeningRoot.removeEventListener('mn-original-viewer-open-external', onOpenExternal)
        listeningRoot.removeEventListener('mn-original-viewer-chapter-select', onChapterSelect)
        listeningRoot.removeEventListener('mn-editor-make-editable', onMakeEditable)
      }
      if (assignedHost) assignedHost.originalFileView = null
      controller?.destroy()
      controller = null
      assignedHost = null
      listeningRoot = null
      latestContext = null
      latestSnapshot = null
      mutationScope = ''
      makeEditableStatus = 'idle'
      makeEditableError = ''
      madeEditable.clear()
    },
  }
}

export function createOrganismShellFeatureHost<TContract = unknown>(): ShellFeatureHost<TContract> {
  const features: readonly ShellFeature<TContract>[] = [
    settingsFeature<TContract>(),
    createPhanesControlWorkspaceFeature<TContract>(),
    createAgentStudioWorkspaceFeature<TContract>(),
    ttsFeature<TContract>(),
    createChoreographStudioFeature<TContract>(),
    originalFileFeature<TContract>(),
    chromeFeature<TContract>(),
    hostedAccessFeature<TContract>(),
  ]
  return createShellFeatureHost(features)
}
