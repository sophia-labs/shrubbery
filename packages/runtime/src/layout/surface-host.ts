/**
 * surface-host.ts — shell chrome for a live LayoutDocument.
 *
 * LayoutInterpreter deliberately owns content geometry and FaceView lifetime,
 * not interactive chrome. This controller is the one reusable companion that
 * turns its solved split wrappers into accessible divider handles. It is used
 * by the production workspace Surface; harnesses can migrate to it without
 * copying another pointer/keyboard implementation.
 */
import {
  applyOperation,
  type Axis,
  type LayoutDocument,
  type LayoutOperation,
  type LayoutSplitNode,
  type LayoutTabsNode,
} from '@shrubbery/nucleus/layout'
import type { FaceRegistry } from './face-registry.js'
import { LayoutInterpreter } from './layout-interpreter.js'
import type { ResourceBroker } from './types.js'
import type { TabActivateRequest } from './layout-interpreter.js'

export interface SurfaceDividerPolicy {
  readonly enabled: boolean
  readonly label?: string
  /** Inclusive legal bounds for the start side, in basis points. */
  readonly minBasisPoints?: number
  readonly maxBasisPoints?: number
}

export interface SurfaceRatioChange {
  readonly host: HTMLElement
  readonly document: LayoutDocument
  readonly operation: Extract<LayoutOperation, { readonly op: 'set_ratio' }>
  readonly split: LayoutSplitNode
  readonly source: 'pointer' | 'keyboard'
  readonly phase: 'input' | 'commit'
  readonly splitBox: {
    readonly left: number
    readonly top: number
    readonly width: number
    readonly height: number
  }
}

export interface LayoutSurfaceControllerOptions {
  readonly registry: FaceRegistry
  readonly broker: ResourceBroker
  readonly dividerThickness?: number
  /** Current host session/auth generation; a change invalidates live resource mounts. */
  readonly resourceScope?: () => string | number | null
  /**
   * Passed straight through to `LayoutInterpreter` — the broker-registered
   * adapter id a grid's COLLECTION children source resolves through. Only a
   * document that actually binds a collection grid consults it; omitting it
   * while reconciling one paints that grid's own honest error state (see
   * `LayoutInterpreterOptions.gridCollectionResourceAdapterId`).
   */
  readonly gridCollectionResourceAdapterId?: string
  readonly dividerPolicy?: (split: LayoutSplitNode, box: SurfaceRatioChange['splitBox']) => SurfaceDividerPolicy
  readonly onRatioChange?: (change: SurfaceRatioChange) => void
  readonly onSizeChange?: (width: number, height: number) => void
  readonly onActiveTabChange?: (change: SurfaceActiveTabChange) => void
}

export interface SurfaceActiveTabChange {
  readonly host: HTMLElement
  readonly document: LayoutDocument
  readonly operation: Extract<LayoutOperation, { readonly op: 'tabs_set_active' }>
  readonly tabs: LayoutTabsNode
  readonly source: 'pointer' | 'keyboard'
}

const DEFAULT_POLICY: SurfaceDividerPolicy = Object.freeze({
  enabled: true,
  minBasisPoints: 100,
  maxBasisPoints: 9900,
})

function finitePx(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function splitBox(wrapper: HTMLElement): SurfaceRatioChange['splitBox'] {
  return {
    left: finitePx(wrapper.style.left),
    top: finitePx(wrapper.style.top),
    width: finitePx(wrapper.style.width),
    height: finitePx(wrapper.style.height),
  }
}

function clampBasisPoints(value: number, policy: SurfaceDividerPolicy): number {
  const min = Math.max(1, Math.min(9999, Math.round(policy.minBasisPoints ?? 100)))
  const max = Math.max(min, Math.min(9999, Math.round(policy.maxBasisPoints ?? 9900)))
  return Math.min(max, Math.max(min, Math.round(value)))
}

function collectSplitIds(node: unknown, into: string[]): void {
  const candidate = node as { readonly kind?: string; readonly id?: string; readonly start?: unknown; readonly end?: unknown }
  if (candidate.kind === 'tabs') {
    collectSplitIds((candidate as { readonly active?: unknown }).active, into)
    return
  }
  if (candidate.kind !== 'split' || typeof candidate.id !== 'string') return
  into.push(candidate.id)
  collectSplitIds(candidate.start, into)
  collectSplitIds(candidate.end, into)
}

/**
 * Owns one interpreter, its resize observation, and split chrome. Calls to
 * setDocument are coalesced and serialized: a fast pointer drag can never run
 * two async reconciliations over the same FaceView concurrently.
 */
export class LayoutSurfaceController {
  readonly contentRoot: HTMLDivElement
  readonly dividerOverlay: HTMLDivElement

  private readonly host: HTMLElement
  private readonly registry: FaceRegistry
  private readonly interpreter: LayoutInterpreter
  private readonly dividerPolicy: NonNullable<LayoutSurfaceControllerOptions['dividerPolicy']>
  private readonly onRatioChange: LayoutSurfaceControllerOptions['onRatioChange']
  private readonly onSizeChange: LayoutSurfaceControllerOptions['onSizeChange']
  private readonly onActiveTabChange: LayoutSurfaceControllerOptions['onActiveTabChange']
  private readonly resizeObserver: ResizeObserver | null

  private document: LayoutDocument | null = null
  private width = 0
  private height = 0
  private dirty = false
  private draining = false
  private disposed = false
  private readyPromise: Promise<void> = Promise.resolve()
  private resolveReady: (() => void) | null = null
  private focusAfterReconcile: string | null = null
  private disposePromise: Promise<void> | null = null

  constructor(host: HTMLElement, options: LayoutSurfaceControllerOptions) {
    this.host = host
    this.registry = options.registry
    this.dividerPolicy = options.dividerPolicy ?? (() => DEFAULT_POLICY)
    this.onRatioChange = options.onRatioChange
    this.onSizeChange = options.onSizeChange
    this.onActiveTabChange = options.onActiveTabChange

    this.contentRoot = document.createElement('div')
    this.contentRoot.dataset.layoutSurfaceContent = 'true'
    this.contentRoot.style.cssText = 'position:absolute;inset:0;min-width:0;min-height:0;overflow:hidden;'

    this.dividerOverlay = document.createElement('div')
    this.dividerOverlay.dataset.layoutSurfaceDividers = 'true'
    this.dividerOverlay.style.cssText = 'position:absolute;inset:0;z-index:40;pointer-events:none;'

    host.style.position = 'relative'
    host.style.overflow = 'hidden'
    host.append(this.contentRoot, this.dividerOverlay)

    this.interpreter = new LayoutInterpreter(this.contentRoot, {
      registry: options.registry,
      broker: options.broker,
      dividerThickness: options.dividerThickness,
      resourceScope: options.resourceScope,
      gridCollectionResourceAdapterId: options.gridCollectionResourceAdapterId,
      onTabActivate: (request) => this.applyActiveTab(request),
    })
    // LayoutInterpreter establishes `position:relative` for ordinary roots.
    // Here the root is the content layer of an overlay stack, so restore the
    // controller's full-inset containing block after construction.
    this.contentRoot.style.position = 'absolute'
    this.contentRoot.style.inset = '0'
    this.contentRoot.style.width = '100%'
    this.contentRoot.style.height = '100%'

    if (typeof ResizeObserver === 'undefined') {
      this.resizeObserver = null
    } else {
      this.resizeObserver = new ResizeObserver(() => this.measure())
      this.resizeObserver.observe(host)
    }
    this.measure()
  }

  setDocument(next: LayoutDocument): void {
    if (this.disposed) return
    this.document = next
    this.requestReconcile()
  }

  currentDocument(): LayoutDocument | null {
    return this.document
  }

  currentInterpreter(): LayoutInterpreter {
    return this.interpreter
  }

  /** Resolves after the newest queued document/measurement has reconciled. */
  whenReady(): Promise<void> {
    return this.readyPromise
  }

  /** Useful in layout-less tests that cannot deliver ResizeObserver entries. */
  setSize(width: number, height: number): void {
    if (this.disposed) return
    const nextWidth = Math.max(0, width)
    const nextHeight = Math.max(0, height)
    if (nextWidth === this.width && nextHeight === this.height) return
    this.width = nextWidth
    this.height = nextHeight
    this.onSizeChange?.(nextWidth, nextHeight)
    this.requestReconcile()
  }

  /**
   * Re-read the connected host box immediately.
   *
   * A custom element may be configured while detached. Its constructor then
   * correctly observes a 0×0 box, but some browsers do not deliver a second
   * ResizeObserver record merely because that already-observed element became
   * connected. The owning element calls this at connection so the first real
   * reconciliation cannot remain pinned to the solver's 1px bootstrap floor.
   */
  measureNow(): void {
    this.measure()
  }

  private measure(): void {
    const rect = this.host.getBoundingClientRect()
    const width = rect.width || this.host.clientWidth
    const height = rect.height || this.host.clientHeight
    this.setSize(width, height)
  }

  private requestReconcile(): void {
    if (this.disposed) return
    this.dirty = true
    if (!this.resolveReady) {
      this.readyPromise = new Promise<void>((resolve) => {
        this.resolveReady = resolve
      })
    }
    if (this.draining) return
    this.draining = true
    queueMicrotask(() => void this.drain())
  }

  private async drain(): Promise<void> {
    try {
      while (this.dirty && !this.disposed) {
        this.dirty = false
        const current = this.document
        if (!current) continue
        // A zero box is common for a detached test host. Reconcile against a
        // one-pixel floor so content can still mount; a real measurement will
        // immediately resize it without a remount.
        await this.interpreter.reconcile(current, {
          width: Math.max(1, this.width),
          height: Math.max(1, this.height),
        })
        this.renderDividers()
      }
    } finally {
      this.draining = false
      if (this.dirty && !this.disposed) {
        this.draining = true
        queueMicrotask(() => void this.drain())
      } else {
        const resolve = this.resolveReady
        this.resolveReady = null
        resolve?.()
      }
    }
  }

  private renderDividers(): void {
    // Divider chrome is rebuilt from the latest solved plan. Preserve focus by
    // split id across ordinary model/measurement reconciles too, not only the
    // keyboard operation that explicitly requested a ratio change.
    const active = this.host.ownerDocument.activeElement
    const activeHandle = active instanceof HTMLElement
      ? active.closest<HTMLElement>('[data-layout-divider]')
      : null
    const focusedDividerId = activeHandle && this.dividerOverlay.contains(activeHandle)
      ? activeHandle.dataset.layoutDivider ?? null
      : null
    this.dividerOverlay.replaceChildren()
    const plan = this.interpreter.currentPlan()
    const current = this.document
    if (!plan || !current) return

    const splitIds: string[] = []
    collectSplitIds(plan.root, splitIds)
    for (const splitId of splitIds) {
      const wrapper = this.interpreter.splitWrapperElement(splitId)
      const node = current.nodes[splitId]
      if (!wrapper || !node || node.kind !== 'split') continue
      const box = splitBox(wrapper)
      const policy = this.dividerPolicy(node, box)
      if (!policy.enabled) continue

      const ratio = node.startBasisPoints / 10000
      const handle = document.createElement('div')
      handle.dataset.layoutDivider = splitId
      handle.tabIndex = 0
      handle.setAttribute('role', 'separator')
      handle.setAttribute('aria-orientation', node.axis === 'horizontal' ? 'vertical' : 'horizontal')
      handle.setAttribute('aria-valuemin', String(Math.round((policy.minBasisPoints ?? 100) / 100)))
      handle.setAttribute('aria-valuemax', String(Math.round((policy.maxBasisPoints ?? 9900) / 100)))
      handle.setAttribute('aria-valuenow', String(Math.round(node.startBasisPoints / 100)))
      handle.setAttribute('aria-label', policy.label ?? `Resize ${splitId}`)
      handle.style.cssText = [
        'position:absolute',
        'z-index:1',
        'pointer-events:auto',
        'touch-action:none',
        'background:transparent',
        'outline-offset:-2px',
      ].join(';')
      if (node.axis === 'horizontal') {
        handle.style.left = `${box.left + box.width * ratio - 6}px`
        handle.style.top = `${box.top}px`
        handle.style.width = '12px'
        handle.style.height = `${box.height}px`
        handle.style.cursor = 'col-resize'
      } else {
        handle.style.left = `${box.left}px`
        handle.style.top = `${box.top + box.height * ratio - 6}px`
        handle.style.width = `${box.width}px`
        handle.style.height = '12px'
        handle.style.cursor = 'row-resize'
      }
      const rule = document.createElement('span')
      rule.setAttribute('aria-hidden', 'true')
      rule.style.cssText = node.axis === 'horizontal'
        ? 'position:absolute;inset:0 auto 0 5px;width:1px;background:var(--mn-color-border-default,#cbc5ba);'
        : 'position:absolute;inset:5px 0 auto 0;height:1px;background:var(--mn-color-border-default,#cbc5ba);'
      handle.appendChild(rule)
      handle.addEventListener('pointerdown', (event) => this.startPointerDrag(event, node, box, policy))
      handle.addEventListener('keydown', (event) => this.onDividerKeyDown(event, node, box, policy))
      this.dividerOverlay.appendChild(handle)
    }

    const focusId = this.focusAfterReconcile ?? focusedDividerId
    if (focusId) {
      this.focusAfterReconcile = null
      this.dividerOverlay.querySelector<HTMLElement>(`[data-layout-divider="${CSS.escape(focusId)}"]`)?.focus()
    }
  }

  private applyRatio(
    split: LayoutSplitNode,
    box: SurfaceRatioChange['splitBox'],
    policy: SurfaceDividerPolicy,
    basisPoints: number,
    source: SurfaceRatioChange['source'],
    phase: SurfaceRatioChange['phase'],
  ): boolean {
    const current = this.document
    if (!current) return false
    const startBasisPoints = clampBasisPoints(basisPoints, policy)
    const operation = { op: 'set_ratio', splitId: split.id, startBasisPoints } as const
    const outcome = applyOperation(current, operation, {
      isFaceRegistered: this.registry.toFaceRegistrationPredicate(),
      isFaceGridEligible: this.registry.toFaceGridEligibilityPredicate(),
    })
    if (!outcome.ok) return false
    this.document = outcome.doc
    if (source === 'keyboard') this.focusAfterReconcile = split.id
    this.onRatioChange?.({
      host: this.host,
      document: outcome.doc,
      operation,
      split: { ...split, startBasisPoints },
      source,
      phase,
      splitBox: box,
    })
    this.requestReconcile()
    return true
  }

  private applyActiveTab(request: TabActivateRequest): void {
    const current = this.document
    if (!current) return
    const tabs = current.nodes[request.tabsId]
    if (!tabs || tabs.kind !== 'tabs') return
    const operation = {
      op: 'tabs_set_active',
      tabsId: request.tabsId,
      activeNodeId: request.nodeId,
      expectedTabsRevision: tabs.tabsRevision,
    } as const
    const outcome = applyOperation(current, operation, {
      isFaceRegistered: this.registry.toFaceRegistrationPredicate(),
      isFaceGridEligible: this.registry.toFaceGridEligibilityPredicate(),
    })
    if (!outcome.ok) return
    this.document = outcome.doc
    const nextTabs = outcome.doc.nodes[request.tabsId]
    if (nextTabs?.kind === 'tabs') {
      this.onActiveTabChange?.({ host: this.host, document: outcome.doc, operation, tabs: nextTabs, source: request.source })
    }
    this.requestReconcile()
  }

  private onDividerKeyDown(
    event: KeyboardEvent,
    split: LayoutSplitNode,
    box: SurfaceRatioChange['splitBox'],
    policy: SurfaceDividerPolicy,
  ): void {
    const step = event.shiftKey ? 500 : 100
    let next: number | null = null
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = split.startBasisPoints - step
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = split.startBasisPoints + step
    if (event.key === 'Home') next = policy.minBasisPoints ?? 100
    if (event.key === 'End') next = policy.maxBasisPoints ?? 9900
    if (next === null) return
    event.preventDefault()
    this.applyRatio(split, box, policy, next, 'keyboard', 'commit')
  }

  private startPointerDrag(
    event: PointerEvent,
    split: LayoutSplitNode,
    box: SurfaceRatioChange['splitBox'],
    policy: SurfaceDividerPolicy,
  ): void {
    if (event.button !== 0) return
    event.preventDefault()
    const axis: Axis = split.axis
    let lastBasisPoints = split.startBasisPoints
    const move = (moveEvent: PointerEvent): void => {
      const position = axis === 'horizontal'
        ? moveEvent.clientX - this.host.getBoundingClientRect().left - box.left
        : moveEvent.clientY - this.host.getBoundingClientRect().top - box.top
      const size = axis === 'horizontal' ? box.width : box.height
      if (!(size > 0)) return
      lastBasisPoints = clampBasisPoints((position / size) * 10000, policy)
      this.applyRatio(split, box, policy, lastBasisPoints, 'pointer', 'input')
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      this.applyRatio(split, box, policy, lastBasisPoints, 'pointer', 'commit')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise
    this.disposed = true
    this.resizeObserver?.disconnect()
    this.disposePromise = this.finishDispose()
    return this.disposePromise
  }

  private async finishDispose(): Promise<void> {
    // A reconcile may be suspended in an async broker acquire or face mount.
    // Let that serialized drain settle before disposing the interpreter, or it
    // can resume afterward and create an untracked view/lease in detached DOM.
    await this.readyPromise
    await this.interpreter.dispose()
    this.contentRoot.remove()
    this.dividerOverlay.remove()
    const resolve = this.resolveReady
    this.resolveReady = null
    resolve?.()
  }
}
