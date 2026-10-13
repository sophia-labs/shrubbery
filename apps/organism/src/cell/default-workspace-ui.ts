/**
 * default-workspace-ui.ts — renderCellErrorPanel, the TRUE-error surface.
 * Outside `?debug=1` the #status strip is display:none, so a first-load
 * failure used to paint NOTHING (the boot placeholder pulsing forever over a
 * blank page). This paints an honest error panel into the render host
 * instead. It is only for the no-prior-read case — a transient poll failure
 * over a live workspace must never clobber the workspace.
 *
 * A closure seam, no module state: it takes an injected host so tests drive
 * the REAL implementation in happy-dom.
 */

// ── The honest error panel ────────────────────────────────────────────────────

export const CELL_ERROR_PANEL_CLASS = 'cell-error-panel'

export interface CellErrorPanelOptions {
  /** Wired to the store's refresh; omitting it omits the button. */
  readonly onRetry?: () => void
  /** The hosted shell supplies a route back when a graph cannot be opened. */
  readonly onBack?: () => void
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

  if (options.onBack) {
    const back = doc.createElement('button')
    back.type = 'button'
    back.className = `${CELL_ERROR_PANEL_CLASS}__back`
    back.textContent = 'Back to workspaces'
    back.addEventListener('click', options.onBack)
    panel.appendChild(back)
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
