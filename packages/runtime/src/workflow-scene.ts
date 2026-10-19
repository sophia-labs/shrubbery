/**
 * `<sh-workflow-scene .plan=${plan}>`: the workflow plan (graph-plan-v1) drawn as a card plane in the main pane.
 *
 * The RDF definition stays the source of truth: `workflowSceneModel` derives everything from the plan the pane already holds
 * (phases as lanes, steps as cards, each collection a step reads as a wire from the step that produces it, the gate dashed, run
 * state as the card's tone, an agent's latest change as a ring).
 *
 * It runs on the Files canvas's engine port (`@shrubbery/nucleus/files-canvas`) with Excalidraw's engine behind it, headless:
 * `route` and `reroute` (frame by frame while a card is dragged), `snap`, `fitCamera`, no React and no Excalidraw UI (Vera,
 * 2026-10-18: "use it in the headless mode with sophia system tokens"). Cards are ordinary DOM and wires one SVG plane, styled only
 * by `--mn-*` tokens, so the scene follows the global theme and a card's text moves with its card.
 *
 * A person may move cards: positions are layout only, kept in this browser per definition, and a card dropped back on its derived
 * place leaves the layout again.
 */

import {
  type Camera, type CanvasEngine, type ConnectorPath, houseEngine, loadDefaultEngine, moveCards, type Pt, type Rect, rectUnion,
  type SceneCard, type SceneConnector, type SceneSnapshot, type SnapGuide,
} from '@shrubbery/nucleus/files-canvas'
import { css, html, LitElement, nothing, svg } from 'lit'
import { repeat } from 'lit/directives/repeat.js'
import type { WorkflowPlanOptions, WorkflowPlanStepView } from './render-workspace.js'

const LANE_WIDTH = 260
const LANE_GAP = 96
const LANE_TOP = 44
const LANE_PAD = 20
const CARD_WIDTH = 220
const CARD_HEIGHT = 92
const CARD_GAP = 28
const ROUTE_PAD = 4
const FIT_INSET = 16
/** Below this the cards stop being readable: a plan wider than the pane pans sideways instead of shrinking further. */
const READABLE_ZOOM = 0.75

export type StepRunState = 'idle' | 'running' | 'done' | 'failed'

export function stepRunState(step: WorkflowPlanStepView): StepRunState {
  const p = step.progress
  if (!p) return 'idle'
  if (p.failed > 0) return 'failed'
  if (p.started > p.done + p.failed) return 'running'
  return p.done > 0 ? 'done' : 'idle'
}

export type WorkflowLayout = Readonly<Record<string, Pt>>

export interface WorkflowSceneModel {
  readonly snapshot: SceneSnapshot
  readonly lanes: readonly { readonly title: string; readonly rect: Rect }[]
  readonly steps: ReadonlyMap<string, WorkflowPlanStepView>
  /** Where each card sits before any move: the layout keeps only departures from it. */
  readonly derived: ReadonlyMap<string, Pt>
  /** Connector ids of gate edges (a step checking what an earlier one produced). */
  readonly gates: ReadonlySet<string>
}

/** Derive the scene from the plan view. Pure: the same plan and layout give the same model. */
export function workflowSceneModel(plan: WorkflowPlanOptions, layout: WorkflowLayout = {}): WorkflowSceneModel {
  const tallest = Math.max(1, ...plan.phases.map((phase) => phase.steps.length))
  const laneHeight = LANE_TOP + tallest * (CARD_HEIGHT + CARD_GAP) - CARD_GAP + LANE_PAD
  const lanes: { title: string; rect: Rect }[] = []
  const cards: SceneCard[] = []
  const steps = new Map<string, WorkflowPlanStepView>()
  const derived = new Map<string, Pt>()
  const producers = new Map<string, string>()
  plan.phases.forEach((phase, i) => {
    const x = i * (LANE_WIDTH + LANE_GAP)
    lanes.push({ title: `${i + 1} · ${phase.title}`, rect: { x, y: 0, w: LANE_WIDTH, h: laneHeight } })
    phase.steps.forEach((step, j) => {
      const at = { x: x + (LANE_WIDTH - CARD_WIDTH) / 2, y: LANE_TOP + j * (CARD_HEIGHT + CARD_GAP) }
      const placed = layout[step.id]
      const rect = { ...(placed ?? at), w: CARD_WIDTH, h: CARD_HEIGHT }
      derived.set(step.id, at)
      steps.set(step.id, step)
      if (step.produces) producers.set(step.produces, step.id)
      // Glyph = the whole card: the engine keeps wires and their labels off it.
      cards.push({ key: step.id, kind: 'file', role: 'real', ref: null, label: step.label, rect, glyph: rect, placed: !!placed, locked: false, ghost: null, draftId: null })
    })
  })
  const connectors: SceneConnector[] = []
  const gates = new Set<string>()
  for (const phase of plan.phases) {
    for (const step of phase.steps) {
      const reads = [...(step.over ? [step.over] : []), ...(step.consumes ?? []), ...(step.checks ? [step.checks] : [])]
      for (const collection of new Set(reads)) {
        const from = producers.get(collection)
        if (!from || from === step.id) continue
        const id = `${from}->${step.id}:${collection}`
        connectors.push({ id, from, to: step.id, label: collection })
        if (step.checks === collection) gates.add(id)
      }
    }
  }
  const snapshot: SceneSnapshot = {
    cards,
    byKey: new Map(cards.map((card) => [card.key, card])),
    connectors,
    cardSize: { w: CARD_WIDTH, h: CARD_HEIGHT },
    grid: null,
    slotColumns: Math.max(1, plan.phases.length),
  }
  return { snapshot, lanes, steps, derived, gates }
}

/** The layout after a card is dropped at `at`: back on its derived place, it leaves the layout. */
export function placeCard(layout: WorkflowLayout, model: WorkflowSceneModel, key: string, at: Pt): WorkflowLayout {
  const home = model.derived.get(key)
  const next: Record<string, Pt> = { ...layout }
  if (home && Math.abs(home.x - at.x) < 0.5 && Math.abs(home.y - at.y) < 0.5) delete next[key]
  else next[key] = { x: Math.round(at.x), y: Math.round(at.y) }
  return next
}

function readLayout(key: string): WorkflowLayout {
  try {
    const raw = globalThis.localStorage?.getItem(`sh-workflow-layout:${key}`)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? (parsed as WorkflowLayout) : {}
  } catch {
    return {}
  }
}

function writeLayout(key: string, layout: WorkflowLayout): void {
  try {
    globalThis.localStorage?.setItem(`sh-workflow-layout:${key}`, JSON.stringify(layout))
  } catch {
    /* layout is a convenience; a browser that refuses storage keeps the derived positions */
  }
}

function modeWords(step: WorkflowPlanStepView): string {
  return step.checks ? `checks each ${step.checks}` : step.mode === 'perItem' ? `for each ${step.over ?? ''}` : 'once'
}

function tallyWords(step: WorkflowPlanStepView): string {
  const p = step.progress
  if (!p) return ''
  const running = p.started - p.done - p.failed
  return [`${p.done} done`, running > 0 ? `${running} running` : '', p.failed ? `${p.failed} failed` : ''].filter(Boolean).join(' · ')
}

/** Everything the scene draws, lanes included: what the camera fits. */
function sceneBounds(model: WorkflowSceneModel): Rect | null {
  return rectUnion([...model.lanes.map((lane) => lane.rect), ...model.snapshot.cards.map((card) => card.rect)])
}

interface Drag {
  readonly key: string
  readonly pointer: number
  readonly from: Pt
  delta: Pt
  moved: boolean
  guides: readonly SnapGuide[]
}

export class ShWorkflowScene extends LitElement {
  static override properties = { plan: { attribute: false } }
  declare plan: WorkflowPlanOptions | null

  private engine: CanvasEngine = houseEngine
  private engineLoading = false
  private layoutKey = ''
  private layout: WorkflowLayout = {}
  private camera: Camera = { x: 0, y: 0, zoom: 1 }
  private fittedFor = ''
  private drag: Drag | null = null
  private modelCache: { plan: WorkflowPlanOptions; layout: WorkflowLayout; model: WorkflowSceneModel } | null = null
  private routeCache: { scene: SceneSnapshot; engine: CanvasEngine; routes: ReadonlyMap<string, ConnectorPath> } | null = null
  private resizer: ResizeObserver | null = null
  private fittedWidth = 0
  private pan: { readonly pointer: number; readonly from: number; readonly x0: number } | null = null

  constructor() {
    super()
    this.plan = null
    this.addEventListener('pointerdown', this.onBackgroundDown)
    this.addEventListener('wheel', this.onWheel, { passive: false })
    this.addEventListener('pointermove', this.onPointerMove)
    this.addEventListener('pointerup', this.onPointerUp)
    this.addEventListener('pointercancel', this.onPointerCancel)
  }

  static override styles = css`
    :host {
      display: block;
      position: relative;
      overflow: hidden;
      height: 240px;
      background: var(--mn-color-surface-canvas);
      touch-action: pan-y;
      font-family: var(--mn-font-chrome);
      color: var(--mn-color-text-primary);
    }
    .scene { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
    .lane {
      position: absolute;
      box-sizing: border-box;
      border: 1px dashed var(--mn-color-border-default);
      border-radius: var(--mn-radius-control, 6px);
    }
    .lane-title {
      position: absolute;
      left: 12px;
      top: 12px;
      font-size: var(--mn-text-sm, 12px);
      font-weight: 600;
      color: var(--mn-color-text-secondary);
      white-space: nowrap;
    }
    .card {
      position: absolute;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 2px;
      padding: var(--mn-space-2, 8px) var(--mn-space-3, 12px);
      background: var(--mn-color-surface-raised);
      border: 1px solid var(--mn-color-border-default);
      border-radius: var(--mn-radius-control, 6px);
      box-shadow: var(--mn-shadow-card, none);
      cursor: grab;
      touch-action: none;
      user-select: none;
    }
    .card:focus-visible { box-shadow: var(--mn-focus-ring); outline: none; }
    .card[data-run='running'] { background: var(--mn-color-warning-surface); border-color: var(--mn-color-warning-border); }
    .card[data-run='done'] { background: var(--mn-color-success-surface); border-color: var(--mn-color-success-border); }
    .card[data-run='failed'] { background: var(--mn-color-danger-surface); border-color: var(--mn-color-danger-border); }
    .card[data-changed] { border-color: var(--mn-color-border-accent); box-shadow: 0 0 0 1px var(--mn-color-border-accent); }
    .card[data-dragging] { cursor: grabbing; z-index: 2; box-shadow: var(--mn-shadow-raised, var(--mn-shadow-card, none)); }
    .label {
      font-size: var(--mn-text-md, 14px);
      font-weight: 600;
      line-height: 1.25;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .job { font-size: var(--mn-text-xs, 11px); line-height: 1.3; color: var(--mn-color-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tally { font-size: var(--mn-text-xs, 11px); line-height: 1.3; font-variant-numeric: tabular-nums; }
    .card[data-run='running'] .tally { color: var(--mn-color-warning-strong, var(--mn-color-text-warning)); }
    .card[data-run='done'] .tally { color: var(--mn-color-success-strong, var(--mn-color-text-success)); }
    .card[data-run='failed'] .tally { color: var(--mn-color-text-danger); }
    .wires { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: visible; pointer-events: none; }
    .wire .line { fill: none; stroke: var(--mn-color-text-secondary); stroke-width: 1.5; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
    .wire .arrow { fill: var(--mn-color-text-secondary); stroke: none; }
    .wire[data-gate] .line { stroke: var(--mn-color-text-danger); stroke-dasharray: 5 4; }
    .wire[data-gate] .arrow { fill: var(--mn-color-text-danger); }
    .guide { stroke: var(--mn-color-border-accent); stroke-width: 1; stroke-dasharray: 3 3; vector-effect: non-scaling-stroke; }
    .wire-label {
      position: absolute;
      transform: translate(-50%, -50%);
      white-space: nowrap;
      padding: 0 var(--mn-space-1, 4px);
      font-size: var(--mn-text-xs, 11px);
      line-height: var(--mn-leading-ui, 1.3);
      color: var(--mn-color-text-secondary);
      background: var(--mn-color-surface-raised);
      border: 1px solid var(--mn-color-border-subtle);
      border-radius: var(--mn-radius-sm, 3px);
      pointer-events: none;
    }
    .wire-label[data-gate] { color: var(--mn-color-text-danger); border-color: var(--mn-color-danger-border); }
  `

  override connectedCallback(): void {
    super.connectedCallback()
    // A new width refits; a new height is the scene's own doing (it sizes itself to the plan).
    this.resizer = new ResizeObserver(() => {
      if (this.clientWidth === this.fittedWidth) return
      this.fittedFor = ''
      this.requestUpdate()
    })
    this.resizer.observe(this)
    if (this.engine === houseEngine && !this.engineLoading) {
      this.engineLoading = true
      // The house engine draws the first frame; Excalidraw's engine takes over once its modules are in (a failed load keeps the house's).
      void loadDefaultEngine().then(({ engine }) => {
        this.engineLoading = false
        if (!this.isConnected) {
          engine.dispose?.()
          return
        }
        this.engine = engine
        this.routeCache = null
        this.requestUpdate()
      })
    }
  }

  override disconnectedCallback(): void {
    this.resizer?.disconnect()
    this.resizer = null
    if (this.engine !== houseEngine) this.engine.dispose?.()
    this.engine = houseEngine
    this.routeCache = null
    super.disconnectedCallback()
  }

  private model(plan: WorkflowPlanOptions): WorkflowSceneModel {
    if (plan.definition !== this.layoutKey) {
      this.layoutKey = plan.definition
      this.layout = readLayout(plan.definition)
      this.fittedFor = ''
    }
    const cache = this.modelCache
    if (cache && cache.plan === plan && cache.layout === this.layout) return cache.model
    const model = workflowSceneModel(plan, this.layout)
    this.modelCache = { plan, layout: this.layout, model }
    return model
  }

  private routes(scene: SceneSnapshot): ReadonlyMap<string, ConnectorPath> {
    const cache = this.routeCache
    if (cache && cache.scene === scene && cache.engine === this.engine) return cache.routes
    const routes = this.engine.route(scene, { pad: ROUTE_PAD })
    this.routeCache = { scene, engine: this.engine, routes }
    return routes
  }

  override render() {
    const plan = this.plan
    if (!plan) return nothing
    const model = this.model(plan)
    const structure = `${model.lanes.length}|${model.snapshot.cards.map((card) => card.key).join(',')}`
    if (this.fittedFor !== structure && this.clientWidth > 0) {
      this.fitView(model)
      this.fittedFor = structure
    } else if (!this.drag?.moved) this.fitHeight(model)
    let scene = model.snapshot
    let routes = this.routes(scene)
    const drag = this.drag?.moved ? this.drag : null
    if (drag) {
      scene = moveCards(scene, [drag.key], drag.delta)
      routes = this.engine.reroute(scene, new Set([drag.key]), routes, { pad: ROUTE_PAD })
    }
    const { x, y, zoom } = this.camera
    return html`<div class="scene" style="transform: scale(${zoom}) translate(${x}px, ${y}px)">
      ${model.lanes.map((lane) => html`<div class="lane" style="left:${lane.rect.x}px;top:${lane.rect.y}px;width:${lane.rect.w}px;height:${lane.rect.h}px">
        <span class="lane-title">${lane.title}</span></div>`)}
      <svg class="wires" aria-hidden="true">
        ${scene.connectors.map((c) => {
          const route = routes.get(c.id)
          if (!route || route.points.length < 2) return nothing
          const d = route.points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')
          const a = route.points[route.points.length - 2]!
          const b = route.points[route.points.length - 1]!
          const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
          const ux = (b.x - a.x) / len
          const uy = (b.y - a.y) / len
          const arrow = `${b.x},${b.y} ${b.x - ux * 9 - uy * 4.5},${b.y - uy * 9 + ux * 4.5} ${b.x - ux * 9 + uy * 4.5},${b.y - uy * 9 - ux * 4.5}`
          return svg`<g class="wire" ?data-gate=${model.gates.has(c.id)}><path class="line" d=${d}></path><polygon class="arrow" points=${arrow}></polygon></g>`
        })}
        ${drag ? drag.guides.map((g) => (g.axis === 'x'
          ? svg`<line class="guide" x1=${g.at} y1=${g.from} x2=${g.at} y2=${g.to}></line>`
          : svg`<line class="guide" x1=${g.from} y1=${g.at} x2=${g.to} y2=${g.at}></line>`)) : nothing}
      </svg>
      ${scene.connectors.map((c) => {
        const route = routes.get(c.id)
        return route ? html`<span class="wire-label" ?data-gate=${model.gates.has(c.id)} style="left:${route.labelAnchor.x}px;top:${route.labelAnchor.y}px">${c.label}</span>` : nothing
      })}
      ${repeat(scene.cards, (card) => card.key, (card) => {
        const step = model.steps.get(card.key)
        if (!step) return nothing
        const run = stepRunState(step)
        const tally = tallyWords(step)
        return html`<div class="card" role="group" tabindex="0"
          aria-label=${[step.label, step.job, modeWords(step), tally].filter(Boolean).join(', ')}
          data-key=${card.key} data-run=${run} ?data-changed=${!!step.changed} ?data-dragging=${drag?.key === card.key}
          style="left:${card.rect.x}px;top:${card.rect.y}px;width:${card.rect.w}px;height:${card.rect.h}px"
          @pointerdown=${(e: PointerEvent) => this.onCardDown(e, card.key)}>
          <div class="label" title=${step.label}>${step.label}</div>
          <div class="job">${step.job} · ${modeWords(step)}</div>
          ${tally ? html`<div class="tally">${tally}</div>` : nothing}
        </div>`
      })}
    </div>`
  }

  /** Fit the plan's width down to a readable zoom (wider plans pan), centre it when it fits, and size the pane to its height. */
  private fitView(model: WorkflowSceneModel): void {
    const bounds = sceneBounds(model)
    const width = this.clientWidth
    this.fittedWidth = width
    if (!bounds) return
    const zoom = Math.min(1, Math.max(READABLE_ZOOM, (width - 2 * FIT_INSET) / bounds.w))
    const contentWidth = bounds.w * zoom
    const left = contentWidth + 2 * FIT_INSET <= width ? (width - contentWidth) / 2 : FIT_INSET
    this.camera = { x: left / zoom - bounds.x, y: 0, zoom }
    this.fitHeight(model)
  }

  /** The pane is as tall as the plan, a moved card included; pan and zoom are kept. */
  private fitHeight(model: WorkflowSceneModel): void {
    const bounds = sceneBounds(model)
    if (!bounds) return
    const { zoom } = this.camera
    this.camera = { ...this.camera, y: FIT_INSET / zoom - bounds.y }
    const height = `${Math.round(bounds.h * zoom + 2 * FIT_INSET)}px`
    if (this.style.height !== height) this.style.height = height
  }

  /** Pan sideways, never so far that the plan leaves the pane. */
  private panTo(x: number): void {
    const bounds = this.plan ? sceneBounds(this.model(this.plan)) : null
    if (!bounds) return
    const { zoom } = this.camera
    const width = this.clientWidth
    if (bounds.w * zoom + 2 * FIT_INSET <= width) return
    const most = FIT_INSET / zoom - bounds.x
    const least = (width - FIT_INSET) / zoom - bounds.x - bounds.w
    this.camera = { ...this.camera, x: Math.min(most, Math.max(least, x)) }
    this.requestUpdate()
  }

  private onBackgroundDown = (e: PointerEvent): void => {
    if (e.button !== 0 || this.drag || this.pan) return
    this.pan = { pointer: e.pointerId, from: e.clientX, x0: this.camera.x }
    this.setPointerCapture(e.pointerId)
  }

  private onWheel = (e: WheelEvent): void => {
    // A sideways swipe pans the plan; an up-or-down one is the page's.
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
    e.preventDefault()
    this.panTo(this.camera.x - e.deltaX / this.camera.zoom)
  }

  private onCardDown(e: PointerEvent, key: string): void {
    if (e.button !== 0 || this.drag) return
    this.drag = { key, pointer: e.pointerId, from: { x: e.clientX, y: e.clientY }, delta: { x: 0, y: 0 }, moved: false, guides: [] }
    this.setPointerCapture(e.pointerId)
  }

  private onPointerMove = (e: PointerEvent): void => {
    const pan = this.pan
    if (pan && e.pointerId === pan.pointer) {
      this.panTo(pan.x0 + (e.clientX - pan.from) / this.camera.zoom)
      return
    }
    const drag = this.drag
    if (!drag || e.pointerId !== drag.pointer) return
    const zoom = this.camera.zoom
    const raw = { x: (e.clientX - drag.from.x) / zoom, y: (e.clientY - drag.from.y) / zoom }
    if (!drag.moved) {
      if (Math.hypot(raw.x, raw.y) * zoom < 3) return
      drag.moved = true
      this.engine.prepareDrag?.(this.model(this.plan!).snapshot, [drag.key])
    }
    const snapped = this.engine.snap(this.model(this.plan!).snapshot, [drag.key], raw, { threshold: 6 / zoom })
    drag.delta = snapped.delta
    drag.guides = snapped.guides
    this.requestUpdate()
  }

  private onPointerUp = (e: PointerEvent): void => {
    if (this.pan && e.pointerId === this.pan.pointer) this.pan = null
    const drag = this.drag
    if (!drag || e.pointerId !== drag.pointer) return
    this.drag = null
    this.engine.releaseDrag?.()
    if (drag.moved && this.plan) {
      const model = this.model(this.plan)
      const card = model.snapshot.byKey.get(drag.key)
      if (card) {
        this.layout = placeCard(this.layout, model, drag.key, { x: card.rect.x + drag.delta.x, y: card.rect.y + drag.delta.y })
        writeLayout(this.layoutKey, this.layout)
      }
    }
    this.requestUpdate()
  }

  private onPointerCancel = (e: PointerEvent): void => {
    if (this.pan && e.pointerId === this.pan.pointer) this.pan = null
    if (!this.drag || e.pointerId !== this.drag.pointer) return
    this.drag = null
    this.engine.releaseDrag?.()
    this.requestUpdate()
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('sh-workflow-scene')) {
  customElements.define('sh-workflow-scene', ShWorkflowScene)
}
