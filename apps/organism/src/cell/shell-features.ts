/**
 * Organism shell-feature composition root.
 *
 * Add independent feature controllers to this list. `main.ts` is already wired
 * to the resulting host at every lifecycle boundary, so feature work does not
 * need to edit the monolithic shell again.
 */

import { HostedBilling } from './hosted-billing.js'
import { HostedTakeHome } from './hosted-take-home.js'
import { HostedUsageExplorer } from './usage-explorer.js'
import type { AuthProfile } from '@shrubbery/nucleus/contract'
import type {
  ChromePresenceFollowDetail,
  ChromePresenceOpenDetail,
  ChromePresenceSelfUpdateDetail,
  MnBottomBar,
  MnSettingsActionDetail,
  MnSettingsSelectChangeDetail,
  MnSettingsToggleChangeDetail,
} from '@shrubbery/components'
import type { ShrubberyContract } from '@shrubbery/nucleus'
import type { EditorPdfSourceLocation, RenderWorkspaceOptions, SidebarNode } from '@shrubbery/runtime'
import { purgeHostedChatWindows } from '@shrubbery/runtime'
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
  OrganismChromeController,
  revealFollowedPresenceCursor,
} from './chrome-controller.js'
import { PRESENCE_COLORS } from './crdt-presence.js'
import { GardendLocalAiSettings } from './local-ai-settings.js'
import { createGrapevineFeature } from './grapevine-feature.js'
import { createChoreographModesFeature } from './choreograph-modes-feature.js'
import { createFlowAppFeature } from './flow-feature.js'
import { flowAppEnabled } from './flow-workspace.js'
import { OrganismOriginalFileController } from './original-file-controller.js'
import './reader/mn-reader.js'
import { readerAnnotationsFor } from './reader/reader-annotations.js'
import type { OcrTextLayer } from './reader/ocr-text-layer.js'
import {
  documentQuoteState,
  isQuoteSourceDoc,
  type DocumentQuoteState,
  type QuoteSourceDoc,
} from './document-quote-sources.js'
import {
  PHANES_CONTROL_GRAPH_ID,
  PhanesControlApi,
  type PhanesControlMcp,
} from './phanes-control-api.js'
import type { ProviderSecretStore } from './provider-secret-store.js'
import { GardendSettingsOperations } from './settings-operations.js'
import {
  readAppearancePreferences,
  readAccessibilityPreferences,
  readEditorMaterialPreference,
  readEditorTypePreferences,
  readValueGutterPreference,
  applyEditorTypePreferences,
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
import { HostedSettingsCapabilities, hostedGraphSettingsWritable } from './settings-capabilities.js'
import './agent-studio-editor.js'
import { createGatewayApiKeyClient, type ApiKeyGatewayRootTransport } from './api-key-client.js'
import { ApiKeyStore } from './api-key-store.js'
import type { MnAgentStudioEditor } from './agent-studio-editor.js'
import { nativeInvoke } from './native-host.js'
import { createShellSettingsService } from './self-host.js'

interface FeatureContract {
  readonly auth?: {
    userId(): string
    profile?(): AuthProfile | null
    token?(): string | null | undefined
    whenReady?(): Promise<void>
    signOut?(): Promise<void>
  }
  readonly runtime?: {
    graphBaseUrl(graphId: string): string
  }
  readonly providerSecrets?: ProviderSecretStore
  readonly rawMcp?: PhanesControlMcp
  readonly gateway?: {
    readonly gatewayBaseUrl: string
    graphs(): Promise<unknown>
  } & Partial<ApiKeyGatewayRootTransport>
}

const phanesControlApis = new WeakMap<object, PhanesControlApi>()
const agentStudioApis = new WeakMap<object, AgentStudioApi>()

/** A transport is not permission. Only a subject-bound server grant admits Phanes. */
function phanesControlApiFor(value: unknown): PhanesControlApi | undefined {
  if (!value || typeof value !== 'object') return undefined
  const contract = value as FeatureContract
  const { rawMcp, auth, gateway } = contract
  if (!rawMcp || typeof rawMcp.callTool !== 'function'
    || !auth || typeof auth.token !== 'function' || !gateway?.gatewayBaseUrl) return undefined
  const key = value
  let api = phanesControlApis.get(key)
  if (!api) {
    api = new PhanesControlApi(rawMcp, new HostedSettingsCapabilities({
      userId: () => auth.userId(), token: () => auth.token!(), whenReady: () => auth.whenReady?.() ?? Promise.resolve(),
    }, gateway.gatewayBaseUrl))
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


function browserStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'object' ? globalThis.localStorage : null
  } catch {
    return null
  }
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
  } else if ('checked' in detail && detail.settingId === 'reducedTransparency') {
    root.toggleAttribute('data-reduced-transparency', detail.checked)
  } else if ('value' in detail && detail.settingId === 'editorMaterial') {
    const material = detail.value === 'paper' || detail.value === 'classic-word'
      ? detail.value
      : 'continuous'
    applyEditorMaterial({ material, target: root })
  } else if ('value' in detail && (detail.settingId === 'editorFont' || detail.settingId === 'lineWidth' || detail.settingId === 'textSize')) {
    // The service persisted the change before calling here.
    applyEditorTypePreferences(readEditorTypePreferences(browserStorage()), root)
  } else if ('checked' in detail && detail.settingId === 'valueGutter') {
    root.toggleAttribute('data-value-gutter', detail.checked)
  } else if ('checked' in detail && detail.settingId === 'panelLabels') {
    root.toggleAttribute('data-panel-labels', detail.checked)
  }
}

function applyStoredAppearance(): void {
  applyEditorTypePreferences(readEditorTypePreferences(browserStorage()), document.documentElement)
  const appearance = readAppearancePreferences(browserStorage())
  const accessibility = readAccessibilityPreferences(browserStorage())
  const theme = resolveThemePreference(appearance.theme)
  document.documentElement.toggleAttribute('data-reduced-motion', accessibility.reducedMotion)
  document.documentElement.toggleAttribute('data-reduced-transparency', accessibility.reducedTransparency)
  document.documentElement.toggleAttribute('data-value-gutter', readValueGutterPreference(browserStorage()))
  for (const target of [document.documentElement, document.body]) {
    applySkin({ skin: appearance.skin, target })
    applyTheme({ theme, target })
  }
}

export async function settingsAction(
  context: ShellContext<unknown>,
  detail: MnSettingsActionDetail,
  apiBaseUrl: string,
  mcpUrl: string,
): Promise<void> {
  const contract = context.contract as FeatureContract | null
  if (detail.actionId === 'sign-out' && contract?.auth?.signOut) {
    // The text of earlier conversations that a chat keeps to show again is private text this
    // sign-in read: it goes first, whether or not the provider can be reached to end the session.
    purgeHostedChatWindows(browserStorage())
    await contract.auth.signOut()
    globalThis.location?.assign('/signin')
    return
  }
  if (detail.actionId === 'copy-api-url' || detail.actionId === 'copy-mcp-url') {
    const value = detail.actionId === 'copy-api-url' ? apiBaseUrl : mcpUrl
    // navigator.clipboard exists only in secure contexts (HTTPS, localhost); the settings page shows this message.
    const clipboard = globalThis.navigator?.clipboard
    if (!clipboard?.writeText) {
      throw new Error(`Copying needs the clipboard, which this browser offers only over HTTPS or on localhost.${value ? ` The URL: ${value}` : ''}`)
    }
    await clipboard.writeText(value)
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
      const localAi = operationsContract
        ? new GardendLocalAiSettings(operationsContract, context.graphId, {
            runtimeMode,
            canWrite: runtimeMode === 'hosted' ? () => hostedGraphSettingsWritable(
              operationsContract.auth, context.graphId,
              () => contract?.gateway?.graphs() ?? Promise.resolve([]),
            ) : undefined,
          })
        : undefined
      const phanesControl = phanesControlApiFor(context.contract)
      return {
        settingsService: createShellSettingsService({
          apiKeyGraphs: runtimeMode === 'hosted' && contract?.gateway ? async () => {
            const subject = contract.auth?.userId()
            const rows = await contract.gateway!.graphs()
            if (!subject || subject !== contract.auth?.userId() || !Array.isArray(rows)) throw new Error('Graph list unavailable')
            return rows.filter((row): row is { owner: string; graphId: string; title?: string } =>
              typeof row?.owner === 'string' && typeof row?.graphId === 'string')
          } : undefined,
          apiKeyStore: runtimeMode === 'hosted' && contract?.gateway?.listApiKeys && contract.gateway.createApiKey && contract.gateway.deleteApiKey
            ? new ApiKeyStore(createGatewayApiKeyClient(contract.gateway as ApiKeyGatewayRootTransport))
            : undefined,
          runtimeMode,
          userName: contract?.auth?.userId() ?? (runtimeMode === 'local' ? 'Local user' : ''),
          account: runtimeMode === 'hosted' ? () => contract?.auth?.profile?.() ?? (
            contract?.auth?.userId() ? {
              userId: contract.auth.userId(), username: '', name: '', email: '', emailVerified: null,
            } : null
          ) : undefined,
          apiBaseUrl: base,
          mcpUrl: base ? `${base.replace(/\/$/, '')}/mcp` : '',
          storage: browserStorage(),
          invoke,
          providerSecrets: contract?.providerSecrets,
          usageExplorer: runtimeMode === 'hosted' && contract?.auth?.token && contract.gateway?.gatewayBaseUrl
            ? new HostedUsageExplorer({ userId: () => contract.auth!.userId(), token: () => contract.auth!.token!(), whenReady: () => contract.auth!.whenReady?.() ?? Promise.resolve() }, contract.gateway.gatewayBaseUrl)
            : undefined,
          takeHome: runtimeMode === 'hosted' && contract?.auth?.token && contract.gateway?.gatewayBaseUrl
            ? new HostedTakeHome({
                userId: () => contract.auth!.userId(), token: () => contract.auth!.token!(),
                whenReady: () => contract.auth!.whenReady?.() ?? Promise.resolve(),
              }, contract.gateway.gatewayBaseUrl)
            : undefined,
          billing: runtimeMode === 'hosted' && contract?.auth?.token && contract.gateway?.gatewayBaseUrl
            ? new HostedBilling({
                userId: () => contract.auth!.userId(), token: () => contract.auth!.token!(),
                whenReady: () => contract.auth!.whenReady?.() ?? Promise.resolve(),
              }, contract.gateway.gatewayBaseUrl)
            : undefined,
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
  let generation = 0
  const priorDisplay = new WeakMap<HTMLElement, { value: string; priority: string }>()
  return {
    id: 'phanes-control-workspace',
    afterWorkspaceRender(context) {
      const current = ++generation
      const controls = context.host.querySelectorAll<MnPhanesControlEditor>('mn-phanes-control-editor')
      const api = context.graphId === PHANES_CONTROL_GRAPH_ID
        ? phanesControlApiFor(context.contract)
        : undefined
      for (const control of controls) {
        control.workspaceSurface = true
        control.api = null
        if (!priorDisplay.has(control)) priorDisplay.set(control, {
          value: control.style.getPropertyValue('display'), priority: control.style.getPropertyPriority('display'),
        })
        control.hidden = true
        control.style.setProperty('display', 'none', 'important')
      }
      if (!api || !controls.length) return
      void api.refreshAuthorization().then(allowed => {
        if (!allowed || current !== generation || !api.isAvailable()) return
        for (const control of controls) {
          if (!context.host.contains(control)) continue
          const display = priorDisplay.get(control)!
          control.hidden = false
          if (display.value) control.style.setProperty('display', display.value, display.priority)
          else control.style.removeProperty('display')
          control.api = api
        }
      }).catch(() => { /* Remain hidden with no API on any capability failure. */ })
    },
    destroy() { generation += 1 },
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
      if (workspace?.localCreation) {
        // A local Owner placeholder is not hosted grant-management authority.
        controller?.setScope(null)
        return { chrome: { ...snapshot.chrome, access: null } }
      }
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

function originalFileFeature<TContract>(): ShellFeature<TContract> {
  type OriginalHost = HTMLElement & { originalFileView?: unknown; getPdfSourceLocation?(): EditorPdfSourceLocation | null }
  let controller: OrganismOriginalFileController | null = null
  let latestContext: ShellContext<TContract> | null = null
  let listeningRoot: HTMLElement | null = null
  let assignedHost: OriginalHost | null = null
  let renderQueued = false
  let latestSnapshot: Readonly<RenderWorkspaceOptions> | null = null
  let mutationScope = ''
  let makeEditableStatus: 'idle' | 'saving' | 'error' = 'idle'
  let makeEditableError = ''
  const madeEditable = new Set<string>()
  // The open document's Y.Doc, read for block text and highlights while its original is shown.
  let quoteDoc: QuoteSourceDoc | null = null
  let quoteDocVersion = 0
  let quoteState: { readonly doc: QuoteSourceDoc; readonly version: number; readonly state: DocumentQuoteState } | null = null
  const currentQuoteState = (): DocumentQuoteState | null => {
    const doc = quoteDoc
    if (!doc) return null
    if (quoteState?.doc !== doc || quoteState.version !== quoteDocVersion) {
      quoteState = { doc, version: quoteDocVersion, state: documentQuoteState(doc) }
    }
    return quoteState.state
  }

  const requestRender = (): void => {
    if (renderQueued) return
    renderQueued = true
    queueMicrotask(() => {
      renderQueued = false
      latestContext?.rerender()
    })
  }
  // Which view a person last chose for each imported document: the Reader opens on the original unless they chose Text.
  const viewKey = (scope: string): string => `mn-reader:v1:view:${scope}`
  const prefersText = (scope: string): boolean => {
    try { return globalThis.localStorage?.getItem(viewKey(scope)) === 'text' } catch { return false }
  }
  const rememberView = (scope: string, view: 'text' | 'original'): void => {
    try { globalThis.localStorage?.setItem(viewKey(scope), view) } catch { /* the default is the original */ }
  }
  let openedOriginalFor = ''
  const ensure = (): OrganismOriginalFileController => {
    controller ??= new OrganismOriginalFileController({
      readerMode: true,
      requestRender,
      fetch: (input, init) => {
        const harnessFetch = (latestContext?.contract as { fetch?: typeof fetch } | null)?.fetch
        return harnessFetch ? harnessFetch(input, init) : globalThis.fetch(input, init)
      },
    })
    return controller
  }
  const onToggle = (): void => {
    if (mutationScope) rememberView(mutationScope, controller?.snapshot().active ? 'text' : 'original')
    void controller?.toggle(assignedHost?.getPdfSourceLocation?.() ?? null)
  }
  const onReload = (): void => { void controller?.reload() }
  // A scan's words: gardend reads them (read_scan_text, a background job) and keeps them (scan_text_layer).
  const scanChecked = new Set<string>()
  let scanPoll = 0
  const mcpCall = async (name: string, args: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
    const mcp = (latestContext?.contract as ImportedDocumentContract | null)?.mcp
    if (!mcp || typeof mcp.toolsCall !== 'function') return null
    const raw = await mcp.toolsCall(name, args) as { structuredContent?: unknown; content?: { type?: string; text?: string }[] } | null
    if (raw?.structuredContent && typeof raw.structuredContent === 'object') return raw.structuredContent as Record<string, unknown>
    const text = raw?.content?.find(item => item.type === 'text')?.text
    try { return text ? JSON.parse(text) as Record<string, unknown> : null } catch { return null }
  }
  const followScan = (graphId: string, documentId: string): void => {
    window.clearTimeout(scanPoll)
    void mcpCall('scan_text_layer', { graphId, documentId }).then(answer => {
      const status = String(answer?.status ?? 'none')
      const progress = (answer?.progress ?? {}) as { done?: number; total?: number }
      if (status === 'done' && answer?.layer) {
        controller?.attachOcr(graphId, documentId, answer.layer as OcrTextLayer)
      } else if (status === 'running') {
        controller?.setScan(graphId, documentId, { state: 'reading', done: progress.done, total: progress.total })
        scanPoll = window.setTimeout(() => followScan(graphId, documentId), 2000)
      } else if (status === 'failed' || status === 'unavailable') {
        controller?.setScan(graphId, documentId, { state: status, message: typeof answer?.message === 'string' ? answer.message : undefined })
      }
    }).catch(() => { /* an older gardend has no scan tools: the Reader keeps offering, and says so when asked */ })
  }
  const onReadScan = (): void => {
    const scan = controller?.scanWithoutWords
    if (!scan) return
    controller?.setScan(scan.graphId, scan.documentId, { state: 'reading' })
    void mcpCall('read_scan_text', { graphId: scan.graphId, documentId: scan.documentId }).then(answer => {
      const status = String(answer?.status ?? '')
      if (status === 'unavailable' || status === 'failed') {
        controller?.setScan(scan.graphId, scan.documentId, { state: status, message: typeof answer?.message === 'string' ? answer.message : undefined })
      } else followScan(scan.graphId, scan.documentId)
    }).catch((error: unknown) => {
      controller?.setScan(scan.graphId, scan.documentId, { state: 'unavailable', message: error instanceof Error ? error.message : String(error) })
    })
  }
  const onDownload = (): void => controller?.download()
  const onOpenExternal = (): void => controller?.openExternal()
  const onChapterSelect = (event: Event): void => {
    const chapterId = (event as CustomEvent<{ chapterId?: string }>).detail?.chapterId?.trim()
    if (chapterId) controller?.selectChapter(chapterId)
  }
  const onPageSelect = (event: Event): void => {
    const detail = (event as CustomEvent<{ graphId?: string; documentId?: string; pageNumber?: number }>).detail
    if (detail?.graphId === latestContext?.graphId && detail?.documentId === latestContext?.documentId
      && typeof detail?.pageNumber === 'number') void controller?.selectPage(detail.pageNumber)
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
    if (!context?.documentId || !node?.textReadOnly || makeEditableStatus === 'saving') return
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
      listeningRoot.removeEventListener('mn-original-viewer-page-select', onPageSelect)
      listeningRoot.removeEventListener('mn-editor-make-editable', onMakeEditable)
      listeningRoot.removeEventListener('reader-read-scan', onReadScan)
    }
    listeningRoot = root
    root.addEventListener('mn-editor-original-view-toggle', onToggle)
    root.addEventListener('mn-original-viewer-reload', onReload)
    root.addEventListener('mn-original-viewer-download', onDownload)
    root.addEventListener('mn-original-viewer-open-external', onOpenExternal)
    root.addEventListener('mn-original-viewer-chapter-select', onChapterSelect)
    root.addEventListener('mn-original-viewer-page-select', onPageSelect)
    root.addEventListener('mn-editor-make-editable', onMakeEditable)
    root.addEventListener('reader-read-scan', onReadScan)
  }

  return {
    id: 'original-file-controller',
    bindProvider(provider, context) {
      latestContext = context
      const contract = originalFileContract(context.contract)
      ensure().setScope(contract, context.graphId, context.documentId)
      const doc = provider.doc as unknown
      const observable = doc as { on?(event: 'update', cb: () => void): void; off?(event: 'update', cb: () => void): void }
      const onUpdate = (): void => {
        quoteDocVersion += 1
        if (controller?.annotationsWanted) requestRender()
      }
      if (isQuoteSourceDoc(doc)) {
        quoteDoc = doc
        quoteDocVersion += 1
        observable.on?.('update', onUpdate)
      }
      return () => {
        observable.off?.('update', onUpdate)
        if (quoteDoc === doc) {
          quoteDoc = null
          quoteState = null
        }
        controller?.releaseScope(context.graphId, context.documentId)
      }
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
      if (node && !node.textReadOnly) madeEditable.delete(scope)
      const active = ensure()
      active.setScope(
        originalFileContract(context.contract),
        context.graphId,
        context.documentId,
        node?.sourceFile ?? null,
      )
      // An imported, read-only document opens on its original, in the Reader, unless its reader chose Text last time.
      if (!scope) openedOriginalFor = ''
      else if (scope !== openedOriginalFor && node?.textReadOnly && !madeEditable.has(scope) && active.snapshot().available) {
        openedOriginalFor = scope
        if (!active.snapshot().active && !prefersText(scope)) void active.toggle(null)
      }
      // A scan shown in the Reader: ask once whether gardend has read its words (or is reading them).
      const scan = active.scanWithoutWords
      if (scan && !scanChecked.has(`${scan.graphId}\u0000${scan.documentId}`)) {
        scanChecked.add(`${scan.graphId}\u0000${scan.documentId}`)
        followScan(scan.graphId, scan.documentId)
      }
      // The comments (and highlights) of this document, drawn over its original while it is open.
      if (active.annotationsWanted) {
        active.setAnnotations(readerAnnotationsFor(snapshot.comments?.comments ?? [], currentQuoteState()))
      }
      return {
        editorDocumentAccess: context.documentId
          ? {
              readOnly: Boolean(node?.textReadOnly) && !madeEditable.has(scope),
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
        | OriginalHost
        | null
      if (assignedHost && assignedHost !== host) assignedHost.originalFileView = null
      assignedHost = host
      // Highlights and notes are saved into the open document's comments, so they need its live Y.Doc.
      if (host) host.originalFileView = { ...ensure().snapshot(), readerCanAnnotate: quoteDoc !== null }
    },
    destroy() {
      if (listeningRoot) {
        listeningRoot.removeEventListener('mn-editor-original-view-toggle', onToggle)
        listeningRoot.removeEventListener('mn-original-viewer-reload', onReload)
        listeningRoot.removeEventListener('mn-original-viewer-download', onDownload)
        listeningRoot.removeEventListener('mn-original-viewer-open-external', onOpenExternal)
        listeningRoot.removeEventListener('mn-original-viewer-chapter-select', onChapterSelect)
        listeningRoot.removeEventListener('mn-original-viewer-page-select', onPageSelect)
        listeningRoot.removeEventListener('mn-editor-make-editable', onMakeEditable)
        listeningRoot.removeEventListener('reader-read-scan', onReadScan)
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
    createChoreographModesFeature<TContract>(),
    createGrapevineFeature<TContract>(),
    createFlowAppFeature<TContract>({ enabled: flowAppEnabled(import.meta.env) }),
    originalFileFeature<TContract>(),
    chromeFeature<TContract>(),
    hostedAccessFeature<TContract>(),
  ]
  return createShellFeatureHost(features)
}
