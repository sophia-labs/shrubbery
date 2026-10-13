/**
 * The interaction reducer of the Files canvas: `(state, event, ctx) -> { state, intents, effects, ... }`.
 *
 * Pure. The DOM binding is thin: it normalises DOM events into `CanvasEvent`s, calls `reduce` with a
 * context built from the current input, applies the session patch, runs the effects, and calls
 * `onIntent` for each intent. Every law of section 3.3 of the design (and the review's grammar) is a
 * unit test over event sequences.
 *
 * The machine of section 3.1: idle, pressing, marquee, dragging, panning, pinching, connecting, picking,
 * menu, and an OS file drag over the canvas. A name edit (`naming`) is orthogonal to the pointer gesture,
 * because the input owns the keystrokes and the pointer stays free: a press elsewhere ends the edit by
 * committing it first (Law 3).
 *
 * Camera, focus and cut are session state the host owns; they come back as a `session` patch. Selection
 * is the shell's: the reducer asks for it with `select` and compares against what it was given (Law 4).
 *
 * `reduce` is a function of its arguments and nothing else: evaluating it changes nothing, not even the engine it is
 * handed (the same state, event and context give the same step, however many times and in whatever company they are
 * evaluated). An engine that keeps drag state (Excalidraw's snap cache is process-global) is bracketed by effects, which
 * are the host's to run (`runEngineEffects`): `prepareDrag` when a press that can drag begins, so the engine is primed
 * before the first snap, `releaseDrag` however that press or drag ends, `disposeEngine` when the canvas is destroyed. The
 * host runs a step's effects before it delivers the next event.
 */
import { fileKey } from '../folder-view-contract.js'
import type {
  FileCanvasCapabilities, FileCanvasIntent, FilePlacementRecord, FileCanvasNaming, FileCanvasSession, FileCanvasSessionPatch, FileKey, FolderViewScope, WorkspaceFileRef,
} from '../folder-view-contract.js'
import type { CanvasEngine, Direction, SceneCard, SceneSnapshot, SnapResult } from './engine-port.js'
import {
  IDENTITY_CAMERA, clampZoom, distance, midpoint, panByViewport, rectCenter, rectContainsPoint, rectFromPoints, revealRect, toScene, toViewport, zoomAbout,
  type Camera, type Pt,
} from './geometry.js'
import { CARD_GAP, draftKey } from './scene.js'

/** Pointer movement beyond this many viewport pixels turns a press into a drag, a marquee or a connect. */
export const DRAG_THRESHOLD = 4
/** Two clicks on one card within this many milliseconds are a double-click. */
export const DOUBLE_CLICK_MS = 400
/** Finder's rule: a click on the label of the selected card, this long after the last click on it, names it. */
export const NAME_CLICK_MIN_MS = 500
export const NAME_CLICK_MAX_MS = 2000
/** Snap threshold in viewport pixels; the engine gets it divided by the zoom. */
export const SNAP_THRESHOLD_PX = 6
/** Keyboard nudge: one grid step, or four with Shift. */
export const NUDGE_STEP = 8
export const NUDGE_STEP_LARGE = 32
/** Control-wheel zoom factor per 100 wheel units, and the keyboard and button zoom factor. */
export const WHEEL_ZOOM_PER_100 = 1.1
export const KEY_ZOOM = 1.25
/** Reset view: content bounds with this inset, never zoomed past 1. */
export const FIT_INSET = 24
export const FIT_ZOOM_MAX = 1
/** Room kept around a card revealed by keyboard navigation, in viewport pixels. */
export const REVEAL_MARGIN = 16

export interface Modifiers {
  readonly shift: boolean
  readonly alt: boolean
  readonly meta: boolean
  readonly ctrl: boolean
}
export const NO_MODS: Modifiers = Object.freeze({ shift: false, alt: false, meta: false, ctrl: false })

export type PointerKind = 'mouse' | 'touch' | 'pen'

/** What the DOM binding found under the pointer. Keys are `SceneCard.key`s; the reducer checks them against the scene. */
export type PointerTarget =
  | { readonly kind: 'background' }
  | { readonly kind: 'card'; readonly key: FileKey }
  | { readonly kind: 'label'; readonly key: FileKey }
  | { readonly kind: 'handle'; readonly key: FileKey }
  | { readonly kind: 'connector'; readonly id: string }

/** A folder outside the canvas the pointer is over during a drag (a tree row), found by the host. */
export interface ExternalTarget { readonly folder: WorkspaceFileRef | null }

export type CanvasEvent =
  | { readonly type: 'pointerdown'; readonly pointerId: number; readonly at: Pt; readonly button: number; readonly mods: Modifiers
      readonly target: PointerTarget; readonly t: number; readonly pointerType?: PointerKind }
  | { readonly type: 'pointermove'; readonly pointerId: number; readonly at: Pt; readonly mods: Modifiers; readonly t: number
      readonly external?: ExternalTarget | null }
  | { readonly type: 'pointerup'; readonly pointerId: number; readonly at: Pt; readonly mods: Modifiers; readonly t: number
      readonly external?: ExternalTarget | null }
  | { readonly type: 'pointercancel'; readonly pointerId: number }
  | { readonly type: 'longpress'; readonly pointerId: number }
  | { readonly type: 'wheel'; readonly at: Pt; readonly deltaX: number; readonly deltaY: number; readonly mods: Modifiers }
  | { readonly type: 'keydown'; readonly key: string; readonly mods: Modifiers; readonly repeat?: boolean }
  | { readonly type: 'keyup'; readonly key: string; readonly mods: Modifiers }
  | { readonly type: 'contextmenu'; readonly at: Pt; readonly target: PointerTarget; readonly mods: Modifiers }
  /** An OS file drag over the canvas (`dragenter` and `dragover` alike). */
  | { readonly type: 'dragover'; readonly at: Pt }
  | { readonly type: 'dragleave' }
  | { readonly type: 'drop'; readonly at: Pt; readonly files: ArrayLike<File> }
  /** The naming input: its text as it changes, Enter or blur (`name-commit`), Escape (`name-cancel`). */
  | { readonly type: 'name-input'; readonly text: string }
  | { readonly type: 'name-commit'; readonly text?: string }
  | { readonly type: 'name-cancel' }
  /** Activation of a card's connector handle button, or the item menu's "Connect…": the keyboard twin of dragging from the handle. Arrows then choose the target, Enter opens the relation picker. */
  | { readonly type: 'handle-activate'; readonly key: FileKey }
  | { readonly type: 'relation-picked'; readonly relation: string; readonly label?: string }
  | { readonly type: 'relation-cancelled' }
  | { readonly type: 'menu-closed' }
  /** Commands from the host's own chrome: the toolbar's New folder, the controls, the background menu's Tidy up. */
  | { readonly type: 'command'; readonly command: 'tidy' | 'reset-view' | 'zoom-in' | 'zoom-out' | 'new-folder' }
  /** The host lost focus: in-flight pointer gestures end without effect. */
  | { readonly type: 'blur' }
  /** The input changed and nothing else happened: let the reducer reconcile. */
  | { readonly type: 'sync' }
  | { readonly type: 'destroy' }

export interface CanvasContext {
  /** The scope identity plus the host's generation. Any change ends every gesture without intents (Law 7). */
  readonly epoch: string
  readonly scope: FolderViewScope
  readonly scene: SceneSnapshot
  readonly camera: Camera
  /** The host element's box in client space: pointer events are relative to its top-left corner. */
  readonly viewport: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  /** `session.selected` as keys. */
  readonly selection: readonly FileKey[]
  /** The focused card: any card key, a ghost's or a draft's included. */
  readonly focused: FileKey | null
  readonly capabilities: FileCanvasCapabilities
  readonly engine: CanvasEngine
  /** `session.naming`: a name edit the shell asked for. */
  readonly naming: FileCanvasNaming | null
  /** `session.cut`: the files marked by Cut. */
  readonly cut: readonly WorkspaceFileRef[]
}

/** The only imperative instructions the host executes. */
export type CanvasEffect =
  | { readonly kind: 'capturePointer'; readonly pointerId: number }
  | { readonly kind: 'releasePointer'; readonly pointerId: number }
  | { readonly kind: 'focusCard'; readonly key: FileKey }
  | { readonly kind: 'focusInput' }
  | { readonly kind: 'focusHeader' }
  | { readonly kind: 'openMenu'; readonly anchor: Pt; readonly files: readonly FileKey[] }
  | { readonly kind: 'openRelationPicker'; readonly at: Pt; readonly source: FileKey; readonly target: FileKey }
  /** A drag ended: the cards stop following the pointer and take their positions from the input, or from where they were. */
  | { readonly kind: 'endDrag'; readonly outcome: 'committed' | 'cancelled' }
  /** The engine's drag state (rule 2b of the port) is opened for these cards, against the scene this step was given. A second one replaces the first. */
  | { readonly kind: 'prepareDrag'; readonly files: readonly FileKey[] }
  /** The engine's drag state is closed, however the press or drag ended. Idempotent. */
  | { readonly kind: 'releaseDrag' }
  /** The canvas is destroyed: the engine lets go of whatever it holds. */
  | { readonly kind: 'disposeEngine' }

/** Session state the host owns and echoes to the shell: camera, focus (a card key), cut. */
export interface CanvasSessionPatch {
  readonly camera?: Camera
  readonly focused?: FileKey | null
  readonly cut?: readonly WorkspaceFileRef[]
}

export interface NamingState {
  readonly target: { readonly kind: 'file'; readonly key: FileKey } | { readonly kind: 'draft'; readonly draftId: string }
  /** 'local': F2 or the name-click rule. 'shell': `session.naming`. */
  readonly origin: 'local' | 'shell'
  readonly initial: string
  readonly text: string
  readonly error: string | null
  /** A commit has been emitted and the shell has not answered yet; a second commit is not emitted. */
  readonly submitted: boolean
}

export interface PointerPoint { readonly id: number; readonly at: Pt }

export type CanvasMode =
  | { readonly kind: 'idle' }
  | { readonly kind: 'pressing'; readonly pointerId: number; readonly origin: Pt; readonly originScene: Pt; readonly target: PointerTarget
      readonly mods: Modifiers; readonly t0: number; readonly selectionAfter: readonly FileKey[]; readonly wasSoleSelected: boolean
      readonly moved: boolean
      /** The cards this press would drag, for which the host was asked to prime the engine; null when it would not drag. */
      readonly primed: readonly FileKey[] | null }
  | { readonly kind: 'marquee'; readonly pointerId: number; readonly origin: Pt; readonly current: Pt; readonly additive: boolean
      readonly anchorSelection: readonly FileKey[] }
  | { readonly kind: 'dragging'; readonly pointerId: number; readonly files: readonly FileKey[]; readonly origin: Pt; readonly originScene: Pt
      readonly delta: Pt; readonly snapped: SnapResult; readonly dropTarget: FileKey | null; readonly external: ExternalTarget | null }
  | { readonly kind: 'panning'; readonly pointerId: number; readonly origin: Pt; readonly cameraAtStart: Camera; readonly via: 'space' | 'middle' | 'touch' }
  | { readonly kind: 'pinching'; readonly a: PointerPoint; readonly b: PointerPoint; readonly startMid: Pt; readonly startDist: number; readonly cameraAtStart: Camera }
  | { readonly kind: 'connecting'; readonly source: FileKey; readonly via: 'pointer' | 'keyboard'; readonly pointerId: number | null
      readonly current: Pt | null; readonly candidate: FileKey | null }
  | { readonly kind: 'picking'; readonly source: FileKey; readonly target: FileKey }
  | { readonly kind: 'menu'; readonly files: readonly FileKey[]; readonly anchor: Pt }
  | { readonly kind: 'osdrag'; readonly at: Pt; readonly dropTarget: FileKey | null }

export interface CanvasState {
  readonly epoch: string
  /** After `destroy`: every event is ignored. */
  readonly dead: boolean
  readonly mode: CanvasMode
  /** A name edit in progress; orthogonal to the pointer gesture, because the input owns the keystrokes, not the pointer. */
  readonly naming: NamingState | null
  /** The anchor of range selection (Shift-click, Shift-arrows). */
  readonly anchor: FileKey | null
  /** The previous click, for the double-click and name-click rules. */
  readonly lastClick: { readonly key: FileKey; readonly downT: number } | null
  /** Space held: pan on the next drag; released without panning, it toggles the focused card. */
  readonly space: { readonly down: boolean; readonly panned: boolean }
  /** Touch pointers that are down. */
  readonly pointers: readonly PointerPoint[]
  /**
   * The shell's `session.naming` the user has already answered (cancelled) or that belonged to a scope that is gone:
   * while the shell still holds exactly that request, the canvas does not open it again.
   */
  readonly dismissedNaming: string | null
}

export interface CanvasStep {
  readonly state: CanvasState
  readonly intents: readonly FileCanvasIntent[]
  readonly effects: readonly CanvasEffect[]
  readonly session: CanvasSessionPatch
  /** The event was the canvas's: the host calls `preventDefault`. False for a key bound to no verb (Law 8). */
  readonly handled: boolean
}

/**
 * What the host tells the shell about the session it owns. The reducer speaks of focus as a card key, which may be a ghost's or a
 * draft's; the shell hears a file: a ghost stands for the file it is a candidate position of, a draft for nothing yet.
 */
export function toShellPatch(patch: CanvasSessionPatch, scene: SceneSnapshot): FileCanvasSessionPatch {
  return {
    ...(patch.camera ? { camera: patch.camera } : {}),
    ...(patch.focused !== undefined ? { focused: (patch.focused ? scene.byKey.get(patch.focused)?.ref : null) ?? null } : {}),
    ...(patch.cut ? { cut: patch.cut } : {}),
  }
}

/**
 * The engine half of the host's job: run what a step asked of the engine's drag state (`prepareDrag`, `releaseDrag`, `disposeEngine`)
 * against the scene the step was given, before the next event is delivered. An engine without the lifecycle is left alone.
 */
export function runEngineEffects(effects: readonly CanvasEffect[], engine: CanvasEngine, scene: SceneSnapshot): void {
  for (const effect of effects) {
    if (effect.kind === 'prepareDrag') engine.prepareDrag?.(scene, effect.files)
    else if (effect.kind === 'releaseDrag') engine.releaseDrag?.()
    else if (effect.kind === 'disposeEngine') engine.dispose?.()
  }
}

/**
 * The focus the reducer starts from, out of the session the shell echoes back. The shell is told a ghost's focus as the file the ghost
 * is a position of (`toShellPatch`), and echoes that file; if that is the file the focus the host holds (`previous`, in `scene`) is
 * already on, nothing new was said, and the host keeps the card it had, the ghost, instead of the real card of the same file: Enter on a
 * focused ghost is a choice of it, and must stay one when the shell has echoed the focus. A different file is the shell's own move of
 * the focus, and is taken.
 */
export function focusKey(session: Pick<FileCanvasSession, 'focused'>, previous: FileKey | null = null, scene?: SceneSnapshot): FileKey | null {
  if (!session.focused) return null
  const echoed = fileKey(session.focused)
  const held = previous !== null && previous !== echoed ? scene?.byKey.get(previous) : undefined
  return held?.ref && fileKey(held.ref) === echoed ? previous : echoed
}

export function initialState(epoch: string): CanvasState {
  return { epoch, dead: false, mode: { kind: 'idle' }, naming: null, anchor: null, lastClick: null,
    space: { down: false, panned: false }, pointers: [], dismissedNaming: null }
}


export type Verb =
  | 'open' | 'open-beside' | 'rename' | 'move-to' | 'connect' | 'remove' | 'new-folder-inside'
  | 'add' | 'new-folder' | 'paste' | 'tidy' | 'view'

export interface MenuVerb { readonly verb: Verb; readonly label: string }

// ---------------------------------------------------------------------------------------------------------------
// The reducer
// ---------------------------------------------------------------------------------------------------------------

const ARROWS: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }
const NUDGE: Record<Direction, Pt> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }

const hasMod = (m: Modifiers): boolean => m.meta || m.ctrl
const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length !== b.length) return false
  const set = new Set(b)
  return a.every((k) => set.has(k))
}
const sameKeys = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((k, i) => k === b[i])
const sameCamera = (a: Camera, b: Camera): boolean => a.x === b.x && a.y === b.y && a.zoom === b.zoom
const namingSignature = (n: FileCanvasNaming): string =>
  JSON.stringify(['draftId' in n.target ? ['draft', n.target.draftId] : ['file', fileKey(n.target)], n.initial, n.error])

function viewedFolder(scope: FolderViewScope): WorkspaceFileRef | null {
  return scope.folderId === null ? null
    : { ownerId: scope.ownerId, graphId: scope.graphId, graphIncarnation: scope.graphIncarnation, kind: 'folder', id: scope.folderId }
}

/** Is `folder` a folder of the same workspace incarnation as every one of `files`? (The shell still runs its own validation.) */
function sameWorkspaceFolder(folder: WorkspaceFileRef, files: readonly WorkspaceFileRef[]): boolean {
  return folder.kind === 'folder' && files.every((f) => f.ownerId === folder.ownerId && f.graphId === folder.graphId &&
    f.graphIncarnation === folder.graphIncarnation && fileKey(f) !== fileKey(folder))
}

const canEdit = (c: FileCanvasCapabilities): boolean => c.place || c.move || c.rename || c.create || c.add || c.remove || c.connect

export function reduce(prev: CanvasState, event: CanvasEvent, ctx: CanvasContext): CanvasStep {
  const run = new Run(prev, ctx)
  run.start()
  if (!run.state.dead) run.handle(event)
  return run.finish()
}

class Run {
  state: CanvasState
  private intents: FileCanvasIntent[] = []
  private effects: CanvasEffect[] = []
  private session: { camera?: Camera; focused?: FileKey | null; cut?: readonly WorkspaceFileRef[] } = {}
  private handled = false
  /** The selection, the focus and the camera as this step has left them. */
  private sel: readonly FileKey[]
  private focus: FileKey | null
  private camera: Camera

  constructor(prev: CanvasState, private readonly ctx: CanvasContext) {
    this.state = prev
    this.sel = ctx.selection
    this.focus = ctx.focused
    this.camera = ctx.camera
  }

  finish(): CanvasStep {
    return { state: this.state, intents: this.intents, effects: this.effects, session: this.session, handled: this.handled }
  }

  // --- small helpers ---------------------------------------------------------------------------------------

  private get caps(): FileCanvasCapabilities { return this.ctx.capabilities }
  private card(key: FileKey | null | undefined): SceneCard | null { return key ? this.ctx.scene.byKey.get(key) ?? null : null }
  private real(key: FileKey | null | undefined): SceneCard | null {
    const c = this.card(key)
    return c && c.role === 'real' ? c : null
  }
  private set(patch: Partial<CanvasState>): void { this.state = { ...this.state, ...patch } }
  private mode(mode: CanvasMode): void { this.state = { ...this.state, mode } }
  private emit(intent: FileCanvasIntent): void { this.intents.push(intent) }
  private effect(effect: CanvasEffect): void { this.effects.push(effect) }
  private scenePoint(at: Pt): Pt { return toScene(this.camera, at) }
  private inside(at: Pt): boolean { return at.x >= 0 && at.y >= 0 && at.x <= this.ctx.viewport.w && at.y <= this.ctx.viewport.h }
  private size(): { w: number; h: number } { return { w: this.ctx.viewport.w, h: this.ctx.viewport.h } }

  /** Real cards in reading order. */
  private order(): FileKey[] {
    return this.ctx.engine.readingOrder(this.ctx.scene).filter((k) => this.ctx.scene.byKey.get(k)!.role === 'real')
  }

  private setCamera(camera: Camera): void {
    if (sameCamera(camera, this.camera)) return
    this.camera = camera
    this.session.camera = camera
  }

  private setFocus(key: FileKey | null, ring = true): void {
    if (key !== this.focus) { this.focus = key; this.session.focused = key }
    if (key && ring) this.effect({ kind: 'focusCard', key })
  }

  private reveal(card: SceneCard | null): void {
    if (card) this.setCamera(revealRect(this.camera, this.size(), card.rect, REVEAL_MARGIN))
  }

  /** Ask the shell for this selection, in reading order, if it is not what the shell already has. */
  private select(keys: readonly FileKey[]): void {
    const wanted = new Set(keys)
    const next = this.order().filter((k) => wanted.has(k))
    if (sameSet(next, this.sel)) return
    this.sel = next
    this.emit({ kind: 'select', files: next.map((k) => this.real(k)!.ref!) })
  }

  private refs(keys: readonly FileKey[]): WorkspaceFileRef[] { return keys.map((k) => this.real(k)!.ref!) }

  private setAnchor(anchor: FileKey | null): void { if (anchor !== this.state.anchor) this.set({ anchor }) }

  // --- reconcile: what changed under the machine since the last event --------------------------------------

  start(): void {
    let s = this.state
    if (s.dead) return
    const { ctx } = this
    if (s.epoch !== ctx.epoch) {
      this.release(s.mode, 'cancelled')
      // The new scope starts clean, and does not inherit a name edit the shell was holding for the old one.
      this.state = { ...initialState(ctx.epoch), dismissedNaming: ctx.naming ? namingSignature(ctx.naming) : null }
      s = this.state
    }
    if (s.anchor && !this.real(s.anchor)) this.set({ anchor: null })
    if (s.lastClick && !this.card(s.lastClick.key)) this.set({ lastClick: null })
    this.sanitize()
    this.syncNaming()
  }

  /** End whatever gesture is in flight with no intents: release the pointers, and put dragged cards back. */
  private release(mode: CanvasMode, outcome: 'committed' | 'cancelled'): void {
    switch (mode.kind) {
      case 'dragging':
        this.effect({ kind: 'releaseDrag' })
        this.effect({ kind: 'releasePointer', pointerId: mode.pointerId }); this.effect({ kind: 'endDrag', outcome })
        break
      case 'pressing':
        if (mode.primed) this.effect({ kind: 'releaseDrag' })
        this.effect({ kind: 'releasePointer', pointerId: mode.pointerId })
        break
      case 'marquee': case 'panning': this.effect({ kind: 'releasePointer', pointerId: mode.pointerId }); break
      case 'connecting': if (mode.pointerId !== null) this.effect({ kind: 'releasePointer', pointerId: mode.pointerId }); break
      case 'pinching': this.effect({ kind: 'releasePointer', pointerId: mode.a.id }); this.effect({ kind: 'releasePointer', pointerId: mode.b.id }); break
      default: break
    }
  }

  private abort(): void {
    this.release(this.state.mode, 'cancelled')
    this.mode({ kind: 'idle' })
  }

  private sanitize(): void {
    const m = this.state.mode
    switch (m.kind) {
      case 'pressing':
        if ('key' in m.target && !this.card(m.target.key)) this.abort()
        break
      case 'dragging': {
        const files = m.files.filter((k) => { const c = this.real(k); return c !== null && !c.locked })
        if (files.length === 0) this.abort()
        else if (files.length !== m.files.length) { this.mode({ ...m, files }); this.effect({ kind: 'prepareDrag', files }) }
        break
      }
      case 'connecting': if (!this.real(m.source)) this.abort(); break
      case 'picking': if (!this.real(m.source) || !this.real(m.target)) this.mode({ kind: 'idle' }); break
      default: break
    }
  }

  private syncNaming(): void {
    const { ctx } = this
    const n = this.state.naming
    if (n) {
      const gone = n.target.kind === 'file' ? !this.real(n.target.key) : !this.cardOfDraft(n.target.draftId)
      if (gone) this.set({ naming: null })
    }
    const asked = ctx.naming
    const now = this.state.naming
    if (asked === null) {
      if (now?.origin === 'shell') this.endNaming()
      if (this.state.dismissedNaming !== null) this.set({ dismissedNaming: null })
      return
    }
    const sig = namingSignature(asked)
    if (this.state.dismissedNaming === sig) return
    const target: NamingState['target'] | null = 'draftId' in asked.target
      ? (this.cardOfDraft(asked.target.draftId) && this.caps.create ? { kind: 'draft', draftId: asked.target.draftId } : null)
      : (this.real(fileKey(asked.target)) && this.caps.rename ? { kind: 'file', key: fileKey(asked.target) } : null)
    if (!target) return
    const same = now && JSON.stringify(now.target) === JSON.stringify(target)
    if (same && now.origin === 'shell' && !now.submitted && now.initial === asked.initial && now.error === asked.error) return
    if (same && now.origin === 'shell' && now.submitted && now.error === asked.error && now.initial === asked.initial) return
    this.set({ naming: { target, origin: 'shell', initial: asked.initial, text: asked.initial, error: asked.error, submitted: false } })
    this.effect({ kind: 'focusInput' })
    this.reveal(target.kind === 'file' ? this.real(target.key) : this.cardOfDraft(target.draftId))
  }

  private cardOfDraft(draftId: string): SceneCard | null {
    return this.ctx.scene.byKey.get(draftKey(draftId)) ?? null
  }

  // --- naming ----------------------------------------------------------------------------------------------

  private startNaming(key: FileKey): void {
    const card = this.real(key)
    if (!card || !this.caps.rename) return
    this.set({ naming: { target: { kind: 'file', key }, origin: 'local', initial: card.label, text: card.label, error: null, submitted: false } })
    this.effect({ kind: 'focusInput' })
  }

  /** End the edit. A shell-held request is remembered as answered until the shell lets go of it. */
  private endNaming(refocus = true): void {
    const n = this.state.naming
    if (!n) return
    this.set({ naming: null, ...(n.origin === 'shell' && this.ctx.naming ? { dismissedNaming: namingSignature(this.ctx.naming) } : {}) })
    if (refocus && n.target.kind === 'file' && this.real(n.target.key)) this.effect({ kind: 'focusCard', key: n.target.key })
  }

  private commitNaming(text?: string): void {
    const n = this.state.naming
    if (!n || n.submitted) return
    const typed = text ?? n.text
    if (n.target.kind === 'file') {
      const card = this.real(n.target.key)
      if (!card || !this.caps.rename || typed === n.initial) {
        if (card && this.caps.rename) this.emit({ kind: 'name-cancel' })
        this.endNaming()
        return
      }
      this.emit({ kind: 'rename', file: card.ref!, name: typed })
    } else {
      const card = this.cardOfDraft(n.target.draftId)
      if (!card || !this.caps.create) { this.endNaming(); return }
      this.emit({ kind: 'create', objectKind: 'folder', parent: viewedFolder(this.ctx.scope), name: typed,
        placement: { x: card.rect.x, y: card.rect.y }, draftId: n.target.draftId })
    }
    if (n.origin === 'local') {
      this.set({ naming: null })
      if (n.target.kind === 'file') this.effect({ kind: 'focusCard', key: n.target.key })
    } else this.set({ naming: { ...n, text: typed, submitted: true } })
  }

  // --- dispatch --------------------------------------------------------------------------------------------

  handle(e: CanvasEvent): void {
    switch (e.type) {
      case 'pointerdown': this.pointerDown(e); return
      case 'pointermove': this.pointerMove(e); return
      case 'pointerup': this.pointerUp(e); return
      case 'pointercancel': this.pointerCancel(e.pointerId); return
      case 'longpress': this.longPress(e.pointerId); return
      case 'wheel': this.wheel(e); return
      case 'keydown': this.keyDown(e); return
      case 'keyup': this.keyUp(e); return
      case 'contextmenu': this.contextMenu(e); return
      case 'dragover': this.dragOver(e); return
      case 'dragleave': if (this.state.mode.kind === 'osdrag') this.mode({ kind: 'idle' }); return
      case 'drop': this.drop(e); return
      case 'name-input': if (this.state.naming && !this.state.naming.submitted) this.set({ naming: { ...this.state.naming, text: e.text } }); this.handled = true; return
      case 'name-commit': if (this.state.naming) { this.handled = true; this.commitNaming(e.text) } return
      case 'name-cancel': this.nameCancel(); return
      case 'handle-activate': this.handleActivate(e.key); return
      case 'relation-picked': this.relationPicked(e); return
      case 'relation-cancelled': if (this.state.mode.kind === 'picking') this.mode({ kind: 'idle' }); return
      case 'menu-closed': if (this.state.mode.kind === 'menu') this.mode({ kind: 'idle' }); return
      case 'command': this.command(e.command); return
      case 'blur': this.blur(); return
      case 'sync': return
      case 'destroy':
        this.release(this.state.mode, 'cancelled')
        this.effect({ kind: 'disposeEngine' })
        this.set({ dead: true, mode: { kind: 'idle' }, naming: null })
        return
    }
  }

  // --- pointer ---------------------------------------------------------------------------------------------

  /** The pointer a gesture in flight belongs to; null when none is, or when it is a keyboard connect. */
  private gesturePointer(): number | null {
    const m = this.state.mode
    switch (m.kind) {
      case 'pressing': case 'marquee': case 'dragging': case 'panning': return m.pointerId
      case 'connecting': return m.pointerId
      case 'pinching': return m.a.id
      default: return null
    }
  }

  private pointerDown(e: Extract<CanvasEvent, { type: 'pointerdown' }>): void {
    // A press anywhere else ends a name edit, by committing it first (Law 3).
    if (this.state.naming) this.commitNaming()
    const open = this.state.mode.kind
    if (open === 'menu' || open === 'picking' || open === 'osdrag') this.mode({ kind: 'idle' })
    const touch = e.pointerType === 'touch'
    if (touch) this.set({ pointers: [...this.state.pointers.filter((p) => p.id !== e.pointerId), { id: e.pointerId, at: e.at }] })
    if (this.state.mode.kind === 'pinching') return
    if (touch && this.state.pointers.length >= 2) { this.startPinch(); this.handled = true; return }
    const busy = this.gesturePointer()
    if (busy !== null && busy !== e.pointerId) return
    if (busy !== null || this.state.mode.kind === 'connecting') this.abort()
    if (e.button === 1) { this.startPan(e, 'middle'); return }
    if (e.button !== 0) return
    if (this.state.space.down) { this.startPan(e, 'space'); return }
    this.press(e)
  }

  private startPan(e: Extract<CanvasEvent, { type: 'pointerdown' }>, via: 'space' | 'middle'): void {
    this.effect({ kind: 'capturePointer', pointerId: e.pointerId })
    if (via === 'space') this.set({ space: { down: true, panned: true } })
    this.mode({ kind: 'panning', pointerId: e.pointerId, origin: e.at, cameraAtStart: this.camera, via })
    this.handled = true
  }

  private startPinch(): void {
    const [a, b] = this.state.pointers as [PointerPoint, PointerPoint]
    this.release(this.state.mode, 'cancelled')
    this.effect({ kind: 'capturePointer', pointerId: a.id })
    this.effect({ kind: 'capturePointer', pointerId: b.id })
    this.mode({ kind: 'pinching', a, b, startMid: midpoint(a.at, b.at), startDist: Math.max(1, distance(a.at, b.at)), cameraAtStart: this.camera })
  }

  private pinchMove(m: Extract<CanvasMode, { kind: 'pinching' }>, e: Extract<CanvasEvent, { type: 'pointermove' }>): void {
    const a = e.pointerId === m.a.id ? { ...m.a, at: e.at } : m.a
    const b = e.pointerId === m.b.id ? { ...m.b, at: e.at } : m.b
    const zoom = clampZoom(m.cameraAtStart.zoom * Math.max(1, distance(a.at, b.at)) / m.startDist)
    const under = toScene(m.cameraAtStart, m.startMid)
    const mid = midpoint(a.at, b.at)
    this.setCamera({ x: mid.x / zoom - under.x, y: mid.y / zoom - under.y, zoom })
    this.mode({ ...m, a, b })
  }

  /** Where a press on a real card leaves the selection. */
  private pressSelection(key: FileKey, mods: Modifiers): FileKey[] {
    const order = this.order()
    const selected = this.sel.filter((k) => this.real(k))
    if (hasMod(mods) && !mods.shift) {
      this.setAnchor(key)
      return selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]
    }
    if (mods.shift) {
      const anchor = this.state.anchor && order.includes(this.state.anchor) ? this.state.anchor
        : this.focus && order.includes(this.focus) ? this.focus : selected[0] ?? key
      if (!this.state.anchor) this.setAnchor(anchor)
      const [i, j] = [order.indexOf(anchor), order.indexOf(key)]
      const range = order.slice(Math.min(i, j), Math.max(i, j) + 1)
      return hasMod(mods) ? [...selected, ...range] : range
    }
    this.setAnchor(key)
    return selected.includes(key) ? selected : [key]
  }

  private press(e: Extract<CanvasEvent, { type: 'pointerdown' }>): void {
    const t = e.target
    const base = { pointerId: e.pointerId, origin: e.at, originScene: this.scenePoint(e.at), mods: e.mods, t0: e.t, moved: false }
    if (t.kind === 'handle') {
      if (!this.real(t.key) || !this.caps.connect) return
      this.effect({ kind: 'capturePointer', pointerId: e.pointerId })
      this.mode({ kind: 'pressing', ...base, target: t, selectionAfter: this.sel, wasSoleSelected: false, primed: null })
      this.handled = true
      return
    }
    if (t.kind === 'card' || t.kind === 'label') {
      const card = this.card(t.key)
      if (!card || card.role === 'draft') return
      this.effect({ kind: 'capturePointer', pointerId: e.pointerId })
      this.handled = true
      if (card.role === 'ghost') { this.mode({ kind: 'pressing', ...base, target: t, selectionAfter: this.sel, wasSoleSelected: false, primed: null }); return }
      const wasSole = this.sel.length === 1 && this.sel[0] === card.key
      this.select(this.pressSelection(card.key, e.mods))
      this.setFocus(card.key)
      // A press that could become a drag opens the engine's drag state now, so the first move that makes it one is snapped against it.
      const draggable = this.draggable(card, this.sel)
      if (draggable) this.effect({ kind: 'prepareDrag', files: draggable })
      this.mode({ kind: 'pressing', ...base, target: t, selectionAfter: this.sel, wasSoleSelected: wasSole, primed: draggable })
      return
    }
    // The room around the work. Nothing changes until the press becomes a marquee, or a click completes.
    this.effect({ kind: 'capturePointer', pointerId: e.pointerId })
    this.mode({ kind: 'pressing', ...base, target: { kind: 'background' }, selectionAfter: this.sel, wasSoleSelected: false, primed: null })
    this.handled = true
  }

  private pointerMove(e: Extract<CanvasEvent, { type: 'pointermove' }>): void {
    if (this.state.pointers.some((p) => p.id === e.pointerId)) {
      this.set({ pointers: this.state.pointers.map((p) => (p.id === e.pointerId ? { id: p.id, at: e.at } : p)) })
    }
    const m = this.state.mode
    switch (m.kind) {
      case 'pinching':
        if (e.pointerId === m.a.id || e.pointerId === m.b.id) { this.pinchMove(m, e); this.handled = true }
        return
      case 'pressing':
        if (e.pointerId !== m.pointerId) return
        this.handled = true
        if (!m.moved && distance(e.at, m.origin) > DRAG_THRESHOLD) this.startMove(m, e)
        return
      case 'marquee':
        if (e.pointerId !== m.pointerId) return
        this.mode({ ...m, current: e.at })
        this.marqueeSelect()
        this.handled = true
        return
      case 'dragging':
        if (e.pointerId !== m.pointerId) return
        this.drag(m, e)
        this.handled = true
        return
      case 'panning':
        if (e.pointerId !== m.pointerId) return
        this.setCamera(panByViewport(m.cameraAtStart, { x: e.at.x - m.origin.x, y: e.at.y - m.origin.y }))
        this.handled = true
        return
      case 'connecting':
        if (m.via !== 'pointer' || e.pointerId !== m.pointerId) return
        this.mode({ ...m, current: e.at, candidate: this.cardUnder(e.at, m.source) })
        this.handled = true
        return
      default: return
    }
  }

  /** A press has moved far enough to be something else. `e` is the move that took it there, or the release that did (see `pointerUp`). */
  private startMove(m: Extract<CanvasMode, { kind: 'pressing' }>, e: { readonly at: Pt; readonly mods: Modifiers; readonly external?: ExternalTarget | null }): void {
    const t = m.target
    if (t.kind === 'handle') {
      this.mode({ kind: 'connecting', source: t.key, via: 'pointer', pointerId: m.pointerId, current: e.at, candidate: this.cardUnder(e.at, t.key) })
      return
    }
    if (t.kind === 'background' || t.kind === 'connector') {
      const additive = m.mods.shift || hasMod(m.mods)
      this.mode({ kind: 'marquee', pointerId: m.pointerId, origin: m.origin, current: e.at, additive, anchorSelection: additive ? this.sel.filter((k) => this.real(k)) : [] })
      this.marqueeSelect()
      return
    }
    const card = this.card(t.key)
    // The set that moves: the selection as the press left it, without any card that is locked (Law 5).
    const files = card ? this.draggable(card, m.selectionAfter) : null
    if (files) {
      const start: Dragging = { kind: 'dragging', pointerId: m.pointerId, files, origin: m.origin, originScene: m.originScene,
        delta: { x: 0, y: 0 }, snapped: { delta: { x: 0, y: 0 }, guides: [] }, dropTarget: null, external: null }
      // The engine was primed at the press; if the set that moves is not the one it was primed for, it is primed again.
      if (!m.primed || !sameKeys(m.primed, files)) this.effect({ kind: 'prepareDrag', files })
      this.drag(start, e)
      return
    }
    if (m.primed) this.effect({ kind: 'releaseDrag' })
    this.mode({ ...m, moved: true, primed: null })
  }

  /** The cards a press on `card` drags, in reading order, when it is moved: the selection as the press left it, minus the locked; null when it cannot drag. */
  private draggable(card: SceneCard, selectionAfter: readonly FileKey[]): readonly FileKey[] | null {
    if (card.role !== 'real' || card.locked || !(this.caps.place || this.caps.move) || !selectionAfter.includes(card.key)) return null
    return this.order().filter((k) => selectionAfter.includes(k) && !this.real(k)!.locked)
  }

  private drag(d: Dragging, e: { readonly at: Pt; readonly mods: Modifiers; readonly external?: ExternalTarget | null }): Dragging {
    const now = this.scenePoint(e.at)
    const raw = { x: now.x - d.originScene.x, y: now.y - d.originScene.y }
    const inside = this.inside(e.at)
    const { engine, scene } = this.ctx
    // Alt turns snapping off (Finder's convention).
    const snapped: SnapResult = e.mods.alt ? { delta: raw, guides: [] } : engine.snap(scene, d.files, raw, { threshold: SNAP_THRESHOLD_PX / this.camera.zoom })
    const next: Dragging = { ...d, delta: raw, snapped,
      dropTarget: this.caps.move && inside ? engine.dropTarget(scene, d.files, now) : null,
      external: this.caps.move && !inside ? e.external ?? null : null }
    this.mode(next)
    return next
  }

  private marqueeSelect(): void {
    const m = this.state.mode
    if (m.kind !== 'marquee') return
    const rect = rectFromPoints(this.scenePoint(m.origin), this.scenePoint(m.current))
    const hits = this.ctx.engine.hitRect(this.ctx.scene, rect, 'intersect').filter((k) => this.real(k))
    this.select(m.additive ? [...m.anchorSelection, ...hits] : hits)
  }

  /** The real card under a viewport point, other than `except`. */
  private cardUnder(at: Pt, except: FileKey): FileKey | null {
    if (!this.inside(at)) return null
    const p = this.scenePoint(at)
    const cards = this.ctx.scene.cards
    for (let i = cards.length - 1; i >= 0; i--) {
      const c = cards[i]!
      if (c.role === 'real' && c.key !== except && rectContainsPoint(c.rect, p)) return c.key
    }
    return null
  }

  private pointerUp(e: Extract<CanvasEvent, { type: 'pointerup' }>): void {
    this.set({ pointers: this.state.pointers.filter((p) => p.id !== e.pointerId) })
    const m = this.state.mode
    switch (m.kind) {
      case 'pinching':
        if (e.pointerId === m.a.id || e.pointerId === m.b.id) { this.abort(); this.handled = true }
        return
      case 'pressing': {
        if (e.pointerId !== m.pointerId) return
        this.handled = true
        let press = m
        // The release has a position of its own. A pointer that got far while no move was delivered (moves are coalesced) was dragging,
        // sweeping or connecting all along: it becomes that gesture, and the release finishes it where it is.
        if (!m.moved && distance(e.at, m.origin) > DRAG_THRESHOLD) {
          this.startMove(m, e)
          const now = this.state.mode
          if (now.kind !== 'pressing') { this.pointerUp(e); return }
          press = now
        }
        if (press.primed) this.effect({ kind: 'releaseDrag' })
        this.effect({ kind: 'releasePointer', pointerId: press.pointerId })
        this.mode({ kind: 'idle' })
        if (!press.moved) this.click(press)
        return
      }
      case 'marquee':
        if (e.pointerId !== m.pointerId) return
        this.handled = true
        // The rectangle ends where the pointer was let go, which may be ahead of the last move that was delivered.
        this.mode({ ...m, current: e.at })
        this.marqueeSelect()
        this.effect({ kind: 'releasePointer', pointerId: m.pointerId })
        this.mode({ kind: 'idle' })
        return
      case 'panning':
        if (e.pointerId !== m.pointerId) return
        this.handled = true
        this.setCamera(panByViewport(m.cameraAtStart, { x: e.at.x - m.origin.x, y: e.at.y - m.origin.y }))
        this.effect({ kind: 'releasePointer', pointerId: m.pointerId })
        this.mode({ kind: 'idle' })
        return
      case 'dragging':
        if (e.pointerId === m.pointerId) { this.handled = true; this.dropDrag(m, e) }
        return
      case 'connecting':
        if (m.via !== 'pointer' || e.pointerId !== m.pointerId) return
        this.handled = true
        this.effect({ kind: 'releasePointer', pointerId: m.pointerId })
        {
          const target = this.cardUnder(e.at, m.source)
          if (target) {
            this.effect({ kind: 'openRelationPicker', at: e.at, source: m.source, target })
            this.mode({ kind: 'picking', source: m.source, target })
          } else this.mode({ kind: 'idle' })
        }
        return
      default: return
    }
  }

  /** A press and release without moving: select (already done), open, name, choose, or clear. */
  private click(m: Extract<CanvasMode, { kind: 'pressing' }>): void {
    const t = m.target
    const plain = !m.mods.shift && !hasMod(m.mods)
    if (t.kind === 'background' || t.kind === 'connector') {
      this.set({ lastClick: null })
      if (plain && this.sel.length) this.select([])
      return
    }
    if (t.kind === 'handle') return
    const card = this.card(t.key)
    if (!card) return
    if (card.role === 'ghost') {
      if (this.caps.place && card.ghost && card.ref) this.emit({ kind: 'choose-placement', file: card.ref, candidateId: card.ghost.candidateId })
      return
    }
    if (card.role !== 'real') return
    if (!plain) { this.set({ lastClick: null }); return }
    // A click that is not a drag lets go of the rest of a multi-selection.
    if (m.selectionAfter.length > 1 && m.selectionAfter.includes(card.key)) this.select([card.key])
    const last = this.state.lastClick
    if (last && last.key === card.key) {
      const dt = m.t0 - last.downT
      if (dt <= DOUBLE_CLICK_MS) { this.emit({ kind: 'open', file: card.ref! }); this.set({ lastClick: null }); return }
      if (t.kind === 'label' && m.wasSoleSelected && dt >= NAME_CLICK_MIN_MS && dt <= NAME_CLICK_MAX_MS && this.caps.rename) {
        this.set({ lastClick: null })
        this.startNaming(card.key)
        return
      }
    }
    this.set({ lastClick: { key: card.key, downT: m.t0 } })
  }

  private dropDrag(m: Dragging, e: Extract<CanvasEvent, { type: 'pointerup' }>): void {
    this.effect({ kind: 'releasePointer', pointerId: m.pointerId })
    // The release has a position of its own, which may be ahead of the last move that was coalesced.
    const d = this.drag(m, e)
    this.effect({ kind: 'releaseDrag' })
    this.mode({ kind: 'idle' })
    const finish = (outcome: 'committed' | 'cancelled') => this.effect({ kind: 'endDrag', outcome })
    const refs = this.refs(d.files)
    if (d.dropTarget) {
      const folder = this.real(d.dropTarget)?.ref
      if (folder && this.caps.move) { this.emit({ kind: 'move', files: refs, folder }); finish('committed'); return }
      finish('cancelled'); return
    }
    if (d.external) {
      const folder = d.external.folder
      const viewed = viewedFolder(this.ctx.scope)
      const same = folder === null ? viewed === null : viewed !== null && fileKey(viewed) === fileKey(folder)
      if (this.caps.move && !same && (folder === null || sameWorkspaceFolder(folder, refs))) { this.emit({ kind: 'move', files: refs, folder }); finish('committed'); return }
      finish('cancelled'); return
    }
    if (!this.inside(e.at) || !this.caps.place) { finish('cancelled'); return }
    const records = d.files.map((k) => {
      const c = this.real(k)!
      return { schemaVersion: 1 as const, scope: this.ctx.scope, file: c.ref!, coordinateSpace: 'folder-canvas' as const,
        x: Math.round(c.rect.x + d.snapped.delta.x), y: Math.round(c.rect.y + d.snapped.delta.y) }
    })
    if (records.every((r, i) => { const c = this.real(d.files[i]!)!; return r.x === c.rect.x && r.y === c.rect.y })) { finish('cancelled'); return }
    this.emit({ kind: 'place', placements: records, previous: this.standing(d.files) })
    finish('committed')
  }

  private pointerCancel(id: number): void {
    this.set({ pointers: this.state.pointers.filter((p) => p.id !== id) })
    const m = this.state.mode
    const mine = m.kind === 'pinching' ? m.a.id === id || m.b.id === id
      : m.kind === 'pressing' || m.kind === 'marquee' || m.kind === 'dragging' || m.kind === 'panning' || m.kind === 'connecting' ? m.pointerId === id : false
    if (mine) { this.abort(); this.handled = true }
  }

  private longPress(id: number): void {
    const m = this.state.mode
    if (m.kind !== 'pressing' || m.pointerId !== id || m.moved) return
    if (m.primed) this.effect({ kind: 'releaseDrag' })
    this.effect({ kind: 'releasePointer', pointerId: id })
    this.openMenuFor(m.origin, m.target)
  }

  private blur(): void {
    const m = this.state.mode
    if (m.kind === 'osdrag') this.mode({ kind: 'idle' })
    else if (m.kind !== 'menu' && m.kind !== 'picking' && m.kind !== 'idle' && !(m.kind === 'connecting' && m.via === 'keyboard')) this.abort()
    this.set({ space: { down: false, panned: false }, pointers: [] })
  }

  // --- menus -----------------------------------------------------------------------------------------------

  private contextMenu(e: Extract<CanvasEvent, { type: 'contextmenu' }>): void {
    if (this.state.naming) this.commitNaming()
    this.handled = true
    if (this.gesturePointer() !== null) return
    this.openMenuFor(e.at, e.target)
  }

  private openMenuFor(at: Pt, target: PointerTarget): void {
    if (target.kind === 'card' || target.kind === 'label' || target.kind === 'handle') {
      const card = this.card(target.key)
      this.handled = true
      if (card?.role !== 'real') { this.mode({ kind: 'idle' }); return }    // ghosts and drafts have no menu
      if (!this.sel.includes(card.key)) { this.select([card.key]); this.setAnchor(card.key) }
      this.setFocus(card.key, false)
      this.showMenu(at, this.sel.filter((k) => this.real(k)))
      return
    }
    if (this.sel.length) this.select([])
    this.showMenu(at, [])
  }

  private showMenu(at: Pt, files: readonly FileKey[]): void {
    const { viewport } = this.ctx
    this.emit({ kind: 'menu', files: this.refs(files), clientX: viewport.x + at.x, clientY: viewport.y + at.y, at: this.scenePoint(at) })
    this.mode({ kind: 'menu', files, anchor: at })
    this.effect({ kind: 'openMenu', anchor: at, files })
    this.handled = true
  }

  // --- wheel, drag of files from the OS --------------------------------------------------------------------

  private wheel(e: Extract<CanvasEvent, { type: 'wheel' }>): void {
    this.setCamera(hasMod(e.mods)
      ? zoomAbout(this.camera, e.at, WHEEL_ZOOM_PER_100 ** (-e.deltaY / 100))
      : panByViewport(this.camera, { x: -e.deltaX, y: -e.deltaY }))
    this.handled = true
  }

  private dragOver(e: Extract<CanvasEvent, { type: 'dragover' }>): void {
    const kind = this.state.mode.kind
    if (!this.caps.add || (kind !== 'idle' && kind !== 'osdrag')) return
    this.mode({ kind: 'osdrag', at: e.at, dropTarget: this.ctx.engine.dropTarget(this.ctx.scene, [], this.scenePoint(e.at)) })
    this.handled = true
  }

  private drop(e: Extract<CanvasEvent, { type: 'drop' }>): void {
    if (this.state.mode.kind === 'osdrag') this.mode({ kind: 'idle' })
    if (!this.caps.add || this.state.mode.kind !== 'idle') return
    this.handled = true
    if (e.files.length === 0) return
    const at = this.scenePoint(e.at)
    const target = this.real(this.ctx.engine.dropTarget(this.ctx.scene, [], at))
    // Law 6: an add, into the folder under the pointer or the viewed folder; never a place, never a move.
    this.emit(target
      ? { kind: 'add', files: e.files, folder: target.ref! }
      : { kind: 'add', files: e.files, folder: viewedFolder(this.ctx.scope), placement: { x: Math.round(at.x), y: Math.round(at.y) } })
  }

  // --- naming events ---------------------------------------------------------------------------------------

  private nameCancel(): void {
    if (!this.state.naming) return
    this.handled = true
    this.emit({ kind: 'name-cancel' })
    this.endNaming()
  }

  // --- connect ---------------------------------------------------------------------------------------------

  private handleActivate(key: FileKey): void {
    if (!this.caps.connect || this.state.mode.kind !== 'idle' || this.state.naming || !this.real(key)) return
    this.handled = true
    this.mode({ kind: 'connecting', source: key, via: 'keyboard', pointerId: null, current: null, candidate: null })
  }

  private connectKey(m: Extract<CanvasMode, { kind: 'connecting' }>, e: Extract<CanvasEvent, { type: 'keydown' }>): void {
    const dir = ARROWS[e.key]
    if (dir) {
      this.handled = true
      let from = m.candidate ?? m.source
      for (let i = 0; i < 3; i++) {
        const n = this.ctx.engine.spatialNeighbor(this.ctx.scene, from, dir)
        if (!n) break
        if (n !== m.source && this.real(n)) { this.mode({ ...m, candidate: n }); break }
        from = n
      }
    } else if (e.key === 'Enter') {
      this.handled = true
      const target = this.real(m.candidate)
      if (!target) return
      this.effect({ kind: 'openRelationPicker', at: toViewport(this.camera, rectCenter(target.rect)), source: m.source, target: target.key })
      this.mode({ kind: 'picking', source: m.source, target: target.key })
    } else if (e.key === 'Escape') {
      this.handled = true
      this.mode({ kind: 'idle' })
      this.setFocus(m.source)
    }
  }

  private relationPicked(e: Extract<CanvasEvent, { type: 'relation-picked' }>): void {
    const m = this.state.mode
    if (m.kind !== 'picking') return
    const source = this.real(m.source), target = this.real(m.target)
    this.mode({ kind: 'idle' })
    if (!source || !target || !this.caps.connect) return
    this.handled = true
    this.emit({ kind: 'connect', source: source.ref!, target: target.ref!, relation: e.relation, ...(e.label !== undefined ? { label: e.label } : {}) })
    this.setFocus(m.source)
  }

  // --- commands from the host's own chrome -----------------------------------------------------------------

  private command(c: Extract<CanvasEvent, { type: 'command' }>['command']): void {
    switch (c) {
      case 'tidy': this.tidy(); return
      case 'reset-view': this.resetView(); return
      case 'zoom-in': this.zoomStep(KEY_ZOOM); return
      case 'zoom-out': this.zoomStep(1 / KEY_ZOOM); return
      case 'new-folder': if (this.caps.create) this.requestFolder(); return
    }
  }

  /** Lay the cards out in reading order on the lattice, as wide as the pane; one record per card that moves. */
  private tidy(): void {
    if (!this.caps.place) return
    this.handled = true
    const { scene, engine, viewport } = this.ctx
    const columns = Math.max(1, Math.floor((viewport.w / this.camera.zoom - CARD_GAP) / (scene.cardSize.w + CARD_GAP)))
    const spots = engine.tidy(scene, { origin: { x: CARD_GAP, y: CARD_GAP }, gap: CARD_GAP, columns })
    const records = this.order().flatMap((k) => {
      const c = this.real(k)!
      const at = spots.get(k)
      if (!at || c.locked) return []
      const x = Math.round(at.x), y = Math.round(at.y)
      return x === c.rect.x && y === c.rect.y ? []
        : [{ schemaVersion: 1 as const, scope: this.ctx.scope, file: c.ref!, coordinateSpace: 'folder-canvas' as const, x, y }]
    })
    if (records.length) this.emit({ kind: 'place', placements: records, previous: this.standing(records.map(r => fileKey(r.file))) })
  }

  private resetView(): void {
    const bounds = this.ctx.engine.bounds(this.ctx.scene)
    this.setCamera(bounds ? this.ctx.engine.fitCamera(bounds, this.size(), FIT_INSET, FIT_ZOOM_MAX) : IDENTITY_CAMERA)
    this.handled = true
  }

  private zoomStep(factor: number): void {
    this.setCamera(zoomAbout(this.camera, { x: this.ctx.viewport.w / 2, y: this.ctx.viewport.h / 2 }, factor))
    this.handled = true
  }

  /**
   * Create where you look: the first free cell wholly inside what is visible. When the visible part is full, the free cell that needs
   * the smallest pan; the naming that follows reveals it (`reveal`) by that pan.
   */
  private requestFolder(): void {
    const { w, h } = this.size()
    const topLeft = toScene(this.camera, { x: 0, y: 0 })
    const visible = { x: topLeft.x, y: topLeft.y, w: w / this.camera.zoom, h: h / this.camera.zoom }
    const slot = this.ctx.engine.nextFreeSlot(this.ctx.scene, null, CARD_GAP, visible)
    this.emit({ kind: 'new-folder', placement: { x: slot.x, y: slot.y } })
    this.handled = true
  }

  // --- keyboard --------------------------------------------------------------------------------------------

  private keyDown(e: Extract<CanvasEvent, { type: 'keydown' }>): void {
    if (this.state.naming) return                                  // the input owns the keystrokes
    const m = this.state.mode
    const gesture = m.kind === 'pressing' || m.kind === 'marquee' || m.kind === 'dragging' || m.kind === 'panning' || m.kind === 'pinching'
      || (m.kind === 'connecting' && m.via === 'pointer')
    if (gesture) { if (e.key === 'Escape') { this.abort(); this.handled = true } return }
    if (m.kind === 'picking') {
      if (e.key === 'Escape') { this.mode({ kind: 'idle' }); this.setFocus(m.source); this.handled = true }
      return
    }
    if (m.kind === 'connecting') { this.connectKey(m, e); return }
    if (m.kind === 'menu' || m.kind === 'osdrag') return
    this.idleKey(e)
  }

  private idleKey(e: Extract<CanvasEvent, { type: 'keydown' }>): void {
    const { key, mods } = e
    const command = hasMod(mods)
    if (key === ' ' && !command && !mods.alt) {
      if (!e.repeat) this.set({ space: { down: true, panned: false } })
      this.handled = true
      return
    }
    if (command && !mods.alt) { this.chord(key.length === 1 ? key.toLowerCase() : key, mods); return }
    if (command) return
    if (mods.alt) {
      const dir = ARROWS[key]
      if (dir) { this.nudge(dir, mods.shift); return }
      if (key === 'Enter') { this.openFocused(true); return }
      return
    }
    const dir = ARROWS[key]
    if (dir) { this.navigate(dir, mods.shift); return }
    switch (key) {
      case 'Home': case 'End': this.edge(key === 'Home', mods.shift); return
      case 'Enter': this.openFocused(false); return
      case 'Escape': this.escape(); return
      case 'F2': this.rename(); return
      case 'Delete': case 'Backspace': this.removeSelected(); return
      case 'ContextMenu': this.keyMenu(); return
      case 'F10': if (mods.shift) this.keyMenu(); return
      default: return
    }
  }

  private keyUp(e: Extract<CanvasEvent, { type: 'keyup' }>): void {
    if (e.key !== ' ') return
    const space = this.state.space
    this.set({ space: { down: false, panned: false } })
    if (!space.down) return
    this.handled = true
    // Space let go without a pan is the listbox's "toggle the focused option".
    if (space.panned || this.state.mode.kind !== 'idle' || this.state.naming) return
    const card = this.real(this.focus)
    if (!card) return
    this.select(this.sel.includes(card.key) ? this.sel.filter((k) => k !== card.key) : [...this.sel, card.key])
    this.setAnchor(card.key)
  }

  private chord(lower: string, mods: Modifiers): void {
    switch (lower) {
      case 'a': this.select(this.order()); this.handled = true; return
      case 'x': this.cut(); return
      case 'v': this.paste(); return
      case 'z': if (canEdit(this.caps)) { this.emit({ kind: mods.shift ? 'redo' : 'undo' }); this.handled = true } return
      case 'y': if (canEdit(this.caps)) { this.emit({ kind: 'redo' }); this.handled = true } return
      case 'n': if (mods.shift && this.caps.create) this.requestFolder(); return
      case '0': this.resetView(); return
      case '=': case '+': this.zoomStep(KEY_ZOOM); return
      case '-': case '_': this.zoomStep(1 / KEY_ZOOM); return
      default: return
    }
  }

  private navigate(dir: Direction, extend: boolean): void {
    const { scene, engine } = this.ctx
    const all = engine.readingOrder(scene)
    if (!all.length) return
    this.handled = true
    const selected = this.order().filter((k) => this.sel.includes(k))
    const current = this.focus && this.card(this.focus) ? this.focus : selected[0] ?? null
    const next = current ? engine.spatialNeighbor(scene, current, dir) : all[0]!
    if (!next) return                                               // the edge of the layout: stay
    this.moveFocus(next, extend ? current : undefined)
  }

  private edge(first: boolean, extend: boolean): void {
    const all = this.ctx.engine.readingOrder(this.ctx.scene)
    if (!all.length) return
    this.handled = true
    this.moveFocus(first ? all[0]! : all[all.length - 1]!, extend ? this.focus : undefined)
  }

  /** Focus moves and the card is brought into view; with `from`, the selection is extended from the anchor to it. */
  private moveFocus(key: FileKey, from?: FileKey | null): void {
    const card = this.card(key)
    if (!card) return
    this.setFocus(key)
    this.reveal(card)
    if (from === undefined || card.role !== 'real') return
    const order = this.order()
    const anchor = this.state.anchor && order.includes(this.state.anchor) ? this.state.anchor : from && order.includes(from) ? from : key
    this.setAnchor(anchor)
    const [i, j] = [order.indexOf(anchor), order.indexOf(key)]
    this.select(order.slice(Math.min(i, j), Math.max(i, j) + 1))
  }

  private escape(): void {
    this.handled = true
    if (this.ctx.cut.length) { this.session.cut = []; return }
    if (this.sel.length) { this.select([]); return }
    this.effect({ kind: 'focusHeader' })
  }

  private rename(): void {
    if (!this.caps.rename) return
    this.handled = true
    const target = this.real(this.focus) ? this.focus : this.sel.length === 1 ? this.sel[0]! : null
    if (target) this.startNaming(target)
  }

  private removeSelected(): void {
    if (!this.caps.remove) return
    this.handled = true
    const keys = this.order().filter((k) => this.sel.includes(k))
    if (keys.length) this.emit({ kind: 'remove', files: this.refs(keys) })
  }

  private openFocused(beside: boolean): void {
    if (beside && !this.caps.openBeside) return
    const key = this.card(this.focus) ? this.focus : this.sel.length === 1 ? this.sel[0]! : null
    const card = this.card(key)
    if (!card) return
    if (card.role === 'real') {
      this.emit(beside ? { kind: 'open', file: card.ref!, beside: true } : { kind: 'open', file: card.ref! })
      this.handled = true
    } else if (card.role === 'ghost' && !beside && this.caps.place && card.ghost && card.ref) {
      this.emit({ kind: 'choose-placement', file: card.ref, candidateId: card.ghost.candidateId })
      this.handled = true
    }
  }

  private nudge(dir: Direction, large: boolean): void {
    if (!this.caps.place) return
    this.handled = true
    const unlocked = (k: FileKey) => { const c = this.real(k); return c !== null && !c.locked }
    let keys = this.order().filter((k) => this.sel.includes(k) && unlocked(k))
    if (this.sel.length === 0 && this.focus && unlocked(this.focus)) keys = [this.focus]
    if (!keys.length) return
    const step = large ? NUDGE_STEP_LARGE : NUDGE_STEP
    this.emit({ kind: 'place', previous: this.standing(keys), placements: keys.map((k) => {
      const c = this.real(k)!
      return { schemaVersion: 1 as const, scope: this.ctx.scope, file: c.ref!, coordinateSpace: 'folder-canvas' as const,
        x: Math.round(c.rect.x + NUDGE[dir].x * step), y: Math.round(c.rect.y + NUDGE[dir].y * step) }
    }) })
  }

  /** Where these cards stand now, as placement records (an auto-slotted card at its slot): what an undo puts back. */
  private standing(keys: readonly FileKey[]): FilePlacementRecord[] {
    return keys.map((k) => {
      const c = this.real(k)!
      return { schemaVersion: 1 as const, scope: this.ctx.scope, file: c.ref!, coordinateSpace: 'folder-canvas' as const, x: Math.round(c.rect.x), y: Math.round(c.rect.y) }
    })
  }

  private cut(): void {
    if (!this.caps.move) return
    this.handled = true
    const keys = this.order().filter((k) => this.sel.includes(k))
    if (keys.length) this.session.cut = this.refs(keys)
  }

  private paste(): void {
    if (!this.caps.move || !this.ctx.cut.length) return
    this.handled = true
    const here = new Set(this.order())
    const files = this.ctx.cut.filter((f) => !here.has(fileKey(f)))
    this.session.cut = []
    if (files.length) this.emit({ kind: 'move', files, folder: viewedFolder(this.ctx.scope) })
  }

  private keyMenu(): void {
    const key = this.real(this.focus) ? this.focus : this.sel.find((k) => this.real(k)) ?? null
    const card = this.real(key)
    if (!card) return
    if (!this.sel.includes(card.key)) { this.select([card.key]); this.setAnchor(card.key) }
    this.showMenu(toViewport(this.camera, rectCenter(card.rect)), this.sel.filter((k) => this.real(k)))
  }
}

type Dragging = Extract<CanvasMode, { kind: 'dragging' }>

/** One menu for every face: the verbs that apply, one label each. The keys and gestures use the same capabilities. */
export function menuVerbs(
  capabilities: FileCanvasCapabilities,
  subject: { readonly kind: 'item'; readonly folder: boolean } | { readonly kind: 'background'; readonly pasteable: boolean },
): readonly MenuVerb[] {
  const out: MenuVerb[] = []
  const offer = (verb: Verb, label: string, allowed = true) => { if (allowed) out.push({ verb, label }) }
  if (subject.kind === 'item') {
    offer('open', 'Open')
    offer('open-beside', 'Open beside', capabilities.openBeside)
    offer('rename', 'Rename', capabilities.rename)
    offer('move-to', 'Move to…', capabilities.move)
    offer('connect', 'Connect…', capabilities.connect)
    offer('remove', 'Remove', capabilities.remove)
    if (subject.folder) offer('new-folder-inside', 'New folder inside', capabilities.create)
  } else {
    offer('add', 'Add PDFs…', capabilities.add)
    offer('new-folder', 'New folder', capabilities.create)
    offer('paste', 'Paste', capabilities.move && subject.pasteable)
    offer('tidy', 'Tidy up', capabilities.place)
    offer('view', 'View as list')
  }
  return out
}
