/**
 * `<mn-files-canvas>`: the card plane of the Files folder view (design §2.3), the DOM binding of the wave-1
 * interaction reducer (`@shrubbery/nucleus/files-canvas`).
 *
 * The host is thin by construction. It normalises DOM events into `CanvasEvent`s, calls `reduce` with a context
 * built from the current input, keeps the two kinds of state the shell does not give it (the reducer's gesture state
 * and the camera), runs the step's effects, reports camera and focus to the shell (`onSessionChange`) and hands the
 * intents to the shell (`onIntent`). It holds no store, no port and no callback that mutates: every edit is an
 * intent the shell may refuse.
 *
 * Cards are ordinary DOM inside one CSS-transformed scene layer (`viewport = (scene + camera) * zoom`), styled
 * only by `--mn-*` tokens, with listbox semantics and a roving tab stop. Gesture feedback that must stay crisp
 * (the marquee, snap guides, the drop hint) lives in a viewport-space overlay above it.
 *
 * Connectors (design section 2.3) are one SVG plane under the cards, routed through the engine port (`engine.route`,
 * and `engine.reroute` frame by frame during a drag) with their labels de-collided by the engine; the host draws what
 * the port answers and invents no route. The `connect` verb exists only when the input's capabilities grant it: a handle
 * on the card (drag it to another card, or "Connect..." from the menu for the keyboard), then the relation picker at the
 * drop point. `openBeside` is still forced off in this release.
 */
import { LitElement, css, html, nothing, svg, unsafeCSS, type PropertyValues, type TemplateResult } from 'lit'
import { repeat } from 'lit/directives/repeat.js'
import { FILES_EMPTY_STYLE, renderFilesEmpty } from './files-empty.js'
import {
  fileKey, folderViewKey, resolveCapabilities, evidenceBadge, evidenceTone, evidenceWords, hasFace, quietMark, CORROBORATION_WORDS,
  type FileEvidence, type FileCanvasCapabilities, type FileCanvasInput, type WorkspaceFileRef, type FileCanvasIntent, type FileCanvasSessionPatch, type FileKey,
} from '@shrubbery/nucleus'
import {
  CARD_METRICS, createSceneBuilder, displayLabel, focusKey, houseEngine, initialState, reduce, runEngineEffects,
  toShellPatch, toViewport,
  moveCards,
  type Camera, type CanvasContext, type CanvasEngine, type CanvasEvent, type CanvasState, type ConnectorPath, type Modifiers,
  type PointerTarget, type Pt, type SceneBuilder, type SceneCard, type SceneSnapshot,
} from '@shrubbery/nucleus/files-canvas'

export type FilesCanvasCommand = 'tidy' | 'reset-view' | 'zoom-in' | 'zoom-out' | 'new-folder' | 'connect'

/** What the shell gives the host: the canvas input (contract v2) plus the two callbacks. */
export interface FilesCanvasHostInput extends FileCanvasInput {
  readonly onIntent: (intent: FileCanvasIntent) => void
  /** Camera and focus are host-owned session state, reported here (never as intents). */
  readonly onSessionChange?: (patch: FileCanvasSessionPatch) => void
  /** The engine behind the port; the house engine when absent. */
  readonly engine?: CanvasEngine
  /** The tree bridge: resolve a folder row of the surrounding tree (its node id) to a folder the canvas may move files into. */
  readonly externalFolder?: (nodeId: string) => { readonly folder: WorkspaceFileRef | null; readonly label: string } | null
}

/** The verbs this release offers: what the input allows, without open-beside (it does not ship yet). */
export function filesCanvasCapabilities(input: Pick<FileCanvasInput, 'capabilities' | 'canEdit'>): FileCanvasCapabilities {
  return { ...resolveCapabilities(input), openBeside: false }
}

const LONG_PRESS_MS = 500
const ROUTE_PAD = 4

/**
 * What the engine routes around: the whole card, not only its glyph. The port's contract keeps wires off glyph boxes; a wire
 * through a card's name or a label on top of one is as unreadable, so the host hands the port a snapshot whose obstacles are
 * the cards themselves (the engine is still the one that routes).
 */
const routingScenes = new WeakMap<SceneSnapshot, SceneSnapshot>()
function routingScene(scene: SceneSnapshot): SceneSnapshot {
  let out = routingScenes.get(scene)
  if (!out) {
    const cards = scene.cards.map(card => ({ ...card, glyph: card.rect }))
    out = { ...scene, cards, byKey: new Map(cards.map(card => [card.key, card])) }
    routingScenes.set(scene, out)
  }
  return out
}
const STATE_WORDS: Readonly<Record<string, string>> = { pending: 'saving', contested: 'contested', rejected: 'refused' }

function mods(e: { shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean }): Modifiers {
  return { shift: e.shiftKey, alt: e.altKey, meta: e.metaKey, ctrl: e.ctrlKey }
}

/** Every element under a viewport point, piercing open shadow roots (the tree lives in another component's shadow). */
function deepElementsFromPoint(x: number, y: number): Element[] {
  const found: Element[] = []
  const seen = new Set<Document | ShadowRoot>()
  const walk = (root: Document | ShadowRoot): void => {
    if (seen.has(root)) return
    seen.add(root)
    for (const el of root.elementsFromPoint(x, y)) {
      if (!found.includes(el)) found.push(el)
      if (el.shadowRoot) walk(el.shadowRoot)
    }
  }
  walk(document)
  return found
}

function glyphSize(iconSize: 'small' | 'medium' | 'large'): 32 | 64 | 96 {
  return iconSize === 'small' ? 32 : iconSize === 'large' ? 96 : 64
}

export class MnFilesCanvas extends LitElement {
  static override properties = { input: { attribute: false } }

  declare input: FilesCanvasHostInput | null

  private state: CanvasState = initialState('')
  private builder: SceneBuilder = createSceneBuilder()
  private generation = 0
  private camera: Camera = { x: 0, y: 0, zoom: 1 }
  /** The card the keyboard focus is on (any card key: a ghost's or a draft's included). */
  private focusedKey: FileKey | null = null
  private scopeKey = ''
  private pendingFocus: FileKey | 'input' | 'picker' | null = null
  private longPressTimer: ReturnType<typeof setTimeout> | null = null
  private sceneCache: SceneSnapshot | null = null
  private keepFocus: string | null = null
  private externalRow: HTMLElement | null = null
  private externalLabel = ''
  /** The relation picker the reducer asked for (`openRelationPicker`), at a point of the host. */
  private picker: { at: Pt; source: FileKey; target: FileKey } | null = null
  private selectedConnector: string | null = null
  /** The picker's "Other..." row is open: a free label instead of a vocabulary entry. */
  private pickerOther = false
  /** The layer toggle: a view choice of this host, not an edit. */
  private connectionsHidden = false
  private routeCache: { scene: SceneSnapshot; engine: CanvasEngine; routes: ReadonlyMap<string, ConnectorPath> } | null = null

  constructor() {
    super()
    this.input = null
  }

  static override styles = css`
    :host {
      display: block;
      position: relative;
      overflow: hidden;
      min-height: 160px;
      background: var(--mn-files-canvas-surface, var(--mn-color-surface-canvas));
      font-family: var(--mn-font-chrome);
      color: var(--mn-files-label-ink, var(--mn-color-text-primary));
      touch-action: none;
      outline: none;
    }
    .plane { position: absolute; inset: 0; }
    .scene { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
    .scene[data-gesture] { will-change: transform; }
    [role='listbox'] { position: absolute; left: 0; top: 0; outline: none; }
    .card {
      position: absolute;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--mn-space-1, 4px);
      padding: var(--mn-space-2, 8px) var(--mn-space-1, 4px) var(--mn-space-1, 4px);
      background: var(--mn-files-card-surface, var(--mn-color-surface-raised));
      border: 1px solid var(--mn-color-border-subtle);
      border-radius: var(--mn-radius-control, 6px);
      box-shadow: var(--mn-shadow-card, none);
      cursor: default;
      user-select: none;
      outline: none;
    }
    .card:hover { background-color: var(--mn-color-interactive-hover); }
    .card:focus-visible { box-shadow: var(--mn-focus-ring); }
    .card[aria-selected='true'] {
      background-color: var(--mn-color-interactive-selected);
      border-color: var(--mn-color-border-accent);
    }
    .card[aria-selected='true'] .label {
      background: var(--mn-files-label-selected-wash, var(--mn-color-interactive-selected));
      color: var(--mn-files-label-selected-ink, var(--mn-color-text-primary));
    }
    .card[data-dragging] { opacity: 0.92; box-shadow: var(--mn-shadow-raised, var(--mn-shadow-card, none)); z-index: 2; }
    .card[data-drop-target] { box-shadow: inset 0 0 0 2px var(--mn-color-border-accent); }
    .card[data-cut] { opacity: 0.55; border-style: dashed; border-color: var(--mn-color-border-default); }
    .card[data-stance='contested'] { opacity: 0.55; border-style: dashed; }
    .card[data-state='rejected'] { border-color: var(--mn-color-text-danger); }
    .card[data-role='draft'] { border-style: dashed; }
    .label {
      max-width: 100%;
      padding: 0 var(--mn-space-1, 4px);
      border-radius: var(--mn-radius-sm, 3px);
      font-size: var(--mn-text-sm, 12px);
      line-height: var(--mn-leading-ui, 1.3);
      text-align: center;
      overflow-wrap: anywhere;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      color: var(--mn-files-label-ink, var(--mn-color-text-primary));
    }
    input.name {
      box-sizing: border-box;
      width: 100%;
      font: inherit;
      font-size: var(--mn-text-sm, 12px);
      color: var(--mn-color-text-primary);
      background: var(--mn-color-surface-sunken);
      border: 1px solid var(--mn-color-border-accent);
      border-radius: var(--mn-radius-sm, 3px);
      padding: 1px var(--mn-space-1, 4px);
      box-shadow: var(--mn-focus-ring);
      outline: none;
      text-align: center;
    }
    .name-error { color: var(--mn-color-text-danger); font-size: var(--mn-text-xs, 11px); }
    .annunciator {
      font-size: var(--mn-text-xs, 11px);
      color: var(--mn-color-text-secondary);
      border: 1px solid var(--mn-color-border-subtle);
      border-radius: var(--mn-radius-sm, 3px);
      padding: 0 var(--mn-space-1, 4px);
    }
    .annunciator[data-tone='attention'] { font-weight: 600; border-color: currentColor; }
    .annunciator[data-tone='danger'] { font-weight: 600; border-style: dashed; border-color: currentColor; }
    /*
     * A datasheet card: the part, large, the maker beneath, three key values; a mark only on a disputed or person-checked value. Every ink is the
     * label ink (dimmed by opacity for the secondary lines) and the marks differ by shape, never by hue, so the card reads on the
     * card surface of every skin and on the bare desktop of the ones that draw no card (98).
     */
    .card[data-evidence] { overflow: hidden; gap: 2px; }
    .card[data-evidence] .annunciator { color: var(--mn-files-label-ink, var(--mn-color-text-primary)); border-color: currentColor; opacity: 0.85;
      max-width: 100%; box-sizing: border-box; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .card[data-evidence] .sheet { width: 100%; min-width: 0; display: flex; flex-direction: column; gap: 1px; color: var(--mn-files-label-ink, var(--mn-color-text-primary)); }
    .sheet .part {
      font-size: var(--mn-text-md, 14px); font-weight: 600; line-height: 1.2; text-align: center;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .sheet .maker {
      display: flex; justify-content: center; gap: 0.35em; min-width: 0; font-size: var(--mn-text-2xs, 10px); line-height: 1.2; opacity: 0.78;
      white-space: nowrap; margin-bottom: 2px;
    }
    .sheet .maker .by { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .sheet .maker .rev { flex: 0 0 auto; }
    .sheet .values { display: grid; gap: 0; padding: 0 var(--mn-space-1, 4px); }
    .sheet .value {
      display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: var(--mn-space-1, 4px); align-items: baseline;
      font-size: var(--mn-text-xs, 11px); line-height: 1.1; white-space: nowrap;
    }
    .sheet .value .k { opacity: 0.78; }
    .sheet .value .v { overflow: hidden; text-overflow: ellipsis; text-align: right; font-variant-numeric: tabular-nums; }
    .sheet .value .mark { letter-spacing: -0.5px; }
    .sheet .value[data-mark='contested'] .mark, .sheet .value[data-mark='checked'] .mark { font-weight: 700; }
    .card[data-evidence][data-size='large'] { gap: 4px; padding-top: var(--mn-space-3, 12px); }
    .card[data-evidence][data-size='large'] .part { font-size: var(--mn-text-lg, 18px); }
    .card[data-evidence][data-size='large'] .maker { font-size: var(--mn-text-xs, 11px); margin-bottom: 6px; }
    .card[data-evidence][data-size='large'] .value { font-size: var(--mn-text-sm, 12px); line-height: 1.35; }
    .card[data-evidence] .label { -webkit-line-clamp: 1; font-size: var(--mn-text-xs, 11px); opacity: 0.78; }
    .card[data-role='ghost'] { cursor: pointer; }
    .card[data-role='ghost']:hover { opacity: 0.85; }
    .handle {
      position: absolute;
      right: -7px;
      top: 50%;
      width: 12px;
      height: 12px;
      margin-top: -6px;
      box-sizing: border-box;
      border-radius: 50%;
      background: var(--mn-color-surface-raised);
      border: 2px solid var(--mn-color-border-accent);
      cursor: crosshair;
      opacity: 0;
    }
    .card:hover .handle, .card:focus-visible .handle, .card[aria-selected='true'] .handle, .handle[data-active] { opacity: 1; }
    .handle:hover { background: var(--mn-color-border-accent); }
    .connectors { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: visible; pointer-events: none; }
    .connector .line {
      fill: none;
      stroke: var(--mn-color-text-secondary);
      stroke-width: 1.5;
      stroke-linejoin: round;
      vector-effect: non-scaling-stroke;
      pointer-events: none;
    }
    .connector .arrow { fill: var(--mn-color-text-secondary); stroke: none; pointer-events: none; }
    .connector .hit { fill: none; stroke: transparent; stroke-width: 12; vector-effect: non-scaling-stroke; pointer-events: stroke; cursor: pointer; }
    .connector[data-state='proposed'] .line { stroke-dasharray: 6 4; }
    .connector[data-state='disputed'] .line { stroke: var(--mn-color-text-danger); stroke-dasharray: 2 4; }
    .connector[data-state='disputed'] .arrow { fill: var(--mn-color-text-danger); }
    .connector:hover .line, .connector[data-selected] .line { stroke: var(--mn-color-border-accent); stroke-width: 2.5; }
    .connector:hover .arrow, .connector[data-selected] .arrow { fill: var(--mn-color-border-accent); }
    .conn-labels { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: visible; pointer-events: none; }
    .conn-label {
      position: absolute;
      transform: translate(-50%, -50%);
      white-space: nowrap;
      display: inline-flex;
      align-items: center;
      gap: var(--mn-space-1, 4px);
      padding: 0 var(--mn-space-1, 4px);
      font-size: var(--mn-text-xs, 11px);
      line-height: var(--mn-leading-ui, 1.3);
      color: var(--mn-color-text-secondary);
      background: var(--mn-color-surface-raised);
      border: 1px solid var(--mn-color-border-subtle);
      border-radius: var(--mn-radius-sm, 3px);
      pointer-events: auto;
      cursor: pointer;
      user-select: none;
    }
    .conn-label[data-selected] { border-color: var(--mn-color-border-accent); color: var(--mn-color-text-primary); }
    .conn-label button {
      font: inherit; line-height: 1; padding: 0 2px; color: inherit; background: none; border: 0; cursor: pointer;
    }
    .rubber { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
    .rubber line { stroke: var(--mn-color-border-accent); stroke-width: 2; stroke-dasharray: 4 3; }
    .picker {
      position: absolute;
      min-width: 160px;
      display: flex;
      flex-direction: column;
      padding: var(--mn-space-1, 4px);
      background: var(--mn-color-surface-raised);
      border: 1px solid var(--mn-color-border-default);
      border-radius: var(--mn-radius-control, 6px);
      box-shadow: var(--mn-shadow-raised, var(--mn-shadow-card, none));
      z-index: 5;
    }
    .picker-title { font-size: var(--mn-text-xs, 11px); color: var(--mn-color-text-secondary); padding: 2px var(--mn-space-2, 8px); }
    .picker button {
      font: inherit;
      font-size: var(--mn-text-sm, 12px);
      text-align: left;
      color: var(--mn-color-text-primary);
      background: none;
      border: 0;
      border-radius: var(--mn-radius-sm, 3px);
      padding: var(--mn-space-1, 4px) var(--mn-space-2, 8px);
      cursor: pointer;
    }
    .picker input.other {
      font: inherit; font-size: var(--mn-text-sm, 12px); color: var(--mn-color-text-primary); background: var(--mn-color-surface-sunken);
      border: 1px solid var(--mn-color-border-accent); border-radius: var(--mn-radius-sm, 3px); padding: 2px var(--mn-space-2, 8px); margin: 2px;
    }
    .picker button:hover { background: var(--mn-color-interactive-hover); }
    .picker button:focus-visible { box-shadow: var(--mn-focus-ring); outline: none; }
    .overlay { position: absolute; inset: 0; pointer-events: none; }
    .marquee {
      position: absolute;
      border: 1px solid var(--mn-color-border-accent);
      background: var(--mn-color-interactive-selected);
    }
    .guides { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
    .guides line { stroke: var(--mn-color-border-accent); stroke-width: 1; }
    .hint {
      position: absolute;
      left: 50%;
      bottom: var(--mn-space-3, 12px);
      transform: translateX(-50%);
      background: var(--mn-color-surface-raised);
      border: 1px solid var(--mn-color-border-subtle);
      border-radius: var(--mn-radius-control, 6px);
      padding: var(--mn-space-1, 4px) var(--mn-space-2, 8px);
      font-size: var(--mn-text-sm, 12px);
    }
    .controls {
      position: absolute;
      right: var(--mn-space-2, 8px);
      bottom: var(--mn-space-2, 8px);
      display: flex;
      gap: 2px;
    }
    .controls button {
      min-width: var(--mn-control-height, 28px);
      height: var(--mn-control-height, 28px);
      font: inherit;
      font-size: var(--mn-text-sm, 12px);
      color: var(--mn-color-text-primary);
      background: var(--mn-color-surface-raised);
      border: 1px solid var(--mn-color-border-default);
      border-radius: var(--mn-radius-control, 6px);
      cursor: pointer;
    }
    .controls button[aria-pressed='true'] { background: var(--mn-color-interactive-selected); border-color: var(--mn-color-border-accent); }
    .controls button.word { padding: 0 var(--mn-space-2, 8px); }
    .controls button:focus-visible { box-shadow: var(--mn-focus-ring); outline: none; }
    .empty {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      pointer-events: none;
    }
    ${unsafeCSS(FILES_EMPTY_STYLE)}
  `

  // --- public API -----------------------------------------------------------------------------------------------

  /** The host's own chrome (the pane's New folder, the zoom controls) speaks through here. */
  command(command: FilesCanvasCommand): void {
    if (command === 'connect') {
      // The item menu's "Connect...": the keyboard twin of dragging from the handle, from the card the menu was opened on.
      const scene = this.scene()
      const key = this.input?.session.selected.map(fileKey).find(k => scene?.byKey.get(k)?.role === 'real') ?? this.focusedKey
      if (key) this.dispatch({ type: 'handle-activate', key })
      return
    }
    this.dispatch({ type: 'command', command })
  }

  /** The shell closed the menu the last `menu` intent asked for. */
  notifyMenuClosed(): void {
    this.dispatch({ type: 'menu-closed' })
  }

  // --- lifecycle --------------------------------------------------------------------------------------------------

  override connectedCallback(): void {
    super.connectedCallback()
    this.addEventListener('focusout', this.onFocusOut)
  }

  override disconnectedCallback(): void {
    this.removeEventListener('focusout', this.onFocusOut)
    this.clearLongPress()
    if (this.input) this.dispatch({ type: 'destroy' })
    super.disconnectedCallback()
  }

  override willUpdate(changed: PropertyValues<this>): void {
    // Lit moves a card's element when the reading order changes (after a drop); a moved element loses focus. Remember it.
    const active = this.renderRoot instanceof ShadowRoot ? this.renderRoot.activeElement : null
    this.keepFocus = active instanceof HTMLElement && active.classList.contains('card') ? active.dataset.cardKey ?? null : null
    if (!changed.has('input')) return
    const input = this.input
    if (!input) { this.sceneCache = null; return }
    const scopeKey = folderViewKey(input.scope)
    if (scopeKey !== this.scopeKey) {
      // A new folder: its own camera from the shell, no focus, fresh auto-slots, and a new epoch that ends any gesture.
      this.scopeKey = scopeKey
      this.generation += 1
      this.camera = input.session.camera
      this.focusedKey = null
      this.builder = createSceneBuilder({ slotColumns: this.slotColumns(input) })
    }
    this.sceneCache = this.builder.build(input)
    // The input changed and nothing else happened: let the reducer reconcile (a naming the shell asked for, a card
    // that went away under a gesture, a lock that arrived during a drag).
    this.dispatch({ type: 'sync' }, false)
  }

  override updated(): void {
    const target = this.pendingFocus
    if (!target) {
      const keep = this.keepFocus
      this.keepFocus = null
      if (keep && this.renderRoot instanceof ShadowRoot && !this.renderRoot.activeElement) this.cardElement(keep as FileKey)?.focus({ preventScroll: true })
      return
    }
    this.pendingFocus = null
    if (target === 'picker') {
      this.renderRoot.querySelector<HTMLElement>('.picker button')?.focus({ preventScroll: true })
      return
    }
    if (target === 'input') {
      const input = this.renderRoot.querySelector<HTMLInputElement>('input.name')
      if (input && this.renderRoot instanceof ShadowRoot && this.renderRoot.activeElement !== input) {
        input.focus({ preventScroll: true })
        const dot = input.value.lastIndexOf('.')
        input.setSelectionRange(0, dot > 0 ? dot : input.value.length)
      }
      return
    }
    this.cardElement(target)?.focus({ preventScroll: true })
  }

  // --- the reducer loop --------------------------------------------------------------------------------------------

  private slotColumns(input: FileCanvasInput): number {
    const width = this.getBoundingClientRect().width
    const metrics = CARD_METRICS[input.view?.iconSize ?? 'medium']
    return width > 0 ? Math.max(1, Math.floor((width - 16) / (metrics.w + 16))) : 4
  }

  private scene(): SceneSnapshot | null {
    if (!this.input) return null
    if (!this.sceneCache) this.sceneCache = this.builder.build(this.input)
    return this.sceneCache
  }

  private context(scene: SceneSnapshot): CanvasContext {
    const input = this.input!
    const box = this.getBoundingClientRect()
    const session = input.session
    // The focus the shell echoes, read so that an echo of the file a focused ghost stands for keeps the ghost. A shell
    // that carries no focus at all leaves the host's own.
    const focused = session.focused === undefined ? this.focusedKey : focusKey(session, this.focusedKey, scene)
    return {
      epoch: `${this.scopeKey}|${this.generation}`,
      scope: input.scope,
      scene,
      camera: this.camera,
      viewport: { x: box.left, y: box.top, w: box.width, h: box.height },
      selection: session.selected.map(fileKey),
      focused: focused && scene.byKey.has(focused) ? focused : null,
      capabilities: filesCanvasCapabilities(input),
      engine: input.engine ?? houseEngine,
      naming: session.naming ?? null,
      cut: session.cut ?? [],
    }
  }

  /** One event through the reducer. Returns whether the canvas handled it (the caller then prevents the default). */
  private dispatch(event: CanvasEvent, render = true): boolean {
    const input = this.input
    const scene = this.scene()
    if (!input || !scene) return false
    const ctx = this.context(scene)
    const step = reduce(this.state, event, ctx)
    this.state = step.state
    if (step.session.camera) this.camera = step.session.camera
    if (step.session.focused !== undefined) this.focusedKey = step.session.focused
    else if (ctx.focused !== this.focusedKey) this.focusedKey = ctx.focused
    runEngineEffects(step.effects, ctx.engine, scene)
    for (const effect of step.effects) {
      switch (effect.kind) {
        case 'capturePointer': this.plane()?.setPointerCapture?.(effect.pointerId); break
        case 'releasePointer':
          try { this.plane()?.releasePointerCapture?.(effect.pointerId) } catch { /* already released */ }
          break
        case 'focusCard': this.pendingFocus = effect.key; break
        case 'focusInput': this.pendingFocus = 'input'; break
        case 'focusHeader':
          this.dispatchEvent(new CustomEvent('mn-files-canvas-escape', { bubbles: true, composed: true }))
          break
        case 'openRelationPicker':
          this.picker = { at: effect.at, source: effect.source, target: effect.target }
          this.pickerOther = false
          this.pendingFocus = 'picker'
          break
        default: break                      // openMenu: the shell opens it on the `menu` intent; endDrag: the next render
      }
    }
    const patch = toShellPatch(step.session, scene)
    if (patch.camera || patch.focused !== undefined || patch.cut) input.onSessionChange?.(patch)
    if (this.picker && this.state.mode.kind !== 'picking') this.picker = null
    for (const intent of step.intents) input.onIntent(intent)
    if (render) this.requestUpdate()
    return step.handled
  }

  // --- DOM events --------------------------------------------------------------------------------------------------

  private plane(): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>('.plane')
  }

  private cardElement(key: FileKey): HTMLElement | null {
    for (const el of this.renderRoot.querySelectorAll<HTMLElement>('.card')) {
      if (el.dataset.cardKey === key) return el
    }
    return null
  }

  private point(e: { clientX: number; clientY: number }): Pt {
    const box = this.getBoundingClientRect()
    return { x: e.clientX - box.left, y: e.clientY - box.top }
  }

  private targetOf(e: Event): PointerTarget {
    for (const node of e.composedPath()) {
      if (!(node instanceof HTMLElement)) continue
      if (node.classList.contains('plane')) break
      if (node.dataset.handle !== undefined) return { kind: 'handle', key: node.dataset.handle }
      if (node.dataset.connectorId !== undefined) return { kind: 'connector', id: node.dataset.connectorId }
      const key = node.dataset.cardKey
      if (key !== undefined) {
        const label = e.composedPath().some(n => n instanceof HTMLElement && n.classList.contains('label'))
        return { kind: label ? 'label' : 'card', key }
      }
    }
    return { kind: 'background' }
  }

  private fromChrome(e: Event): boolean {
    return e.composedPath().some(n => n instanceof HTMLElement && (n.classList.contains('controls') || n.classList.contains('picker') || n.matches?.('input.name')))
  }

  private clearLongPress(): void {
    if (this.longPressTimer !== null) clearTimeout(this.longPressTimer)
    this.longPressTimer = null
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (this.fromChrome(e)) return
    if (this.picker) this.dispatch({ type: 'relation-cancelled' })
    const hit = this.targetOf(e)
    const connector = hit.kind === 'connector' ? hit.id : null
    if (connector !== this.selectedConnector) { this.selectedConnector = connector; this.requestUpdate() }
    const pointerType = e.pointerType === 'touch' || e.pointerType === 'pen' ? e.pointerType : 'mouse'
    const handled = this.dispatch({ type: 'pointerdown', pointerId: e.pointerId, at: this.point(e), button: e.button, mods: mods(e),
      target: this.targetOf(e), t: e.timeStamp || Date.now(), pointerType })
    if (handled && e.button !== 2) {
      // Keep the browser from starting a text selection or a native drag; focus stays with the card the reducer focuses.
      e.preventDefault()
      const list = this.renderRoot.querySelector<HTMLElement>('[role="listbox"]')
      const active = this.renderRoot instanceof ShadowRoot ? this.renderRoot.activeElement : null
      // A control the person clicked earlier (Tidy, Links, zoom) must not keep the keys: they belong to the canvas again.
      if (list && (!active || active.closest('.controls'))) list.focus({ preventScroll: true })
    }
    this.clearLongPress()
    if (pointerType === 'touch') {
      const id = e.pointerId
      this.longPressTimer = setTimeout(() => { this.longPressTimer = null; this.dispatch({ type: 'longpress', pointerId: id }) }, LONG_PRESS_MS)
    }
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.state.mode.kind === 'idle') return
    if (this.longPressTimer !== null) this.clearLongPress()
    const external = this.externalAt(e)
    if (this.dispatch({ type: 'pointermove', pointerId: e.pointerId, at: this.point(e), mods: mods(e), t: e.timeStamp || Date.now(), ...(external ? { external } : {}) })) e.preventDefault()
  }

  private readonly onPointerUp = (e: PointerEvent): void => {
    this.clearLongPress()
    if (this.fromChrome(e) && this.state.mode.kind === 'idle') return
    const external = this.externalAt(e)
    this.markExternal(null)
    if (this.dispatch({ type: 'pointerup', pointerId: e.pointerId, at: this.point(e), mods: mods(e), t: e.timeStamp || Date.now(), ...(external ? { external } : {}) })) e.preventDefault()
  }

  /** The folder row of the surrounding tree under the pointer during a drag, if the shell can resolve it (the tree bridge). */
  private externalAt(e: PointerEvent): { folder: WorkspaceFileRef | null } | null {
    const resolve = this.input?.externalFolder
    if (!resolve || this.state.mode.kind !== 'dragging') { this.markExternal(null); return null }
    const p = this.point(e)
    const box = this.getBoundingClientRect()
    if (e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom) { this.markExternal(null); return null }
    for (const el of deepElementsFromPoint(e.clientX, e.clientY)) {
      if (!(el instanceof HTMLElement)) continue
      // The tree's top ("Files") is the section header of the Files section: dropping there moves to the top folder.
      const top = el.classList.contains('section-header') && el.closest<HTMLElement>('[data-section-id]')?.dataset.sectionId === 'tree'
      const nodeId = top ? '@root' : el.dataset.kind === 'folder' ? el.dataset.nodeId : undefined
      if (!nodeId) continue
      const hit = resolve(nodeId)
      if (hit) { this.externalLabel = hit.label; this.markExternal(el); return { folder: hit.folder } }
    }
    void p
    this.markExternal(null)
    return null
  }

  private markExternal(row: HTMLElement | null): void {
    if (row === this.externalRow) return
    if (this.externalRow) this.externalRow.style.outline = ''
    this.externalRow = row
    if (row) row.style.outline = '2px solid var(--mn-color-border-accent, currentColor)'
  }

  private readonly onPointerCancel = (e: PointerEvent): void => {
    this.markExternal(null)
    this.clearLongPress()
    this.dispatch({ type: 'pointercancel', pointerId: e.pointerId })
  }

  private readonly onWheel = (e: WheelEvent): void => {
    if (this.dispatch({ type: 'wheel', at: this.point(e), deltaX: e.deltaX, deltaY: e.deltaY, mods: mods(e) })) e.preventDefault()
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (this.fromChrome(e)) return
    if (this.selectedConnector && (e.key === 'Delete' || e.key === 'Backspace') && this.input && filesCanvasCapabilities(this.input).connect) {
      this.disconnect(this.selectedConnector); e.preventDefault(); e.stopPropagation(); return
    }
    if (this.selectedConnector && e.key === 'Escape') { this.selectedConnector = null; this.requestUpdate() }
    if (this.dispatch({ type: 'keydown', key: e.key, mods: mods(e), repeat: e.repeat })) { e.preventDefault(); e.stopPropagation() }
  }

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (this.fromChrome(e)) return
    if (this.dispatch({ type: 'keyup', key: e.key, mods: mods(e) })) e.preventDefault()
  }

  private readonly onContextMenu = (e: MouseEvent): void => {
    if (this.fromChrome(e)) return
    if (this.dispatch({ type: 'contextmenu', at: this.point(e), target: this.targetOf(e), mods: mods(e) })) e.preventDefault()
  }

  private carriesFiles(e: DragEvent): boolean {
    const types = e.dataTransfer?.types
    return !!types && Array.from(types).includes('Files')
  }

  private readonly onDragOver = (e: DragEvent): void => {
    if (!this.carriesFiles(e)) return
    if (this.dispatch({ type: 'dragover', at: this.point(e) })) {
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
  }

  private readonly onDragLeave = (e: DragEvent): void => {
    const next = e.relatedTarget
    if (next instanceof Node && this.renderRoot.contains(next)) return
    this.dispatch({ type: 'dragleave' })
  }

  private readonly onDrop = (e: DragEvent): void => {
    const files = e.dataTransfer?.files
    if (!files) return
    if (this.dispatch({ type: 'drop', at: this.point(e), files })) { e.preventDefault(); e.stopPropagation() }
  }

  private readonly onFocusOut = (e: FocusEvent): void => {
    const next = e.relatedTarget
    if (next instanceof Node && (this.contains(next) || this.renderRoot.contains(next))) return
    if (this.state.naming) return                     // the input's own blur commits it
    this.dispatch({ type: 'blur' })
  }

  // --- connectors and the picker ------------------------------------------------------------------------------------

  private disconnect(connectionId: string): void {
    this.selectedConnector = null
    this.input?.onIntent({ kind: 'disconnect', connectionId })
    this.requestUpdate()
  }

  private readonly onPickerKey = (e: KeyboardEvent): void => {
    e.stopPropagation()
    const buttons = [...this.renderRoot.querySelectorAll<HTMLElement>('.picker button')]
    const at = buttons.indexOf(e.target as HTMLElement)
    if (e.key === 'Escape') { e.preventDefault(); this.dispatch({ type: 'relation-cancelled' }) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(at + 1) % buttons.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(at - 1 + buttons.length) % buttons.length]?.focus() }
  }

  private readonly onOtherKey = (e: KeyboardEvent): void => {
    const text = (e.target as HTMLInputElement).value.trim()
    if (e.key === 'Enter' && text) { e.preventDefault(); e.stopPropagation(); this.dispatch({ type: 'relation-picked', relation: 'urn:shrubbery:files:relation:custom', label: text }) }
  }

  private routes(scene: SceneSnapshot, engine: CanvasEngine): ReadonlyMap<string, ConnectorPath> {
    if (!scene.connectors.length) return new Map()
    const cache = this.routeCache
    if (cache && cache.scene === scene && cache.engine === engine) return cache.routes
    const routes = engine.route(routingScene(scene), { pad: ROUTE_PAD })
    this.routeCache = { scene, engine, routes }
    return routes
  }

  // --- naming input ------------------------------------------------------------------------------------------------

  private readonly onNameInput = (e: Event): void => {
    this.dispatch({ type: 'name-input', text: (e.target as HTMLInputElement).value }, false)
  }

  private readonly onNameKey = (e: KeyboardEvent): void => {
    e.stopPropagation()
    if (e.key === 'Enter') { e.preventDefault(); this.dispatch({ type: 'name-commit', text: (e.target as HTMLInputElement).value }) }
    else if (e.key === 'Escape') { e.preventDefault(); this.dispatch({ type: 'name-cancel' }) }
  }

  private readonly onNameBlur = (e: FocusEvent): void => {
    if (!this.state.naming || this.state.naming.submitted) return
    this.dispatch({ type: 'name-commit', text: (e.target as HTMLInputElement).value })
  }

  // --- render ------------------------------------------------------------------------------------------------------

  /** The datasheet face of a card: the part, the maker and revision beneath, and up to three key values with their marks. */
  private renderSheet(e: FileEvidence): TemplateResult {
    return html`<div class="sheet" data-sheet data-kind=${e.kind}>
      <span class="part" title=${e.title}>${e.title}</span>
      <span class="maker">${e.subtitle.length ? e.subtitle.map((s, i) => html`<span class=${s.fixed ? 'rev' : 'by'} title=${s.text}>${s.text || (i ? '' : '\u00a0')}</span>`) : '\u00a0'}</span>
      <div class="values">${e.values.map(v => html`<span class="value" data-mark=${v.mark} data-label=${v.label}><span class="k">${v.label}</span><span class="v">${v.text}</span>${quietMark(v.mark)
        ? html`<span class="mark" role="img" aria-label=${CORROBORATION_WORDS[v.mark]} title=${CORROBORATION_WORDS[v.mark]}>${quietMark(v.mark)}</span>` : nothing}</span>`)}</div>
    </div>`
  }

  override render(): TemplateResult | typeof nothing {
    const input = this.input
    const scene = this.scene()
    if (!input || !scene) return nothing
    const mode = this.state.mode
    const camera = this.camera
    const selected = new Set(input.session.selected.map(fileKey))
    const cut = new Set((input.session.cut ?? []).map(fileKey))
    const types = new Map(input.nodes.map(node => [fileKey(node.file), node.type ?? '']))
    const evidence = new Map<FileKey, FileEvidence>()
    for (const node of input.nodes) if (node.evidence) evidence.set(fileKey(node.file), node.evidence)
    const states = input.placementStates ?? {}
    const naming = this.state.naming
    const dragging = mode.kind === 'dragging' ? new Set(mode.files) : null
    const delta = mode.kind === 'dragging' ? mode.snapped.delta : null
    const dropTarget = mode.kind === 'dragging' ? mode.dropTarget : mode.kind === 'osdrag' ? mode.dropTarget
      : mode.kind === 'connecting' ? mode.candidate : null
    const engine = input.engine ?? houseEngine
    const iconSize = input.view?.iconSize ?? 'medium'
    const order = (input.engine ?? houseEngine).readingOrder(scene)
    const focus = this.focusedKey && scene.byKey.has(this.focusedKey) ? this.focusedKey : order[0] ?? null
    const realCount = scene.cards.filter(c => c.role === 'real').length
    const caps = filesCanvasCapabilities(input)
    const wires = !this.connectionsHidden && scene.connectors.length > 0
    // Routes: from scratch per snapshot; frame by frame during a drag, over the snapshot with the moving cards where they are now.
    let routes: ReadonlyMap<string, ConnectorPath> = new Map()
    if (wires) {
      const base = this.routes(scene, engine)
      routes = dragging && delta ? engine.reroute(moveCards(routingScene(scene), [...dragging], delta), dragging, base, { pad: ROUTE_PAD }) : base
    }
    const connectionsById = new Map((input.connections ?? []).map(c => [c.id, c]))
    const gesture = mode.kind === 'dragging' || mode.kind === 'panning' || mode.kind === 'pinching'
    const cardsInOrder = [...scene.cards].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))

    const renderCard = (card: SceneCard): TemplateResult => {
      const rect = dragging?.has(card.key) && delta ? { ...card.rect, x: card.rect.x + delta.x, y: card.rect.y + delta.y } : card.rect
      const state = card.role === 'real' ? states[card.key] : undefined
      const type = card.ref ? types.get(card.key) ?? '' : ''
      const isNaming = naming && ((naming.target.kind === 'file' && naming.target.key === card.key)
        || (naming.target.kind === 'draft' && card.draftId === naming.target.draftId))
      const sheet = card.role === 'real' ? evidence.get(card.key) : undefined
      // Small cards keep the glyph (and say the badge); medium and large trade the glyph for the part and its key values.
      const richSheet = hasFace(sheet) && iconSize !== 'small' ? sheet : undefined
      const words = [card.label, card.kind === 'folder' ? 'Folder' : card.ref?.kind === 'document' ? 'Document' : type || 'File']
      if (sheet) words.push(evidenceWords(sheet))
      if (card.role === 'ghost' && card.ghost) words.push(`position proposed by ${card.ghost.label}`)
      if (state && STATE_WORDS[state]) words.push(STATE_WORDS[state]!)
      const connecting = mode.kind === 'connecting' && mode.source === card.key
      const annunciator = card.role === 'ghost' && card.ghost ? card.ghost.label
        : card.role === 'draft' ? 'new' : state ? STATE_WORDS[state] ?? '' : sheet ? evidenceBadge(sheet) : ''
      const badgeTone = !sheet || state ? nothing : evidenceTone(sheet) ?? nothing
      return html`<div
        class="card"
        role="option"
        data-card-key=${card.key}
        data-kind=${card.kind}
        data-role=${card.role}
        data-stance=${card.role === 'ghost' ? 'contested' : nothing}
        data-state=${state && state !== 'applied' ? state : nothing}
        ?data-dragging=${dragging?.has(card.key) ?? false}
        ?data-drop-target=${dropTarget === card.key}
        ?data-cut=${card.ref !== null && cut.has(card.key)}
        ?data-evidence=${!!richSheet}
        data-size=${richSheet ? iconSize : nothing}
        ?data-naming=${!!isNaming}
        aria-selected=${card.role === 'real' && selected.has(card.key) ? 'true' : 'false'}
        aria-label=${words.join(', ')}
        tabindex=${card.key === focus ? '0' : '-1'}
        title=${card.role === 'ghost' ? `Keep this position (${card.ghost?.label ?? ''})` : card.label}
        style="left:${rect.x}px;top:${rect.y}px;width:${card.rect.w}px;height:${card.rect.h}px"
      >
        ${richSheet ? this.renderSheet(richSheet) : html`<mn-file-glyph kind=${card.kind === 'folder' ? 'folder' : card.ref?.kind === 'document' ? 'document' : 'file'} type=${type} size=${glyphSize(iconSize)}
          ?selected=${card.role === 'real' && selected.has(card.key)}></mn-file-glyph>`}
        ${isNaming ? html`
          <input class="name" aria-label="Name" .value=${naming!.text} aria-invalid=${naming!.error ? 'true' : 'false'}
            @input=${this.onNameInput} @keydown=${this.onNameKey} @blur=${this.onNameBlur}
            @pointerdown=${(e: Event) => e.stopPropagation()} />
          ${naming!.error ? html`<span class="name-error" role="alert">${naming!.error}</span>` : nothing}`
          : html`<span class="label">${displayLabel(card.label, iconSize)}</span>`}
        ${annunciator ? html`<span class="annunciator" data-tone=${badgeTone} title=${annunciator}>${annunciator}</span>` : nothing}
        ${caps.connect && card.role === 'real' && !isNaming ? html`<span class="handle" data-handle=${card.key} ?data-active=${connecting} aria-hidden="true"></span>` : nothing}
      </div>`
    }

    const connectorSvg = wires ? html`<svg class="connectors" aria-hidden="false">${scene.connectors.map(c => {
      const route = routes.get(c.id)
      if (!route) return nothing
      const meta = connectionsById.get(c.id)
      const d = route.points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')
      const a = route.points[route.points.length - 2]!, b = route.points[route.points.length - 1]!
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
      const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len
      const arrow = `${b.x},${b.y} ${b.x - ux * 9 - uy * 4.5},${b.y - uy * 9 + ux * 4.5} ${b.x - ux * 9 + uy * 4.5},${b.y - uy * 9 - ux * 4.5}`
      const name = `${meta?.label || c.label || 'Connection'}: ${scene.byKey.get(c.from)?.label ?? ''} to ${scene.byKey.get(c.to)?.label ?? ''}`
      return svg`<g class="connector" data-connection-id=${c.id} data-state=${meta?.state ?? 'proposed'}
        ?data-selected=${this.selectedConnector === c.id}>
        <title>${name}</title>
        <path class="line" d=${d}></path>
        <polygon class="arrow" points=${arrow}></polygon>
        <path class="hit" data-connector-id=${c.id} d=${d} role="img" aria-label=${name}></path>
      </g>`
    })}</svg>` : nothing
    const labelsDiv = wires ? html`<div class="conn-labels">${scene.connectors.map(c => {
      const route = routes.get(c.id)
      if (!route || !c.label.trim()) return nothing
      const selected = this.selectedConnector === c.id
      const meta = connectionsById.get(c.id)
      return html`<span class="conn-label" data-connector-id=${c.id} data-connection-id=${c.id} ?data-selected=${selected}
        title=${meta?.attribution ? `${c.label} · ${meta.state} by ${meta.attribution}` : c.label}
        style="left:${route.labelAnchor.x}px;top:${route.labelAnchor.y}px">${c.label}${selected && caps.connect
          ? html`<button type="button" aria-label=${`Disconnect ${c.label}`} @click=${(e: Event) => { e.stopPropagation(); this.disconnect(c.id) }}
            @pointerdown=${(e: Event) => e.stopPropagation()}>×</button>` : nothing}</span>`
    })}</div>` : nothing
    const rubber = mode.kind === 'connecting' && mode.via === 'pointer' && mode.current ? (() => {
      const from = scene.byKey.get(mode.source)
      if (!from) return nothing
      const a = toViewport(camera, { x: from.rect.x + from.rect.w, y: from.rect.y + from.rect.h / 2 })
      return html`<svg class="rubber" aria-hidden="true"><line x1=${a.x} y1=${a.y} x2=${mode.current.x} y2=${mode.current.y}></line></svg>`
    })() : nothing
    const picker = this.picker && mode.kind === 'picking' ? (() => {
      const box = this.getBoundingClientRect()
      const relations = input.relations ?? []
      const to = scene.byKey.get(this.picker.target)?.label ?? ''
      const from = scene.byKey.get(this.picker.source)?.label ?? ''
      const left = Math.max(4, Math.min(this.picker.at.x, Math.max(4, box.width - 180)))
      const top = Math.max(4, Math.min(this.picker.at.y, Math.max(4, box.height - 40 - relations.length * 28)))
      return html`<div class="picker" role="menu" aria-label=${`How is ${from} related to ${to}?`} style="left:${left}px;top:${top}px"
        @keydown=${this.onPickerKey} @pointerdown=${(e: Event) => e.stopPropagation()}>
        <div class="picker-title">${from} → ${to}</div>
        ${relations.map(r => html`<button type="button" role="menuitem" data-relation=${r.uri}
          @click=${() => this.dispatch({ type: 'relation-picked', relation: r.uri, label: r.label })}>${r.label}</button>`)}
        ${this.pickerOther
          ? html`<input class="other" aria-label="Other relation" placeholder="Name the relation" maxlength="48"
              @keydown=${this.onOtherKey} />`
          : html`<button type="button" role="menuitem" data-relation="other" @click=${() => { this.pickerOther = true; this.requestUpdate(); void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>('input.other')?.focus()) }}>Other…</button>`}
      </div>`
    })() : nothing

    const marquee = mode.kind === 'marquee' ? (() => {
      const x = Math.min(mode.origin.x, mode.current.x), y = Math.min(mode.origin.y, mode.current.y)
      return html`<div class="marquee" style="left:${x}px;top:${y}px;width:${Math.abs(mode.current.x - mode.origin.x)}px;height:${Math.abs(mode.current.y - mode.origin.y)}px"></div>`
    })() : nothing
    const guides = mode.kind === 'dragging' && mode.snapped.guides.length ? html`<svg class="guides" aria-hidden="true">${mode.snapped.guides.map(g => {
      const a = g.axis === 'x' ? toViewport(camera, { x: g.at, y: g.from }) : toViewport(camera, { x: g.from, y: g.at })
      const b = g.axis === 'x' ? toViewport(camera, { x: g.at, y: g.to }) : toViewport(camera, { x: g.to, y: g.at })
      return html`<line x1=${a.x + 0.5} y1=${a.y + 0.5} x2=${b.x + 0.5} y2=${b.y + 0.5}></line>`
    })}</svg>` : nothing
    const target = dropTarget ? scene.byKey.get(dropTarget) : null
    const ext = mode.kind === 'dragging' ? mode.external : null
    const connectHint = mode.kind === 'connecting' && mode.via === 'keyboard'
      ? html`<div class="hint">Connect ${scene.byKey.get(mode.source)?.label ?? ''}: arrows choose the target, Enter picks, Esc cancels</div>`
      : mode.kind === 'connecting' && target ? html`<div class="hint">Connect to ${target.label}</div>` : nothing
    const hint = connectHint !== nothing ? connectHint : ext ? html`<div class="hint">Move into ${this.externalLabel}</div>` : target ? html`<div class="hint">${mode.kind === 'osdrag' ? 'Upload into' : 'Move into'} ${target.label}</div>`
      : mode.kind === 'osdrag' ? html`<div class="hint">Upload here</div>` : nothing

    return html`<div
      class="plane"
      @pointerdown=${this.onPointerDown}
      @pointermove=${this.onPointerMove}
      @pointerup=${this.onPointerUp}
      @pointercancel=${this.onPointerCancel}
      @wheel=${this.onWheel}
      @keydown=${this.onKeyDown}
      @keyup=${this.onKeyUp}
      @contextmenu=${this.onContextMenu}
      @dragenter=${this.onDragOver}
      @dragover=${this.onDragOver}
      @dragleave=${this.onDragLeave}
      @drop=${this.onDrop}
    >
      <div class="scene" ?data-gesture=${gesture}
        style="transform: translate(${camera.x * camera.zoom}px, ${camera.y * camera.zoom}px) scale(${camera.zoom})">
        ${connectorSvg}
        <div role="listbox" aria-multiselectable="true" aria-label=${`Folder canvas, ${realCount} ${realCount === 1 ? 'item' : 'items'}`}
          tabindex=${focus ? '-1' : '0'}>
          ${repeat(cardsInOrder, card => card.key, renderCard)}
        </div>
        ${labelsDiv}
      </div>
      ${realCount === 0 && !scene.cards.length ? html`<div class="empty">${renderFilesEmpty(caps.add)}</div>` : nothing}
      <div class="overlay">${marquee}${guides}${rubber}${hint}</div>
      ${picker}
      <div class="controls" role="group" aria-label="View">
        ${caps.place ? html`<button type="button" class="word" aria-label="Tidy up" title="Tidy up: lay the cards out in a grid" @click=${() => this.command('tidy')}>Tidy</button>` : nothing}
        ${(input.connections?.length ?? 0) > 0 || caps.connect ? html`<button type="button" class="word" aria-label="Connections" aria-pressed=${this.connectionsHidden ? 'false' : 'true'}
          title=${this.connectionsHidden ? 'Show connections' : 'Hide connections'}
          @click=${() => { this.connectionsHidden = !this.connectionsHidden; this.selectedConnector = null; this.requestUpdate() }}>Links</button>` : nothing}
        <button type="button" aria-label="Zoom out" title="Zoom out" @click=${() => this.command('zoom-out')}>−</button>
        <button type="button" aria-label="Reset view" title="Reset view (fit the folder)" @click=${() => this.command('reset-view')}>${Math.round(camera.zoom * 100)}%</button>
        <button type="button" aria-label="Zoom in" title="Zoom in" @click=${() => this.command('zoom-in')}>+</button>
      </div>
    </div>`
  }
}

if (!customElements.get('mn-files-canvas')) customElements.define('mn-files-canvas', MnFilesCanvas)

declare global {
  interface HTMLElementTagNameMap { 'mn-files-canvas': MnFilesCanvas }
}
