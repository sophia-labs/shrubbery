/**
 * The whiteboard's binding: a Y.Doc (the document's room, FORMAT.md in gardend's `src-tauri/src/whiteboard/`) on one
 * side, an Excalidraw scene on the other. Pure logic over `Y.Doc` and a small scene port, so it runs without a browser;
 * `sh-whiteboard` adapts the real Excalidraw API to the port.
 *
 * The shared format: `elements` is a `Y.Map<string, string>`, key = element id, value = the element's JSON. The unit of
 * collaboration is the whole element; between two copies the higher `version` wins and, on a tie, the lower
 * `versionNonce` (Excalidraw's own rule). A deletion is a tombstone (`isDeleted`, bumped version), so a stale peer
 * cannot resurrect it.
 *
 * - Remote to canvas: observe `elements`, parse the changed entries, take the ones that win, and hand the scene the
 *   merged list. The element a person is dragging or typing into right now is never replaced; its remote version waits
 *   and is judged again once the interaction ends. Elements an agent wrote are re-measured through `refresh` (the
 *   server sizes text approximately), and ONE client, the leader, writes the corrected size back.
 * - Canvas to remote: diff the scene against the last synced versions, write only what changed, in one transaction with
 *   a local origin, throttled, and once more on pointer-up so the final position always lands. Echoes are ignored by
 *   origin.
 * - Images are not shared in v1: they stay on the local canvas and the binding counts them (`droppedImages`) so the
 *   shell can say so.
 */
import * as Y from 'yjs'

export const WHITEBOARD_SCHEMA = 'sophia.whiteboard/1'

/** Transaction origin of every write this binding makes. */
export const LOCAL_ORIGIN: unique symbol = Symbol('sophia.whiteboard.local')

export interface WbElement {
  readonly id: string
  readonly type: string
  readonly version: number
  readonly versionNonce: number
  readonly isDeleted?: boolean
  readonly index?: string | null
  readonly updated?: number
  readonly customData?: Record<string, unknown>
  readonly [key: string]: unknown
}

/** What the binding needs of a canvas. The pane adapts Excalidraw's API to it; tests use a real small model. */
export interface WbScene {
  /** Every element, deleted ones included. */
  getElements(): readonly WbElement[]
  /** Replace the scene's elements. Must not enter the undo history. */
  setElements(elements: readonly WbElement[]): void
  /** Ids a person is dragging, resizing, drawing or typing into right now. */
  busyIds(): ReadonlySet<string>
}

export interface WbToolWrite {
  readonly by: string
  readonly ids: readonly string[]
}

export interface WhiteboardBindingOptions {
  /** Who this client writes as. Default `person`. */
  readonly actor?: string
  readonly throttleMs?: number
  readonly now?: () => number
  readonly schedule?: (callback: () => void, ms: number) => unknown
  readonly cancel?: (handle: unknown) => void
  /** Re-measure elements (Excalidraw's `restoreElements(…, null, { refreshDimensions: true })`). */
  readonly refresh?: (elements: readonly WbElement[]) => readonly WbElement[]
  /** Is this client the one that writes corrected dimensions back? Default true. */
  readonly isLeader?: () => boolean
  /** Something other than a person drew these (a tool, an agent). */
  readonly onToolWrite?: (write: WbToolWrite) => void
  /** Images were left out of what is shared. */
  readonly onImagesLeftOut?: (count: number) => void
}

/** Excalidraw's reconcile rule: does `remote` replace `local`? */
export function remoteWins(local: WbElement, remote: WbElement): boolean {
  if (remote.version !== local.version) return remote.version > local.version
  return remote.versionNonce < local.versionNonce
}

function parseElement(text: unknown): WbElement | null {
  if (typeof text !== 'string') return null
  try {
    const value: unknown = JSON.parse(text)
    if (value && typeof value === 'object' && typeof (value as WbElement).id === 'string') return value as WbElement
  } catch {
    // A peer's malformed write must not take the reader down.
  }
  return null
}

function byOf(element: WbElement): string | null {
  const sophia = element.customData?.sophia
  if (sophia && typeof sophia === 'object') {
    const by = (sophia as { by?: unknown }).by
    if (typeof by === 'string') return by
  }
  return null
}

/** Order by the fractional `index`, as Excalidraw does; elements without one keep their relative place. */
function inIndexOrder(elements: readonly WbElement[]): readonly WbElement[] {
  if (!elements.every((e) => typeof e.index === 'string')) return elements
  return [...elements].sort((a, b) => (a.index! < b.index! ? -1 : a.index! > b.index! ? 1 : 0))
}

export class WhiteboardBinding {
  private readonly actor: string
  private readonly throttleMs: number
  private readonly now: () => number
  private readonly schedule: (callback: () => void, ms: number) => unknown
  private readonly cancel: (handle: unknown) => void
  private readonly elements: Y.Map<string>
  /** The version each element had when we last wrote it or accepted it. */
  private readonly synced = new Map<string, { version: number; versionNonce: number }>()
  private readonly pending = new Map<string, { element: WbElement; attribute: boolean }>()
  /** Remote versions that arrived while a person was working on the element. */
  private readonly deferred = new Map<string, WbElement>()
  private scene: WbScene | null = null
  private timer: unknown = null
  private destroyed = false
  private imagesLeftOut = new Set<string>()
  private readonly observer: (event: Y.YMapEvent<string>, transaction: Y.Transaction) => void

  constructor(private readonly doc: Y.Doc, private readonly options: WhiteboardBindingOptions = {}) {
    this.actor = options.actor ?? 'person'
    this.throttleMs = options.throttleMs ?? 80
    this.now = options.now ?? Date.now
    this.schedule = options.schedule ?? ((callback, ms) => setTimeout(callback, ms))
    this.cancel = options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
    this.elements = doc.getMap<string>('elements')
    this.observer = (event, transaction) => {
      if (transaction.origin === LOCAL_ORIGIN) return
      this.applyRemote([...event.keysChanged])
    }
    this.elements.observe(this.observer)
  }

  /** How many images are on this canvas and not shared. */
  get droppedImages(): number {
    return this.imagesLeftOut.size
  }

  /** Every element in the room right now, ready to mount as the scene's initial data. */
  initialElements(): readonly WbElement[] {
    const found: WbElement[] = []
    this.elements.forEach((text) => {
      const element = parseElement(text)
      if (element) found.push(element)
    })
    const ordered = inIndexOrder(found)
    for (const element of ordered) this.synced.set(element.id, { version: element.version, versionNonce: element.versionNonce })
    return this.options.refresh ? this.options.refresh(ordered) : ordered
  }

  /** Start applying remote changes to this scene (call once the canvas is up). */
  attach(scene: WbScene): void {
    this.scene = scene
    // Anything that arrived between initialElements() and now.
    const missed: string[] = []
    this.elements.forEach((text, id) => {
      const element = parseElement(text)
      const have = this.synced.get(id)
      if (element && (!have || element.version !== have.version || element.versionNonce !== have.versionNonce)) missed.push(id)
    })
    if (missed.length) this.applyRemote(missed)
  }

  /** Excalidraw's onChange: queue what differs from what is synced. */
  localChanged(): void {
    const scene = this.scene
    if (!scene || this.destroyed) return
    this.retryDeferred()
    let any = false
    for (const element of scene.getElements()) {
      if (element.type === 'image') {
        if (!this.imagesLeftOut.has(element.id) && element.isDeleted !== true) {
          this.imagesLeftOut.add(element.id)
          this.options.onImagesLeftOut?.(this.imagesLeftOut.size)
        }
        continue
      }
      const have = this.synced.get(element.id)
      if (have && have.version === element.version && have.versionNonce === element.versionNonce) continue
      this.pending.set(element.id, { element, attribute: true })
      any = true
    }
    if (any && this.timer === null) this.timer = this.schedule(() => this.flushNow(), this.throttleMs)
  }

  /** Write what is queued, now (pointer-up, blur, leaving). */
  flushNow(): void {
    if (this.timer !== null) {
      this.cancel(this.timer)
      this.timer = null
    }
    if (this.destroyed || this.pending.size === 0) return
    const batch = [...this.pending.values()]
    this.pending.clear()
    const at = this.now()
    this.doc.transact(() => {
      for (const { element, attribute } of batch) {
        let out: WbElement = element
        if (attribute) {
          out = { ...element, customData: { ...(element.customData ?? {}), sophia: { by: this.actor, at } } }
        }
        this.elements.set(element.id, JSON.stringify(out))
        this.synced.set(element.id, { version: element.version, versionNonce: element.versionNonce })
      }
    }, LOCAL_ORIGIN)
  }

  /**
   * Leaving: take what the scene holds now, not only what `onChange` has reported (React reports a change after a
   * render, which a leave can beat), and write it.
   */
  flushScene(): void {
    this.localChanged()
    this.flushNow()
  }

  destroy(): void {
    this.flushScene()
    this.destroyed = true
    this.elements.unobserve(this.observer)
    this.scene = null
  }

  private retryDeferred(): void {
    if (!this.scene || this.deferred.size === 0) return
    const busy = this.scene.busyIds()
    const ready = [...this.deferred.keys()].filter((id) => !busy.has(id))
    if (ready.length === 0) return
    for (const id of ready) this.deferred.delete(id)
    this.applyRemote(ready)
  }

  private applyRemote(ids: readonly string[]): void {
    const scene = this.scene
    if (!scene || this.destroyed) return
    const current = new Map(scene.getElements().map((e) => [e.id, e] as const))
    const busy = scene.busyIds()
    const accepted: WbElement[] = []
    for (const id of ids) {
      const remote = parseElement(this.elements.get(id))
      if (!remote) continue
      if (busy.has(id)) {
        this.deferred.set(id, remote)
        continue
      }
      const local = current.get(id)
      if (!local || remoteWins(local, remote)) accepted.push(remote)
      else if (local.version !== remote.version || local.versionNonce !== remote.versionNonce) {
        // The room holds a copy that loses to ours (Yjs settles a concurrent write by client id, not by version):
        // write ours back, so the room converges on what every canvas shows.
        this.pending.set(id, { element: local, attribute: false })
      }
    }
    if (accepted.length === 0) {
      if (this.pending.size > 0 && this.timer === null) this.timer = this.schedule(() => this.flushNow(), this.throttleMs)
      return
    }
    for (const element of accepted) this.synced.set(element.id, { version: element.version, versionNonce: element.versionNonce })
    const prepared = this.options.refresh ? [...this.options.refresh(accepted)] : [...accepted]
    // Re-measured sizes differ from what the writer put there: one client writes the correction back.
    const leader = this.options.isLeader ? this.options.isLeader() : true
    if (leader) {
      for (let i = 0; i < prepared.length; i++) {
        const before = accepted[i]
        const after = prepared[i]
        if (!before || !after || before.id !== after.id) continue
        const by = byOf(before)
        if (by === null || by === 'person') continue
        const drift = (key: string) => Math.abs(Number(after[key] ?? 0) - Number(before[key] ?? 0)) > 1.5
        if (drift('width') || drift('height') || drift('x') || drift('y')) {
          const fixed: WbElement = { ...after, version: after.version + 1, versionNonce: Math.floor(Math.random() * 2_000_000_000) }
          prepared[i] = fixed
          this.pending.set(fixed.id, { element: fixed, attribute: false })
        }
      }
    }
    const byId = new Map(prepared.map((e) => [e.id, e] as const))
    const merged: WbElement[] = scene.getElements().map((e) => byId.get(e.id) ?? e)
    const known = new Set(merged.map((e) => e.id))
    for (const element of prepared) if (!known.has(element.id)) merged.push(element)
    scene.setElements(inIndexOrder(merged))
    if (this.pending.size > 0 && this.timer === null) this.timer = this.schedule(() => this.flushNow(), this.throttleMs)

    const tools = new Map<string, string[]>()
    for (const element of accepted) {
      const by = byOf(element)
      if (by && by !== 'person' && by !== this.actor) tools.set(by, [...(tools.get(by) ?? []), element.id])
    }
    for (const [by, written] of tools) this.options.onToolWrite?.({ by, ids: written })
  }
}
