import type { HostedBilling } from './hosted-billing.js'
import { SELF_HOST_GUIDE_ACTION, TAKE_HOME_ACTION, type HostedTakeHome } from './hosted-take-home.js'
import type { BillingCreditsPort } from './add-credits.js'
import type { AuthProfile } from '@shrubbery/nucleus/contract'
import type { UsageReader } from './usage-explorer.js'
import type {
  MnSettingsActionDetail,
  MnSettingsJobActionDetail,
  MnSettingsSection,
  MnSettingsSecretActionDetail,
  MnSettingsSelectChangeDetail,
  MnSettingsToggleChangeDetail,
} from '@shrubbery/components'
import {
  isVisualIdentitySkin,
  SKIN_LABELS,
  type EditorMaterial,
  type Theme,
  type VisualIdentitySkin,
} from '@shrubbery/tokens'
import { GARDEN_SITE_BUNDLE } from '@shrubbery/site/garden'
import type { GardendSettingsOperations } from './settings-operations.js'
import { defaultSkinForBuild } from './mithras-deployment.js'
import type { GardendLocalAiSettings } from './local-ai-settings.js'
import type { PhanesControlApi } from './phanes-control-api.js'
import {
  AI_PROVIDERS,
  TauriProviderSecretStore,
  isAiProvider,
  type ProviderSecretStore,
  type TauriInvoke,
} from './provider-secret-store.js'

export interface OrganismSettingsSnapshot {
  readonly runtimeMode?: 'local' | 'hosted'
  readonly account?: AuthProfile | null
  readonly userName: string
  readonly userEmail: string
  readonly sections: readonly MnSettingsSection[]
}

export interface OrganismSettingsService {
  readonly apiKeyGatewayUrl?: string
  readonly apiKeyGraphs?: () => Promise<readonly { owner: string; graphId: string; title?: string }[]>
  readonly apiKeyStore?: import('./api-key-store.js').ApiKeyStore
  readonly usageExplorer?: UsageReader
  /** What the Billing panel (Add credits) and a Stripe return need; hosted runtimes only. */
  readonly billingCredits?: BillingCreditsPort
  /** Optional shell authority for the Phanes Meaningful Object workbench. */
  readonly phanesControl?: PhanesControlApi
  load(): Promise<OrganismSettingsSnapshot>
  toggle(detail: MnSettingsToggleChangeDetail): Promise<void>
  select(detail: MnSettingsSelectChangeDetail): Promise<void>
  secret(detail: MnSettingsSecretActionDetail): Promise<void>
  action(detail: MnSettingsActionDetail): Promise<void>
  job(detail: MnSettingsJobActionDetail): Promise<void>
  /** Optional live-operation invalidation (job progress, errors, history refresh). */
  subscribe?(callback: () => void): () => void
}

export interface DefaultSettingsServiceOptions {
  readonly apiKeyGraphs?: () => Promise<readonly { owner: string; graphId: string; title?: string }[]>
  readonly apiKeyStore?: import('./api-key-store.js').ApiKeyStore
  readonly usageExplorer?: UsageReader
  readonly runtimeMode: 'local' | 'hosted'
  readonly account?: () => AuthProfile | null
  readonly userName?: string
  readonly userEmail?: string
  readonly apiBaseUrl?: string
  readonly mcpUrl?: string
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'> | null
  /** Backward-compatible desktop bridge; projected into a write-only secret store. */
  readonly invoke?: TauriInvoke
  /** Write-only provider credential backend (native Garden or hosted Choreograph). */
  readonly providerSecrets?: ProviderSecretStore
  readonly promptSecret?: (label: string) => string | null | Promise<string | null>
  readonly onAction?: (detail: MnSettingsActionDetail) => void | Promise<void>
  readonly isActionAvailable?: (actionId: string) => boolean
  readonly onPreferenceChange?: (
    detail: MnSettingsToggleChangeDetail | MnSettingsSelectChangeDetail,
  ) => void | Promise<void>
  /** Authenticated gardend effects; omitted for static/component-only stories. */
  readonly operations?: GardendSettingsOperations
  /** Signed-in hosted account billing; never used by local runtimes. */
  readonly billing?: HostedBilling
  /** Settings → Account → Download my gardens (hosted only): every owned garden, for gardend. */
  readonly takeHome?: HostedTakeHome
  /** Authenticated gardend semantic-model/index/ingestion settings. */
  readonly localAi?: GardendLocalAiSettings
  /** Cross-graph Phanes control authority; omitted when this shell cannot
   * mediate graph-id-bearing MCP calls. */
  readonly phanesControl?: PhanesControlApi
}

interface PreferenceState {
  [key: string]: string | boolean | undefined
}

const STORAGE_KEY = 'shrubbery.organism.settings.v1'
type Provider = (typeof AI_PROVIDERS)[number]
export type OrganismThemePreference = Theme | 'system'

export interface OrganismAppearancePreferences {
  readonly skin: VisualIdentitySkin
  readonly theme: OrganismThemePreference
}

const DEFAULTS: PreferenceState = {
  theme: 'system',
  // The Mithras deployment (VITE_SHRUBBERY_FLOW_APP=1) defaults to Flow's skin.
  skin: defaultSkinForBuild(import.meta.env as Readonly<Record<string, unknown>> | undefined, GARDEN_SITE_BUNDLE.appearance.defaultSkin),
  density: 'comfortable',
  reducedMotion: false,
  reducedTransparency: false,
  editorMaterial: GARDEN_SITE_BUNDLE.appearance.defaultEditorMaterial,
  editorFont: 'default',
  lineWidth: 'default',
  textSize: '100',
  panelLabels: true,
  rightPanelOnLaunch: true,
  restoreLastDocument: true,
  autoSync: true,
  imageModel: 'google/gemini-2.5-flash-image',
  semanticModel: 'nomic-ai/nomic-embed-text-v2-moe',
  pdfEngine: 'auto',
  experimentalFeatures: false,
  diagnostics: false,
  analytics: false,
}

function visualIdentitySkinFrom(preferences: PreferenceState): VisualIdentitySkin {
  const value = preferences.skin
  if (value === 'sophia') return 'emporium'
  return isVisualIdentitySkin(value) ? value : DEFAULTS.skin as VisualIdentitySkin
}

function themePreferenceFrom(preferences: PreferenceState): OrganismThemePreference {
  const value = preferences.theme
  return value === 'light' || value === 'dark' ? value : 'system'
}

function readPreferences(storage: DefaultSettingsServiceOptions['storage']): PreferenceState {
  if (!storage) return { ...DEFAULTS }
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...DEFAULTS }
    const stored = parsed as PreferenceState
    const migratedMaterial = stored.editorMaterial == null && stored.paperPage === true
      ? { editorMaterial: 'paper' }
      : {}
    const merged: PreferenceState = { ...DEFAULTS, ...stored, ...migratedMaterial }
    const normalized: PreferenceState = {
      ...merged,
      skin: visualIdentitySkinFrom(merged),
      theme: themePreferenceFrom(merged),
    }
    // Pre-release values have no compatibility contract: replace anything
    // outside the current catalog immediately so retired identities do not
    // linger invisibly in the settings record.
    if (normalized.skin !== merged.skin || normalized.theme !== merged.theme) {
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(normalized))
      } catch {
        // A read-only browser store still receives the normalized in-memory view.
      }
    }
    return normalized
  } catch {
    return { ...DEFAULTS }
  }
}

/** Read the shared chrome/settings appearance state without mounting Settings. */
export function readAppearancePreferences(
  storage: DefaultSettingsServiceOptions['storage'],
): OrganismAppearancePreferences {
  const preferences = readPreferences(storage)
  return {
    skin: visualIdentitySkinFrom(preferences),
    theme: themePreferenceFrom(preferences),
  }
}

/** Accessibility controls must take effect before the Settings route mounts. */
export function readAccessibilityPreferences(
  storage: DefaultSettingsServiceOptions['storage'],
): { reducedMotion: boolean; reducedTransparency: boolean } {
  const preferences = readPreferences(storage)
  return {
    reducedMotion: preferences.reducedMotion === true,
    reducedTransparency: preferences.reducedTransparency === true,
  }
}

/** Merge appearance state into the Settings record without clobbering other rows. */
export function persistAppearancePreferences(
  storage: DefaultSettingsServiceOptions['storage'],
  patch: Partial<OrganismAppearancePreferences>,
): void {
  if (!storage) return
  try {
    const preferences = readPreferences(storage)
    if (patch.skin !== undefined) preferences.skin = patch.skin
    if (patch.theme !== undefined) preferences.theme = patch.theme
    storage.setItem(STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    // Storage denial must not make a chrome action fail.
  }
}

/** Resolve the persisted System/Light/Dark preference into the rendered axis. */
export function resolveThemePreference(
  preference: OrganismThemePreference,
  prefersDark = globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches === true,
): Theme {
  return preference === 'system' ? (prefersDark ? 'dark' : 'light') : preference
}

function editorMaterialFrom(preferences: PreferenceState): EditorMaterial {
  const value = preferences.editorMaterial
  return value === 'paper' || value === 'classic-word' ? value : 'continuous'
}

/**
 * Editor typography (Appearance > Editor font, Line width, Text size). Each
 * choice becomes a custom property on the root that only the editor reads, so
 * the app's own chrome keeps the skin's faces and sizes. `default` sets
 * nothing: the skin and the editor material decide.
 */
export const EDITOR_FONTS = {
  default: { label: 'Skin default', stack: null },
  literata: { label: 'Literata', stack: "'Literata Variable', 'Literata', Georgia, serif" },
  'source-sans': { label: 'Source Sans', stack: "'Source Sans 3 Variable', 'Source Sans 3', -apple-system, sans-serif" },
} as const satisfies Record<string, { label: string, stack: string | null }>

/** The measure of the text itself, before the sheet's own padding. */
export const LINE_WIDTHS = {
  default: { label: 'Default', width: null },
  narrow: { label: 'Narrow', width: '560px' },
  medium: { label: 'Medium', width: '680px' },
  wide: { label: 'Wide', width: '840px' },
  // Larger than any window: the sheet's min(100%, ...) caps it to the pane.
  full: { label: 'Full width', width: '10000px' },
} as const satisfies Record<string, { label: string, width: string | null }>

export const TEXT_SIZES = ['90', '100', '110', '125', '140'] as const

export type EditorFontPreference = keyof typeof EDITOR_FONTS
export type LineWidthPreference = keyof typeof LINE_WIDTHS
export type TextSizePreference = (typeof TEXT_SIZES)[number]

export interface EditorTypePreferences {
  readonly editorFont: EditorFontPreference
  readonly lineWidth: LineWidthPreference
  readonly textSize: TextSizePreference
}

function isKeyOf<T extends object>(table: T, value: unknown): value is keyof T {
  return typeof value === 'string' && Object.hasOwn(table, value)
}

function editorTypeFrom(preferences: PreferenceState): EditorTypePreferences {
  const size = preferences.textSize
  return {
    editorFont: isKeyOf(EDITOR_FONTS, preferences.editorFont) ? preferences.editorFont : 'default',
    lineWidth: isKeyOf(LINE_WIDTHS, preferences.lineWidth) ? preferences.lineWidth : 'default',
    textSize: (TEXT_SIZES as readonly unknown[]).includes(size) ? size as TextSizePreference : '100',
  }
}

export function readEditorTypePreferences(
  storage: DefaultSettingsServiceOptions['storage'],
): EditorTypePreferences {
  return editorTypeFrom(readPreferences(storage))
}

/** Write the editor typography onto the root (or remove what is at default). */
export function applyEditorTypePreferences(
  preferences: EditorTypePreferences,
  root: { style: Pick<CSSStyleDeclaration, 'setProperty' | 'removeProperty'> },
): void {
  const set = (name: string, value: string | null) => {
    if (value === null) root.style.removeProperty(name)
    else root.style.setProperty(name, value)
  }
  set('--mn-editor-font', EDITOR_FONTS[preferences.editorFont].stack)
  set('--mn-editor-line-width', LINE_WIDTHS[preferences.lineWidth].width)
  set('--mn-editor-text-scale', preferences.textSize === '100' ? null : String(Number(preferences.textSize) / 100))
}

/** Read the one preference the live editor needs before the settings route is
 * mounted. The rest of the settings state remains private to this service. */
export function readEditorMaterialPreference(
  storage: DefaultSettingsServiceOptions['storage'],
): EditorMaterial {
  return editorMaterialFrom(readPreferences(storage))
}

/**
 * Whether the right rail opens when the workspace boots.
 *
 * DELIBERATELY A LAUNCH PREFERENCE, not a live mirror of the rail's state. The
 * rail is already opened and closed constantly during a session -- by the
 * toolbar, by Mod+Shift+I, by opening an inspector on a document -- and its
 * session state already persists on its own key
 * (`shrubbery.organism.panel-layout.v1`). A settings toggle that tried to
 * reflect that would be a second source of truth for one fact, and the two
 * would disagree the first time the rail was closed by any of the other three
 * routes. So the toggle answers one question the session state cannot: what
 * should be true when the window opens.
 */
export function readRightPanelOnLaunchPreference(
  storage: DefaultSettingsServiceOptions['storage'],
): boolean {
  return readPreferences(storage).rightPanelOnLaunch !== false
}

function section(
  id: string,
  title: string,
  description: string,
  rows: Omit<MnSettingsSection, 'id' | 'title' | 'description'>,
): MnSettingsSection {
  return { id, title, description, ...rows }
}

export class DefaultOrganismSettingsService implements OrganismSettingsService {
  get apiKeyGatewayUrl() { return this.options.apiBaseUrl ?? '' }
  get apiKeyGraphs() { return this.options.apiKeyGraphs }
  get apiKeyStore(): import('./api-key-store.js').ApiKeyStore | undefined { return this.options.apiKeyStore }
  get phanesControl(): PhanesControlApi | undefined {
    return this.options.phanesControl?.isAvailable() ? this.options.phanesControl : undefined
  }
  get usageExplorer(): UsageReader | undefined { return this.options.runtimeMode === 'hosted' ? this.options.usageExplorer : undefined }
  get billingCredits(): BillingCreditsPort | undefined { return this.options.runtimeMode === 'hosted' ? this.options.billing : undefined }
  private preferences: PreferenceState
  private readonly providerSecrets: ProviderSecretStore | null
  private providerSecretsAvailable = false
  private providerStatus: Record<Provider, boolean> = {
    openrouter: false,
    anthropic: false,
    openai: false,
  }

  constructor(private readonly options: DefaultSettingsServiceOptions) {
    this.preferences = readPreferences(options.storage)
    this.providerSecrets = options.providerSecrets
      ?? (options.invoke ? new TauriProviderSecretStore(options.invoke) : null)
  }

  private async refreshProviderStatus(): Promise<void> {
    if (!this.providerSecrets) {
      this.providerSecretsAvailable = false
      return
    }
    try {
      const status = await this.providerSecrets.status()
      for (const provider of AI_PROVIDERS) this.providerStatus[provider] = status[provider] === true
      this.providerSecretsAvailable = true
    } catch {
      this.providerSecretsAvailable = false
      // Browser and hosted deployments have no native secret store. The section
      // remains truthful: every provider is shown as missing and disabled.
    }
  }

  private persist(): void {
    try {
      this.options.storage?.setItem(STORAGE_KEY, JSON.stringify(this.preferences))
    } catch {
      // Private browsing/storage denial must not make a setting interaction crash.
    }
  }

  private actionUnavailable(actionId: string): boolean {
    if (this.options.operations?.supports(actionId)) return false
    return !this.options.onAction || this.options.isActionAvailable?.(actionId) === false
  }

  async load(): Promise<OrganismSettingsSnapshot> {
    if (this.options.runtimeMode === 'hosted') this.options.billing?.ensureLoaded()
    await Promise.all([
      this.refreshProviderStatus(),
      this.options.operations?.ensureHistoryLoaded(),
      this.options.localAi?.ensureLoaded(),
      this.options.phanesControl?.refreshAuthorization(),
    ])
    const hasProviderSecrets = Boolean(this.providerSecrets && this.providerSecretsAvailable)
    const local = this.options.runtimeMode === 'local'
    const apiBaseUrl = this.options.apiBaseUrl?.trim() || (local ? 'Local loopback' : 'Hosted gateway')
    const mcpUrl = this.options.mcpUrl?.trim() || (local ? '/mcp' : '/g/{graph_id}/mcp')
    const p = this.preferences
    const account = local ? null : this.options.account?.() ?? null

    const sections: MnSettingsSection[] = [
      section('account', 'Account', 'Profile, authentication, and account state.', {
        metrics: [
          { id: 'identity', label: 'Identity', value: account?.email || account?.username || this.options.userEmail || this.options.userName || (local ? 'Local user' : 'Signed-in account') },
          { id: 'runtime', label: 'Runtime', value: this.options.runtimeMode, tone: local ? 'neutral' : 'accent' },
        ],
        actions: local || this.actionUnavailable('sign-out')
          ? []
          : [{ id: 'sign-out', label: 'Sign out', description: 'End the current hosted session.', variant: 'danger' }],
      }),
      section('appearance', 'Appearance', 'Skin, theme, how documents read, and accessibility preferences.', {
        selects: [
          { id: 'theme', label: 'Theme', value: themePreferenceFrom(p), options: [{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }] },
          {
            id: 'skin',
            label: 'Skin',
            value: visualIdentitySkinFrom(p),
            options: GARDEN_SITE_BUNDLE.appearance.skins.map((value) => ({ value, label: SKIN_LABELS[value] })),
          },
          {
            id: 'editorMaterial',
            label: 'Editor canvas',
            description: 'Choose a continuous canvas, a quiet physical page, or full old-school Word skeuomorphism.',
            value: editorMaterialFrom(p),
            options: GARDEN_SITE_BUNDLE.appearance.editorMaterials.map((value) => ({
              value,
              label: value === 'continuous'
                ? 'Continuous canvas'
                : value === 'paper'
                  ? 'Quiet paper page'
                  : 'Classic Word page',
            })),
          },
          {
            id: 'editorFont',
            label: 'Editor font',
            description: 'The face for documents. The rest of the app keeps its own.',
            value: editorTypeFrom(p).editorFont,
            options: Object.entries(EDITOR_FONTS).map(([value, font]) => ({ value, label: font.label })),
          },
          {
            id: 'lineWidth',
            label: 'Line width',
            description: 'How long a line of text runs before it wraps.',
            value: editorTypeFrom(p).lineWidth,
            options: Object.entries(LINE_WIDTHS).map(([value, width]) => ({ value, label: width.label })),
          },
          {
            id: 'textSize',
            label: 'Text size',
            description: 'The size of text in documents.',
            value: editorTypeFrom(p).textSize,
            options: TEXT_SIZES.map((value) => ({ value, label: `${value}%` })),
          },
        ],
        toggles: [
          { id: 'reducedMotion', label: 'Reduce motion', checked: p.reducedMotion === true },
          { id: 'reducedTransparency', label: 'Reduce transparency', description: 'Use solid menus and floating controls.', checked: p.reducedTransparency === true },
        ],
      }),
      section('interface', 'Interface', 'Workspace chrome behavior.', {
        toggles: [
          { id: 'panelLabels', label: 'Show panel labels', checked: p.panelLabels === true },
          {
            id: 'rightPanelOnLaunch',
            label: 'Open the right panel on launch',
            description: 'The right rail can still be opened and closed at any time; this is only what it does when the window opens.',
            checked: p.rightPanelOnLaunch !== false,
          },
        ],
      }),
      section('billing', 'Billing', 'Plan and subscription controls.', {
        metrics: [{ id: 'plan', label: 'Plan', value: local ? 'Local' : 'Hosted' }],
        actions: [{ id: 'manage-billing', label: 'Manage billing', disabled: local || this.actionUnavailable('manage-billing') }],
      }),
      section('usage', 'Usage', 'Runtime and storage usage summaries.', {
        metrics: [
          { id: 'runtime', label: 'Execution', value: local ? 'On device' : 'Cloud' },
          { id: 'storage', label: 'Graph storage', value: local ? 'Local profile' : 'Durable cloud cell' },
        ],
        actions: [{ id: 'refresh-usage', label: 'Refresh usage', disabled: this.actionUnavailable('refresh-usage') }],
      }),
      section('history', 'History', 'Snapshots, restore points, and document time travel.', {
        actions: this.actionUnavailable('open-history')
          ? []
          : [{ id: 'open-history', label: 'Open document history' }],
        notes: ['Document history is scoped to the active graph and document.'],
      }),
      section('graph-ops', 'Graph Ops', 'Export, import, duplicate, and maintain graphs.', {
        actions: [
          { id: 'duplicate-graph', label: 'Duplicate graph', disabled: this.actionUnavailable('duplicate-graph') },
          { id: 'export-graph', label: 'Export graph', disabled: this.actionUnavailable('export-graph') },
          { id: 'import-graph', label: 'Import graph', disabled: this.actionUnavailable('import-graph') },
        ],
        jobs: [],
      }),
      section('imports', 'Imports', 'Bring documents and knowledge archives into Garden.', {
        actions: [
          { id: 'import-files', label: 'Import files', disabled: this.actionUnavailable('import-files') },
          { id: 'import-obsidian', label: 'Import Obsidian vault', disabled: this.actionUnavailable('import-obsidian') },
          { id: 'import-notion', label: 'Import Notion archive', disabled: this.actionUnavailable('import-notion') },
          { id: 'import-roam', label: 'Import Roam archive', disabled: this.actionUnavailable('import-roam') },
        ],
      }),
      section('api-keys', 'AI Provider Keys', 'Agent-inference provider credentials. Secret values are write-only and never reflected into component properties.', {
        secrets: hasProviderSecrets ? (this.providerSecrets?.providers ?? []).map(provider => ({
          id: provider,
          label: provider === 'openrouter' ? 'OpenRouter' : provider === 'openai' ? 'OpenAI' : 'Anthropic',
          provider,
          configured: this.providerStatus[provider],
          disabled: !hasProviderSecrets,
        })) : [],
        notes: hasProviderSecrets && this.providerSecrets
          ? [`Keys are stored in the ${this.providerSecrets.storageLabel}.`]
          : ['Provider-key management is unavailable in this runtime.'],
      }),
      section('api-mcp', 'API & MCP', 'Loopback or gateway endpoints used by external agents.', {
        metrics: [
          { id: 'api-base', label: 'API base', value: apiBaseUrl },
          { id: 'mcp-url', label: 'MCP endpoint', value: mcpUrl },
        ],
        actions: [
          ...(!this.actionUnavailable('copy-api-url') ? [{ id: 'copy-api-url', label: 'Copy API URL' }] : []),
          ...(!this.actionUnavailable('copy-mcp-url') ? [{ id: 'copy-mcp-url', label: 'Copy MCP URL' }] : []),
        ] satisfies MnSettingsSection['actions'],
      }),
      ...(this.phanesControl ? [section(
        'phanes',
        'Phanes',
        'Edit Phanes’s AgentPresentationCatalog, standalone /phanes and /roles InteractionFlows, and fail-closed DiscordIngestionPolicy. Every Meaningful Object is revision-checked, sealed, and durably reread.',
        { wide: true, contentSlot: 'phanes-control' },
      )] : []),
      section('local-ai', local ? 'Local AI' : 'Embeddings', local
        ? 'Image generation, semantic indexing, and document parsing.'
        : 'Hosted embedding runtime and this workspace’s semantic index.', {
        secrets: local && hasProviderSecrets && this.providerSecrets?.providers.includes('openrouter') ? [{
          id: 'openrouter',
          label: 'OpenRouter',
          provider: 'openrouter',
          configured: this.providerStatus.openrouter,
          description: 'Used for local chat and image generation; the value stays outside graph and browser state.',
        }] : [],
        notes: !local ? [] : hasProviderSecrets && this.providerSecrets
          ? [`The OpenRouter key is stored in the ${this.providerSecrets.storageLabel}.`]
          : ['Provider credentials require a write-only native or Choreograph secret backend.'],
      }),
      section('experimental', 'Experimental', 'Opt into unfinished Garden capabilities.', {
        toggles: [
          { id: 'experimentalFeatures', label: 'Experimental features', checked: p.experimentalFeatures === true },
          { id: 'diagnostics', label: 'Extended diagnostics', checked: p.diagnostics === true },
        ],
      }),
      section('privacy', 'Privacy', 'Telemetry and local-data controls.', {
        toggles: [{ id: 'analytics', label: 'Anonymous product analytics', checked: p.analytics === true }],
        actions: [{ id: 'clear-local-cache', label: 'Clear local cache', variant: 'danger', disabled: this.actionUnavailable('clear-local-cache') }],
        notes: [local ? 'Graph content remains in the local Garden profile.' : 'Hosted graph content is stored in the graph’s durable cloud cell.'],
      }),
    ]
    const localAiSection = sections.find(section => section.id === 'local-ai')
    const projectedSections = localAiSection && this.options.localAi
      ? sections.map(section => section.id === 'local-ai' ? this.options.localAi!.decorateSection(section) : section)
      : sections
    const hasEndpoints = Boolean(this.options.apiBaseUrl?.trim() && this.options.mcpUrl?.trim())
    const visibleSections = projectedSections.filter(section => {
      if (section.id === 'billing' || section.id === 'usage') return !local && Boolean(this.options.billing)
      if (section.id === 'experimental' || section.id === 'privacy') return false
      if (section.id === 'api-keys') return !local && hasProviderSecrets
      if (section.id === 'local-ai') return Boolean(this.options.localAi || (local && hasProviderSecrets))
      if (section.id === 'api-mcp') return hasEndpoints || Boolean(this.apiKeyStore)
      if (section.id === 'history' || section.id === 'graph-ops' || section.id === 'imports') {
        return Boolean(this.options.operations)
      }
      return true
    })
    const takeHome = local ? undefined : this.options.takeHome
    const accountSections = takeHome ? visibleSections.map(section => takeHome.decorate(section)) : visibleSections
    return {
      runtimeMode: this.options.runtimeMode,
      account,
      userName: account ? account.name || account.username || account.email || 'Signed-in account' : this.options.userName ?? '',
      userEmail: account?.email ?? this.options.userEmail ?? '',
      sections: (this.options.operations?.decorateSections(accountSections) ?? accountSections)
        .map(section => section.id === 'usage' && this.usageExplorer
          ? { id: 'usage', title: 'Usage', description: 'Explore recorded inference events and historical coverage.', wide: true, contentSlot: 'usage-explorer' }
          : !local && this.options.billing ? this.options.billing.decorate(section) : section),
    }
  }

  async toggle(detail: MnSettingsToggleChangeDetail): Promise<void> {
    this.preferences[detail.settingId] = detail.checked
    this.persist()
    await this.options.onPreferenceChange?.(detail)
  }

  async select(detail: MnSettingsSelectChangeDetail): Promise<void> {
    if (this.options.localAi?.handlesSelect(detail.settingId)) {
      await this.options.localAi.select(detail.settingId, detail.value)
      return
    }
    const normalized = detail.settingId === 'editorMaterial'
      ? editorMaterialFrom({ editorMaterial: detail.value })
      : detail.settingId === 'skin'
        ? visualIdentitySkinFrom({ skin: detail.value })
        : detail.settingId === 'theme'
          ? themePreferenceFrom({ theme: detail.value })
          : detail.settingId === 'editorFont' || detail.settingId === 'lineWidth' || detail.settingId === 'textSize'
            ? editorTypeFrom({ [detail.settingId]: detail.value })[detail.settingId]
            : detail.value
    this.preferences[detail.settingId] = normalized
    if (detail.settingId === 'editorMaterial') delete this.preferences.paperPage
    this.persist()
    await this.options.onPreferenceChange?.({ ...detail, value: normalized })
  }

  async secret(detail: MnSettingsSecretActionDetail): Promise<void> {
    const provider = isAiProvider(detail.secretId) ? detail.secretId : null
    if (provider && this.providerSecrets && !this.providerSecretsAvailable) {
      await this.refreshProviderStatus()
    }
    if (!provider || !this.providerSecrets || !this.providerSecretsAvailable) throw new Error('Provider key storage is unavailable.')
    if (detail.action === 'delete') {
      await this.providerSecrets.delete(provider)
      this.providerStatus[provider] = false
      return
    }
    const prompt = this.options.promptSecret ?? ((label: string) => globalThis.prompt?.(`Enter ${label} API key`) ?? null)
    const value = (await prompt(provider))?.trim()
    if (!value) return
    await this.providerSecrets.store(provider, value)
    this.providerStatus[provider] = true
  }

  async action(detail: MnSettingsActionDetail): Promise<void> {
    // Before any await, so the new tab still counts as the person's click.
    if (detail.actionId === SELF_HOST_GUIDE_ACTION && this.options.runtimeMode === 'hosted' && this.options.takeHome) {
      this.options.takeHome.openGuide()
      return
    }
    if (detail.actionId === TAKE_HOME_ACTION && this.options.runtimeMode === 'hosted' && this.options.takeHome) {
      await this.options.takeHome.start()
      return
    }
    if (this.options.runtimeMode === 'hosted' && this.options.billing && ['manage-billing', 'refresh-usage'].includes(detail.actionId)) {
      await this.options.billing.action(detail.actionId)
      return
    }
    if (this.options.operations?.supports(detail.actionId)) {
      await this.options.operations.action(detail)
      return
    }
    if (!this.options.onAction) throw new Error(`Settings action is unavailable: ${detail.actionId}`)
    await this.options.onAction(detail)
  }

  async job(detail: MnSettingsJobActionDetail): Promise<void> {
    if (this.options.localAi?.handlesJob(detail.jobId)) {
      await this.options.localAi.job(detail.jobId)
      return
    }
    throw new Error(`Settings job is unavailable: ${detail.jobId}`)
  }

  subscribe(callback: () => void): () => void {
    const unsubscribeOperations = this.options.operations?.subscribe(callback) ?? (() => undefined)
    const unsubscribeLocalAi = this.options.localAi?.subscribe(callback) ?? (() => undefined)
    const unsubscribeBilling = this.options.runtimeMode === 'hosted' ? this.options.billing?.subscribe(callback) : undefined
    const unsubscribeTakeHome = this.options.runtimeMode === 'hosted' ? this.options.takeHome?.subscribe(callback) : undefined
    return () => {
      unsubscribeTakeHome?.()
      unsubscribeBilling?.()
      unsubscribeOperations()
      unsubscribeLocalAi()
    }
  }
}

export function createDefaultSettingsService(
  options: DefaultSettingsServiceOptions,
): DefaultOrganismSettingsService {
  return new DefaultOrganismSettingsService(options)
}
