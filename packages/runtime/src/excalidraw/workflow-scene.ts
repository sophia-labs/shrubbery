/**
 * The workflow plan as an Excalidraw scene (graph-plan-v1, Vera 2026-10-18: "a good excalidraw use case").
 *
 * The RDF definition stays the source of truth. `workflowPlanScene` derives a skeleton from the plan the pane already
 * holds (phases as lanes, steps as cards, data flow as bound arrows, run state as colour), and `<sh-workflow-scene>`
 * draws it with the same pinned Excalidraw the Files canvas loads. A person may move cards: their positions are layout
 * only, kept in this browser per definition, and applied before the skeleton is converted, so the arrows follow.
 */
import type { WorkflowPlanOptions } from '../render-workspace.js'

/** One element of Excalidraw's skeleton API (`convertToExcalidrawElements`), the subset this scene uses. */
export type WorkflowSceneSkeleton = Readonly<Record<string, unknown>> & { readonly id: string; readonly type: string }

const LANE_WIDTH = 280
const LANE_GAP = 110
const CARD_WIDTH = 240
const CARD_HEIGHT = 110
const CARD_GAP = 36
const TOP = 64

/** Derive the scene skeleton from the plan view. Pure: same plan, same skeleton (ids are stable per step). */
export function workflowPlanScene(plan: WorkflowPlanOptions): readonly WorkflowSceneSkeleton[] {
  const out: WorkflowSceneSkeleton[] = []
  const producers = new Map<string, string>()
  for (const phase of plan.phases) for (const step of phase.steps) if (step.produces) producers.set(step.produces, step.id)
  const tallest = Math.max(1, ...plan.phases.map((phase) => phase.steps.length))
  plan.phases.forEach((phase, i) => {
    const x = i * (LANE_WIDTH + LANE_GAP)
    out.push({
      id: `wf-lane-${i}`,
      type: 'rectangle',
      x,
      y: 0,
      width: LANE_WIDTH,
      height: TOP + tallest * (CARD_HEIGHT + CARD_GAP),
      strokeColor: '#adb5bd',
      backgroundColor: 'transparent',
      strokeStyle: 'dashed',
      roughness: 0,
      locked: true,
    })
    out.push({ id: `wf-lane-title-${i}`, type: 'text', x: x + 14, y: 16, text: `${i + 1} · ${phase.title}`, fontSize: 18, strokeColor: '#495057', locked: true })
    phase.steps.forEach((step, j) => {
      const progress = step.progress
      const running = progress ? progress.started > progress.done + progress.failed : false
      const fill = progress?.failed ? '#ffe3e3' : running ? '#fff3bf' : progress && progress.done > 0 ? '#d3f9d8' : '#ffffff'
      const mode = step.checks ? `checks each ${step.checks}` : step.mode === 'perItem' ? `for each ${step.over ?? ''}` : 'once'
      const tally = progress ? `\n${progress.done} done${running ? ` · ${progress.started - progress.done - progress.failed} running` : ''}${progress.failed ? ` · ${progress.failed} failed` : ''}` : ''
      out.push({
        id: `wf-step-${step.id}`,
        type: 'rectangle',
        x: x + (LANE_WIDTH - CARD_WIDTH) / 2,
        y: TOP + j * (CARD_HEIGHT + CARD_GAP),
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        backgroundColor: fill,
        fillStyle: 'solid',
        strokeColor: step.changed ? '#3557a3' : '#343a40',
        strokeWidth: step.changed ? 3 : 1,
        roundness: { type: 3 },
        label: { text: `${step.label}\n${step.job} · ${mode}${tally}`, fontSize: 16 },
        customData: { workflowStep: step.id },
      })
    })
  })
  for (const phase of plan.phases) {
    for (const step of phase.steps) {
      const reads = [...(step.over && step.over !== step.checks ? [step.over] : []), ...(step.consumes ?? []), ...(step.checks ? [step.checks] : [])]
      for (const collection of new Set(reads)) {
        const from = producers.get(collection)
        if (!from) continue
        out.push({
          id: `wf-edge-${from}-${step.id}-${collection}`,
          type: 'arrow',
          x: 0,
          y: 0,
          start: { id: `wf-step-${from}` },
          end: { id: `wf-step-${step.id}` },
          label: { text: collection, fontSize: 14 },
          strokeColor: step.checks === collection ? '#b4483c' : '#495057',
          strokeStyle: step.checks === collection ? 'dashed' : 'solid',
        })
      }
    }
  }
  return out
}

type Layout = Record<string, { readonly x: number; readonly y: number }>

type Box = { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/**
 * Give each bound arrow its geometry from the cards as placed: the skeleton API binds an arrow to existing elements by
 * id but does not route it, so an unrouted arrow sits at the origin. Left-to-right when the target lies to the right,
 * otherwise top-to-bottom.
 */
export function routeArrows(placed: readonly WorkflowSceneSkeleton[]): WorkflowSceneSkeleton[] {
  const boxes = new Map<string, Box>()
  for (const el of placed) if (el.type === 'rectangle') boxes.set(el.id, el as unknown as Box)
  return placed.map((el) => {
    if (el.type !== 'arrow') return el
    const from = boxes.get((el.start as { id?: string } | undefined)?.id ?? '')
    const to = boxes.get((el.end as { id?: string } | undefined)?.id ?? '')
    if (!from || !to) return el
    const across = to.x >= from.x + from.width
    const start = across ? { x: from.x + from.width, y: from.y + from.height / 2 } : { x: from.x + from.width / 2, y: from.y + from.height }
    const end = across ? { x: to.x, y: to.y + to.height / 2 } : { x: to.x + to.width / 2, y: to.y }
    return { ...el, x: start.x, y: start.y, points: [[0, 0], [end.x - start.x, end.y - start.y]] }
  })
}

function readLayout(key: string): Layout {
  try {
    const raw = globalThis.localStorage?.getItem(`sh-workflow-layout:${key}`)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? (parsed as Layout) : {}
  } catch {
    return {}
  }
}

function writeLayout(key: string, layout: Layout): void {
  try {
    globalThis.localStorage?.setItem(`sh-workflow-layout:${key}`, JSON.stringify(layout))
  } catch {
    /* layout is a convenience; a browser that refuses storage keeps the derived positions */
  }
}

interface SceneRuntime {
  readonly Excalidraw: unknown
  readonly cssText: string
  readonly createElement: (type: unknown, props: Record<string, unknown>) => unknown
  readonly createRoot: (container: Element) => { render(node: unknown): void; unmount(): void }
  readonly convertToExcalidrawElements: (skeleton: readonly unknown[], opts?: Record<string, unknown>) => unknown[]
}

let runtimePromise: Promise<SceneRuntime> | null = null

function loadRuntime(): Promise<SceneRuntime> {
  runtimePromise ??= (async () => {
    // @ts-ignore -- resolved by Vite's CSS inline plugin; some consuming
    // tsconfigs include Vite's declaration while others do not (as excalidraw-runtime.ts).
    const cssModulePromise: Promise<{ default: string }> = import('@excalidraw/excalidraw/index.css?inline')
    const [excalidraw, react, reactDom, cssModule] = await Promise.all([
      import('@excalidraw/excalidraw'),
      import('react'),
      import('react-dom/client'),
      cssModulePromise,
    ])
    const ex = excalidraw as unknown as { Excalidraw: unknown; convertToExcalidrawElements: SceneRuntime['convertToExcalidrawElements'] }
    return {
      Excalidraw: ex.Excalidraw,
      cssText: cssModule.default,
      createElement: react.createElement as unknown as SceneRuntime['createElement'],
      createRoot: reactDom.createRoot as unknown as SceneRuntime['createRoot'],
      convertToExcalidrawElements: ex.convertToExcalidrawElements,
    }
  })()
  return runtimePromise
}

interface SceneApi {
  updateScene(data: { readonly elements?: readonly unknown[] }): void
  // This pinned build fits with `setViewport` (it has no `scrollToContent`).
  setViewport(opts: { readonly target: readonly unknown[]; readonly fit?: 'scale-down' | 'contain' | 'none'; readonly animation?: boolean } | null): void
}

/** `<sh-workflow-scene .scene=${skeleton} .layoutKey=${definition}>`: draws the skeleton; remembers moved cards. */
export class ShWorkflowScene extends HTMLElement {
  private skeleton: readonly WorkflowSceneSkeleton[] = []
  private key = ''
  private drawn = ''
  private api: SceneApi | null = null
  private runtime: SceneRuntime | null = null
  private root: { render(node: unknown): void; unmount(): void } | null = null
  private layout: Layout = {}
  private fitted = false

  set scene(value: readonly WorkflowSceneSkeleton[]) {
    this.skeleton = value
    this.redraw()
  }

  set layoutKey(value: string) {
    if (value === this.key) return
    this.key = value
    this.layout = readLayout(value)
    this.drawn = ''
    this.redraw()
  }

  private container: HTMLElement | null = null

  connectedCallback(): void {
    if (this.root) return
    this.style.cssText = 'display:block;position:relative;width:100%;height:460px;min-height:320px;border-radius:6px;overflow:hidden;'
    const shadow = this.shadowRoot ?? this.attachShadow({ mode: 'open' })
    if (!this.container) {
      this.container = document.createElement('div')
      this.container.style.cssText = 'position:absolute;inset:0;'
      shadow.appendChild(this.container)
    }
    const container = this.container
    void loadRuntime().then((runtime) => {
      if (!this.isConnected || this.root) return
      this.runtime = runtime
      if (!shadow.querySelector('style[data-workflow-scene]')) {
        const style = document.createElement('style')
        style.dataset.workflowScene = 'true'
        style.textContent = runtime.cssText
        shadow.prepend(style)
      }
      this.root = runtime.createRoot(container)
      this.root.render(
        runtime.createElement(runtime.Excalidraw as never, {
          // This pinned Excalidraw build hands its API over through `onInitialize` (as excalidraw-runtime.ts uses it).
          // Draw on the next frame, outside Excalidraw's own commit: a throw inside the callback unmounts its tree.
          onInitialize: (api: SceneApi) => {
            this.api = api
            this.drawn = ''
            requestAnimationFrame(() => this.redraw())
          },
          onChange: (elements: readonly { id: string; x: number; y: number; isDeleted?: boolean }[]) => this.remember(elements),
          initialData: { elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} },
        }),
      )
    })
  }

  disconnectedCallback(): void {
    this.root?.unmount()
    this.root = null
    this.api = null
  }

  /** Keep only what a person moved: a card back at its derived position drops out of the layout. */
  private remember(elements: readonly { id: string; x: number; y: number; isDeleted?: boolean }[]): void {
    let changed = false
    const next: Record<string, { x: number; y: number }> = { ...this.layout }
    for (const el of elements) {
      if (!el.id.startsWith('wf-step-') || el.isDeleted) continue
      const derived = this.skeleton.find((s) => s.id === el.id) as { x?: number; y?: number } | undefined
      if (!derived) continue
      const prior = next[el.id]
      if (derived.x === el.x && derived.y === el.y) {
        if (prior) {
          delete next[el.id]
          changed = true
        }
      } else if (!prior || prior.x !== el.x || prior.y !== el.y) {
        next[el.id] = { x: el.x, y: el.y }
        changed = true
      }
    }
    if (!changed) return
    this.layout = next
    if (this.key) writeLayout(this.key, this.layout)
  }

  private redraw(): void {
    if (!this.api || !this.runtime) return
    const placed = routeArrows(this.skeleton.map((el) => (this.layout[el.id] ? { ...el, ...this.layout[el.id] } : el)))
    const signature = JSON.stringify(placed)
    if (signature === this.drawn) return
    this.drawn = signature
    const elements = this.runtime.convertToExcalidrawElements(placed, { regenerateIds: false })
    this.api.updateScene({ elements })
    if (!this.fitted && elements.length > 0) {
      this.fitted = true
      this.api.setViewport({ target: elements, fit: 'scale-down', animation: false })
    }
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('sh-workflow-scene')) {
  customElements.define('sh-workflow-scene', ShWorkflowScene)
}
