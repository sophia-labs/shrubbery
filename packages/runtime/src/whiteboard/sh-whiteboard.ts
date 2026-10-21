/**
 * `<sh-whiteboard .page=${page}>`: a whiteboard document as the whole main pane (Vera, 2026-10-21: "a simple
 * collaborative Excalidraw ... as a shared visual-semantic medium"). Excalidraw's own UI is on (tools, library, export
 * to PNG/SVG); its live-collaboration trigger and anything that talks to excalidraw.com are off, and its fonts are
 * served from this app (`/excalidraw-assets/`), so nothing leaves the machine.
 *
 * The board is the document's room: the shell leases the room exactly as the editor does and passes the provider
 * (`page.provider`, a Y.Doc and its awareness). `WhiteboardBinding` keeps the canvas and the `elements` map in step;
 * presence rides the same awareness. A viewer gets `viewModeEnabled`.
 *
 * Gotchas of the pinned build (0.18.0-4ce38fb): the API arrives through `onInitialize`; there is no `scrollToContent`
 * on the API; a throw inside `onInitialize` unmounts the tree but leaves a live API over an empty container, so the
 * first draw happens on the next frame.
 */
import { adoptStyleSheet, styleRootOf } from '@shrubbery/nucleus'
import { css, html, LitElement, nothing, type PropertyValues } from 'lit'
import type * as Y from 'yjs'
import {
  type AwarenessLike, collaboratorsOf, isLeader, publishPointer, toolDrewLine,
} from './whiteboard-presence.js'
import { applySophiaPalette, WHITEBOARD_DEFAULTS, WHITEBOARD_THEME_CSS } from './whiteboard-theme.js'
import { type WbElement, type WbScene, type WbToolWrite, WhiteboardBinding } from './whiteboard-binding.js'

export interface WhiteboardPageOptions {
  readonly graphId: string
  readonly documentId: string
  readonly title: string
  readonly status: 'loading' | 'ready' | 'error'
  readonly error?: string | null
  /** The document's room, leased by the shell. */
  readonly provider: { readonly doc: unknown; readonly awareness: unknown } | null
  readonly readOnly?: boolean
  readonly theme?: 'light' | 'dark'
  /** Rename the board (the document's existing rename path). */
  readonly onRename?: (title: string) => void
  /** A shape's link was clicked: the shell opens the document or object. Return true when it handled the link. */
  readonly onOpenLink?: (link: string) => boolean
}

interface ExcalidrawModule {
  readonly Excalidraw: unknown
  readonly MainMenu: any
  readonly restoreElements: (elements: readonly unknown[], existing: unknown, opts?: { refreshDimensions?: boolean }) => readonly unknown[]
  readonly CaptureUpdateAction: { readonly NEVER: unknown }
  readonly cssText: string
  createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): unknown
  createRoot(container: Element): { render(node: unknown): void; unmount(): void }
}

interface ExcalidrawApiLike {
  getSceneElementsIncludingDeleted(): readonly unknown[]
  getAppState(): Record<string, any>
  updateScene(data: Record<string, unknown>): void
  setActiveTool?(tool: Record<string, unknown>): void
  scrollToContent?: unknown
}

export const WHITEBOARD_ASSET_PATH = '/excalidraw-assets/'
const RING_MS = 2600
const POINTER_THROTTLE_MS = 50

let modulePromise: Promise<ExcalidrawModule> | null = null

/** Load Excalidraw and React once. Fonts come from this app, never a CDN. */
export function loadExcalidraw(): Promise<ExcalidrawModule> {
  if (!modulePromise) {
    const w = window as unknown as { EXCALIDRAW_ASSET_PATH?: string }
    w.EXCALIDRAW_ASSET_PATH = new URL(WHITEBOARD_ASSET_PATH, window.location.origin).toString()
    // @ts-ignore -- resolved by Vite's CSS inline plugin, as the Files canvas runtime does.
    const cssModulePromise: Promise<{ default: string }> = import('@excalidraw/excalidraw/index.css?inline')
    modulePromise = Promise.all([import('@excalidraw/excalidraw'), import('react'), import('react-dom/client'), cssModulePromise, import('@excalidraw/common')]).then(
      ([excalidraw, react, reactDom, cssModule, common]) => {
        try {
          const style = getComputedStyle(document.documentElement)
          applySophiaPalette(common, (token) => style.getPropertyValue(token).trim())
        } catch { /* the picker keeps Excalidraw's own colours */ }
        const ex = excalidraw as unknown as {
          Excalidraw: unknown
          MainMenu: unknown
          restoreElements: ExcalidrawModule['restoreElements']
          CaptureUpdateAction: ExcalidrawModule['CaptureUpdateAction']
        }
        return {
          Excalidraw: ex.Excalidraw,
          MainMenu: ex.MainMenu,
          restoreElements: ex.restoreElements,
          CaptureUpdateAction: ex.CaptureUpdateAction,
          cssText: cssModule.default,
          createElement: react.createElement as unknown as ExcalidrawModule['createElement'],
          createRoot: reactDom.createRoot as unknown as ExcalidrawModule['createRoot'],
        }
      },
    )
    modulePromise.catch(() => { modulePromise = null })
  }
  return modulePromise
}

function busyIdsOf(state: Record<string, any>): Set<string> {
  const busy = new Set<string>()
  const add = (e: { id?: string } | null | undefined) => { if (e?.id) busy.add(e.id) }
  add(state.editingTextElement)
  add(state.newElement)
  add(state.resizingElement)
  add(state.multiElement)
  if (state.selectedElementsAreBeingDragged || state.isResizing || state.isRotating) {
    for (const [id, on] of Object.entries(state.selectedElementIds ?? {})) if (on) busy.add(id)
  }
  return busy
}

export class ShWhiteboard extends LitElement {
  static override properties = { page: { attribute: false }, presenceLine: { state: true }, notice: { state: true }, editingTitle: { state: true } }
  declare page: WhiteboardPageOptions | null
  declare presenceLine: string
  declare notice: string
  declare editingTitle: boolean

  private mountedKey = ''
  private generation = 0
  private root: { unmount(): void } | null = null
  private binding: WhiteboardBinding | null = null
  private api: ExcalidrawApiLike | null = null
  private awareness: AwarenessLike | null = null
  private awarenessListener: (() => void) | null = null
  private canvasHost: HTMLDivElement | null = null
  private ringTimer: ReturnType<typeof setTimeout> | null = null
  private lastPointerAt = 0
  private rings: Array<{ ids: readonly string[]; until: number }> = []
  private ringLayer: HTMLDivElement | null = null
  private resizeObserver: ResizeObserver | null = null
  private readonly onPointerUpCapture = () => {
    this.binding?.localChanged()
    this.binding?.flushNow()
  }

  constructor() {
    super()
    this.page = null
    this.presenceLine = ''
    this.notice = ''
    this.editingTitle = false
  }

  static override styles = css`
    :host { display: flex; flex-direction: column; height: 100%; min-height: 240px; box-sizing: border-box;
      background: var(--mn-color-surface-canvas); color: var(--mn-color-text-primary); font: var(--mn-text-sm, 13px)/1.4 var(--mn-font-chrome); }
    header { flex: none; display: flex; align-items: center; gap: 12px; min-width: 0; padding: 8px 16px;
      border-bottom: 1px solid var(--mn-color-border-subtle); background: var(--mn-color-surface-raised); }
    .title { font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; cursor: text;
      border: 0; background: none; color: inherit; font-family: inherit; padding: 2px 4px; border-radius: 4px; }
    .title:hover { background: var(--mn-color-surface-hover); }
    input.title { cursor: text; border: 1px solid var(--mn-color-border-accent); background: var(--mn-color-surface-canvas); min-width: 12em; }
    .presence { margin-left: auto; color: var(--mn-color-text-secondary); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .notice { color: var(--mn-color-text-secondary); font-size: 12px; }
    .stage { position: relative; flex: 1; min-height: 0; }
    .canvas { position: absolute; inset: 0; }
    .rings { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
    .ring { position: absolute; border: 2px solid var(--mn-color-border-accent, #326f4c); border-radius: 6px; box-shadow: 0 0 0 4px color-mix(in srgb, var(--mn-color-border-accent, #326f4c) 25%, transparent);
      transition: opacity 600ms ease; }
    .state { position: absolute; inset: 0; display: grid; place-items: center; color: var(--mn-color-text-secondary); padding: 24px; text-align: center; }
  `

  override render() {
    const page = this.page
    if (!page) return nothing
    return html`
      <header>
        ${this.editingTitle && !page.readOnly
          ? html`<input class="title" .value=${page.title} aria-label="Whiteboard title" @keydown=${this.onTitleKey} @blur=${this.onTitleBlur} />`
          : html`<button class="title" title=${page.readOnly ? page.title : 'Rename'} @click=${() => { if (!page.readOnly && page.onRename) { this.editingTitle = true } }}>${page.title || 'Untitled whiteboard'}</button>`}
        ${this.notice ? html`<span class="notice" role="status">${this.notice}</span>` : nothing}
        <span class="presence" role="status" aria-live="polite" data-testid="whiteboard-presence">${this.presenceLine}</span>
      </header>
      <div class="stage" data-surface="whiteboard" data-status=${page.status}>
        <div class="canvas"></div>
        <div class="rings"></div>
        ${page.status === 'error' ? html`<div class="state" role="alert">Could not open this whiteboard. ${page.error ?? ''}</div>` : nothing}
        ${page.status === 'loading' ? html`<div class="state">Opening the whiteboard...</div>` : nothing}
      </div>`
  }

  private onTitleKey = (event: KeyboardEvent) => {
    const input = event.target as HTMLInputElement
    if (event.key === 'Enter') { event.preventDefault(); this.commitTitle(input.value) }
    else if (event.key === 'Escape') { this.editingTitle = false }
  }
  private onTitleBlur = (event: FocusEvent) => this.commitTitle((event.target as HTMLInputElement).value)
  private commitTitle(value: string): void {
    const next = value.trim()
    this.editingTitle = false
    if (next && next !== this.page?.title) this.page?.onRename?.(next)
  }

  override updated(changed: PropertyValues): void {
    super.updated(changed)
    if (this.editingTitle) this.renderRoot.querySelector<HTMLInputElement>('input.title')?.focus()
    const page = this.page
    const key = page && page.status !== 'error' && page.provider ? `${page.graphId}/${page.documentId}/${page.readOnly ? 'ro' : 'rw'}` : ''
    if (changed.has('page') && key !== this.mountedKey) {
      void this.mount(key)
    } else if (changed.has('page') && this.api && page) {
      // Same board, new props (theme): tell Excalidraw.
      this.api.updateScene({ appState: { theme: page.theme ?? 'light' } })
    }
  }

  override disconnectedCallback(): void {
    this.unmount()
    super.disconnectedCallback()
  }

  private unmount(): void {
    this.generation += 1
    this.mountedKey = ''
    this.binding?.destroy()
    this.binding = null
    if (this.awareness && this.awarenessListener) this.awareness.off('change', this.awarenessListener)
    if (this.awareness) {
      try { publishPointer(this.awareness, null) } catch { /* the room may already be gone */ }
    }
    this.awareness = null
    this.awarenessListener = null
    this.canvasHost?.removeEventListener('pointerup', this.onPointerUpCapture, true)
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    try { this.root?.unmount() } catch { /* already torn down */ }
    this.root = null
    this.api = null
    if (this.ringTimer) clearTimeout(this.ringTimer)
    this.ringTimer = null
    this.rings = []
  }

  private async mount(key: string): Promise<void> {
    this.unmount()
    if (!key) return
    const page = this.page
    if (!page?.provider) return
    this.mountedKey = key
    const generation = this.generation
    const doc = page.provider.doc as Y.Doc
    const awareness = page.provider.awareness as AwarenessLike
    const runtime = await loadExcalidraw()
    if (generation !== this.generation) return
    const stage = this.renderRoot.querySelector<HTMLDivElement>('.canvas')
    this.ringLayer = this.renderRoot.querySelector<HTMLDivElement>('.rings')
    if (!stage) return
    stage.replaceChildren()
    const host = document.createElement('div')
    host.style.cssText = 'position:absolute;inset:0;'
    stage.appendChild(host)
    this.canvasHost = host
    const shadow = host.attachShadow({ mode: 'open' })
    const container = document.createElement('div')
    container.style.cssText = 'position:absolute;inset:0;'
    shadow.appendChild(container)
    const excalidrawCss = runtime.cssText.replace(/:root\b/g, '.excalidraw') + WHITEBOARD_THEME_CSS
    adoptStyleSheet(styleRootOf(shadow), 'excalidraw-whiteboard', excalidrawCss)
    // Excalidraw portals its dialogs (help, export image, clear canvas) to <body>, outside the shadow root; every rule
    // is scoped to `.excalidraw`, so the same sheet on the document dresses them in Sophia too.
    adoptStyleSheet(document, 'excalidraw-whiteboard-dialogs', excalidrawCss)
    host.addEventListener('pointerup', this.onPointerUpCapture, true)

    const refresh = (elements: readonly WbElement[]): readonly WbElement[] =>
      runtime.restoreElements(elements, null, { refreshDimensions: true }) as readonly WbElement[]
    const binding = new WhiteboardBinding(doc, {
      actor: 'person',
      refresh,
      isLeader: () => isLeader(awareness),
      onToolWrite: (write) => this.toolDrew(write),
      onImagesLeftOut: () => { this.notice = 'Images are not shared yet; they stay on this canvas only.' },
    })
    this.binding = binding
    this.awareness = awareness
    const initial = binding.initialElements()

    const port: WbScene = {
      getElements: () => (this.api?.getSceneElementsIncludingDeleted() ?? []) as readonly WbElement[],
      setElements: (elements) => this.api?.updateScene({ elements, captureUpdate: runtime.CaptureUpdateAction.NEVER }),
      busyIds: () => (this.api ? busyIdsOf(this.api.getAppState()) : new Set<string>()),
    }

    const onInitialize = (api: ExcalidrawApiLike) => {
      if (generation !== this.generation) return
      this.api = api
      // First draw on the next frame: a throw inside onInitialize would leave a live API over an empty tree.
      requestAnimationFrame(() => {
        if (generation !== this.generation) return
        binding.attach(port)
        this.updateCollaborators()
        this.updateRings()
      })
    }
    const props: Record<string, unknown> = {
      key,
      initialData: {
        elements: initial,
        // Transparent, so the pane's Sophia surface shows through. Excalidraw's dark theme inverts the canvas
        // (invert(93%) hue-rotate(180deg)); a dark background colour came out as a light grey wash over the board.
        appState: { viewBackgroundColor: 'transparent', theme: page.theme ?? 'light', ...WHITEBOARD_DEFAULTS },
        scrollToContent: true,
      },
      theme: page.theme ?? 'light',
      viewModeEnabled: page.readOnly === true,
      isCollaborating: true,
      aiEnabled: false,
      libraryReturnUrl: window.location.origin,
      UIOptions: { canvasActions: { loadScene: false, saveToActiveFile: false, toggleTheme: false, changeViewBackgroundColor: false } },
      onInitialize,
      onChange: (_elements: unknown, appState: Record<string, any>) => {
        binding.localChanged()
        if (appState) this.updateRings(appState)
      },
      onPointerUpdate: (payload: { pointer: { x: number; y: number }; button: string; pointersMap: Map<number, unknown> }) => {
        const now = Date.now()
        if (now - this.lastPointerAt < POINTER_THROTTLE_MS) return
        this.lastPointerAt = now
        publishPointer(awareness, { x: payload.pointer.x, y: payload.pointer.y, tool: 'pointer' })
      },
      onLinkOpen: (element: { link?: string | null }, event: CustomEvent) => {
        const link = element.link
        if (link && this.page?.onOpenLink?.(link)) event.preventDefault()
      },
    }
    const reactRoot = runtime.createRoot(container)
    this.root = reactRoot
    reactRoot.render(runtime.createElement(runtime.Excalidraw, props, this.mainMenu(runtime)))

    this.awarenessListener = () => this.updateCollaborators()
    awareness.on('change', this.awarenessListener)
    this.resizeObserver = new ResizeObserver(() => this.updateRings())
    this.resizeObserver.observe(stage)
  }

  /** A short main menu: no socials, no Excalidraw+, no hosted-library browser. Search, export an image, preferences, help, clear. */
  private mainMenu(runtime: ExcalidrawModule): unknown {
    const M = runtime.MainMenu
    if (!M?.DefaultItems) return null
    const D = M.DefaultItems
    const h = runtime.createElement
    return h(M, null,
      h(D.SearchMenu, null),
      h(D.SaveAsImage, null),
      h(M.Separator, null),
      h(D.Preferences, null),
      h(D.Help, null),
      h(M.Separator, null),
      h(D.ClearCanvas, null),
    )
  }

  private updateCollaborators(): void {
    if (!this.api || !this.awareness) return
    const collaborators = collaboratorsOf(this.awareness)
    this.api.updateScene({ collaborators })
    const names = [...collaborators.values()].map((c) => c.username)
    const here = names.length ? `With ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}` : ''
    if (!this.presenceLine.includes(' drew ')) this.presenceLine = here
  }

  private toolDrew(write: WbToolWrite): void {
    const shapes = this.countShapes(write.ids)
    this.presenceLine = toolDrewLine(write, shapes)
    this.rings.push({ ids: write.ids, until: Date.now() + RING_MS })
    this.updateRings()
    if (this.ringTimer) clearTimeout(this.ringTimer)
    this.ringTimer = setTimeout(() => {
      this.rings = this.rings.filter((r) => r.until > Date.now())
      this.updateRings()
      if (this.rings.length === 0) { this.presenceLine = ''; this.updateCollaborators() }
    }, RING_MS + 200)
  }

  /** Written elements are shapes; their bound text is not counted twice. */
  private countShapes(ids: readonly string[]): number {
    const byId = new Map((this.api?.getSceneElementsIncludingDeleted() ?? []).map((e) => [(e as WbElement).id, e as WbElement] as const))
    let n = 0
    for (const id of ids) {
      const e = byId.get(id)
      if (!e || e.isDeleted) continue
      if (e.type === 'text' && typeof e.containerId === 'string') continue
      n += 1
    }
    return Math.max(n, ids.length ? 1 : 0)
  }

  /** The "changed" ring: a box around each shape a tool just drew, in screen space, fading after a moment. */
  private updateRings(appState?: Record<string, any>): void {
    const layer = this.ringLayer
    if (!layer || !this.api) return
    const state = appState ?? this.api.getAppState()
    const now = Date.now()
    const live = this.rings.filter((r) => r.until > now)
    layer.replaceChildren()
    if (live.length === 0) return
    const zoom = (state.zoom?.value as number | undefined) ?? 1
    const scrollX = (state.scrollX as number | undefined) ?? 0
    const scrollY = (state.scrollY as number | undefined) ?? 0
    const byId = new Map(this.api.getSceneElementsIncludingDeleted().map((e) => [(e as WbElement).id, e as WbElement] as const))
    for (const ring of live) {
      for (const id of ring.ids) {
        const e = byId.get(id) as (WbElement & { x?: number; y?: number; width?: number; height?: number }) | undefined
        if (!e || e.isDeleted || (e.type === 'text' && typeof e.containerId === 'string')) continue
        const box = document.createElement('div')
        box.className = 'ring'
        const x = ((e.x ?? 0) + scrollX) * zoom
        const y = ((e.y ?? 0) + scrollY) * zoom
        box.style.cssText = `left:${x - 6}px;top:${y - 6}px;width:${Math.abs((e.width ?? 0) * zoom) + 12}px;height:${Math.abs((e.height ?? 0) * zoom) + 12}px;`
        layer.appendChild(box)
      }
    }
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('sh-whiteboard')) {
  customElements.define('sh-whiteboard', ShWhiteboard)
}
