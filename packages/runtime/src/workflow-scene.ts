/**
 * `<sh-workflow-scene .plan=${plan}>`: a workflow (graph-plan-v1) drawn as the whole main pane (Vera, 2026-10-19: "the
 * workflow page [is] just a canvas ... and then information in the right sidebar that is contextual").
 *
 * What a workflow is made of, drawn as what it is (`workflowCanvasModel`, pure, from the plan the pane already holds):
 * - a **source** (what it reads: a book, a run of its blocks) is a tile on the left;
 * - a **person** (a step) is a card: who, what kind of work, once or once per item;
 * - a **stack** (a collection handed from one step to the next) is a stack of paper with its count after a run;
 * - a **check** is a gate on the path; what it refuses lands in a tray beneath it;
 * - a **destination** (where results go: a margin) is a tile on the right.
 * Columns follow the flow (each node one column after what it takes in); there are no phase lanes. People light up
 * while they work. Clicking a node selects it (`sh-workflow-select`), and the right sidebar explains it; clicking the
 * canvas or Esc clears the selection. Double-clicking a node, or Enter on the selected one, opens it full size
 * (`onFocus`, `<sh-workflow-focus>`); a source or destination opens its document instead.
 *
 * It runs on the Files canvas's engine port (`@shrubbery/nucleus/files-canvas`) with Excalidraw's engine behind it,
 * headless: `route` and `reroute` while a node is dragged, `snap`, no React and no Excalidraw UI, everything styled by
 * `--mn-*` tokens. A moved node is layout only, kept in this browser per definition; dropped back on its derived place,
 * it leaves the layout again. Drag the canvas to pan; pinch or Ctrl-scroll to zoom.
 */

import {
  type Camera, type CanvasEngine, type ConnectorPath, houseEngine, loadDefaultEngine, moveCards, type Pt, rectUnion,
  type SceneCard, type SceneConnector, type SceneSnapshot, type SnapGuide,
} from '@shrubbery/nucleus/files-canvas'
import { css, html, LitElement, nothing, svg, type TemplateResult } from 'lit'
import { repeat } from 'lit/directives/repeat.js'
import './being/being-face-element.js'
import type {
  WorkflowDestinationView, WorkflowPlanOptions, WorkflowPlanStepView, WorkflowSourceView, WorkflowStackView,
} from './render-workspace.js'

export type WorkflowNodeKind = 'source' | 'step' | 'check' | 'stack' | 'destination' | 'refused'

const SIZE: Readonly<Record<WorkflowNodeKind, { readonly w: number; readonly h: number }>> = {
  source: { w: 184, h: 76 },
  step: { w: 204, h: 96 },
  check: { w: 204, h: 96 },
  stack: { w: 128, h: 64 },
  destination: { w: 184, h: 76 },
  refused: { w: 128, h: 44 },
}
const COLUMN_GAP = 56
const ROW_GAP = 28
/** Between two lines of a wrapped flow: room for the wire that carries on to the next line. */
const LINE_GAP = 84
const TRAY_GAP = 22
const ROUTE_PAD = 4
const FIT_INSET = 32
/** Room kept free at the bottom for the Run pill. */
const PILL_ROOM = 64
const MIN_ZOOM = 0.4
const MAX_ZOOM = 1.6
const FIT_MAX_ZOOM = 1

export type StepRunState = 'idle' | 'running' | 'done' | 'failed'

export function stepRunState(step: WorkflowPlanStepView): StepRunState {
  const p = step.progress
  if (!p) return 'idle'
  if (p.started > p.done + p.failed) return 'running'
  if (p.failed > 0) return p.done > 0 ? 'done' : 'failed'
  return p.done > 0 ? 'done' : 'idle'
}

export type WorkflowLayout = Readonly<Record<string, Pt>>

export interface WorkflowCanvasNode {
  readonly key: string
  readonly kind: WorkflowNodeKind
  readonly step?: WorkflowPlanStepView
  readonly source?: WorkflowSourceView
  readonly stack?: WorkflowStackView
  readonly destination?: WorkflowDestinationView
  /** For a refused tray: the check it belongs to and how many it holds. */
  readonly refused?: { readonly check: WorkflowPlanStepView; readonly count: number }
}

export interface WorkflowCanvasModel {
  readonly snapshot: SceneSnapshot
  readonly nodes: ReadonlyMap<string, WorkflowCanvasNode>
  /** Where each node sits before any move: the layout keeps only departures from it. */
  readonly derived: ReadonlyMap<string, Pt>
  /** Connector ids that go into a check, and from a check to its refused tray. */
  readonly gates: ReadonlySet<string>
  readonly refusals: ReadonlySet<string>
}

export const nodeKey = {
  source: (id: string) => `source:${id}`,
  step: (id: string) => `step:${id}`,
  stack: (id: string) => `stack:${id}`,
  destination: (id: string) => `destination:${id}`,
  refused: (id: string) => `refused:${id}`,
}

function refusedCount(step: WorkflowPlanStepView): number {
  return step.verdicts?.refused ?? 0
}

/**
 * Derive the canvas from the plan view. Pure: the same plan, layout and width give the same model. A flow wider than
 * `wrapWidth` carries on in a new line below, as text does, so a long workflow stays at reading size.
 */
export function workflowCanvasModel(plan: WorkflowPlanOptions, layout: WorkflowLayout = {}, wrapWidth = Number.POSITIVE_INFINITY): WorkflowCanvasModel {
  const nodes = new Map<string, WorkflowCanvasNode>()
  for (const source of plan.sources ?? []) nodes.set(nodeKey.source(source.id), { key: nodeKey.source(source.id), kind: 'source', source })
  for (const step of plan.steps) nodes.set(nodeKey.step(step.id), { key: nodeKey.step(step.id), kind: step.checks ? 'check' : 'step', step })
  for (const stack of plan.stacks ?? []) nodes.set(nodeKey.stack(stack.id), { key: nodeKey.stack(stack.id), kind: 'stack', stack })
  for (const destination of plan.destinations ?? []) {
    nodes.set(nodeKey.destination(destination.id), { key: nodeKey.destination(destination.id), kind: 'destination', destination })
  }
  const ensureStack = (id: string): string => {
    const key = nodeKey.stack(id)
    if (!nodes.has(key)) nodes.set(key, { key, kind: 'stack', stack: { id, producer: null, fields: [] } })
    return key
  }

  // The flow: what each node takes in.
  const connectors: SceneConnector[] = []
  const gates = new Set<string>()
  const refusals = new Set<string>()
  const connect = (from: string, to: string, label = ''): string => {
    const id = `${from}->${to}`
    if (from !== to && nodes.has(from) && nodes.has(to) && !connectors.some((c) => c.id === id)) connectors.push({ id, from, to, label })
    return id
  }
  for (const step of plan.steps) {
    const key = nodeKey.step(step.id)
    for (const read of step.reads ?? []) connect(nodeKey.source(read), key)
    const takes = [...(step.over ? [step.over] : []), ...(step.consumes ?? [])]
    for (const collection of new Set(takes)) {
      const id = connect(ensureStack(collection), key, step.mode === 'perItem' && collection === step.over ? 'each' : '')
      if (step.checks === collection) gates.add(id)
    }
    if (step.produces) connect(key, ensureStack(step.produces))
  }
  for (const destination of plan.destinations ?? []) {
    if (destination.receives) connect(ensureStack(destination.receives), nodeKey.destination(destination.id))
  }

  // Columns: each node one after the furthest thing it takes in (a cycle, which the compiler refuses, is cut).
  const preds = new Map<string, string[]>()
  for (const c of connectors) preds.set(c.to, [...(preds.get(c.to) ?? []), c.from])
  const rank = new Map<string, number>()
  const visiting = new Set<string>()
  const rankOf = (key: string): number => {
    const known = rank.get(key)
    if (known !== undefined) return known
    if (visiting.has(key)) return 0
    visiting.add(key)
    const before = (preds.get(key) ?? []).map(rankOf)
    visiting.delete(key)
    const r = before.length ? Math.max(...before) + 1 : 0
    rank.set(key, r)
    return r
  }
  const kindOrder: Record<WorkflowNodeKind, number> = { source: 0, step: 1, check: 2, stack: 3, destination: 4, refused: 5 }
  const keys = [...nodes.keys()]
  for (const key of keys) rankOf(key)
  // A destination sits after the last column of work, so where results go reads as the end of the line.
  const workEnd = Math.max(0, ...keys.filter((k) => nodes.get(k)!.kind !== 'destination').map((k) => rank.get(k) ?? 0))
  for (const key of keys) if (nodes.get(key)!.kind === 'destination') rank.set(key, Math.max(rank.get(key) ?? 0, workEnd + 1))
  const columns: string[][] = []
  for (const key of keys) {
    const r = rank.get(key) ?? 0
    ;(columns[r] ??= []).push(key)
  }
  // Order each column by where what it takes in sits (fewer crossings), then by kind and key.
  const row = new Map<string, number>()
  columns.forEach((column, r) => {
    const weight = (key: string): number => {
      const before = (preds.get(key) ?? []).map((p) => row.get(p)).filter((n): n is number => n !== undefined)
      return before.length ? before.reduce((a, b) => a + b, 0) / before.length : Number.MAX_SAFE_INTEGER
    }
    column.sort((a, b) => (r > 0 ? weight(a) - weight(b) : 0) || kindOrder[nodes.get(a)!.kind] - kindOrder[nodes.get(b)!.kind] || a.localeCompare(b))
    column.forEach((key, i) => row.set(key, i))
  })

  const derived = new Map<string, Pt>()
  const columnWidth = Array.from(columns, (column) => Math.max(0, ...(column ?? []).map((key) => SIZE[nodes.get(key)!.kind].w)))
  const columnHeight = Array.from(columns, (column) => {
    const keysIn = column ?? []
    return keysIn.reduce((h, key) => h + SIZE[nodes.get(key)!.kind].h, 0) + Math.max(0, keysIn.length - 1) * ROW_GAP
  })
  // Lines of columns, each as wide as fits.
  const lines: number[][] = []
  let lineWidth = 0
  columnWidth.forEach((w, r) => {
    if (lines.length === 0 || (lineWidth > 0 && lineWidth + COLUMN_GAP + w > wrapWidth)) {
      lines.push([r])
      lineWidth = w
    } else {
      lines[lines.length - 1]!.push(r)
      lineWidth += COLUMN_GAP + w
    }
  })
  let top = 0
  for (const line of lines) {
    const tallest = Math.max(0, ...line.map((r) => columnHeight[r] ?? 0))
    let x = 0
    for (const r of line) {
      let y = top + (tallest - (columnHeight[r] ?? 0)) / 2
      for (const key of columns[r] ?? []) {
        const size = SIZE[nodes.get(key)!.kind]
        derived.set(key, { x: x + (columnWidth[r]! - size.w) / 2, y })
        y += size.h + ROW_GAP
      }
      x += (columnWidth[r] ?? 0) + COLUMN_GAP
    }
    top += tallest + LINE_GAP
  }

  const cards: SceneCard[] = []
  const card = (key: string, kind: WorkflowNodeKind, at: Pt): SceneCard => {
    const placed = layout[key]
    const rect = { ...(placed ?? at), ...SIZE[kind] }
    return { key, kind: 'file', role: 'real', ref: null, label: key, rect, glyph: rect, placed: !!placed, locked: false, ghost: null, draftId: null }
  }
  for (const key of keys) cards.push(card(key, nodes.get(key)!.kind, derived.get(key)!))

  // What a check refused lands in a tray beneath it, once a run has refused something.
  for (const step of plan.steps) {
    const count = refusedCount(step)
    if (!step.checks || count === 0) continue
    const checkKey = nodeKey.step(step.id)
    const checkCard = cards.find((c) => c.key === checkKey)
    if (!checkCard) continue
    const key = nodeKey.refused(step.id)
    nodes.set(key, { key, kind: 'refused', refused: { check: step, count } })
    const at = { x: checkCard.rect.x + (SIZE.check.w - SIZE.refused.w) / 2, y: checkCard.rect.y + SIZE.check.h + TRAY_GAP }
    derived.set(key, at)
    cards.push(card(key, 'refused', at))
    refusals.add(connect(checkKey, key))
  }

  const snapshot: SceneSnapshot = {
    cards,
    byKey: new Map(cards.map((c) => [c.key, c])),
    connectors,
    cardSize: { w: SIZE.step.w, h: SIZE.step.h },
    grid: null,
    slotColumns: Math.max(1, columns.length),
  }
  return { snapshot, nodes, derived, gates, refusals }
}

/** The layout after a node is dropped at `at`: back on its derived place, it leaves the layout. */
export function placeNode(layout: WorkflowLayout, model: WorkflowCanvasModel, key: string, at: Pt): WorkflowLayout {
  const home = model.derived.get(key)
  const next: Record<string, Pt> = { ...layout }
  if (home && Math.abs(home.x - at.x) < 0.5 && Math.abs(home.y - at.y) < 0.5) delete next[key]
  else next[key] = { x: Math.round(at.x), y: Math.round(at.y) }
  return next
}

const LAYOUT_PREFIX = 'sh-workflow-canvas:'

function readLayout(key: string): WorkflowLayout {
  try {
    const raw = globalThis.localStorage?.getItem(`${LAYOUT_PREFIX}${key}`)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? (parsed as WorkflowLayout) : {}
  } catch {
    return {}
  }
}

function writeLayout(key: string, layout: WorkflowLayout): void {
  try {
    globalThis.localStorage?.setItem(`${LAYOUT_PREFIX}${key}`, JSON.stringify(layout))
  } catch {
    /* layout is a convenience; a browser that refuses storage keeps the derived positions */
  }
}

/** How a step works, in words: once, once per item of a stack, or checking each item of one. */
export function stepModeWords(step: WorkflowPlanStepView): string {
  if (step.checks) return `checks each of ${humanName(step.checks)}`
  if (step.mode === 'perItem') return `once for each of ${humanName(step.over ?? '')}`
  return 'once'
}

/** A collection or node id as a person reads it: `verified_entries` → "verified entries". */
export function humanName(id: string): string {
  return id.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().trim()
}

function tallyWords(step: WorkflowPlanStepView): string {
  const p = step.progress
  if (step.checks && step.verdicts && (!p || p.started === p.done + p.failed)) {
    return `${step.verdicts.passed} passed${step.verdicts.refused ? ` · ${step.verdicts.refused} refused` : ''}`
  }
  if (!p) return ''
  const running = p.started - p.done - p.failed
  if (step.mode === 'perItem' && running > 0) return `${p.done + p.failed} of ${p.started}${p.failed ? ` · ${p.failed} failed` : ''}`
  if (running > 0) return 'working…'
  return [`${p.done} done`, p.failed ? `${p.failed} failed` : ''].filter(Boolean).join(' · ')
}

/** A stack's count, in words: what it held after the run, or how its maker is getting on during it. */
function stackWords(stack: WorkflowStackView, maker: WorkflowPlanStepView | undefined): { count: string; note: string } {
  if (stack.items) {
    const unfit = (stack.objects ?? []).filter((o) => o?.stance === 'unfit').length
    const note = stack.itemClass ? (stack.items.length === 1 ? stack.itemClass.label : stack.itemClass.plural).toLowerCase() : stack.items.length === 1 ? 'item' : 'items'
    return { count: String(stack.items.length), note: unfit ? `${note} · ${unfit} unfit` : note }
  }
  const p = maker?.progress
  if (p && p.started > p.done + p.failed) return { count: '…', note: 'filling' }
  const fields = stack.itemClass ? stack.itemClass.columns.map((c) => c.label) : stack.fields
  return { count: '', note: fields.length ? fields.slice(0, 3).join(' · ') : '' }
}

function sourceWhere(source: WorkflowSourceView): string {
  const doc = source.documentTitle ?? source.documentId ?? 'no document yet'
  return source.fromBlock || source.toBlock ? `${doc} · a section` : doc
}

// Small line glyphs (Lucide's shapes, drawn here so the scene needs no icon package), each a whole <svg>.
const GLYPH: Readonly<Record<'source' | 'step' | 'check' | 'stack' | 'destination' | 'refused', TemplateResult>> = {
  source: html`<svg class="glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>`,
  step: html`<svg class="glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  check: html`<svg class="glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>`,
  stack: html`<svg class="glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/></svg>`,
  destination: html`<svg class="glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/></svg>`,
  refused: html`<svg class="glyph" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>`,
}

/** A node kind's small line glyph, for the scene, the inspector and the full views. */
export function workflowGlyph(kind: keyof typeof GLYPH): TemplateResult {
  return glyph(kind)
}

// Each glyph is one whole template, with no binding inside its <svg> (a binding there is lost by some DOMs).
function glyph(kind: keyof typeof GLYPH): TemplateResult {
  return GLYPH[kind]
}

interface Drag {
  readonly key: string
  readonly pointer: number
  readonly from: Pt
  delta: Pt
  moved: boolean
  guides: readonly SnapGuide[]
}

interface Pan {
  readonly pointer: number
  readonly from: Pt
  readonly camera: Camera
  moved: boolean
}

const DOUBLE_CLICK_MS = 400

export class ShWorkflowScene extends LitElement {
  static override properties = { plan: { attribute: false } }
  declare plan: WorkflowPlanOptions | null

  private lastClick: { key: string; at: number } | null = null
  private engine: CanvasEngine = houseEngine
  private engineLoading = false
  private layoutKey = ''
  private layout: WorkflowLayout = {}
  private camera: Camera = { x: 0, y: 0, zoom: 1 }
  private fittedFor = ''
  private fittedSize = ''
  /** The person moved the camera: a new structure still refits, a resize no longer does. */
  private cameraMoved = false
  private drag: Drag | null = null
  private pan: Pan | null = null
  private modelCache: { plan: WorkflowPlanOptions; layout: WorkflowLayout; wrap: number; model: WorkflowCanvasModel } | null = null
  private routeCache: { scene: SceneSnapshot; engine: CanvasEngine; routes: ReadonlyMap<string, ConnectorPath> } | null = null
  private resizer: ResizeObserver | null = null

  constructor() {
    super()
    this.plan = null
    this.tabIndex = -1
    this.addEventListener('pointerdown', this.onBackgroundDown)
    this.addEventListener('wheel', this.onWheel, { passive: false })
    this.addEventListener('pointermove', this.onPointerMove)
    this.addEventListener('pointerup', this.onPointerUp)
    this.addEventListener('pointercancel', this.onPointerCancel)
    this.addEventListener('keydown', this.onKeyDown)
  }

  static override styles = css`
    :host {
      display: block;
      position: relative;
      overflow: hidden;
      height: 100%;
      min-height: 240px;
      background: var(--mn-color-surface-canvas);
      touch-action: none;
      font-family: var(--mn-font-chrome);
      color: var(--mn-color-text-primary);
      cursor: default;
      outline: none;
    }
    :host([data-panning]) { cursor: grabbing; }
    .scene { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
    .node {
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
      cursor: pointer;
      touch-action: none;
      user-select: none;
      transition: border-color .3s, box-shadow .3s, background-color .3s;
    }
    .node:focus-visible { box-shadow: var(--mn-focus-ring); outline: none; }
    .node[data-selected] { border-color: var(--mn-color-border-accent); box-shadow: 0 0 0 2px var(--mn-color-border-accent); }
    .node[data-dragging] { cursor: grabbing; z-index: 2; box-shadow: var(--mn-shadow-raised, var(--mn-shadow-card, none)); }
    .node[data-changed]:not([data-selected]) { border-color: var(--mn-color-border-accent); box-shadow: 0 0 0 1px var(--mn-color-border-accent); }
    .node[data-problem] { border-color: var(--mn-color-danger-border); }
    .head { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .glyph { width: 15px; height: 15px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; color: var(--mn-color-text-secondary); }
    .label {
      font-size: var(--mn-text-md, 14px);
      font-weight: 600;
      line-height: 1.25;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .sub { font-size: var(--mn-text-xs, 11px); line-height: 1.3; color: var(--mn-color-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tally { font-size: var(--mn-text-xs, 11px); line-height: 1.3; font-variant-numeric: tabular-nums; }
    .flag {
      position: absolute; top: -9px; right: -9px; min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box;
      border-radius: 9px; background: var(--mn-color-danger-surface); border: 1px solid var(--mn-color-danger-border);
      color: var(--mn-color-text-danger); font-size: 11px; font-weight: 700; line-height: 16px; text-align: center;
    }

    /* a person at work, done, or failed */
    .node[data-run='running'] { background: var(--mn-color-warning-surface); border-color: var(--mn-color-warning-border); animation: working 1.6s ease-in-out infinite; }
    .node[data-run='done'] { background: var(--mn-color-success-surface); border-color: var(--mn-color-success-border); }
    .node[data-run='failed'] { background: var(--mn-color-danger-surface); border-color: var(--mn-color-danger-border); }
    .node[data-run='running'] .tally { color: var(--mn-color-warning-strong, var(--mn-color-text-warning)); }
    .node[data-run='done'] .tally { color: var(--mn-color-success-strong, var(--mn-color-text-success)); }
    .node[data-run='failed'] .tally { color: var(--mn-color-text-danger); }
    @keyframes working { 50% { box-shadow: 0 0 0 4px var(--mn-color-warning-surface); } }
    @media (prefers-reduced-motion: reduce) { .node[data-run='running'] { animation: none; } }

    /* a check is a gate: its left edge is the bar the items pass */
    .node[data-kind='check'] { border-left: 4px solid var(--mn-color-text-danger); }

    /* a source is a book on the shelf; a destination is a margin */
    .node[data-kind='source'], .node[data-kind='destination'] { background: var(--mn-color-surface-sunken, var(--mn-color-surface-raised)); }
    .node[data-kind='source'] { border-left: 4px double var(--mn-color-border-strong, var(--mn-color-border-default)); }
    .node[data-kind='destination'] { border-right: 4px double var(--mn-color-border-strong, var(--mn-color-border-default)); }

    /* a stack of paper: two sheets behind the top one */
    .node[data-kind='stack'] {
      align-items: center; text-align: center; padding: 6px 10px;
      box-shadow: 3px 3px 0 -1px var(--mn-color-surface-raised), 3px 3px 0 0 var(--mn-color-border-default),
        6px 6px 0 -1px var(--mn-color-surface-raised), 6px 6px 0 0 var(--mn-color-border-subtle);
    }
    .node[data-kind='stack'][data-selected] {
      box-shadow: 0 0 0 2px var(--mn-color-border-accent), 3px 3px 0 -1px var(--mn-color-surface-raised), 3px 3px 0 0 var(--mn-color-border-default);
    }
    .node[data-kind='stack'] .label { font-size: var(--mn-text-sm, 12.5px); font-weight: 600; -webkit-line-clamp: 1; }
    .count { font-size: 17px; font-weight: 600; line-height: 1.1; font-variant-numeric: tabular-nums; }
    .count:empty { display: none; }

    /* what a check refused */
    .node[data-kind='refused'] {
      align-items: center; text-align: center; padding: 4px 8px; border-style: dashed; border-color: var(--mn-color-danger-border);
      background: var(--mn-color-surface-canvas); color: var(--mn-color-text-danger); box-shadow: none;
    }
    .node[data-kind='refused'] .glyph { color: var(--mn-color-text-danger); }

    .wires { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: visible; pointer-events: none; }
    .wire .line { fill: none; stroke: var(--mn-color-text-secondary); stroke-width: 1.5; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
    .wire .arrow { fill: var(--mn-color-text-secondary); stroke: none; }
    .wire[data-gate] .line { stroke: var(--mn-color-text-danger); }
    .wire[data-gate] .arrow { fill: var(--mn-color-text-danger); }
    .wire[data-refusal] .line { stroke: var(--mn-color-text-danger); stroke-dasharray: 4 4; }
    .wire[data-refusal] .arrow { fill: var(--mn-color-text-danger); }
    .wire[data-lit] .line { stroke: var(--mn-color-border-accent); stroke-width: 2.25; }
    .wire[data-lit] .arrow { fill: var(--mn-color-border-accent); }
    .guide { stroke: var(--mn-color-border-accent); stroke-width: 1; stroke-dasharray: 3 3; vector-effect: non-scaling-stroke; }
    .wire-label {
      position: absolute; transform: translate(-50%, -50%); white-space: nowrap; padding: 0 var(--mn-space-1, 4px);
      font-size: var(--mn-text-xs, 11px); line-height: var(--mn-leading-ui, 1.3); color: var(--mn-color-text-secondary);
      background: var(--mn-color-surface-canvas); border-radius: var(--mn-radius-sm, 3px); pointer-events: none; font-style: italic;
    }
    .empty {
      position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none;
      color: var(--mn-color-text-secondary); font-size: var(--mn-text-md, 14px); text-align: center; padding: 24px;
    }
  `

  override connectedCallback(): void {
    super.connectedCallback()
    this.resizer = new ResizeObserver(() => {
      if (`${this.clientWidth}x${this.clientHeight}` === this.fittedSize) return
      // A new size may reflow the lines (which refits); otherwise it refits only a camera the person has not moved.
      if (!this.cameraMoved) this.fittedFor = ''
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

  private model(plan: WorkflowPlanOptions): WorkflowCanvasModel {
    if (plan.definition !== this.layoutKey) {
      this.layoutKey = plan.definition
      this.layout = readLayout(plan.definition)
      this.fittedFor = ''
      this.cameraMoved = false
    }
    // Lines as wide as the pane at life size (in steps of 40px, so a small resize does not reflow).
    const wrap = this.clientWidth > 0 ? Math.max(560, Math.floor((this.clientWidth - 2 * FIT_INSET) / 40) * 40) : Number.POSITIVE_INFINITY
    const cache = this.modelCache
    if (cache && cache.plan === plan && cache.layout === this.layout && cache.wrap === wrap) return cache.model
    const model = workflowCanvasModel(plan, this.layout, wrap)
    this.modelCache = { plan, layout: this.layout, wrap, model }
    return model
  }

  private routes(scene: SceneSnapshot): ReadonlyMap<string, ConnectorPath> {
    const cache = this.routeCache
    if (cache && cache.scene === scene && cache.engine === this.engine) return cache.routes
    const routes = this.engine.route(scene, { pad: ROUTE_PAD })
    this.routeCache = { scene, engine: this.engine, routes }
    return routes
  }

  private select(key: string | null): void {
    this.dispatchEvent(new CustomEvent('sh-workflow-select', { detail: { key }, bubbles: true, composed: true }))
    this.plan?.onSelect?.(key)
  }

  /**
   * Open a node full size (a double-click, or Enter on the selected node): a person, a check, a stack or a check's
   * refusals fills the pane; a source opens its document at its section; a destination, its document.
   */
  private open(key: string): void {
    const plan = this.plan
    if (!plan) return
    const kind = key.slice(0, key.indexOf(':'))
    const id = key.slice(key.indexOf(':') + 1)
    if (kind === 'source') {
      const source = plan.sources?.find((s) => s.id === id)
      if (source?.documentId) plan.onOpenDocument?.({ documentId: source.documentId, blockId: source.fromBlock ?? null })
      return
    }
    if (kind === 'destination') {
      const destination = plan.destinations?.find((d) => d.id === id)
      if (destination?.documentId) plan.onOpenDocument?.({ documentId: destination.documentId })
      return
    }
    plan.onFocus?.({ key })
  }

  override render() {
    const plan = this.plan
    if (!plan) return nothing
    const model = this.model(plan)
    const structure = `${this.modelCache?.wrap ?? ''}|${model.snapshot.cards.map((card) => card.key).join(',')}`
    if (this.fittedFor !== structure && this.clientWidth > 0) {
      this.fitView(model)
      this.fittedFor = structure
    }
    let scene = model.snapshot
    let routes = this.routes(scene)
    const drag = this.drag?.moved ? this.drag : null
    if (drag) {
      scene = moveCards(scene, [drag.key], drag.delta)
      routes = this.engine.reroute(scene, new Set([drag.key]), routes, { pad: ROUTE_PAD })
    }
    const selected = plan.selected ?? null
    const lit = (c: SceneConnector) => selected !== null && (c.from === selected || c.to === selected)
    const { x, y, zoom } = this.camera
    const empty = scene.cards.length === 0
    return html`<div class="scene" style="transform: scale(${zoom}) translate(${x}px, ${y}px)">
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
          return svg`<g class="wire" data-wire=${c.id} ?data-gate=${model.gates.has(c.id)} ?data-refusal=${model.refusals.has(c.id)} ?data-lit=${lit(c)}><path class="line" d=${d}></path><polygon class="arrow" points=${arrow}></polygon></g>`
        })}
        ${drag ? drag.guides.map((g) => (g.axis === 'x'
          ? svg`<line class="guide" x1=${g.at} y1=${g.from} x2=${g.at} y2=${g.to}></line>`
          : svg`<line class="guide" x1=${g.from} y1=${g.at} x2=${g.to} y2=${g.at}></line>`)) : nothing}
      </svg>
      ${scene.connectors.map((c) => {
        const route = routes.get(c.id)
        return route && c.label ? html`<span class="wire-label" style="left:${route.labelAnchor.x}px;top:${route.labelAnchor.y}px">${c.label}</span>` : nothing
      })}
      ${repeat(scene.cards, (card) => card.key, (card) => {
        const node = model.nodes.get(card.key)
        return node ? this.renderNode(node, card, plan, model, selected === card.key, drag?.key === card.key) : nothing
      })}
    </div>
    ${empty ? html`<div class="empty">${plan.status === 'loading' ? 'Reading the workflow…' : 'Nothing here yet. Tell Sophia what this workflow should do, and it is drawn here as she writes it.'}</div>` : nothing}`
  }

  private renderNode(node: WorkflowCanvasNode, card: SceneCard, plan: WorkflowPlanOptions, model: WorkflowCanvasModel, selected: boolean, dragging: boolean): TemplateResult {
    const style = `left:${card.rect.x}px;top:${card.rect.y}px;width:${card.rect.w}px;height:${card.rect.h}px`
    const problems = node.step?.problems ?? node.source?.problems ?? node.stack?.problems ?? node.destination?.problems ?? []
    const common = (label: string, body: TemplateResult, extra: { run?: StepRunState; changed?: boolean } = {}) => html`<div class="node" role="button" tabindex="0"
      aria-label=${label} aria-pressed=${selected ? 'true' : 'false'}
      data-key=${card.key} data-kind=${node.kind} data-run=${extra.run ?? 'idle'}
      ?data-selected=${selected} ?data-dragging=${dragging} ?data-changed=${!!extra.changed} ?data-problem=${problems.length > 0}
      style=${style}
      @pointerdown=${(e: PointerEvent) => this.onNodeDown(e, card.key)}
      @keydown=${(e: KeyboardEvent) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        if (e.key === 'Enter' && selected) this.open(card.key)
        else this.select(card.key)
      }}>
      ${body}
      ${problems.length > 0 ? html`<span class="flag" title=${problems.join('\n')}>${problems.length}</span>` : nothing}
    </div>`
    if (node.step) {
      const step = node.step
      const run = stepRunState(step)
      const tally = tallyWords(step)
      const being = plan.cast?.find((face) => face.stepId === step.id)
      return common([step.label, step.job, stepModeWords(step), tally].filter(Boolean).join(', '), html`
        <div class="head">${being ? html`<sh-being-mark agent-id=${being.agentId} name=${being.name} .size=${18}></sh-being-mark>` : glyph(step.checks ? 'check' : 'step')}<div class="label" title=${step.label}>${step.label}</div></div>
        <div class="sub">${step.job} · ${step.checks ? 'checks each' : step.mode === 'perItem' ? '× each' : 'once'}</div>
        ${tally ? html`<div class="tally">${tally}</div>` : nothing}`, { run, changed: step.changed })
    }
    if (node.source) {
      const source = node.source
      return common(`Source: ${source.label}, ${sourceWhere(source)}`, html`
        <div class="head">${glyph('source')}<div class="label" title=${source.label}>${source.label}</div></div>
        <div class="sub" title=${sourceWhere(source)}>${sourceWhere(source)}</div>`, { changed: source.changed })
    }
    if (node.stack) {
      const stack = node.stack
      const maker = plan.steps.find((s) => s.id === stack.producer)
      const words = stackWords(stack, maker)
      // A typed stack is called by its class (typed objects D8.1): "Dream reports".
      const name = stack.itemClass?.plural ?? humanName(stack.id)
      return common(`Stack: ${name}${words.count ? `, ${words.count} ${words.note}` : ''}`, html`
        <div class="label" title=${stack.itemClass ? `${name} (${humanName(stack.id)})` : name}>${name}</div>
        <div class="count">${words.count}</div>
        ${words.note ? html`<div class="sub" title=${words.note}>${words.note}</div>` : nothing}`)
    }
    if (node.destination) {
      const destination = node.destination
      const ready = plan.publish && plan.publish.destination === destination.id ? plan.publish : null
      const where = destination.documentTitle ?? destination.documentId ?? (destination.kind === 'margin' ? "the margins of what it quotes" : destination.kind ?? '')
      const note = ready ? (ready.status === 'done' ? 'published' : ready.status === 'publishing' ? 'publishing…' : `${ready.count} ready`) : ''
      return common(`Destination: ${destination.label}${note ? `, ${note}` : ''}`, html`
        <div class="head">${glyph('destination')}<div class="label" title=${destination.label}>${destination.label}</div></div>
        <div class="sub" title=${where}>${where}</div>
        ${note ? html`<div class="tally">${note}</div>` : nothing}`, { changed: destination.changed })
    }
    if (node.refused) {
      const { count } = node.refused
      return common(`${count} refused by ${node.refused.check.label}`, html`
        <div class="head">${glyph('refused')}<div class="label">${count} refused</div></div>`)
    }
    void model
    return html``
  }

  /** Fit the whole workflow in the pane (no larger than life, no smaller than readable), leaving room for the Run pill. */
  private fitView(model: WorkflowCanvasModel): void {
    const bounds = rectUnion(model.snapshot.cards.map((card) => card.rect))
    const width = this.clientWidth
    const height = this.clientHeight
    this.fittedSize = `${width}x${height}`
    if (!bounds) return
    const room = { w: Math.max(1, width - 2 * FIT_INSET), h: Math.max(1, height - 2 * FIT_INSET - PILL_ROOM) }
    const zoom = Math.min(FIT_MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(room.w / bounds.w, room.h / bounds.h)))
    const left = (width - bounds.w * zoom) / 2
    const top = Math.max(FIT_INSET, (height - PILL_ROOM - bounds.h * zoom) / 2)
    this.camera = { x: left / zoom - bounds.x, y: top / zoom - bounds.y, zoom }
  }

  private zoomAt(clientX: number, clientY: number, factor: number): void {
    const box = this.getBoundingClientRect()
    const px = clientX - box.left
    const py = clientY - box.top
    const { x, y, zoom } = this.camera
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor))
    // Keep the scene point under the pointer where it is.
    const sx = px / zoom - x
    const sy = py / zoom - y
    this.camera = { x: px / next - sx, y: py / next - sy, zoom: next }
    this.cameraMoved = true
    this.requestUpdate()
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) {
      this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01))
      return
    }
    const { zoom } = this.camera
    this.camera = { ...this.camera, x: this.camera.x - e.deltaX / zoom, y: this.camera.y - e.deltaY / zoom }
    this.cameraMoved = true
    this.requestUpdate()
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.plan?.selected) {
      e.preventDefault()
      this.select(null)
    }
  }

  private onBackgroundDown = (e: PointerEvent): void => {
    if (e.button !== 0 || this.drag || this.pan) return
    this.focus({ preventScroll: true })
    this.pan = { pointer: e.pointerId, from: { x: e.clientX, y: e.clientY }, camera: this.camera, moved: false }
    this.setPointerCapture(e.pointerId)
  }

  private onNodeDown(e: PointerEvent, key: string): void {
    if (e.button !== 0 || this.drag) return
    e.stopPropagation()
    this.drag = { key, pointer: e.pointerId, from: { x: e.clientX, y: e.clientY }, delta: { x: 0, y: 0 }, moved: false, guides: [] }
    this.setPointerCapture(e.pointerId)
  }

  private onPointerMove = (e: PointerEvent): void => {
    const pan = this.pan
    if (pan && e.pointerId === pan.pointer) {
      const dx = e.clientX - pan.from.x
      const dy = e.clientY - pan.from.y
      if (!pan.moved && Math.hypot(dx, dy) < 3) return
      if (!pan.moved) this.toggleAttribute('data-panning', true)
      pan.moved = true
      this.camera = { ...pan.camera, x: pan.camera.x + dx / pan.camera.zoom, y: pan.camera.y + dy / pan.camera.zoom }
      this.cameraMoved = true
      this.requestUpdate()
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
    const pan = this.pan
    if (pan && e.pointerId === pan.pointer) {
      this.pan = null
      this.toggleAttribute('data-panning', false)
      // A click on the canvas itself, not a pan: the workflow as a whole is what the sidebar shows.
      if (!pan.moved) this.select(null)
      return
    }
    const drag = this.drag
    if (!drag || e.pointerId !== drag.pointer) return
    this.drag = null
    this.engine.releaseDrag?.()
    if (drag.moved && this.plan) {
      const model = this.model(this.plan)
      const card = model.snapshot.byKey.get(drag.key)
      if (card) {
        this.layout = placeNode(this.layout, model, drag.key, { x: card.rect.x + drag.delta.x, y: card.rect.y + drag.delta.y })
        writeLayout(this.layoutKey, this.layout)
      }
    } else if (!drag.moved) {
      // A second click on the same node, soon after the first: open it.
      const now = performance.now()
      if (this.lastClick?.key === drag.key && now - this.lastClick.at < DOUBLE_CLICK_MS) {
        this.lastClick = null
        this.open(drag.key)
      } else {
        this.lastClick = { key: drag.key, at: now }
        this.select(drag.key)
      }
    }
    this.requestUpdate()
  }

  private onPointerCancel = (e: PointerEvent): void => {
    if (this.pan && e.pointerId === this.pan.pointer) {
      this.pan = null
      this.toggleAttribute('data-panning', false)
    }
    if (!this.drag || e.pointerId !== this.drag.pointer) return
    this.drag = null
    this.engine.releaseDrag?.()
    this.requestUpdate()
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('sh-workflow-scene')) {
  customElements.define('sh-workflow-scene', ShWorkflowScene)
}
