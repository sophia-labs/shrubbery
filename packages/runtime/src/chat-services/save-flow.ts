/**
 * save-flow.ts — Save to Garden and Download as Markdown, as one small state machine.
 *
 * The person picks a workspace they can write to; only then is a copy made. The
 * copy is a Markdown document, the same text Download hands out as a file. The
 * shell owns which workspaces are offered and how the write is made (the port);
 * this file owns the order of things and the words.
 *
 * Doctrine carried here:
 *   - The audience is the person's choice, made explicitly. With several
 *     workspaces nothing is preselected; with exactly one it is preselected, and
 *     the copy still waits for Save. The promise is stated in the same words every
 *     time (saveToGardenCopy) and only for a workspace that is actually chosen.
 *   - A failure is said, with the person's choice kept, and can be tried again.
 *   - Cancelling while a conversation is being read stops the reading and saves
 *     nothing.
 */

import { buildMarkdownFile, type ConversationExportSource, type MarkdownFile } from './conversation-export.js'

/** A workspace the person can write to. */
export interface SaveTarget {
  readonly graphId: string
  readonly title: string
}

export interface SaveToGardenRequest {
  readonly workspaceId: string
  readonly workspaceTitle: string
  readonly title: string
  readonly markdown: string
  readonly kind: 'live' | 'imported'
}

export interface SaveToGardenResult {
  readonly workspaceId: string
  readonly workspaceTitle: string
  readonly documentIds: readonly string[]
}

/** What the shell provides: where a copy may go, how to make one, and (optionally) how to open it. */
export interface SaveToGardenPort {
  targets(): Promise<readonly SaveTarget[]> | readonly SaveTarget[]
  save(request: SaveToGardenRequest): Promise<SaveToGardenResult>
  open?(result: { workspaceId: string; documentId: string }): void
}

export const SAVE_TO_GARDEN_INTRO = 'Choose the workspace to copy this conversation into.'

/** The promise, exactly as the release ruled it. */
export function saveToGardenCopy(workspaceTitle: string): string {
  return `Copies this conversation into ${workspaceTitle}. Everyone with access there can read it.`
}

export type SavePhase = 'choosing' | 'preparing' | 'saving' | 'saved' | 'error'

export interface SaveFlowState {
  readonly phase: SavePhase
  /** null while the list is being read (or could not be). */
  readonly targets: readonly SaveTarget[] | null
  readonly targetsError: string | null
  /** The chosen workspace's graph id. */
  readonly selected: string | null
  /** How far reading an imported conversation has got. */
  readonly progress: { readonly loaded: number; readonly total: number } | null
  readonly result: SaveToGardenResult | null
  readonly error: string | null
  /** The name of the file last handed to the person. */
  readonly downloaded: string | null
}

export interface SaveFlow {
  getState(): SaveFlowState
  subscribe(listener: () => void): () => void
  loadTargets(): Promise<void>
  select(graphId: string): void
  save(): Promise<void>
  downloadMarkdown(): Promise<void>
  /** Stops reading the conversation, if it is being read. A write already sent cannot be taken back. */
  cancel(): void
  dispose(): void
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createSaveFlow(input: {
  readonly source: ConversationExportSource
  readonly port: SaveToGardenPort | null
  readonly download: (file: MarkdownFile) => void
  readonly now: () => number
}): SaveFlow {
  const { source, port } = input
  let disposed = false
  let controller: AbortController | null = null
  let state: SaveFlowState = {
    phase: 'choosing', targets: null, targetsError: null, selected: null, progress: null, result: null, error: null, downloaded: null,
  }
  const listeners = new Set<() => void>()

  function commit(next: Partial<SaveFlowState>): void {
    if (disposed) return
    state = { ...state, ...next }
    for (const listener of [...listeners]) listener()
  }

  async function loadTargets(): Promise<void> {
    if (!port) {
      commit({ targets: [], targetsError: null })
      return
    }
    try {
      const targets = [...(await port.targets())]
      if (disposed) return
      const stillChosen = targets.some(target => target.graphId === state.selected)
      commit({
        targets,
        targetsError: null,
        // The only workspace is preselected; with several, nothing is chosen for the person.
        selected: targets.length === 1 ? targets[0].graphId : stillChosen ? state.selected : null,
      })
    } catch (error) {
      if (disposed) return
      commit({ targets: null, targetsError: messageOf(error) })
    }
  }

  function select(graphId: string): void {
    if (!state.targets?.some(target => target.graphId === graphId)) return
    commit({ selected: graphId, error: null })
  }

  const busy = (): boolean => state.phase === 'preparing' || state.phase === 'saving'

  async function collect(ctl: AbortController) {
    return source.collect({
      signal: ctl.signal,
      onProgress: (loaded, total) => commit({ progress: { loaded, total } }),
    })
  }

  async function save(): Promise<void> {
    if (!port) {
      commit({ error: 'Saving to a workspace is not available here.' })
      return
    }
    const target = state.targets?.find(candidate => candidate.graphId === state.selected)
    if (!target) {
      commit({ error: 'Choose a workspace first.' })
      return
    }
    if (busy()) return
    const ctl = new AbortController()
    controller = ctl
    commit({ phase: 'preparing', error: null, result: null, progress: null, downloaded: null })
    try {
      const collected = await collect(ctl)
      if (disposed) return
      if (ctl.signal.aborted) {
        commit({ phase: 'choosing', progress: null })
        return
      }
      const file = buildMarkdownFile(collected, input.now())
      commit({ phase: 'saving', progress: null })
      const result = await port.save({
        workspaceId: target.graphId,
        workspaceTitle: target.title,
        title: collected.title,
        markdown: file.text,
        kind: collected.kind,
      })
      if (disposed) return
      commit({ phase: 'saved', result, error: null })
    } catch (error) {
      if (disposed) return
      // Cancelling while reading is not a failure; a failed write is one, whatever was pressed.
      if (ctl.signal.aborted && state.phase === 'preparing') commit({ phase: 'choosing', progress: null })
      else commit({ phase: 'error', error: messageOf(error), progress: null })
    } finally {
      if (controller === ctl) controller = null
    }
  }

  async function downloadMarkdown(): Promise<void> {
    if (busy()) return
    const ctl = new AbortController()
    controller = ctl
    commit({ phase: 'preparing', error: null, progress: null, downloaded: null })
    try {
      const collected = await collect(ctl)
      if (disposed) return
      if (ctl.signal.aborted) {
        commit({ phase: 'choosing', progress: null })
        return
      }
      const file = buildMarkdownFile(collected, input.now())
      input.download(file)
      commit({ phase: 'choosing', progress: null, downloaded: file.filename })
    } catch (error) {
      if (disposed) return
      if (ctl.signal.aborted) commit({ phase: 'choosing', progress: null })
      else commit({ phase: 'error', error: messageOf(error), progress: null })
    } finally {
      if (controller === ctl) controller = null
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    loadTargets,
    select,
    save,
    downloadMarkdown,
    cancel() {
      controller?.abort()
    },
    dispose() {
      disposed = true
      controller?.abort()
      listeners.clear()
    },
  }
}
