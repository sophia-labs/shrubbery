/**
 * default-workspace-ui.ts — the two honest chrome affordances around the
 * session-store's absent-config carve-out (see session-store.ts module doc):
 *
 *   1. makeDefaultWorkspaceNotice — a small, dismissable, auto-quiet mn-toast
 *      shown ONCE per graph while the shell is rendering the in-memory
 *      GARDEN_DEFAULT because the graph's :ux:config has no sux:Workspace node.
 *      The moment a real config lands (read.defaulted flips false) the notice
 *      is dismissed and forgotten. Nothing here writes to the graph — the
 *      notice is pure chrome over the read's provenance flag.
 *
 *   2. renderCellErrorPanel — the TRUE-error surface. Outside `?debug=1` the
 *      #status strip is display:none, so a first-load failure used to paint
 *      NOTHING (the boot placeholder pulsing forever over a blank page). This
 *      paints an honest error panel into the render host instead. It is only
 *      for the no-prior-read case — a transient poll failure over a live
 *      workspace must never clobber the workspace.
 *
 * Closure seams, no module state: both are factories/functions over an injected
 * Document/host so tests drive the REAL implementations in happy-dom.
 */

import type { MnToast } from '@shrubbery/components'

export const DEFAULT_WORKSPACE_NOTICE_ATTR = 'data-default-workspace-notice'
export const DEFAULT_WORKSPACE_NOTICE_MESSAGE = 'Default workspace'
export const DEFAULT_WORKSPACE_NOTICE_DESCRIPTION =
  'This graph has no UX configuration yet, so the Garden default is shown. '
  + 'Nothing is written back — the graph’s own configuration takes over the moment it exists.'

/** How long the notice lingers before auto-quieting (also closable by hand). */
const NOTICE_DURATION_MS = 12000

export interface DefaultWorkspaceNotice {
  /**
   * Reconcile the notice with the latest successful render: `defaulted` is the
   * read's provenance flag, `graphId` the graph it came from. Idempotent —
   * called on every render pass (poll ticks included); the toast is created
   * once per graph and never re-spawned after the user dismisses it or it
   * auto-quiets.
   */
  sync(defaulted: boolean, graphId: string): void
  /** The live toast element, or null when none is on screen. */
  element(): MnToast | null
}

export function makeDefaultWorkspaceNotice(doc: Document): DefaultWorkspaceNotice {
  let shownForGraph: string | null = null
  let live: MnToast | null = null

  const currentLive = (): MnToast | null => (live?.isConnected ? live : null)

  return {
    sync(defaulted: boolean, graphId: string): void {
      if (!defaulted) {
        // Real config triples win the moment they exist: drop the notice and
        // forget it was shown (a graph that later LOSES its config re-notices).
        currentLive()?.dismiss()
        live = null
        shownForGraph = null
        return
      }
      if (shownForGraph === graphId) return
      currentLive()?.dismiss()
      const toast = doc.createElement('mn-toast') as MnToast
      toast.setAttribute(DEFAULT_WORKSPACE_NOTICE_ATTR, graphId)
      toast.type = 'info'
      toast.position = 'bottom-center'
      toast.message = DEFAULT_WORKSPACE_NOTICE_MESSAGE
      toast.description = DEFAULT_WORKSPACE_NOTICE_DESCRIPTION
      toast.closable = true
      toast.duration = NOTICE_DURATION_MS
      doc.body.appendChild(toast)
      live = toast
      shownForGraph = graphId
    },
    element: currentLive,
  }
}

// ── The honest error panel ────────────────────────────────────────────────────

export const CELL_ERROR_PANEL_CLASS = 'cell-error-panel'

export interface CellErrorPanelOptions {
  /** Wired to the store's refresh; omitting it omits the button. */
  readonly onRetry?: () => void
}

/**
 * Paint an honest error panel into the render host (replacing the boot
 * placeholder and any previous panel — never stacking). The message is the
 * store's error VERBATIM; no softening, no faked data. Returns the panel.
 */
export function renderCellErrorPanel(
  host: HTMLElement,
  message: string,
  options: CellErrorPanelOptions = {},
): HTMLElement {
  const doc = host.ownerDocument
  clearCellErrorPanel(host)
  removeDirectChildrenByClass(host, 'boot-placeholder')

  const panel = doc.createElement('div')
  panel.className = CELL_ERROR_PANEL_CLASS
  panel.setAttribute('role', 'alert')

  const title = doc.createElement('div')
  title.className = `${CELL_ERROR_PANEL_CLASS}__title`
  title.textContent = 'Couldn’t load this workspace'
  panel.appendChild(title)

  const detail = doc.createElement('pre')
  detail.className = `${CELL_ERROR_PANEL_CLASS}__message`
  detail.textContent = message
  panel.appendChild(detail)

  if (options.onRetry) {
    const retry = doc.createElement('button')
    retry.type = 'button'
    retry.className = `${CELL_ERROR_PANEL_CLASS}__retry`
    retry.textContent = 'Retry'
    retry.addEventListener('click', options.onRetry)
    panel.appendChild(retry)
  }

  host.appendChild(panel)
  return panel
}

/**
 * Remove the panel (if present). The workspace/route render paths call this at
 * the same seam where they retire the static boot placeholder — Lit preserves
 * unmanaged siblings in its render container, so a stale panel would otherwise
 * remain stacked in the host after a successful render.
 */
export function clearCellErrorPanel(host: HTMLElement): void {
  removeDirectChildrenByClass(host, CELL_ERROR_PANEL_CLASS)
}

/** Direct-child removal without `:scope >` (which happy-dom cannot select). */
function removeDirectChildrenByClass(host: HTMLElement, className: string): void {
  for (const child of Array.from(host.children)) {
    if (child.classList.contains(className)) child.remove()
  }
}
