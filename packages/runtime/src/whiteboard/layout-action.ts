/**
 * "Lay out" on the board (plans/2026-10-30-elk-layout/DESIGN.md): ELK arranges the selection (or the whole board) and
 * routes the arrows between the shapes at right angles. One undo step; the binding carries it to the room, so every
 * open browser sees it. The same presets and rules as gardend's `{op:"layout"}`, so Sophia's layout and a person's agree.
 *
 * Flow: plan (pure, nucleus) → ELK (the page's host, a Worker) → apply (pure) → stamp → `updateScene`. A person who
 * kept drawing on the set while ELK ran gets one fresh attempt; if the set changed again, the board says so.
 */
import { t } from '@shrubbery/nucleus'
import {
  applyBoardLayout,
  type BoardElement,
  BoardLayoutError,
  type BoardLayoutPlan,
  type BoardLayoutRequest,
  planBoardLayout,
} from '@shrubbery/nucleus/board-layout'
import { ElkLayoutError, type ElkHost, elkHost } from '../elk/elk-host.js'
import type { WbSelectionBarDeps } from './selection-bar.js'
import type { WbElement } from './whiteboard-binding.js'


/** What to lay out and how: `ids` are the selection's (bound text stands for its container), `null` the whole board. */
export interface WbLayoutCommand extends Omit<BoardLayoutRequest, 'ids'> {
  readonly ids: readonly string[] | null
}

export type WbLayoutOutcome =
  | { readonly ok: true; readonly nodes: number; readonly edges: number; readonly changed: number }
  | { readonly ok: false; readonly reason: 'read-only' | 'no-canvas' | 'nothing' | 'invalid' | 'stale' | 'too-long' | 'failed'; readonly message: string }

/** Excalidraw's capture action: IMMEDIATELY makes the layout one step on the person's undo stack. */
const CAPTURE_IMMEDIATELY = 'IMMEDIATELY'

function freshNonce(): number {
  return Math.floor(Math.random() * 2_000_000_000)
}

function versionsOf(elements: readonly WbElement[], ids: readonly string[]): Map<string, number> {
  const byId = new Map(elements.map((e) => [e.id, e] as const))
  return new Map(ids.map((id) => [id, byId.get(id)?.version ?? -1]))
}

function unchanged(elements: readonly WbElement[], before: ReadonlyMap<string, number>): boolean {
  const now = versionsOf(elements, [...before.keys()])
  for (const [id, version] of before) if (now.get(id) !== version) return false
  return true
}

/**
 * Lay the board out. Resolves to what happened; every refusal is also told to the person through `deps.notify`.
 * `host` is the page's ELK host unless a caller (a test) hands its own.
 */
export async function layOut(deps: WbSelectionBarDeps, command: WbLayoutCommand, host: ElkHost = elkHost()): Promise<WbLayoutOutcome> {
  const refuse = (reason: Exclude<WbLayoutOutcome, { ok: true }>['reason'], message: string): WbLayoutOutcome => {
    deps.notify(message)
    return { ok: false, reason, message }
  }
  const page = deps.page()
  if (page?.readOnly) return refuse('read-only', t('This board is read-only.'))
  const api = deps.api()
  if (!api) return refuse('no-canvas', t('The board is not ready yet'))
  const read = (): readonly WbElement[] => (deps.api()?.getSceneElementsIncludingDeleted() ?? []) as readonly WbElement[]
  const request: BoardLayoutRequest = { ids: command.ids, style: command.style, direction: command.direction, spacing: command.spacing }

  for (let attempt = 0; attempt < 2; attempt++) {
    const elements = read()
    let plan: BoardLayoutPlan
    try {
      plan = planBoardLayout(elements as readonly BoardElement[], request)
    } catch (error) {
      if (error instanceof BoardLayoutError) {
        return error.message.startsWith('nothing to lay out')
          ? refuse('nothing', t('Select at least two shapes to lay out.'))
          : refuse('invalid', error.message)
      }
      throw error
    }
    const before = versionsOf(elements, plan.touched)
    let result
    try {
      result = await host.layout(plan.graph)
    } catch (error) {
      if (error instanceof ElkLayoutError && error.kind === 'deadline') return refuse('too-long', t('The layout took too long.'))
      return refuse('failed', error instanceof Error ? error.message : String(error))
    }
    const live = deps.api()
    if (!live) return refuse('no-canvas', t('The board is not ready yet'))
    const now = live.getSceneElementsIncludingDeleted() as readonly WbElement[]
    if (!unchanged(now, before)) continue
    const change = applyBoardLayout(now as readonly BoardElement[], plan, result)
    const stamp = Date.now()
    const next = now.map((e) => {
      const laid = change.elements.get(e.id)
      if (!laid) return e
      // Excalidraw's own mutations bump version, nonce and `updated`; the binding diffs by version, so ours must too.
      return { ...(laid as unknown as WbElement), version: e.version + 1, versionNonce: freshNonce(), updated: stamp }
    })
    live.updateScene({ elements: next, captureUpdate: CAPTURE_IMMEDIATELY })
    return { ok: true, nodes: change.nodes, edges: change.edges, changed: change.elements.size }
  }
  return refuse('stale', t('The board changed while laying out. Try again.'))
}
