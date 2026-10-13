/**
 * The host, in memory: what the DOM binding does, minus the DOM. It owns the camera and the focus (the
 * session the shell does not give the canvas), builds one scene per event from the shell's input, calls
 * `reduce`, applies the session patch, runs the engine effects (the host's job: `runEngineEffects`), hands every
 * intent to the shell, and keeps a log. Each helper is one thing a person does with a pointer or a key, so a law
 * reads as the gesture that breaks it.
 */
import { fileKey, type FileCanvasIntent, type FileKey } from '../../../folder-view-contract.js'
import type { SceneCard, SceneSnapshot } from '../../engine-port.js'
import type { CanvasEngine } from '../../engine-port.js'
import { houseEngine } from '../../engine-house.js'
import { rectCenter, toViewport, type Camera, type Pt } from '../../geometry.js'
import {
  NO_MODS, focusKey, initialState, reduce, runEngineEffects, toShellPatch, type CanvasContext, type CanvasEffect, type CanvasEvent, type CanvasMode, type CanvasState, type CanvasStep, type Modifiers,
  type PointerKind, type PointerTarget,
} from '../../interaction.js'
import { createSceneBuilder } from '../../scene.js'
import { ShellSim } from './shell-sim.js'

export const mods = (over: Partial<Modifiers> = {}): Modifiers => ({ ...NO_MODS, ...over })
export const MOD = mods({ meta: true })
export const SHIFT = mods({ shift: true })
export const ALT = mods({ alt: true })

export interface StepInfo {
  readonly event: CanvasEvent
  readonly before: CanvasState
  readonly ctx: CanvasContext
  readonly step: CanvasStep
}

export interface HarnessOptions {
  readonly sim?: ShellSim
  readonly camera?: Camera
  readonly viewport?: { x: number; y: number; w: number; h: number }
  readonly epoch?: string
  readonly engine?: CanvasEngine
  /**
   * The host as it is with a real shell: the focus the reducer asks for goes to the shell as the file it stands for (`toShellPatch`) and comes
   * back through the session it echoes (`focusKey`), instead of being kept as the card key it was.
   */
  readonly echoFocus?: boolean
}

export class Harness {
  readonly sim: ShellSim
  state: CanvasState
  camera: Camera
  focused: FileKey | null = null
  viewport: { x: number; y: number; w: number; h: number }
  epoch: string
  engine: CanvasEngine
  readonly echoFocus: boolean
  clock = 1000
  readonly builder = createSceneBuilder()
  readonly intents: FileCanvasIntent[] = []
  readonly effects: CanvasEffect[] = []
  readonly steps: CanvasStep[] = []
  /** Every state the reducer returned, for assertions about what a sequence passed through. */
  readonly states: CanvasState[] = []
  /**
   * Called after every event with what the reducer was given and what it returned, before the step's effects have run on the engine:
   * the engine is in the state the reducer saw, so an observer may evaluate `reduce` again on the same triple.
   */
  readonly observers: ((info: StepInfo) => void)[] = []
  /** Called after every event once the engine effects have run and the intents have been applied: what the world is left as. */
  readonly afterEffects: ((info: StepInfo) => void)[] = []
  private pointerId = 1

  constructor(opts: HarnessOptions = {}) {
    this.sim = opts.sim ?? new ShellSim()
    this.camera = opts.camera ?? { x: 0, y: 0, zoom: 1 }
    this.viewport = opts.viewport ?? { x: 0, y: 0, w: 1024, h: 768 }
    this.epoch = opts.epoch ?? 'epoch-1'
    this.engine = opts.engine ?? houseEngine
    this.echoFocus = opts.echoFocus ?? false
    this.state = initialState(this.epoch)
  }

  scene(): SceneSnapshot {
    return this.builder.build(this.sim.input({ camera: this.camera, focused: null }))
  }

  ctx(scene = this.scene()): CanvasContext {
    return {
      epoch: this.epoch, scope: this.sim.scope(), scene, camera: this.camera, viewport: this.viewport,
      selection: this.sim.selection, focused: this.focused, capabilities: this.sim.capabilities, engine: this.engine,
      naming: this.sim.naming, cut: this.sim.cut,
    }
  }

  /** One event: reduce, apply the session patch, hand the intents to the shell. */
  send(event: CanvasEvent): CanvasStep {
    const scene = this.scene()
    this.sim.scene = scene
    const before = this.state
    const ctx = this.ctx(scene)
    const step = reduce(before, event, ctx)
    this.state = step.state
    this.steps.push(step)
    this.states.push(step.state)
    this.effects.push(...step.effects)
    if (step.session.camera) this.camera = step.session.camera
    if (step.session.focused !== undefined) {
      this.focused = step.session.focused
      if (this.echoFocus) this.focused = focusKey({ focused: toShellPatch({ focused: step.session.focused }, scene).focused ?? null }, step.session.focused, scene)
    }
    if (step.session.cut) this.sim.cut = [...step.session.cut]
    const info = { event, before, ctx, step }
    for (const observe of this.observers) observe(info)
    runEngineEffects(step.effects, this.engine, scene)
    for (const intent of step.intents) { this.intents.push(intent); this.sim.apply(intent) }
    for (const observe of this.afterEffects) observe(info)
    return step
  }

  /** What the reducer would answer to `event` now, without applying anything: no state kept, no effect run, no intent applied. */
  evaluate(event: CanvasEvent): CanvasStep {
    return reduce(this.state, event, this.ctx())
  }

  tick(ms: number): void { this.clock += ms }
  private advance(ms: number): number { this.clock += ms; return this.clock }

  // --- finding things ------------------------------------------------------------------------

  keyOf(id: string, folder = false): FileKey { return fileKey(this.sim.refOf(id, folder)) }
  card(id: string, folder = false): SceneCard {
    const card = this.scene().byKey.get(this.keyOf(id, folder))
    if (!card) throw new Error(`no card ${id}`)
    return card
  }
  /** A card's centre in viewport coordinates. */
  at(id: string, folder = false): Pt { return toViewport(this.camera, rectCenter(this.card(id, folder).rect)) }
  /** A point on a card's label, in viewport coordinates. */
  labelAt(id: string, folder = false): Pt { const c = this.card(id, folder).rect; return toViewport(this.camera, { x: c.x + c.w / 2, y: c.y + c.h - 16 }) }
  /** An empty point of the viewport: far from every card of the usual fixtures. */
  empty(x = 900, y = 700): Pt { return { x, y } }
  intentsOf<K extends FileCanvasIntent['kind']>(kind: K): Extract<FileCanvasIntent, { kind: K }>[] {
    return this.intents.filter((i): i is Extract<FileCanvasIntent, { kind: K }> => i.kind === kind)
  }
  get mode(): string { return this.state.mode.kind }
  /** The dragging mode, or a failure naming the mode the canvas is in instead. */
  dragMode(): Extract<CanvasMode, { kind: 'dragging' }> {
    if (this.state.mode.kind !== 'dragging') throw new Error(`expected dragging, the canvas is ${this.state.mode.kind}`)
    return this.state.mode
  }
  get last(): CanvasStep { return this.steps[this.steps.length - 1]! }
  effectsOf<K extends CanvasEffect['kind']>(kind: K): Extract<CanvasEffect, { kind: K }>[] {
    return this.effects.filter((e): e is Extract<CanvasEffect, { kind: K }> => e.kind === kind)
  }
  /** Forget the log (not the state): the next assertion is about what happens from here. */
  mark(): void { this.intents.length = 0; this.effects.length = 0; this.steps.length = 0 }

  // --- pointer ---------------------------------------------------------------------------------

  down(target: PointerTarget, at: Pt, opts: { mods?: Modifiers; button?: number; pointerId?: number; t?: number; pointerType?: PointerKind } = {}): CanvasStep {
    const pointerId = opts.pointerId ?? this.pointerId
    return this.send({ type: 'pointerdown', pointerId, at, button: opts.button ?? 0, mods: opts.mods ?? NO_MODS, target, t: opts.t ?? this.advance(50), pointerType: opts.pointerType })
  }
  move(at: Pt, opts: { mods?: Modifiers; pointerId?: number; external?: { folder: import('../../../folder-view-contract.js').WorkspaceFileRef | null } | null } = {}): CanvasStep {
    return this.send({ type: 'pointermove', pointerId: opts.pointerId ?? this.pointerId, at, mods: opts.mods ?? NO_MODS, t: this.advance(16), external: opts.external })
  }
  up(at: Pt, opts: { mods?: Modifiers; pointerId?: number; external?: { folder: import('../../../folder-view-contract.js').WorkspaceFileRef | null } | null } = {}): CanvasStep {
    return this.send({ type: 'pointerup', pointerId: opts.pointerId ?? this.pointerId, at, mods: opts.mods ?? NO_MODS, t: this.advance(30), external: opts.external })
  }
  cancel(pointerId = this.pointerId): CanvasStep { return this.send({ type: 'pointercancel', pointerId }) }

  click(id: string, opts: { mods?: Modifiers; folder?: boolean; wait?: number; label?: boolean } = {}): void {
    if (opts.wait) this.tick(opts.wait)
    const at = opts.label ? this.labelAt(id, opts.folder) : this.at(id, opts.folder)
    const target: PointerTarget = { kind: opts.label ? 'label' : 'card', key: this.keyOf(id, opts.folder) }
    this.down(target, at, { mods: opts.mods })
    this.up(at, { mods: opts.mods })
  }
  clickBackground(at = this.empty(), opts: { mods?: Modifiers } = {}): void {
    this.down({ kind: 'background' }, at, opts)
    this.up(at, opts)
  }
  doubleClick(id: string, folder = false): void {
    this.click(id, { folder })
    this.tick(120)
    this.click(id, { folder })
  }

  /** Press on a card, move in steps to `to`, and (unless told not to) release there. */
  drag(id: string, to: Pt, opts: { steps?: number; mods?: Modifiers; release?: boolean; folder?: boolean; external?: { folder: import('../../../folder-view-contract.js').WorkspaceFileRef | null } | null } = {}): void {
    const from = this.at(id, opts.folder)
    this.down({ kind: 'card', key: this.keyOf(id, opts.folder) }, from, { mods: opts.mods })
    const steps = opts.steps ?? 6
    for (let i = 1; i <= steps; i++) {
      this.move({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }, { mods: opts.mods, external: i === steps ? opts.external : undefined })
    }
    if (opts.release !== false) this.up(to, { mods: opts.mods, external: opts.external })
  }
  /** Drag a card onto the centre of another. */
  dragOnto(id: string, onto: string, opts: { folder?: boolean; ontoFolder?: boolean } = {}): void {
    this.drag(id, this.at(onto, opts.ontoFolder ?? true), { folder: opts.folder })
  }
  marquee(from: Pt, to: Pt, opts: { mods?: Modifiers; release?: boolean } = {}): void {
    this.down({ kind: 'background' }, from, { mods: opts.mods })
    for (let i = 1; i <= 4; i++) this.move({ x: from.x + ((to.x - from.x) * i) / 4, y: from.y + ((to.y - from.y) * i) / 4 }, { mods: opts.mods })
    if (opts.release !== false) this.up(to, { mods: opts.mods })
  }
  contextMenu(target: PointerTarget, at: Pt): CanvasStep { return this.send({ type: 'contextmenu', at, target, mods: NO_MODS }) }

  // --- keyboard ------------------------------------------------------------------------------

  key(key: string, m: Modifiers = NO_MODS): CanvasStep { return this.send({ type: 'keydown', key, mods: m }) }
  press(key: string, m: Modifiers = NO_MODS): CanvasStep {
    const step = this.send({ type: 'keydown', key, mods: m })
    this.send({ type: 'keyup', key, mods: m })
    return step
  }
  type(text: string): void { this.send({ type: 'name-input', text }) }
  commit(text?: string): CanvasStep { return this.send({ type: 'name-commit', text }) }
  escapeInput(): CanvasStep { return this.send({ type: 'name-cancel' }) }
  drop(at: Pt, names: string[] = ['datasheet.pdf']): CanvasStep {
    return this.send({ type: 'drop', at, files: names.map((n) => new File(['%PDF-1.7'], n, { type: 'application/pdf' })) })
  }
  hoverFiles(at: Pt): CanvasStep { return this.send({ type: 'dragover', at }) }
}
