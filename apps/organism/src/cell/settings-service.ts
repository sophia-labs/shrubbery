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
  readonly userName: string
  readonly userEmail: string
  readonly sections: readonly MnSettingsSection[]
}

export interface OrganismSettingsService {
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
  readonly runtimeMode: 'local' | 'hosted'
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
  skin: GARDEN_SITE_BUNDLE.appearance.defaultSkin,
  density: 'comfortable',
  reducedMotion: false,
  editorMaterial: GARDEN_SITE_BUNDLE.appearance.defaultEditorMaterial,
  panelLabels: true,
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
  return isVisualIdentitySkin(value) ? value : 'garden'
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

/** Read the one preference the live editor needs before the settings route is
 * mounted. The rest of the settings state remains private to this service. */
export function readEditorMaterialPreference(
  storage: DefaultSettingsServiceOptions['storage'],
): EditorMaterial {
  return editorMaterialFrom(readPreferences(storage))
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
  readonly phanesControl: PhanesControlApi | undefined
  private preferences: PreferenceState
  private readonly providerSecrets: ProviderSecretStore | null
  private providerSecretsAvailable = false
  private providerStatus: Record<Provider, boolean> = {
    openrouter: false,
    anthropic: false,
    openai: false,
  }

  constructor(private readonly options: DefaultSettingsServiceOptions) {
    this.phanesControl = options.phanesControl
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
    await Promise.all([
      this.refreshProviderStatus(),
      this.options.operations?.ensureHistoryLoaded(),
      this.options.localAi?.ensureLoaded(),
    ])
    const hasProviderSecrets = Boolean(this.providerSecrets && this.providerSecretsAvailable)
    const local = this.options.runtimeMode === 'local'
    const apiBaseUrl = this.options.apiBaseUrl?.trim() || (local ? 'Local loopback' : 'Hosted gateway')
    const mcpUrl = this.options.mcpUrl?.trim() || (local ? '/mcp' : '/g/{graph_id}/mcp')
    const p = this.preferences

    const sections: MnSettingsSection[] = [
      section('account', 'Account', 'Profile, authentication, and account state.', {
        metrics: [
          { id: 'identity', label: 'Identity', value: this.options.userEmail || this.options.userName || 'Local user' },
          { id: 'runtime', label: 'Runtime', value: this.options.runtimeMode, tone: local ? 'neutral' : 'accent' },
        ],
        actions: local || this.actionUnavailable('sign-out')
          ? []
          : [{ id: 'sign-out', label: 'Sign out', description: 'End the current hosted session.', variant: 'danger' }],
      }),
      section('appearance', 'Appearance', 'Skin, theme, and motion preferences.', {
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
        ],
        toggles: [
          { id: 'reducedMotion', label: 'Reduce motion', checked: p.reducedMotion === true },
        ],
      }),
      section('interface', 'Interface', 'Workspace chrome behavior.', {
        toggles: [{ id: 'panelLabels', label: 'Show panel labels', checked: p.panelLabels === true }],
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
      section('local-ai', 'Local AI', 'Image generation, semantic indexing, and document parsing.', {
        secrets: hasProviderSecrets && this.providerSecrets?.providers.includes('openrouter') ? [{
          id: 'openrouter',
          label: 'OpenRouter',
          provider: 'openrouter',
          configured: this.providerStatus.openrouter,
          description: 'Used for local chat and image generation; the value stays outside graph and browser state.',
        }] : [],
        notes: hasProviderSecrets && this.providerSecrets
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
      if (section.id === 'billing' || section.id === 'usage') return false
      if (section.id === 'experimental' || section.id === 'privacy') return false
      if (section.id === 'api-keys') return !local && hasProviderSecrets
      if (section.id === 'local-ai') return local && Boolean(this.options.localAi || hasProviderSecrets)
      if (section.id === 'api-mcp') return hasEndpoints
      if (section.id === 'history' || section.id === 'graph-ops' || section.id === 'imports') {
        return Boolean(this.options.operations)
      }
      return true
    })
    return {
      userName: this.options.userName ?? '',
      userEmail: this.options.userEmail ?? '',
      sections: this.options.operations?.decorateSections(visibleSections) ?? visibleSections,
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
    return () => {
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
