/**
 * The two small things the place needs outside the Files pane itself: the way back to it from a document opened out of it
 * ("← Back to Pictures"), and a sentence when a verb in the tree cannot be done yet (a cell that still keeps documents and
 * files in separate folders). One fixed strip at the foot of the window, one polite live region; no framework, no state
 * outside it. Used by the real shell and by the harness, so the witness sees what people see.
 */
export interface PlaceNotice {
  /** Offer the way back to the place; null hides it. */
  back(target: { readonly label: string; readonly onBack: () => void } | null): void
  /** Say a sentence for a few seconds (the strip stays until then, then goes). */
  say(message: string, tone?: 'info' | 'error'): void
  readonly element: HTMLElement
}

const STYLE = `
.place-notice { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 2147483000; display: flex; flex-direction: column;
  align-items: center; gap: 8px; max-width: min(92vw, 640px); pointer-events: none; font-family: var(--mn-font-chrome, system-ui, sans-serif);
  font-size: var(--mn-text-sm, 12px); }
.place-notice > * { pointer-events: auto; }
.place-notice button[data-place-back] { font: inherit; cursor: pointer; padding: 4px 12px; min-height: var(--mn-control-height, 28px);
  color: var(--mn-color-text-primary, #111); background: var(--mn-color-surface-raised, #fff); border: 1px solid var(--mn-color-border-default, #ccc);
  border-radius: 999px; box-shadow: 0 2px 8px rgba(0,0,0,.12); }
.place-notice button[data-place-back]:focus-visible { outline: none; box-shadow: var(--mn-focus-ring, 0 0 0 2px #2563eb); }
.place-notice [data-place-say] { padding: 6px 12px; border-radius: var(--mn-radius-control, 6px); color: var(--mn-color-text-primary, #111);
  background: var(--mn-color-surface-raised, #fff); border: 1px solid var(--mn-color-border-default, #ccc); box-shadow: 0 2px 8px rgba(0,0,0,.12); }
.place-notice [data-place-say][data-tone='error'] { border-color: var(--mn-color-text-danger, #b91c1c); }
.place-notice [hidden] { display: none; }
`

export function mountPlaceNotice(parent: HTMLElement = document.body, options: { readonly sayMs?: number } = {}): PlaceNotice {
  const root = document.createElement('div')
  root.className = 'place-notice'
  root.dataset.placeNotice = ''
  const style = document.createElement('style')
  style.textContent = STYLE
  const button = document.createElement('button')
  button.type = 'button'
  button.dataset.placeBack = ''
  button.hidden = true
  const live = document.createElement('div')
  live.dataset.placeSay = ''
  live.setAttribute('role', 'status')
  live.setAttribute('aria-live', 'polite')
  live.hidden = true
  root.append(style, button, live)
  parent.appendChild(root)
  let onBack: (() => void) | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  button.addEventListener('click', () => onBack?.())
  return {
    element: root,
    back(target) {
      onBack = target?.onBack ?? null
      button.hidden = !target
      button.textContent = target ? `← Back to ${target.label}` : ''
      button.setAttribute('aria-label', target ? `Back to ${target.label}` : '')
    },
    say(message, tone = 'info') {
      live.textContent = message
      live.dataset.tone = tone
      live.hidden = !message
      if (timer) clearTimeout(timer)
      if (message) timer = setTimeout(() => { live.hidden = true; live.textContent = '' }, options.sayMs ?? 8000)
    },
  }
}
