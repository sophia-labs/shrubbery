/**
 * Excalidraw React-island runtime for the controlled <mn-excalidraw-canvas>.
 *
 * The component package owns chrome and emits intents. This controller owns the
 * imperative drawing surface: lazy React/Excalidraw loading, the named-slot
 * mount, artifact snapshot load/change/save, current API state, operation
 * serialization, and teardown. Graph semantics remain shell-owned callbacks:
 * projection, link mutation/navigation, and wire sync/hydration are injected at
 * this boundary rather than smuggled into the runtime package.
 */

export const EXCALIDRAW_SCENE_MIME = 'application/vnd.excalidraw+json'
export const EXCALIDRAW_NODE_DND_MIME = 'application/x-mnemosyne-node'

export type ExcalidrawCanvasStatus = 'idle' | 'loading' | 'ready' | 'error'
export type ExcalidrawSaveStatus = 'idle' | 'saving' | 'saved' | 'error'
export type ExcalidrawOperationStatus = 'idle' | 'ready' | 'running' | 'success' | 'error'
export type ExcalidrawProjectionReason = 'load' | 'change' | 'manual' | 'operation' | 'save'

export interface ExcalidrawScope {
  readonly graphId: string
  readonly artifactId: string
}

export interface ExcalidrawInitialData {
  readonly elements?: readonly unknown[]
  readonly appState?: Record<string, unknown>
  readonly files?: unknown
  readonly [key: string]: unknown
}

export type ExcalidrawArtifactPayload =
  | string
  | Uint8Array
  | ArrayBuffer
  | Blob
  | ExcalidrawInitialData
  | null
  | undefined

export interface ExcalidrawApi {
  getSceneElements(): readonly unknown[]
  getAppState(): Record<string, unknown>
  getFiles(): unknown
  updateScene(data: {
    readonly elements?: readonly unknown[]
    readonly appState?: Record<string, unknown>
  }): void
  addFiles?(files: readonly unknown[]): void
  refresh?(): void
}

export interface ExcalidrawSnapshot extends ExcalidrawScope {
  readonly elements: readonly unknown[]
  readonly appState: Record<string, unknown>
  readonly files: unknown
  readonly selectedElementId: string | null
}

export interface ExcalidrawProjectionSummary {
  readonly anchors?: number
  readonly arrows?: number
  readonly wireCandidates?: number
  readonly text?: number
  readonly frames?: number
  readonly diagnostics?: number
  readonly searchText?: string | null
}

export interface ExcalidrawDiagnostic {
  readonly id?: string
  readonly code: string
  readonly message: string
  readonly sceneElementId?: string | null
  readonly severity?: 'info' | 'warning' | 'error'
}

export interface ExcalidrawSelectedElement {
  readonly id: string
  readonly type?: string | null
  readonly label?: string | null
  readonly linkKind?: 'document' | 'artifact' | null
  readonly linkTargetId?: string | null
  readonly linkTitle?: string | null
  readonly predicate?: string | null
  readonly canRecreateTarget?: boolean
  readonly canRemoveLink?: boolean
  readonly canLink?: boolean
  readonly canOpenLink?: boolean
}

export interface ExcalidrawWireSummary {
  readonly missing?: number
  readonly hydratable?: number
  readonly hydrated?: number
  readonly created?: number
  readonly skipped?: number
  readonly lastMessage?: string | null
}

/** Projection result mapped directly onto the controlled component. */
export interface ExcalidrawProjectionView {
  readonly summary?: ExcalidrawProjectionSummary | null
  readonly diagnostics?: readonly ExcalidrawDiagnostic[]
  readonly selectedElement?: ExcalidrawSelectedElement | null
  readonly wireSummary?: ExcalidrawWireSummary | null
  /** Full Garden-style projection emitted to consumers, when available. */
  readonly raw?: unknown
  /** Compact summary embedded in saved Excalidraw JSON as mnemosyneProjection. */
  readonly embedded?: unknown
}

export interface ExcalidrawArtifactLoadRequest extends ExcalidrawScope {
  readonly signal: AbortSignal
}

export interface ExcalidrawArtifactSaveRequest extends ExcalidrawScope {
  readonly signal: AbortSignal
  readonly bytes: Uint8Array
  readonly json: string
  readonly mimeType: typeof EXCALIDRAW_SCENE_MIME
  readonly label: string
  readonly snapshot: ExcalidrawSnapshot
  readonly projection: ExcalidrawProjectionView | null
}

export interface ExcalidrawSnapshotChangeRequest extends ExcalidrawScope {
  readonly snapshot: ExcalidrawSnapshot
}

export interface ExcalidrawArtifactCallbacks {
  load(request: ExcalidrawArtifactLoadRequest): Promise<ExcalidrawArtifactPayload>
  save(request: ExcalidrawArtifactSaveRequest): Promise<void>
  /** Optional observation seam; persistence remains explicit through Save. */
  onChange?(request: ExcalidrawSnapshotChangeRequest): void | Promise<void>
}

export interface ExcalidrawProjectionRequest extends ExcalidrawSnapshot {
  readonly reason: ExcalidrawProjectionReason
}

export interface ExcalidrawProjectionCallbacks {
  project(request: ExcalidrawProjectionRequest): ExcalidrawProjectionView | Promise<ExcalidrawProjectionView>
}

export interface ExcalidrawEngineContext extends ExcalidrawSnapshot {
  readonly api: ExcalidrawApi
  readonly convertToExcalidrawElements?: (skeleton: readonly unknown[], options?: unknown) => readonly unknown[]
  readonly viewportCoordsToSceneCoords?: (
    point: { clientX: number; clientY: number },
    appState: unknown,
  ) => { x: number; y: number }
}

export interface ExcalidrawSceneOperationResult {
  /** Elements to apply through Excalidraw API before re-projecting. */
  readonly elements?: readonly unknown[]
  /** Optional already-computed view; otherwise project() is called. */
  readonly view?: ExcalidrawProjectionView | null
  /** Persist the resulting scene as a new artifact revision. */
  readonly save?: boolean
  readonly message?: string
}

export interface ExcalidrawElementIntent {
  readonly elementId: string | null
}

export interface ExcalidrawNodeLinkTarget extends ExcalidrawElementIntent {
  readonly kind: 'document' | 'artifact'
  readonly id: string
  readonly title: string
  readonly mimeType?: string
}

export interface ExcalidrawPredicateIntent extends ExcalidrawElementIntent {
  readonly predicate: string
}

export interface ExcalidrawDroppedNodeIntent {
  readonly node: unknown
  readonly clientX: number
  readonly clientY: number
}

export interface ExcalidrawLinkOpenIntent {
  readonly element: unknown
  readonly event: unknown
}

export interface ExcalidrawLinkCallbacks {
  /** Must return synchronously so Excalidraw's default navigation can be cancelled. */
  openElementLink?(context: ExcalidrawEngineContext, intent: ExcalidrawLinkOpenIntent): boolean
  linkSelected?(
    context: ExcalidrawEngineContext,
    target: ExcalidrawNodeLinkTarget,
  ): ExcalidrawSceneOperationResult | Promise<ExcalidrawSceneOperationResult | void> | void
  openSelected?(
    context: ExcalidrawEngineContext,
    intent: ExcalidrawElementIntent,
  ): ExcalidrawSceneOperationResult | Promise<ExcalidrawSceneOperationResult | void> | void
  refreshTitles?(context: ExcalidrawEngineContext):
    | ExcalidrawSceneOperationResult
    | Promise<ExcalidrawSceneOperationResult | void>
    | void
  recreateTarget?(
    context: ExcalidrawEngineContext,
    intent: ExcalidrawElementIntent,
  ): ExcalidrawSceneOperationResult | Promise<ExcalidrawSceneOperationResult | void> | void
  removeSelected?(
    context: ExcalidrawEngineContext,
    intent: ExcalidrawElementIntent,
  ): ExcalidrawSceneOperationResult | Promise<ExcalidrawSceneOperationResult | void> | void
  changePredicate?(
    context: ExcalidrawEngineContext,
    intent: ExcalidrawPredicateIntent,
  ): ExcalidrawSceneOperationResult | Promise<ExcalidrawSceneOperationResult | void> | void
  dropNode?(
    context: ExcalidrawEngineContext,
    intent: ExcalidrawDroppedNodeIntent,
  ): ExcalidrawSceneOperationResult | Promise<ExcalidrawSceneOperationResult | void> | void
}

export interface ExcalidrawWireCallbacks {
  sync?(context: ExcalidrawEngineContext):
    | ExcalidrawSceneOperationResult
    | Promise<ExcalidrawSceneOperationResult | void>
    | void
  hydrate?(context: ExcalidrawEngineContext):
    | ExcalidrawSceneOperationResult
    | Promise<ExcalidrawSceneOperationResult | void>
    | void
}

export interface ExcalidrawReactRoot {
  render(node: unknown): void
  unmount(): void
}

export interface ExcalidrawRuntimeModule {
  readonly Excalidraw: unknown
  /** Inline stylesheet installed inside this canvas's own shadow root. */
  readonly cssText?: string
  createElement(type: unknown, props: Record<string, unknown>): unknown
  createRoot(container: Element | DocumentFragment): ExcalidrawReactRoot
  serializeAsJSON(elements: unknown, appState: unknown, files: unknown, type: unknown): string
  readonly convertToExcalidrawElements?: (
    skeleton: readonly unknown[],
    options?: unknown,
  ) => readonly unknown[]
  readonly viewportCoordsToSceneCoords?: (
    point: { clientX: number; clientY: number },
    appState: unknown,
  ) => { x: number; y: number }
}

export type ExcalidrawRuntimeLoader = () => Promise<ExcalidrawRuntimeModule>

/** Structural surface of packages/components' controlled element; no dependency cycle. */
export interface ExcalidrawCanvasHost extends HTMLElement {
  graphId: string
  artifactId: string
  status: ExcalidrawCanvasStatus
  error: string
  saveStatus: ExcalidrawSaveStatus
  projectionStatus: ExcalidrawOperationStatus
  syncStatus: ExcalidrawOperationStatus
  hydrateStatus: ExcalidrawOperationStatus
  liveMessage: string
  nodeLinkPickerOpen: boolean
  projection: ExcalidrawProjectionSummary | null
  diagnostics: readonly ExcalidrawDiagnostic[]
  selectedElement: ExcalidrawSelectedElement | null
  wireSummary: ExcalidrawWireSummary | null
  requestUpdate?(): unknown
}

export interface ExcalidrawRuntimeOptions {
  readonly scope: ExcalidrawScope
  readonly artifacts: ExcalidrawArtifactCallbacks
  readonly projection?: ExcalidrawProjectionCallbacks
  readonly links?: ExcalidrawLinkCallbacks
  readonly wires?: ExcalidrawWireCallbacks
  readonly loader?: ExcalidrawRuntimeLoader
  readonly saveLabel?: string
  readonly scheduleFrame?: (callback: FrameRequestCallback) => number
}

export interface ExcalidrawRuntimeHandle {
  readonly ready: Promise<void>
  readonly mountElement: HTMLElement
  readonly api: ExcalidrawApi | null
  readonly destroyed: boolean
  snapshot(): ExcalidrawSnapshot
  reload(): Promise<void>
  refreshProjection(): Promise<ExcalidrawProjectionView | null>
  save(): Promise<void>
  destroy(): void
}

type CanvasEventDetail = {
  readonly graphId?: string | null
  readonly artifactId?: string | null
  readonly elementId?: string | null
  readonly predicate?: string
  readonly kind?: 'document' | 'artifact'
  readonly id?: string
  readonly title?: string
  readonly mimeType?: string
}

type ExcalidrawComponentProps = {
  readonly key: string
  readonly initialData: ExcalidrawInitialData
  readonly excalidrawAPI: (api: ExcalidrawApi) => void
  readonly onChange: (elements: readonly unknown[], appState: Record<string, unknown>, files: unknown) => void
  readonly onLinkOpen: (element: unknown, event: unknown) => void
}

const EMPTY_SCENE: ExcalidrawInitialData = { elements: [], appState: {}, files: {} }

function errorText(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return 'Unknown Excalidraw runtime error'
}

function abortError(): Error {
  return new DOMException('Excalidraw runtime was destroyed', 'AbortError')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isInitialData(value: unknown): value is ExcalidrawInitialData {
  return isRecord(value) && (
    Array.isArray(value.elements)
    || isRecord(value.appState)
    || value.files !== undefined
    || value.type === 'excalidraw'
  )
}

async function payloadText(payload: Exclude<ExcalidrawArtifactPayload, ExcalidrawInitialData | null | undefined>): Promise<string> {
  if (typeof payload === 'string') return payload
  if (payload instanceof Blob) return payload.text()
  const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload)
  return new TextDecoder().decode(bytes)
}

/** Decode artifact bytes without restoring Excalidraw's transient collaborators. */
export async function decodeExcalidrawArtifact(payload: ExcalidrawArtifactPayload): Promise<ExcalidrawInitialData> {
  if (payload === null || payload === undefined) return EMPTY_SCENE
  let parsed: unknown
  if (isInitialData(payload)) parsed = payload
  else {
    const text = (await payloadText(payload)).trim()
    if (!text) return EMPTY_SCENE
    parsed = JSON.parse(text)
  }
  if (!isRecord(parsed)) throw new Error('Excalidraw artifact must be a JSON object')
  const appState = isRecord(parsed.appState) ? { ...parsed.appState } : {}
  delete appState.collaborators
  return {
    ...parsed,
    elements: Array.isArray(parsed.elements) ? parsed.elements : [],
    appState,
    files: parsed.files ?? {},
  }
}

export function embedExcalidrawProjection(json: string, projection: unknown): string {
  if (projection === undefined || projection === null) return json
  const parsed = JSON.parse(json) as unknown
  if (!isRecord(parsed)) throw new Error('Serialized Excalidraw scene must be a JSON object')
  return JSON.stringify({ ...parsed, mnemosyneProjection: projection })
}

async function defaultRuntimeLoader(): Promise<ExcalidrawRuntimeModule> {
  // Vite's ?inline transform returns the stylesheet as a string. TypeScript
  // does not know that virtual module when runtime source is traversed from a
  // sibling package's tsconfig.
  // @ts-ignore -- resolved by Vite's CSS inline plugin; some consuming
  // tsconfigs include Vite's declaration while the components island does not.
  const cssModulePromise: Promise<{ default: string }> = import('@excalidraw/excalidraw/index.css?inline')
  const [excalidraw, react, reactDom, cssModule] = await Promise.all([
    import('@excalidraw/excalidraw'),
    import('react'),
    import('react-dom/client'),
    cssModulePromise,
  ])
  const ex = excalidraw as unknown as {
    Excalidraw: unknown
    serializeAsJSON: ExcalidrawRuntimeModule['serializeAsJSON']
    convertToExcalidrawElements?: ExcalidrawRuntimeModule['convertToExcalidrawElements']
    viewportCoordsToSceneCoords?: ExcalidrawRuntimeModule['viewportCoordsToSceneCoords']
  }
  return {
    Excalidraw: ex.Excalidraw,
    cssText: cssModule.default,
    createElement: react.createElement as unknown as ExcalidrawRuntimeModule['createElement'],
    createRoot: reactDom.createRoot as unknown as ExcalidrawRuntimeModule['createRoot'],
    serializeAsJSON: ex.serializeAsJSON,
    convertToExcalidrawElements: ex.convertToExcalidrawElements,
    viewportCoordsToSceneCoords: ex.viewportCoordsToSceneCoords,
  }
}

function selectedId(appState: Record<string, unknown>): string | null {
  const ids = isRecord(appState.selectedElementIds)
    ? Object.entries(appState.selectedElementIds)
      .filter(([, selected]) => selected === true)
      .map(([id]) => id)
    : []
  return ids.length === 1 ? ids[0] : null
}

class ExcalidrawRuntimeController implements ExcalidrawRuntimeHandle {
  readonly mountElement: HTMLElement
  readonly ready: Promise<void>
  private readonly mountRoot: ShadowRoot
  private readonly reactContainer: HTMLElement
  private readonly host: ExcalidrawCanvasHost
  private readonly options: ExcalidrawRuntimeOptions
  private readonly listeners: Array<[string, EventListener]> = []
  private runtime: ExcalidrawRuntimeModule | null = null
  private root: ExcalidrawReactRoot | null = null
  private currentApi: ExcalidrawApi | null = null
  private currentElements: readonly unknown[] = []
  private currentAppState: Record<string, unknown> = {}
  private currentFiles: unknown = {}
  private currentSelectedId: string | null = null
  private currentProjection: ExcalidrawProjectionView | null = null
  private loadAbort: AbortController | null = null
  private saveAbort: AbortController | null = null
  private loadGeneration = 0
  private projectionGeneration = 0
  private renderGeneration = 0
  private operationGeneration = 0
  private operationChain: Promise<void> = Promise.resolve()
  private changeEffectsScheduled = false
  private isSaving = false
  private isDestroyed = false
  private resolveReady!: () => void
  private rejectReady!: (reason: unknown) => void
  private readySettled = false

  constructor(host: ExcalidrawCanvasHost, options: ExcalidrawRuntimeOptions) {
    this.host = host
    this.options = options
    this.mountElement = document.createElement('div')
    this.mountElement.slot = 'canvas'
    this.mountElement.className = 'sh-excalidraw-runtime-slot'
    this.mountElement.dataset.excalidrawRuntime = 'true'
    this.mountElement.style.cssText = 'position:relative;display:block;width:100%;height:100%;min-width:0;min-height:0;'
    this.mountRoot = this.mountElement.attachShadow({ mode: 'open' })
    this.reactContainer = document.createElement('div')
    this.reactContainer.className = 'sh-excalidraw-react-root'
    this.reactContainer.style.cssText = 'position:relative;width:100%;height:100%;min-width:0;min-height:0;'
    this.mountRoot.appendChild(this.reactContainer)
    this.host.appendChild(this.mountElement)
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    // Prevent a rejected readiness promise from becoming an unhandled rejection
    // when callers rely only on the controlled host's error state.
    void this.ready.catch(() => {})
    this.patchHost({
      graphId: options.scope.graphId,
      artifactId: options.scope.artifactId,
      status: 'loading',
      error: '',
      saveStatus: 'idle',
      projectionStatus: 'idle',
      syncStatus: 'idle',
      hydrateStatus: 'idle',
      liveMessage: 'Scene canvas loading',
    })
    this.bindEvents()
    this.mountElement.addEventListener('dragover', this.onDragOver, true)
    this.mountElement.addEventListener('drop', this.onDrop, true)
    window.addEventListener('mn-sidebar-node-drop', this.onSidebarNodeDrop as EventListener)
    void this.loadAndRender().catch((error) => this.failMount(error))
  }

  get api(): ExcalidrawApi | null {
    return this.currentApi
  }

  get destroyed(): boolean {
    return this.isDestroyed
  }

  snapshot(): ExcalidrawSnapshot {
    const api = this.currentApi
    const elements = api?.getSceneElements() ?? this.currentElements
    const appState = api?.getAppState() ?? this.currentAppState
    const files = api?.getFiles() ?? this.currentFiles
    return {
      ...this.options.scope,
      elements,
      appState,
      files,
      selectedElementId: selectedId(appState) ?? this.currentSelectedId,
    }
  }

  async reload(): Promise<void> {
    this.assertAlive()
    try {
      await this.loadAndRender()
    } catch (error) {
      if (!this.isDestroyed) {
        this.patchHost({ status: 'error', error: errorText(error), liveMessage: 'Scene canvas failed to reload' })
      }
      throw error
    }
  }

  async refreshProjection(): Promise<ExcalidrawProjectionView | null> {
    this.assertAlive()
    return this.project('manual', true)
  }

  async save(): Promise<void> {
    this.assertAlive()
    if (!this.currentApi || !this.runtime || this.isSaving) return
    this.isSaving = true
    this.saveAbort?.abort()
    const abort = new AbortController()
    this.saveAbort = abort
    this.patchHost({ saveStatus: 'saving', liveMessage: 'Saving scene version', error: '' })
    try {
      const projection = await this.project('save', false)
      if (this.isDestroyed || abort.signal.aborted) throw abortError()
      const snapshot = this.snapshot()
      let json = this.runtime.serializeAsJSON(
        snapshot.elements,
        snapshot.appState,
        snapshot.files,
        'local',
      )
      json = embedExcalidrawProjection(json, projection?.embedded)
      const bytes = new TextEncoder().encode(json)
      await this.options.artifacts.save({
        ...this.options.scope,
        signal: abort.signal,
        bytes,
        json,
        mimeType: EXCALIDRAW_SCENE_MIME,
        label: this.options.saveLabel ?? 'Edited',
        snapshot,
        projection,
      })
      if (this.isDestroyed || abort.signal.aborted) throw abortError()
      this.patchHost({ saveStatus: 'saved', liveMessage: 'Scene version saved' })
      this.host.dispatchEvent(new CustomEvent('mn-excalidraw-runtime-saved', {
        detail: { ...this.options.scope, bytes, projection },
        bubbles: true,
        composed: true,
      }))
    } catch (error) {
      if (!abort.signal.aborted && !this.isDestroyed) {
        this.patchHost({ saveStatus: 'error', error: errorText(error), liveMessage: 'Scene save failed' })
      }
      throw error
    } finally {
      if (this.saveAbort === abort) this.saveAbort = null
      this.isSaving = false
    }
  }

  destroy(): void {
    if (this.isDestroyed) return
    this.isDestroyed = true
    this.loadGeneration += 1
    this.projectionGeneration += 1
    this.operationGeneration += 1
    this.loadAbort?.abort()
    this.saveAbort?.abort()
    this.loadAbort = null
    this.saveAbort = null
    for (const [type, listener] of this.listeners) this.host.removeEventListener(type, listener)
    this.listeners.length = 0
    this.mountElement.removeEventListener('dragover', this.onDragOver, true)
    this.mountElement.removeEventListener('drop', this.onDrop, true)
    window.removeEventListener('mn-sidebar-node-drop', this.onSidebarNodeDrop as EventListener)
    this.root?.unmount()
    this.root = null
    this.currentApi = null
    this.mountElement.remove()
    this.patchHost({
      status: 'idle',
      error: '',
      saveStatus: 'idle',
      projectionStatus: 'idle',
      syncStatus: 'idle',
      hydrateStatus: 'idle',
      liveMessage: 'Scene canvas idle',
      nodeLinkPickerOpen: false,
      projection: null,
      diagnostics: [],
      selectedElement: null,
      wireSummary: null,
    })
    if (!this.readySettled) {
      this.readySettled = true
      this.rejectReady(abortError())
    }
  }

  private assertAlive(): void {
    if (this.isDestroyed) throw abortError()
  }

  private patchHost(patch: Partial<ExcalidrawCanvasHost>): void {
    Object.assign(this.host, patch)
    this.host.requestUpdate?.()
  }

  private async loadAndRender(): Promise<void> {
    this.assertAlive()
    const generation = ++this.loadGeneration
    this.operationGeneration += 1
    this.loadAbort?.abort()
    const abort = new AbortController()
    this.loadAbort = abort
    this.currentApi = null
    this.patchHost({
      status: 'loading',
      error: '',
      liveMessage: 'Scene canvas loading',
      projectionStatus: 'idle',
    })

    try {
      const [runtime, payload] = await Promise.all([
        this.runtime ? Promise.resolve(this.runtime) : (this.options.loader ?? defaultRuntimeLoader)(),
        this.options.artifacts.load({ ...this.options.scope, signal: abort.signal }),
      ])
      if (this.isDestroyed || abort.signal.aborted || generation !== this.loadGeneration) return
      this.runtime = runtime
      this.installRuntimeStyle(runtime.cssText)
      const initialData = await decodeExcalidrawArtifact(payload)
      if (this.isDestroyed || abort.signal.aborted || generation !== this.loadGeneration) return
      this.currentElements = initialData.elements ?? []
      this.currentAppState = initialData.appState ?? {}
      this.currentFiles = initialData.files ?? {}
      this.currentSelectedId = selectedId(this.currentAppState)
      this.applySelectedFallback()
      await this.project('load', false)
      if (this.isDestroyed || abort.signal.aborted || generation !== this.loadGeneration) return

      if (!this.root) this.root = runtime.createRoot(this.reactContainer)
      const props: ExcalidrawComponentProps = {
        key: `${this.options.scope.graphId}/${this.options.scope.artifactId}/${++this.renderGeneration}`,
        initialData,
        excalidrawAPI: (api) => this.claimApi(api, generation),
        onChange: (elements, appState, files) => this.sceneChanged(elements, appState, files, generation),
        onLinkOpen: (element, event) => this.linkOpened(element, event),
      }
      this.root.render(runtime.createElement(runtime.Excalidraw, props as unknown as Record<string, unknown>))
    } catch (error) {
      // A reload intentionally aborts the previous generation. A stale abort
      // must not reject the shared ready promise or paint over the new load.
      if (this.isDestroyed || abort.signal.aborted || generation !== this.loadGeneration) return
      throw error
    } finally {
      if (this.loadAbort === abort) this.loadAbort = null
    }
  }

  private installRuntimeStyle(cssText: string | undefined): void {
    if (!cssText || this.mountRoot.querySelector('style[data-excalidraw-runtime-style]')) return
    const style = document.createElement('style')
    style.dataset.excalidrawRuntimeStyle = 'true'
    // Excalidraw's stacking tokens are defined on :root. That selector does
    // not match inside a shadow tree, so bind it to Excalidraw's own root.
    style.textContent = cssText.replace(/:root\b/g, '.excalidraw')
    this.mountRoot.insertBefore(style, this.reactContainer)
  }

  private claimApi(api: ExcalidrawApi, generation: number): void {
    if (this.isDestroyed || generation !== this.loadGeneration) return
    this.currentApi = api
    this.currentElements = api.getSceneElements()
    this.currentAppState = api.getAppState()
    this.currentFiles = api.getFiles()
    this.currentSelectedId = selectedId(this.currentAppState)
    this.applySelectedFallback()
    this.patchHost({ status: 'ready', error: '', liveMessage: 'Scene canvas ready' })
    const schedule = this.options.scheduleFrame ?? requestAnimationFrame
    schedule(() => {
      if (this.isDestroyed || this.currentApi !== api) return
      try {
        api.refresh?.()
      } catch {
        // Layout refresh is best effort; the canvas remains usable without it.
      }
    })
    if (!this.readySettled) {
      this.readySettled = true
      this.resolveReady()
    }
  }

  private sceneChanged(
    elements: readonly unknown[],
    appState: Record<string, unknown>,
    files: unknown,
    generation: number,
  ): void {
    if (this.isDestroyed || generation !== this.loadGeneration) return
    this.currentElements = elements
    this.currentAppState = appState
    this.currentFiles = files
    this.currentSelectedId = selectedId(appState)
    this.applySelectedFallback()
    this.scheduleChangeEffects(generation)
  }

  private scheduleChangeEffects(generation: number): void {
    if (this.changeEffectsScheduled) return
    this.changeEffectsScheduled = true
    const schedule = this.options.scheduleFrame ?? requestAnimationFrame
    schedule(() => {
      this.changeEffectsScheduled = false
      if (this.isDestroyed || generation !== this.loadGeneration) return
      const snapshot = this.snapshot()
      void Promise.resolve(this.options.artifacts.onChange?.({ ...this.options.scope, snapshot })).catch((error) => {
        if (!this.isDestroyed) this.patchHost({ error: errorText(error) })
      })
      void this.project('change', false).catch(() => {})
    })
  }

  private linkOpened(element: unknown, event: unknown): void {
    if (!this.currentApi || !this.options.links?.openElementLink) return
    try {
      const handled = this.options.links.openElementLink(
        this.engineContext(),
        { element, event },
      )
      if (handled && isRecord(event) && typeof event.preventDefault === 'function') {
        ;(event.preventDefault as () => void)()
      }
    } catch (error) {
      this.patchHost({ error: errorText(error), liveMessage: 'Linked node could not be opened' })
    }
  }

  private applySelectedFallback(): void {
    const current = this.host.selectedElement
    if (!this.currentSelectedId) {
      this.patchHost({ selectedElement: null })
      return
    }
    if (current?.id === this.currentSelectedId) return
    this.patchHost({ selectedElement: { id: this.currentSelectedId } })
  }

  private async project(
    reason: ExcalidrawProjectionReason,
    showRunning: boolean,
  ): Promise<ExcalidrawProjectionView | null> {
    const project = this.options.projection?.project
    if (!project) {
      if (showRunning) this.patchHost({ projectionStatus: 'ready' })
      return this.currentProjection
    }
    const generation = ++this.projectionGeneration
    if (showRunning) this.patchHost({ projectionStatus: 'running', liveMessage: 'Projecting scene' })
    try {
      const view = await project({ ...this.snapshot(), reason })
      if (this.isDestroyed || generation !== this.projectionGeneration) return this.currentProjection
      this.applyProjectionView(view)
      this.patchHost({
        projectionStatus: 'ready',
        ...(showRunning ? { liveMessage: 'Scene projection ready' } : {}),
      })
      return view
    } catch (error) {
      if (!this.isDestroyed && generation === this.projectionGeneration) {
        this.patchHost({ projectionStatus: 'error', error: errorText(error), liveMessage: 'Scene projection failed' })
      }
      throw error
    }
  }

  private applyProjectionView(view: ExcalidrawProjectionView | null): void {
    this.currentProjection = view
    if (!view) {
      this.patchHost({
        projection: null,
        diagnostics: [],
        selectedElement: this.currentSelectedId ? { id: this.currentSelectedId } : null,
        wireSummary: null,
      })
      return
    }
    this.patchHost({
      projection: view.summary ?? null,
      diagnostics: view.diagnostics ?? [],
      selectedElement: view.selectedElement === undefined
        ? (this.currentSelectedId ? { id: this.currentSelectedId } : null)
        : view.selectedElement,
      ...(view.wireSummary === undefined ? {} : { wireSummary: view.wireSummary }),
    })
    this.host.dispatchEvent(new CustomEvent('scene-graph-projection', {
      detail: view.raw ?? view.summary ?? view,
      bubbles: true,
      composed: true,
    }))
  }

  private engineContext(): ExcalidrawEngineContext {
    if (!this.currentApi) throw new Error('Excalidraw API is not ready')
    const snapshot = this.snapshot()
    return {
      ...snapshot,
      api: this.currentApi,
      convertToExcalidrawElements: this.runtime?.convertToExcalidrawElements,
      viewportCoordsToSceneCoords: this.runtime?.viewportCoordsToSceneCoords,
    }
  }

  private async applyOperationResult(
    result: ExcalidrawSceneOperationResult | void,
  ): Promise<void> {
    if (!result || this.isDestroyed) return
    if (result.elements) {
      if (!this.currentApi) throw new Error('Excalidraw API is not ready')
      this.currentApi.updateScene({ elements: result.elements })
      this.currentElements = result.elements
    }
    if (result.view !== undefined) this.applyProjectionView(result.view)
    else await this.project('operation', false)
    if (result.message) this.patchHost({ liveMessage: result.message })
    if (result.save) await this.save()
  }

  private async runOperation(
    callback: ((context: ExcalidrawEngineContext) =>
      | ExcalidrawSceneOperationResult
      | Promise<ExcalidrawSceneOperationResult | void>
      | void) | undefined,
    status: 'syncStatus' | 'hydrateStatus' | null,
    runningMessage: string,
    successMessage: string,
  ): Promise<void> {
    if (!callback || !this.currentApi || this.isDestroyed) return
    const generation = this.operationGeneration
    if (status) this.patchHost({ [status]: 'running' } as Partial<ExcalidrawCanvasHost>)
    this.patchHost({ error: '', liveMessage: runningMessage })
    try {
      const result = await callback(this.engineContext())
      if (this.isDestroyed || generation !== this.operationGeneration) return
      await this.applyOperationResult(result)
      if (this.isDestroyed || generation !== this.operationGeneration) return
      if (status) this.patchHost({ [status]: 'success' } as Partial<ExcalidrawCanvasHost>)
      this.patchHost({ liveMessage: result?.message ?? successMessage })
    } catch (error) {
      if (status) this.patchHost({ [status]: 'error' } as Partial<ExcalidrawCanvasHost>)
      this.patchHost({ error: errorText(error), liveMessage: `${successMessage} failed` })
    }
  }

  private enqueueOperation(task: () => Promise<unknown>): void {
    this.operationChain = this.operationChain
      .then(async () => {
        if (!this.isDestroyed) await task()
      })
      .catch((error) => {
        if (!this.isDestroyed) this.patchHost({ error: errorText(error) })
      })
  }

  private bind(type: string, handler: (detail: CanvasEventDetail, event: Event) => void): void {
    const listener: EventListener = (event) => {
      const detail = (event as CustomEvent<CanvasEventDetail>).detail ?? {}
      if (detail.graphId && detail.graphId !== this.options.scope.graphId) return
      if (detail.artifactId && detail.artifactId !== this.options.scope.artifactId) return
      handler(detail, event)
    }
    this.host.addEventListener(type, listener)
    this.listeners.push([type, listener])
  }

  private bindEvents(): void {
    this.bind('mn-excalidraw-reload', () => this.enqueueOperation(() => this.reload()))
    this.bind('mn-excalidraw-refresh-projection', () => this.enqueueOperation(() => this.refreshProjection()))
    this.bind('mn-excalidraw-save', () => this.enqueueOperation(() => this.save()))
    this.bind('mn-excalidraw-refresh-link-titles', () => {
      this.enqueueOperation(() => this.runOperation(
        this.options.links?.refreshTitles,
        null,
        'Refreshing scene link titles',
        'Scene link titles refreshed',
      ))
    })
    this.bind('mn-excalidraw-sync-wires', () => {
      this.enqueueOperation(() => this.runOperation(
        this.options.wires?.sync,
        'syncStatus',
        'Syncing scene wires',
        'Scene wires synced',
      ))
    })
    this.bind('mn-excalidraw-hydrate-wires', () => {
      this.enqueueOperation(() => this.runOperation(
        this.options.wires?.hydrate,
        'hydrateStatus',
        'Hydrating scene wires',
        'Scene wires hydrated',
      ))
    })
    this.bind('mn-excalidraw-link-selected', () => {
      if (this.currentApi) this.patchHost({ nodeLinkPickerOpen: true })
    })
    this.bind('mn-excalidraw-node-link-picker-close', () => {
      this.patchHost({ nodeLinkPickerOpen: false })
    })
    this.bind('mn-excalidraw-node-link-pick', (detail) => {
      this.patchHost({ nodeLinkPickerOpen: false })
      if (!detail.kind || !detail.id || !detail.title || !this.options.links?.linkSelected) return
      this.enqueueOperation(() => this.runOperation(
        (context) => this.options.links!.linkSelected!(context, {
          elementId: detail.elementId ?? this.currentSelectedId,
          kind: detail.kind!,
          id: detail.id!,
          title: detail.title!,
          mimeType: detail.mimeType,
        }),
        null,
        'Linking selected scene element',
        'Scene element linked',
      ))
    })
    this.bind('mn-excalidraw-open-selected-link', (detail) => {
      const callback = this.options.links?.openSelected
      if (!callback) return
      this.enqueueOperation(() => this.runOperation(
        (context) => callback(context, { elementId: detail.elementId ?? this.currentSelectedId }),
        null,
        'Opening linked node',
        'Linked node opened',
      ))
    })
    this.bind('mn-excalidraw-recreate-target', (detail) => {
      const callback = this.options.links?.recreateTarget
      if (!callback) return
      this.enqueueOperation(() => this.runOperation(
        (context) => callback(context, { elementId: detail.elementId ?? this.currentSelectedId }),
        null,
        'Recreating linked target',
        'Linked target recreated',
      ))
    })
    this.bind('mn-excalidraw-remove-selected-link', (detail) => {
      const callback = this.options.links?.removeSelected
      if (!callback) return
      this.enqueueOperation(() => this.runOperation(
        (context) => callback(context, { elementId: detail.elementId ?? this.currentSelectedId }),
        null,
        'Removing scene link',
        'Scene link removed',
      ))
    })
    this.bind('mn-excalidraw-predicate-change', (detail) => {
      const callback = this.options.links?.changePredicate
      if (!callback || !detail.predicate) return
      this.enqueueOperation(() => this.runOperation(
        (context) => callback(context, {
          elementId: detail.elementId ?? this.currentSelectedId,
          predicate: detail.predicate!,
        }),
        null,
        'Updating scene wire predicate',
        'Scene wire predicate updated',
      ))
    })
  }

  private onDragOver = (event: DragEvent): void => {
    if (!this.options.links?.dropNode || !Array.from(event.dataTransfer?.types ?? []).includes(EXCALIDRAW_NODE_DND_MIME)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }

  private onDrop = (event: DragEvent): void => {
    if (!this.options.links?.dropNode || !Array.from(event.dataTransfer?.types ?? []).includes(EXCALIDRAW_NODE_DND_MIME)) return
    event.preventDefault()
    event.stopPropagation()
    const raw = event.dataTransfer?.getData(EXCALIDRAW_NODE_DND_MIME)
    if (!raw) return
    try {
      const node = JSON.parse(raw) as unknown
      this.runDroppedNode({ node, clientX: event.clientX, clientY: event.clientY })
    } catch {
      // Ignore malformed foreign drag payloads.
    }
  }

  private onSidebarNodeDrop = (event: CustomEvent<ExcalidrawDroppedNodeIntent>): void => {
    if (!this.options.links?.dropNode || !event.detail?.node) return
    const rect = this.mountElement.getBoundingClientRect()
    const { clientX, clientY } = event.detail
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return
    this.runDroppedNode(event.detail)
  }

  private runDroppedNode(intent: ExcalidrawDroppedNodeIntent): void {
    const callback = this.options.links?.dropNode
    if (!callback) return
    this.enqueueOperation(() => this.runOperation(
      (context) => callback(context, intent),
      null,
      'Adding linked scene node',
      'Linked scene node added',
    ))
  }

  private failMount(error: unknown): void {
    if (this.isDestroyed) return
    this.patchHost({ status: 'error', error: errorText(error), liveMessage: 'Scene canvas failed to load' })
    if (!this.readySettled) {
      this.readySettled = true
      this.rejectReady(error)
    }
  }
}

/** Mount a real Excalidraw React canvas into the component's named `canvas` slot. */
export function mountExcalidrawRuntime(
  host: ExcalidrawCanvasHost,
  options: ExcalidrawRuntimeOptions,
): ExcalidrawRuntimeHandle {
  if (!options.scope.graphId.trim() || !options.scope.artifactId.trim()) {
    throw new Error('Excalidraw runtime requires graphId and artifactId')
  }
  return new ExcalidrawRuntimeController(host, options)
}
