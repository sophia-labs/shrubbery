import type {
  HojaComposerDetail,
  HojaJSONContent,
  HojaWikiLinkRequestDetail,
  HojaWikiLinkResolveContext,
  HojaWikiLinkSuggestion,
} from '@shrubbery/hoja'
import type { AuthSessionSnapshot, CognitoAuthSession, GatewayGraphInfo } from '@shrubbery/source/gateway'
import { isEnabled } from '@shrubbery/source/features'
import { HOJA_NEW_NOTE_ACTION } from '@shrubbery/components/app-toolbar'
import { sophiaApp, sophiaAppHref } from '@shrubbery/components/sophia-suite'
import { applySkinTheme } from '@shrubbery/tokens'
import { css, html, LitElement, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { live } from 'lit/directives/live.js'
import type { ChromeAppTab, ChromeControl } from '@shrubbery/components/top-bar'
import { firstLineTitle, relativeTime, snippetOf } from './notes.js'
import { CellStore } from './cell-store.js'
import { SeedConflictError, type SeedStore, type SeedSummary, SoilStore } from './seed-store.js'
import { setPageLeaving } from './unload.js'

const SAVE_DEBOUNCE_MS = 500
const suiteTab = (id: string): ChromeAppTab => ({ id, label: sophiaApp(id).label, icon: sophiaApp(id).icon })
/** Hoja owns its theme (light/dark); it has no skins and no Garden settings page. */
const HOJA_CONTROLS: readonly ChromeControl[] = Object.freeze(['theme'])
const SAVE_RETRY_MAX_MS = 30_000
/** The unsaved "New leaf" draft: it becomes a real document on first input. */
const NEW_LEAF_ID = 'hoja:new-leaf'
/** Phones in either orientation get the single-pane, page-scrolling layout. */
const SINGLE_PANE_QUERY = '(max-width: 719px), (max-height: 500px) and (max-width: 950px)'
const EMPTY_DOCUMENT: HojaJSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }

/**
 * Hoja's two-pane notes surface. Soil and Garden cells share the SeedStore
 * contract; this element owns workspace selection, the note list, and saves.
 */
@customElement('hoja-app')
export class HojaApp extends LitElement {
  @property({ attribute: false }) store: SeedStore = new SoilStore()
  @property({ attribute: false }) authSession: CognitoAuthSession | null = null
  @property({ type: String }) gardenHref = '/'
  @property({ type: String }) choreographHref = '/choreograph'
  /**
   * Local (Soil) builds only: the features the build opted into
   * (`VITE_SHRUBBERY_FEATURES`). Hosted Hoja keys every gate on the Cognito
   * session instead, exactly as Garden does.
   */
  @property({ attribute: false }) localFeatures: readonly string[] = []
  /** How often an open leaf checks the server for a newer revision. */
  @property({ type: Number }) revisionPollMs = 5000
  @state() private seeds: SeedSummary[] = []
  @state() private selectedId: string | null = null
  @state() private draft = ''
  private draftDocument: HojaJSONContent | null = null
  @state() private saveState: 'idle' | 'saving' | 'saved' | 'error' | 'conflict' = 'idle'
  @state() private loadError: string | null = null
  @state() private mobileEditorOpen = false
  @state() private searchQuery = ''
  @state() private availableWorkspaces: readonly GatewayGraphInfo[] = []
  @state() private workspaceBusy = false
  @state() private appNavigationBusy = false
  @state() private themeChoice: 'system' | 'light' | 'dark' = 'system'
  @state() private fontChoice: 'serif' | 'sans' = 'serif'
  @state() private authSnapshot: AuthSessionSnapshot | null = null
  @state() private authBusy = false
  @state() private authError: string | null = null
  @state() private identity = ''
  @state() private password = ''
  /** Editor identity: stays put when a new leaf's draft gets its real id. */
  @state() private editorKey = ''
  @state() private conflict: { id: string; message: string } | null = null
  @state() private searchHits: ReadonlyMap<string, string> = new Map()

  private saveTimer: number | undefined
  private pendingSave: { id: string; markdown: string; json: unknown; expectedRevision?: number | null } | null = null
  private inflightSave: Promise<boolean> | null = null
  private creatingLeaf: Promise<string> | null = null
  private newLeafCounter = 0
  private selectGeneration = 0
  private openRevision: number | null = null
  private retryTimer: number | undefined
  private retryAttempt = 0
  private pollTimer: number | undefined
  private searchTimer: number | undefined
  private editorHistoryEntry = false
  private listScrollY = 0
  private readonly onPageHide = () => { setPageLeaving(true); void this.flushPendingSave() }
  private readonly onPageShow = () => { setPageLeaving(false) }
  private readonly onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      setPageLeaving(true)
      void this.flushPendingSave()
    } else {
      setPageLeaving(false)
      void this.pollRevision()
    }
  }
  private readonly onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (this.pendingSave === null && this.inflightSave === null) return
    setPageLeaving(true)
    void this.flushPendingSave()
    event.preventDefault()
    event.returnValue = ''
  }
  private readonly onOnline = () => {
    if (this.pendingSave !== null) void this.flushPendingSave()
  }
  private readonly onPopState = () => {
    if (!this.editorHistoryEntry) return
    this.editorHistoryEntry = false
    this.closeEditorPane()
  }
  private readonly onVisualViewport = () => {
    const viewport = window.visualViewport
    if (!viewport) return
    const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
    this.style.setProperty('--hoja-keyboard-inset', `${Math.round(inset)}px`)
  }
  private stopAuthListener: (() => void) | null = null
  private darkMedia: MediaQueryList | null = null
  private readonly onSystemThemeChange = () => { if (this.themeChoice === 'system') this.applyAppearance() }
  private readonly onKeydown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
      event.preventDefault()
      void this.createSeed()
    }
  }

  override connectedCallback(): void {
    super.connectedCallback()
    this.themeChoice = readChoice('shrubbery.hoja.theme', ['system', 'light', 'dark'], 'system')
    this.fontChoice = readChoice('shrubbery.hoja.font', ['serif', 'sans'], 'serif')
    this.darkMedia = window.matchMedia('(prefers-color-scheme: dark)')
    this.darkMedia.addEventListener('change', this.onSystemThemeChange)
    this.applyAppearance()
    window.addEventListener('keydown', this.onKeydown)
    window.addEventListener('pagehide', this.onPageHide)
    window.addEventListener('pageshow', this.onPageShow)
    window.addEventListener('beforeunload', this.onBeforeUnload)
    window.addEventListener('online', this.onOnline)
    window.addEventListener('popstate', this.onPopState)
    document.addEventListener('visibilitychange', this.onVisibilityChange)
    window.visualViewport?.addEventListener('resize', this.onVisualViewport)
    window.visualViewport?.addEventListener('scroll', this.onVisualViewport)
    this.schedulePoll()
    this.bindAuth()
  }

  override disconnectedCallback(): void {
    this.darkMedia?.removeEventListener('change', this.onSystemThemeChange)
    this.darkMedia = null
    window.removeEventListener('keydown', this.onKeydown)
    window.removeEventListener('pagehide', this.onPageHide)
    window.removeEventListener('pageshow', this.onPageShow)
    window.removeEventListener('beforeunload', this.onBeforeUnload)
    window.removeEventListener('online', this.onOnline)
    window.removeEventListener('popstate', this.onPopState)
    document.removeEventListener('visibilitychange', this.onVisibilityChange)
    window.visualViewport?.removeEventListener('resize', this.onVisualViewport)
    window.visualViewport?.removeEventListener('scroll', this.onVisualViewport)
    window.clearTimeout(this.pollTimer)
    window.clearTimeout(this.retryTimer)
    window.clearTimeout(this.searchTimer)
    this.stopAuthListener?.()
    this.stopAuthListener = null
    super.disconnectedCallback()
  }

  private bindAuth(): void {
    this.stopAuthListener?.()
    this.stopAuthListener = null
    if (!this.authSession) {
      void this.loadSeeds()
      return
    }
    const update = () => {
      this.authSnapshot = this.authSession?.snapshot() ?? null
      if (this.authSnapshot?.status === 'authenticated') {
        if (this.hostedAccessGranted()) void this.loadSeeds()
      } else if (this.authSnapshot?.status === 'anonymous') {
        this.seeds = []
        this.selectedId = null
        this.draft = ''
      }
    }
    this.stopAuthListener = this.authSession.onChange(update)
    void this.authSession.whenReady().then(update)
  }

  private async loadSeeds(): Promise<void> {
    try {
      const listed = [...await this.store.list()]
      const draft = this.seeds.find(seed => seed.id === NEW_LEAF_ID)
      // Keep snippets already learned from reads; hosted rows carry no body.
      const known = new Map(this.seeds.map(seed => [seed.id, seed.snippet]))
      this.seeds = [
        ...(draft ? [draft] : []),
        ...listed.map(seed => seed.snippet || !known.get(seed.id) ? seed : { ...seed, snippet: known.get(seed.id)! }),
      ]
      if (this.store instanceof CellStore && this.availableWorkspaces.length === 0) {
        this.availableWorkspaces = await this.store.workspaces()
      }
      this.loadError = null
      if (this.selectedId === null) {
        // ?doc=<id> opens that leaf even when it lives outside Hoja's list.
        const linked = linkedDocumentId()
        if (linked) await this.select(linked, { openMobile: true })
        else if (this.seeds.length > 0) await this.select(this.seeds[0].id, { openMobile: false })
      }
    } catch (error) {
      this.loadError = error instanceof Error ? error.message : String(error)
    }
  }

  /**
   * Open a leaf. The most recent request wins: a row clicked while the first
   * auto-open is still loading is not overridden when that load lands.
   */
  private async select(id: string, { openMobile = true } = {}): Promise<void> {
    const generation = ++this.selectGeneration
    if (!await this.flushPendingSave()) return
    if (generation !== this.selectGeneration) return
    try {
      const data = await this.store.read(id)
      if (generation !== this.selectGeneration) return
      if (this.selectedId === NEW_LEAF_ID && this.pendingSave === null) this.dropNewLeafDraft()
      this.selectedId = data.id
      this.editorKey = data.id
      this.draft = data.markdown
      this.draftDocument = isDocument(data.json) ? data.json : null
      this.openRevision = data.revision ?? null
      this.saveState = 'idle'
      this.loadError = null
      this.conflict = null
      const snippet = snippetOf(data.markdown)
      if (snippet) this.seeds = this.seeds.map(seed => seed.id === data.id && !seed.snippet ? { ...seed, snippet } : seed)
      if (openMobile) this.openEditorPane()
    } catch (error) {
      if (generation !== this.selectGeneration) return
      this.loadError = error instanceof Error ? error.message : String(error)
    }
  }

  /**
   * New opens an empty, focused draft at once. The document is created only
   * when the first keystroke arrives, and pressing New again while the draft
   * is still untouched reuses it — no orphan "New leaf" per click.
   */
  private async createSeed(): Promise<void> {
    if (this.workspaceReadOnly) return
    if (this.selectedId === NEW_LEAF_ID && this.pendingSave === null && this.creatingLeaf === null) {
      this.openEditorPane()
      await this.focusEditor()
      return
    }
    if (!await this.flushPendingSave()) return
    this.selectGeneration += 1
    this.searchQuery = ''
    this.searchHits = new Map()
    this.dropNewLeafDraft()
    this.seeds = [{ id: NEW_LEAF_ID, title: 'New leaf', snippet: '', modified_ms: Date.now() }, ...this.seeds]
    this.selectedId = NEW_LEAF_ID
    this.editorKey = `${NEW_LEAF_ID}:${++this.newLeafCounter}`
    this.draft = ''
    this.draftDocument = EMPTY_DOCUMENT
    this.openRevision = null
    this.saveState = 'idle'
    this.loadError = null
    this.conflict = null
    this.openEditorPane()
    await this.focusEditor()
  }

  private dropNewLeafDraft(): void {
    if (this.seeds.some(seed => seed.id === NEW_LEAF_ID)) this.seeds = this.seeds.filter(seed => seed.id !== NEW_LEAF_ID)
  }

  private async focusEditor(): Promise<void> {
    await this.updateComplete
    const editor = this.renderRoot.querySelector<HTMLElement & { updateComplete?: Promise<unknown> }>('hoja-editor')
    await editor?.updateComplete
    editor?.focus()
  }

  /** Give the draft a real document id (once), keeping the editor mounted. */
  private materializeNewLeaf(): Promise<string> {
    if (this.creatingLeaf) return this.creatingLeaf
    const creating = this.store.create().then(({ id }) => {
      this.seeds = this.seeds.map(seed => seed.id === NEW_LEAF_ID ? { ...seed, id } : seed)
      if (this.selectedId === NEW_LEAF_ID) this.selectedId = id
      if (this.pendingSave?.id === NEW_LEAF_ID) this.pendingSave = { ...this.pendingSave, id }
      this.creatingLeaf = null
      return id
    }, (error: unknown) => {
      this.creatingLeaf = null
      throw error
    })
    this.creatingLeaf = creating
    return creating
  }

  private openEditorPane(): void {
    this.mobileEditorOpen = true
    if (!window.matchMedia?.(SINGLE_PANE_QUERY).matches) return
    // Single pane: the editor is a history entry, so Back (button, Android
    // gesture, iOS swipe) returns to the list instead of leaving Hoja.
    if (!this.editorHistoryEntry) {
      this.listScrollY = window.scrollY
      window.history.pushState({ ...(window.history.state ?? {}), hojaEditor: true }, '')
      this.editorHistoryEntry = true
    }
    window.scrollTo(0, 0)
  }

  private closeEditorPane(): void {
    if (this.editorHistoryEntry) {
      window.history.back()
      return
    }
    void this.flushPendingSave()
    this.mobileEditorOpen = false
    const restore = this.listScrollY
    void this.updateComplete.then(() => window.scrollTo(0, restore))
  }

  private get workspaceReadOnly(): boolean {
    const store = this.store
    return store instanceof CellStore && this.availableWorkspaces.find(
      graph => graph.graphId === store.activeGraphId,
    )?.role === 'viewer'
  }

  /**
   * The workspace <select>'s rows. The displayed row is always the graph the
   * list and the top bar are reading: each option carries its own `selected`
   * (a `.value` on the <select> is committed BEFORE Lit renders the options
   * under it, so after a deep link / reload the first row showed instead),
   * and an active graph missing from the directory still gets its own row.
   */
  private workspaceOptions(): readonly Pick<GatewayGraphInfo, 'graphId' | 'title'>[] {
    const active = this.store instanceof CellStore ? this.store.activeGraphId : null
    if (!active || this.availableWorkspaces.some(graph => graph.graphId === active)) return this.availableWorkspaces
    return [{ graphId: active, title: active }, ...this.availableWorkspaces]
  }

  private async switchWorkspace(graphId: string): Promise<void> {
    if (!(this.store instanceof CellStore) || !graphId || graphId === this.store.activeGraphId) return
    this.workspaceBusy = true
    try {
      if (!await this.flushPendingSave()) return
      await this.store.switchGraph(graphId)
      const url = new URL(window.location.href)
      url.searchParams.set('graph', graphId)
      url.searchParams.delete('doc')
      window.history.replaceState(window.history.state, '', url)
      this.seeds = []
      this.selectedId = null
      this.draft = ''
      this.draftDocument = null
      this.searchQuery = ''
      this.mobileEditorOpen = false
      this.loadError = null
      await this.loadSeeds()
    } catch (error) {
      this.loadError = error instanceof Error ? error.message : String(error)
    } finally {
      this.workspaceBusy = false
    }
  }

  /**
   * The Sophia picker, gated like Garden's (features.ts): Garden always,
   * Choreograph for the `choreograph` audience, Hoja itself. The bar orders
   * them in the suite's canonical order.
   */
  private suiteApps(): readonly ChromeAppTab[] {
    const session = this.authSession
      ? { mode: 'hosted' as const, userId: this.authSnapshot?.userId ?? null }
      : { mode: 'local' as const, localOptIns: this.localFeatures }
    return [
      suiteTab('hoja'),
      suiteTab('garden'),
      ...(isEnabled('choreograph', session) ? [suiteTab('choreograph')] : []),
    ]
  }

  private async switchApp(app: string): Promise<void> {
    if (this.appNavigationBusy || (app !== 'garden' && app !== 'choreograph')) return
    if (!this.suiteApps().some(tab => tab.id === app)) return
    this.appNavigationBusy = true
    try {
      if (!await this.flushPendingSave()) return
      // Land in the same workspace: `?graph=` is the suite-wide parameter.
      const graphId = this.store instanceof CellStore ? this.store.activeGraphId : null
      const base = new URL(app === 'garden' ? this.gardenHref : this.choreographHref, window.location.href).href
      window.location.assign(sophiaAppHref(base, graphId))
    } finally {
      this.appNavigationBusy = false
    }
  }

  private get effectiveTheme(): 'light' | 'dark' {
    return this.themeChoice === 'system'
      ? (this.darkMedia?.matches ? 'dark' : 'light')
      : this.themeChoice
  }

  /** The shared bar's theme button: flip what is showing, and remember it. */
  private toggleTheme(): void {
    this.setTheme(this.effectiveTheme === 'dark' ? 'light' : 'dark')
  }

  private applyAppearance(): void {
    // Garden's identity is "no data-skin" (skin-garden.css keys an explicit
    // [data-skin=garden] to its LIGHT masthead, which out-ranked theme-dark and
    // left Hoja's shared top bar light in dark mode). Apply skin + theme as
    // the organism does, so the bar and the page share one dark palette.
    applySkinTheme({ skin: 'garden', theme: this.effectiveTheme, target: document.documentElement })
    this.dataset.font = this.fontChoice
    this.requestUpdate()
  }

  private setTheme(value: string): void {
    if (value !== 'system' && value !== 'light' && value !== 'dark') return
    this.themeChoice = value
    storeChoice('shrubbery.hoja.theme', value)
    this.applyAppearance()
  }

  private setFont(value: string): void {
    if (value !== 'serif' && value !== 'sans') return
    this.fontChoice = value
    storeChoice('shrubbery.hoja.font', value)
    this.applyAppearance()
  }

  private onEditorChange(detail: HojaComposerDetail): void {
    if (this.selectedId === null) return
    const expectedRevision = this.pendingSave?.id === this.selectedId ? this.pendingSave.expectedRevision : undefined
    this.pendingSave = {
      id: this.selectedId, markdown: detail.value, json: detail.json,
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
    }
    if (this.selectedId === NEW_LEAF_ID) void this.materializeNewLeaf().catch(() => undefined)
    if (this.conflict?.id === this.selectedId) return
    this.saveState = 'saving'
    const optimisticTitle = firstLineTitle(detail.value)
    const optimisticSnippet = snippetOf(detail.value)
    this.seeds = this.seeds.map((seed) =>
      seed.id === this.selectedId
        ? { ...seed, title: optimisticTitle, snippet: optimisticSnippet }
        : seed,
    )
    window.clearTimeout(this.saveTimer)
    this.saveTimer = window.setTimeout(() => {
      void this.flushPendingSave()
    }, SAVE_DEBOUNCE_MS)
  }

  /**
   * Resolve a refused save. 'reload' discards the unsaved edits and opens the
   * server's version; 'overwrite' writes the user's version over the newer
   * revision (deliberately, having been told).
   */
  private async resolveConflict(choice: 'reload' | 'overwrite'): Promise<void> {
    const conflict = this.conflict
    if (!conflict) return
    if (choice === 'reload') {
      this.pendingSave = null
      this.conflict = null
      await this.refreshOpenLeaf(conflict.id, { force: true })
      return
    }
    try {
      const latest = await this.store.revisionOf?.(conflict.id) ?? null
      if (this.pendingSave?.id === conflict.id) this.pendingSave = { ...this.pendingSave, expectedRevision: latest }
      this.conflict = null
      await this.flushPendingSave()
    } catch (error) {
      this.loadError = error instanceof Error ? error.message : String(error)
    }
  }

  private schedulePoll(): void {
    window.clearTimeout(this.pollTimer)
    if (!this.isConnected || this.revisionPollMs <= 0) return
    this.pollTimer = window.setTimeout(() => {
      void this.pollRevision().finally(() => this.schedulePoll())
    }, this.revisionPollMs)
  }

  /** Pick up another writer's revision of the open leaf while it is quiet. */
  private async pollRevision(): Promise<void> {
    const id = this.selectedId
    if (!id || id === NEW_LEAF_ID || !this.store.revisionOf || this.openRevision === null) return
    if (document.visibilityState === 'hidden' || this.pendingSave || this.inflightSave || this.conflict) return
    try {
      const revision = await this.store.revisionOf(id)
      if (revision === null || this.openRevision === null || revision <= this.openRevision) return
      await this.refreshOpenLeaf(id)
    } catch {
      // A missed poll is harmless; the next one (or the save fence) catches up.
    }
  }

  private async refreshOpenLeaf(id: string, { force = false } = {}): Promise<void> {
    const generation = this.selectGeneration
    const data = await this.store.read(id)
    if (generation !== this.selectGeneration || this.selectedId !== id) return
    if (!force && (this.pendingSave || this.inflightSave)) return
    this.draft = data.markdown
    this.draftDocument = isDocument(data.json) ? data.json : null
    this.openRevision = data.revision ?? null
    this.saveState = 'idle'
    const title = firstLineTitle(data.markdown)
    const snippet = snippetOf(data.markdown)
    this.seeds = this.seeds.map(seed => seed.id === id ? { ...seed, title, snippet } : seed)
  }

  private scheduleRetry(): void {
    window.clearTimeout(this.retryTimer)
    const delay = Math.min(SAVE_RETRY_MAX_MS, 1000 * 2 ** this.retryAttempt)
    this.retryAttempt += 1
    this.retryTimer = window.setTimeout(() => {
      if (this.pendingSave !== null && this.inflightSave === null) void this.flushPendingSave()
    }, delay)
  }

  private onSearchInput(value: string): void {
    this.searchQuery = value
    window.clearTimeout(this.searchTimer)
    const query = value.trim()
    if (!this.store.search || query.length < 2) {
      this.searchHits = new Map()
      return
    }
    this.searchTimer = window.setTimeout(() => {
      void this.store.search?.(query).then(hits => {
        if (this.searchQuery.trim() !== query) return
        this.searchHits = new Map(hits.map(hit => [hit.id, hit.snippet]))
      }, () => undefined)
    }, 250)
  }

  private readonly resolveWikiLinks = async (
    request: HojaWikiLinkRequestDetail,
    { signal }: HojaWikiLinkResolveContext,
  ): Promise<readonly HojaWikiLinkSuggestion[]> => {
    const documents = await this.store.list()
    if (signal.aborted) return []
    const query = request.query.trim().toLocaleLowerCase()
    const graphId = this.store instanceof CellStore ? this.store.activeGraphId : null
    return documents
      .filter(seed => !query || `${seed.title} ${seed.snippet}`.toLocaleLowerCase().includes(query))
      .sort((left, right) => Number(right.title.toLocaleLowerCase().startsWith(query)) - Number(left.title.toLocaleLowerCase().startsWith(query)))
      .slice(0, 12)
      .map(seed => ({ label: seed.title, targetDocId: seed.id, targetGraphId: graphId }))
  }

  /**
   * Saves are serialized: each write carries the revision the previous one
   * produced, so a fast typist never races their own save into a conflict.
   */
  private async flushPendingSave(): Promise<boolean> {
    window.clearTimeout(this.saveTimer)
    while (this.inflightSave) {
      if (!await this.inflightSave) return false
    }
    const pending = this.pendingSave
    if (pending === null) return true
    if (this.conflict?.id === pending.id) return false
    const write = this.writePending(pending)
    this.inflightSave = write
    try {
      return await write
    } finally {
      if (this.inflightSave === write) this.inflightSave = null
    }
  }

  private async writePending(pending: NonNullable<HojaApp['pendingSave']>): Promise<boolean> {
    this.pendingSave = null
    window.clearTimeout(this.retryTimer)
    this.saveState = 'saving'
    let id = pending.id
    try {
      if (id === NEW_LEAF_ID) id = await this.materializeNewLeaf()
      const data = await this.store.save(id, {
        markdown: pending.markdown,
        json: pending.json,
        ...(pending.expectedRevision === undefined ? {} : { expectedRevision: pending.expectedRevision }),
      })
      this.retryAttempt = 0
      if (this.selectedId === id) this.openRevision = data.revision ?? this.openRevision
      this.seeds = this.seeds
        .map((seed) =>
          seed.id === id
            ? { ...seed, title: data.title, snippet: data.snippet, modified_ms: data.modified_ms }
            : seed,
        )
        .sort((a, b) => Number(b.id === NEW_LEAF_ID) - Number(a.id === NEW_LEAF_ID) || b.modified_ms - a.modified_ms)
      if (this.pendingSave === null) {
        this.saveState = 'saved'
        this.loadError = null
      }
      return true
    } catch (error) {
      // Keep the newest edits: a later keystroke may already be pending.
      if (this.pendingSave === null) this.pendingSave = { ...pending, id }
      if (error instanceof SeedConflictError) {
        this.conflict = { id, message: error.message }
        this.saveState = 'conflict'
        return false
      }
      this.loadError = error instanceof Error ? error.message : String(error)
      this.saveState = 'error'
      this.scheduleRetry()
      return false
    }
  }

  private async signIn(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    if (!this.authSession || this.authBusy) return
    this.authBusy = true
    this.authError = null
    try {
      await this.authSession.signIn(this.identity, this.password)
      this.password = ''
    } catch (error) {
      this.authError = error instanceof Error ? error.message : String(error)
    } finally {
      this.authBusy = false
    }
  }

  private async signOut(): Promise<void> {
    if (!this.authSession || this.authBusy) return
    if (!await this.flushPendingSave()) return
    this.authBusy = true
    try {
      await this.authSession.signOut()
    } finally {
      this.authBusy = false
    }
  }

  private renderSuiteTopbar(workspaceName: string, canCreate: boolean) {
    const toolbar = canCreate
      ? [{ ...HOJA_NEW_NOTE_ACTION, disabled: this.workspaceReadOnly || this.workspaceBusy || this.appNavigationBusy }]
      : []
    return html`<mn-top-bar class="suite-topbar" role="banner" active-app="hoja"
      .apps=${this.suiteApps()} .toolbarActions=${toolbar} .controls=${HOJA_CONTROLS}
      .isDark=${this.effectiveTheme === 'dark'}
      @mn-app-change=${(event: CustomEvent<{ app: string }>) => { void this.switchApp(event.detail.app) }}
      @mn-hoja-new-note=${() => { void this.createSeed() }}
      @mn-theme-toggle=${() => this.toggleTheme()}>
      ${workspaceName ? html`<span slot="breadcrumbs" class="topbar-workspace" title=${workspaceName}>${workspaceName}</span>` : nothing}
      <details slot="actions" class="appearance-menu">
        <summary aria-label="Appearance controls" title="Appearance controls">Aa</summary>
        <div class="appearance-panel">
          <label>Theme
            <select aria-label="Theme" .value=${this.themeChoice} @change=${(event: Event) => this.setTheme((event.currentTarget as HTMLSelectElement).value)}>
              <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
            </select>
          </label>
          <label>Writing font
            <select aria-label="Writing font" .value=${this.fontChoice} @change=${(event: Event) => this.setFont((event.currentTarget as HTMLSelectElement).value)}>
              <option value="serif">Serif</option><option value="sans">Sans</option>
            </select>
          </label>
        </div>
      </details>
    </mn-top-bar>`
  }

  /**
   * Hosted Hoja follows feature 'hoja-v2' (features.ts), open to everyone
   * since 2026-09-23; the closed gate stays for a future narrowing. Local Soil mode has no Cognito and is
   * the owner's own process, so it is not gated here.
   */
  private hostedAccessGranted(): boolean {
    if (!this.authSession) return true
    return isEnabled('hoja-v2', { mode: 'hosted', userId: this.authSnapshot?.userId ?? null })
  }

  override render() {
    if (this.authSession && this.authSnapshot?.status !== 'authenticated') {
      return this.renderSignIn()
    }
    if (!this.hostedAccessGranted()) return this.renderNotYetOpen()
    const query = this.searchQuery.trim().toLocaleLowerCase()
    const visibleSeeds = query
      ? this.seeds
        .filter(seed => this.searchHits.has(seed.id) || `${seed.title} ${seed.snippet}`.toLocaleLowerCase().includes(query))
        .map(seed => seed.snippet || !this.searchHits.get(seed.id) ? seed : { ...seed, snippet: this.searchHits.get(seed.id)! })
      : this.seeds
    const selected = this.seeds.find(seed => seed.id === this.selectedId)
    const graphId = this.store instanceof CellStore ? this.store.activeGraphId : null
    const workspaceName = this.store instanceof CellStore
      ? this.availableWorkspaces.find(graph => graph.graphId === graphId)?.title || graphId || 'Workspace'
      : 'Local notes'
    return html`
      <div class="shell ${this.mobileEditorOpen ? 'editor-open' : ''}">
        ${this.renderSuiteTopbar(workspaceName, true)}
        <aside>
          <div class="sidebar-tools">
            <label class="workspace-field">
              <span>Workspace</span>
              <select
                aria-label="Workspace"
                data-testid="select.workspace"
                ?disabled=${!(this.store instanceof CellStore) || this.workspaceBusy || this.workspaceOptions().length < 2}
                @change=${(event: Event) => void this.switchWorkspace((event.currentTarget as HTMLSelectElement).value)}
              >
                ${this.store instanceof CellStore
                  ? this.workspaceOptions().map(graph => html`<option
                      value=${graph.graphId}
                      .selected=${live(graph.graphId === graphId)}
                    >${graph.title || graph.graphId}</option>`)
                  : html`<option value="local" selected>Local notes</option>`}
              </select>
            </label>
            <label class="search-field">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                aria-label="Search leaves"
                placeholder="Search leaves"
                .value=${this.searchQuery}
                @input=${(event: Event) => this.onSearchInput((event.currentTarget as HTMLInputElement).value)}
              />
            </label>
            <div class="list-heading"><span>Leaves</span><span>${this.seeds.length}</span></div>
          </div>
          ${this.loadError !== null
            ? html`<p class="load-error">${this.loadError}</p>`
            : nothing}
          <ul>
            ${visibleSeeds.map(
              (seed) => html`
                <li>
                  <button
                    class="row ${seed.id === this.selectedId ? 'selected' : ''}"
                    @click=${() => void this.select(seed.id)}
                  >
                    <span class="row-meta">
                      <span class="row-title">${seed.title}</span>
                      <span class="row-time">${relativeTime(seed.modified_ms)}</span>
                    </span>
                    ${seed.snippet ? html`<span class="row-snippet">${seed.snippet}</span>` : nothing}
                  </button>
                </li>
              `,
            )}
            ${this.seeds.length === 0 && this.loadError === null
              ? html`<li class="empty-list">No leaves yet.</li>`
              : nothing}
            ${this.seeds.length > 0 && visibleSeeds.length === 0
              ? html`<li class="empty-list">No matching leaves.</li>`
              : nothing}
          </ul>
          ${this.authSession
            ? html`<footer class="sidebar-footer"><button
                class="sign-out"
                title="Sign out"
                aria-label="Sign out"
                data-testid="button.sign-out"
                @click=${() => void this.signOut()}
              >Sign out</button></footer>`
            : nothing}
        </aside>
        <main>
          ${this.selectedId !== null
            ? html`
                <div class="editor-bar">
                  <button
                    class="back"
                    aria-label="Back to leaves"
                    data-testid="button.back"
                    @click=${() => this.closeEditorPane()}
                  >‹</button>
                  <span class="editor-bar-title">${selected?.title || 'New leaf'}</span>
                  <span class="save-state" data-state=${this.saveState}>
                    ${this.saveState === 'saving'
                      ? 'Saving…'
                      : this.saveState === 'saved'
                        ? 'Saved'
                        : this.saveState === 'error'
                          ? 'Save failed · retrying'
                          : this.saveState === 'conflict'
                            ? 'Not saved'
                            : this.workspaceReadOnly || selected?.readOnly
                              ? 'Read only'
                              : 'Ready'}
                  </span>
                </div>
                ${this.conflict && this.conflict.id === this.selectedId ? html`
                  <div class="conflict" role="alert" data-testid="conflict">
                    <p>This leaf changed elsewhere while you were editing. Your latest edits are not saved.</p>
                    <div class="conflict-actions">
                      <button type="button" data-testid="conflict-reload" @click=${() => void this.resolveConflict('reload')}>Load latest (discard mine)</button>
                      <button type="button" data-testid="conflict-overwrite" @click=${() => void this.resolveConflict('overwrite')}>Keep mine</button>
                    </div>
                  </div>` : nothing}
                <div class="page">
                  <hoja-editor
                    posture="page"
                    label="Leaf"
                    placeholder="Start writing…"
                    .valueKey=${this.editorKey}
                    .value=${this.draft}
                    .pageDocument=${this.draftDocument}
                    .readOnly=${selected?.readOnly === true}
                    .resolveWikiLinks=${this.resolveWikiLinks}
                    .onWikiLinkOpen=${(id: string) => { void this.select(id) }}
                    @hoja-change=${(event: CustomEvent<HojaComposerDetail>) =>
                      this.onEditorChange(event.detail)}
                  ></hoja-editor>
                </div>
              `
            : html`<div class="blank"><p>Select a note or create one.</p></div>`}
        </main>
      </div>
    `
  }

  private renderNotYetOpen() {
    return html`
      <div class="auth-layout">${this.renderSuiteTopbar('', false)}
      <main class="auth-shell">
        <div class="auth-card" data-hoja-gate="closed">
          <h1>hoja</h1>
          <p class="auth-note">Hoja isn’t open for this account yet. Your notes are in Garden.</p>
          <a class="auth-link" href=${this.gardenHref}>open Garden</a>
        </div>
      </main></div>
    `
  }

  private renderSignIn() {
    const restoring = this.authSnapshot === null || this.authSnapshot.status === 'restoring'
    return html`
      <div class="auth-layout">${this.renderSuiteTopbar('', false)}
      <main class="auth-shell">
        <div class="auth-card">
          <svg class="auth-mark" viewBox="0 0 24 24" role="img" aria-label="hoja">
            <path
              fill="currentColor"
              d="M 8.6 21.6 C 8.2 18.5 6.5 16.8 4.9 14.2 C 2.9 10.9 4.4 6.6 8.4 4.4 C 10.3 3.35 12.4 3.0 14.6 3.0 L 20.2 8.6 C 20.9 11.6 20.3 14.6 18.1 16.9 C 15.7 19.4 12.2 20.6 9.9 21.2 C 9.4 21.35 9.0 21.5 8.6 21.6 Z"
            ></path>
          </svg>
          ${restoring
            ? html`<p>finding your garden…</p>`
            : html`
                <h1>hoja</h1>
                <p class="auth-note">Sign in to open your Garden leaves.</p>
                <form @submit=${(event: SubmitEvent) => void this.signIn(event)}>
                  <label>
                    Email or username
                    <input
                      name="identity"
                      autocomplete="username"
                      .value=${this.identity}
                      @input=${(event: InputEvent) => {
                        this.identity = (event.currentTarget as HTMLInputElement).value
                      }}
                      required
                    />
                  </label>
                  <label>
                    Password
                    <input
                      name="password"
                      type="password"
                      autocomplete="current-password"
                      .value=${this.password}
                      @input=${(event: InputEvent) => {
                        this.password = (event.currentTarget as HTMLInputElement).value
                      }}
                      required
                    />
                  </label>
                  ${this.authError ? html`<p class="auth-error" role="alert">${this.authError}</p>` : nothing}
                  <button type="submit" ?disabled=${this.authBusy}>
                    ${this.authBusy ? 'signing in…' : 'open garden'}
                  </button>
                </form>
              `}
        </div>
      </main>
      </div>
    `
  }

  static override styles = css`
    :host {
      display: block;
      height: 100vh;
      height: 100dvh;
      /* The suite bar's own height (46px under Garden's material, 40px
         under Mithras), plus the notch. Same bar, same height, every app. */
      --hoja-topbar-height: calc(var(--mn-top-bar-height, 46px) + env(safe-area-inset-top, 0px));
    }

    .shell {
      display: grid;
      grid-template-columns: 288px 1fr;
      grid-template-rows: var(--hoja-topbar-height) minmax(0, 1fr);
      height: 100%;
    }
    .auth-layout { display: grid; grid-template-rows: var(--hoja-topbar-height) minmax(0, 1fr); height: 100%; }
    .suite-topbar {
      grid-column: 1 / -1;
      grid-row: 1;
      min-width: 0;
      height: var(--hoja-topbar-height);
      min-height: var(--hoja-topbar-height);
      padding-top: env(safe-area-inset-top, 0px);
    }
    /* The top bar is its own stacking context (z-index 2 in mn-top-bar);
       lift it above the sticky editor bar so its popovers (Appearance, app
       picker) paint over an open note (QA P1-4). */
    .suite-topbar { position: relative; z-index: 5; }
    .topbar-workspace { display: block; max-width: min(30vw, 240px); overflow: hidden; color: var(--mn-top-bar-text-muted, var(--mn-color-text-secondary, #58665c)); font: 600 12px/1.3 var(--mn-font-chrome, system-ui, sans-serif); text-overflow: ellipsis; white-space: nowrap; }
    aside, main { grid-row: 2; min-height: 0; }

    .sign-out {
      position: fixed;
      left: 0.75rem;
      bottom: 0.6rem;
      border: 0;
      background: none;
      color: inherit;
      opacity: 0.28;
      cursor: pointer;
      z-index: 3;
    }

    .sign-out:hover {
      opacity: 0.75;
    }

    .auth-shell {
      min-height: 0;
      display: grid;
      place-items: center;
      padding: 1.5rem;
      box-sizing: border-box;
    }

    .auth-card {
      width: min(22rem, 100%);
      text-align: center;
    }

    .auth-mark {
      width: 2.4rem;
      color: #4d7a5a;
    }

    .auth-card h1 {
      margin: 0.65rem 0 0;
      font-size: 1.15rem;
      font-weight: 600;
    }

    .auth-note,
    .auth-card > p {
      opacity: 0.55;
      font-size: 0.86rem;
    }

    .auth-card form {
      display: grid;
      gap: 0.9rem;
      margin-top: 1.4rem;
      text-align: left;
    }

    .auth-card label {
      display: grid;
      gap: 0.35rem;
      font-size: 0.75rem;
      opacity: 0.8;
    }

    .auth-card input {
      border: 1px solid rgba(125, 115, 95, 0.24);
      border-radius: 8px;
      padding: 0.65rem 0.7rem;
      background: rgba(125, 115, 95, 0.05);
      color: inherit;
    }

    .auth-card button[type='submit'] {
      border: 0;
      border-radius: 8px;
      padding: 0.72rem;
      background: #4d7a5a;
      color: white;
      cursor: pointer;
    }

    .auth-card button[disabled] {
      opacity: 0.55;
      cursor: wait;
    }

    .auth-error {
      color: #a3402f;
      font-size: 0.8rem;
      margin: 0;
    }

    aside {
      border-right: 1px solid rgba(125, 115, 95, 0.16);
      background: rgba(125, 115, 95, 0.05);
      overflow-y: auto;
      display: flex;
      flex-direction: column;
    }



    ul {
      list-style: none;
      margin: 0;
      padding: 0 0.5rem 1rem;
    }

    .row {
      display: block;
      width: 100%;
      text-align: left;
      border: 0;
      background: none;
      color: inherit;
      cursor: pointer;
      padding: 0.6rem 0.65rem;
      border-radius: 8px;
    }

    .row.selected {
      background: rgba(125, 115, 95, 0.14);
    }

    .row-title {
      display: block;
      font-size: 0.87rem;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .row-meta {
      display: flex;
      gap: 0.5rem;
      align-items: baseline;
      margin-top: 0.15rem;
    }

    .row-time {
      font-size: 0.72rem;
      opacity: 0.5;
      flex: none;
    }

    .row-snippet {
      font-size: 0.78rem;
      opacity: 0.6;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .empty-list,
    .load-error {
      padding: 0 1rem;
      font-size: 0.8rem;
      opacity: 0.6;
    }

    .load-error {
      color: #a3402f;
      opacity: 1;
    }

    main {
      overflow-y: auto;
      position: relative;
    }

    .editor-bar {
      position: sticky;
      top: 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.55rem 1rem 0;
      z-index: 2;
    }

    .back {
      display: none;
      border: 0;
      background: none;
      color: inherit;
      font-size: 1.4rem;
      line-height: 1;
      cursor: pointer;
      opacity: 0.6;
      padding: 0 0.4rem;
    }

    .save-state {
      margin-left: auto;
      font-family: ui-monospace, monospace;
      font-size: 0.8rem;
      opacity: 0.45;
    }

    .save-state[data-state='error'] {
      color: #a3402f;
      opacity: 1;
    }

    .page {
      max-width: 42rem;
      margin: 0 auto;
      padding: 1.25rem 1.25rem 6rem;
    }

    hoja-editor {
      display: block;
      min-height: 70vh;
      min-height: 70dvh;
    }

    .blank {
      height: 100%;
      display: grid;
      place-items: center;
      opacity: 0.4;
      font-style: italic;
    }

    @media (max-width: 719px), (max-height: 500px) and (max-width: 950px) {
      .shell {
        grid-template-columns: 1fr;
      }

      .shell main {
        display: none;
      }

      .shell.editor-open aside {
        display: none;
      }

      .shell.editor-open main {
        display: block;
      }

      .back {
        display: block;
      }
    }

    /* Garden suite language: solid writing surfaces, restrained glass edges. */
    :host {
      color: var(--mn-color-text-primary, #18211b);
      background: var(--mn-color-surface-canvas, #f5f3ed);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }
    .shell { grid-template-columns: minmax(290px, 326px) minmax(0, 1fr); }
    aside {
      overflow-x: hidden;
      border-right: 1px solid var(--mn-color-border-subtle, #d8ded9);
      background: var(--mn-color-surface-chrome, #f1f2e9);
    }
    .sidebar-intro { padding: 22px 18px 14px; }
    .eyebrow {
      margin: 0 0 7px;
      color: var(--mn-color-text-accent, #376d57);
      font: 700 10px/1.2 var(--mn-font-utility, system-ui, sans-serif);
      letter-spacing: 0.13em;
    }
    .sidebar-intro h2 {
      margin: 0 0 20px;
      max-width: 22ch;
      color: var(--mn-color-text-primary, #18211b);
      font: 500 21px/1.2 var(--mn-font-display, Georgia, serif);
      letter-spacing: -0.035em;
    }
    .search-field {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 42px;
      padding: 0 12px;
      border: 1px solid var(--mn-color-border-subtle, #d8ded9);
      border-radius: 12px;
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-muted, #66736a);
      box-shadow: var(--mn-garden-card-shadow, none);
    }
    .search-field > span { font-size: 21px; line-height: 1; }
    .search-field input {
      width: 100%;
      min-width: 0;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--mn-color-text-primary, #18211b);
      font: 14px/1.3 var(--mn-font-utility, system-ui, sans-serif);
    }
    .search-field:focus-within { outline: 2px solid var(--mn-focus-ring-color, #376d57); outline-offset: 2px; }
    ul { display: grid; align-content: start; gap: 7px; padding: 0 11px 72px; }
    .row {
      box-sizing: border-box;
      min-height: 56px;
      padding: 12px 13px;
      border: 1px solid transparent;
      border-radius: 14px;
      background: transparent;
    }
    .row:hover { background: var(--mn-color-surface-hover, #edf6ef); }
    .row.selected {
      border-color: var(--mn-garden-card-edge, #d8ded9);
      background: var(--mn-color-surface-raised, #fff);
      box-shadow: var(--mn-garden-card-shadow, 0 1px 0 rgb(30 69 48 / 0.08));
    }
    .row:focus-visible, .back:focus-visible {
      outline: 2px solid var(--mn-focus-ring-color, #376d57);
      outline-offset: 2px;
    }
    .row-meta { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin: 0; }
    .row-title {
      color: var(--mn-color-text-primary, #18211b);
      font: 650 14px/1.35 var(--mn-font-chrome, system-ui, sans-serif);
    }
    .row-time { order: 2; color: var(--mn-color-text-muted, #66736a); opacity: 1; font-size: 11px; }
    .row-snippet {
      display: block;
      margin-top: 7px;
      color: var(--mn-color-text-secondary, #58665c);
      font-size: 12px;
      opacity: 1;
    }
    .empty-list, .load-error { padding: 8px 19px; color: var(--mn-color-text-secondary, #58665c); opacity: 1; }
    main { background: var(--mn-color-surface-base, #fff); }
    .editor-bar {
      min-height: 64px;
      padding: 0 24px;
      border-bottom: 1px solid var(--mn-color-border-subtle, #d8ded9);
      background: var(--mn-color-surface-base, #fff);
    }
    .editor-bar-title {
      min-width: 0;
      overflow: hidden;
      color: var(--mn-color-text-primary, #18211b);
      font: 600 14px/1.2 var(--mn-font-chrome, system-ui, sans-serif);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .save-state {
      flex: 0 0 auto;
      color: var(--mn-color-text-accent, #376d57);
      font: 600 11px/1.2 var(--mn-font-utility, system-ui, sans-serif);
      opacity: 1;
    }
    .save-state[data-state='saving'] { color: var(--mn-color-text-secondary, #58665c); }
    .save-state[data-state='conflict'] { color: var(--mn-color-text-danger, #a3402f); }
    .conflict {
      display: grid;
      gap: 10px;
      margin: 16px auto 0;
      max-width: 672px;
      padding: 12px 16px;
      border: 1px solid var(--mn-color-border-danger, #d9a79c);
      border-radius: 12px;
      background: var(--mn-color-surface-danger, #fbefec);
      color: var(--mn-color-text-primary, #18211b);
      font: 13px/1.4 var(--mn-font-utility, system-ui, sans-serif);
    }
    .conflict p { margin: 0; }
    .conflict-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .conflict button {
      min-height: 36px;
      padding: 0 12px;
      border: 1px solid var(--mn-color-border-subtle, #d8ded9);
      border-radius: 10px;
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-primary, #18211b);
      font: 600 13px/1 var(--mn-font-utility, system-ui, sans-serif);
      cursor: pointer;
    }
    .page { max-width: 720px; padding: 52px 48px 120px; }
    .blank { align-content: center; gap: 8px; padding: 24px; color: var(--mn-color-text-secondary, #58665c); opacity: 1; font-style: normal; text-align: center; }
    .blank > span { color: var(--mn-color-text-accent, #376d57); font-size: 38px; }
    .blank h2 { margin: 0; color: var(--mn-color-text-primary, #18211b); font: 500 28px/1.2 var(--mn-font-display, Georgia, serif); }
    .blank p { margin: 0; font-size: 14px; }
    .sign-out { left: 16px; bottom: 13px; opacity: 0.55; }
    aside { min-height: 0; overflow: hidden; }
    .appearance-menu { position: relative; }
    /* Sized and coloured like the shared bar's own action buttons. */
    .appearance-menu summary {
      display: grid;
      width: var(--mn-control-height, 32px);
      height: var(--mn-control-height, 32px);
      place-items: center;
      border: 0;
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: var(--mn-top-bar-text-muted, #6b7280);
      font: 600 14px/1 var(--mn-font-display, Georgia, serif);
      cursor: pointer;
      list-style: none;
    }
    .appearance-menu summary::-webkit-details-marker { display: none; }
    .appearance-menu summary:focus-visible { outline: 2px solid var(--mn-focus-ring-color, #376d57); outline-offset: 2px; }
    .appearance-panel {
      position: absolute;
      z-index: 20;
      top: calc(100% + 9px);
      right: 0;
      display: grid;
      gap: 12px;
      width: 220px;
      padding: 14px;
      border: 1px solid var(--mn-material-popover-edge, var(--mn-color-border-subtle, #d8ded9));
      border-radius: 14px;
      background: var(--mn-material-popover-bg, var(--mn-color-surface-raised, #fff));
      box-shadow: var(--mn-material-popover-shadow, 0 10px 25px rgb(0 0 0 / 0.12));
      backdrop-filter: var(--mn-material-popover-filter, none);
    }
    .appearance-panel label { display: grid; gap: 5px; color: var(--mn-material-popover-text-muted, var(--mn-color-text-secondary, #58665c)); font: 650 11px/1.2 var(--mn-font-utility, system-ui, sans-serif); }
    .appearance-panel select {
      width: 100%;
      min-height: 36px;
      padding: 0 8px;
      border: 1px solid var(--mn-color-border-subtle, #d8ded9);
      border-radius: 8px;
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-primary, #18211b);
      font: 13px/1 var(--mn-font-utility, system-ui, sans-serif);
    }
    .sidebar-tools { display: grid; flex: 0 0 auto; gap: 12px; padding: 16px 18px 12px; }
    .workspace-field { display: grid; gap: 5px; min-width: 0; }
    .workspace-field > span,
    .list-heading {
      color: var(--mn-color-text-muted, #66736a);
      font: 700 10px/1.2 var(--mn-font-utility, system-ui, sans-serif);
      letter-spacing: 0.11em;
      text-transform: uppercase;
    }
    .workspace-field select {
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
      min-height: 42px;
      padding: 0 11px;
      border: 1px solid var(--mn-color-border-subtle, #d8ded9);
      border-radius: 11px;
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-primary, #18211b);
      font: 600 13px/1 var(--mn-font-utility, system-ui, sans-serif);
      text-overflow: ellipsis;
    }
    .workspace-field select:disabled { opacity: 0.8; }
    .list-heading { display: flex; justify-content: space-between; padding: 5px 2px 0; }
    ul {
      display: block;
      flex: 1 1 auto;
      min-height: 0;
      overflow-x: hidden;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding-bottom: 18px;
      scrollbar-gutter: stable;
    }
    ul li { min-width: 0; margin-bottom: 7px; }
    .row { overflow: hidden; }
    .row-meta { min-width: 0; }
    .row-title { flex: 1 1 auto; min-width: 0; }
    .row-time { flex: 0 0 auto; }
    .row-snippet { max-width: 100%; }
    .empty-list { list-style: none; }
    .sidebar-footer { flex: 0 0 auto; padding: 8px 18px max(8px, env(safe-area-inset-bottom, 0px)); border-top: 1px solid var(--mn-color-border-subtle, #d8ded9); }
    .sign-out { position: static; padding: 7px 0; color: var(--mn-color-text-secondary, #58665c); font: 12px/1.2 var(--mn-font-utility, system-ui, sans-serif); opacity: 1; }
    :host([data-font='sans']) hoja-editor .ProseMirror { font-family: var(--mn-font-sans, system-ui, sans-serif); }
    @media (max-width: 719px), (max-height: 500px) and (max-width: 950px) {
      .shell { display: grid; grid-template-columns: minmax(0, 1fr); }
      aside { height: auto; border: 0; }
      .sidebar-tools { padding-top: 17px; }
      ul { padding-inline: 12px; }
      .row { min-height: 60px; }
      .shell.editor-open main { height: auto; }
      .editor-bar { min-height: 64px; padding: 0 16px; box-sizing: border-box; gap: 10px; }
      .back { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 42px; height: 42px; padding: 0; border: 1px solid var(--mn-garden-control-edge, #d8ded9); border-radius: 12px; background: var(--mn-garden-control-bg, #fff); color: var(--mn-garden-control-text, #376d57); font-size: 26px; opacity: 1; }
      .editor-bar-title { flex: 1; }
      .save-state { margin-left: 0; }
      .page { padding: 28px 22px 100px; }
      .sign-out { bottom: max(14px, env(safe-area-inset-bottom, 0px)); }
    }
    /* Phones, both orientations (QA P1-3): the DOCUMENT scrolls (so iOS can
       collapse its address bar), the top bar and the note's bar stay sticky,
       and the note's text starts right under them — no nested page card, no
       fixed 48px gutters. Side safe-area insets keep text out of the notch. */
    @media (max-width: 719px), (max-height: 500px) and (max-width: 950px) {
      :host { height: auto; min-height: 100vh; min-height: 100dvh; }
      .shell { height: auto; min-height: 100vh; min-height: 100dvh; grid-template-rows: auto auto; }
      .suite-topbar { position: sticky; top: 0; }
      aside { overflow: visible; }
      aside ul { overflow: visible; }
      aside, main { padding-inline: env(safe-area-inset-left, 0px) env(safe-area-inset-right, 0px); }
      .sidebar-footer { position: sticky; bottom: 0; background: var(--mn-color-surface-chrome, #f1f2e9); }
      main { overflow: visible; }
      .editor-bar { top: var(--mn-top-bar-height); min-height: 48px; padding: 0 12px; }
      .back { flex-basis: 40px; height: 40px; }
      .page { max-width: none; padding: 0 0 calc(72px + env(safe-area-inset-bottom, 0px)); }
      .conflict { margin: 8px 12px 0; }
      hoja-editor {
        min-height: 0;
        --mn-editor-sheet-padding: 12px 12px 48px 0;
      }
      /* :host lifts these over the editor's own adopted page-posture rules. */
      :host hoja-editor[posture='page'] .hoja-editor__content { min-block-size: 0; }
      /* Formatting controls ride the bottom edge, above the keyboard. */
      :host hoja-editor[posture='page'] .hoja-editor__footer {
        position: sticky;
        bottom: var(--hoja-keyboard-inset, 0px);
        z-index: 1;
        order: 2;
        border-top: 1px solid var(--mn-color-border-subtle, #d8ded9);
        border-bottom: 0;
        padding-bottom: max(4px, env(safe-area-inset-bottom, 0px));
      }
    }
  `
}

function isDocument(value: unknown): value is HojaJSONContent {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && (value as { type?: unknown }).type === 'doc'
    && Array.isArray((value as { content?: unknown }).content))
}

function readChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = window.localStorage.getItem(key)
    return allowed.find(choice => choice === value) ?? fallback
  } catch {
    return fallback
  }
}

function storeChoice(key: string, value: string): void {
  try { window.localStorage.setItem(key, value) } catch { /* Private browsing can deny storage. */ }
}

declare global {
  interface HTMLElementTagNameMap {
    'hoja-app': HojaApp
  }
}

function linkedDocumentId(): string {
  try {
    return new URL(window.location.href).searchParams.get('doc')?.trim() ?? ''
  } catch {
    return ''
  }
}
