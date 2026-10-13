/**
 * Full-screen view of one diagram (senderos follow-ups, 2026-09-26).
 *
 * It opens FITTED to the screen — the whole diagram in view — and zooms in
 * from there: pinch (two fingers), a trackpad pinch (ctrl + wheel), a double
 * tap or double click (fit ⇄ 1:1, anchored where you tapped), or the zoom
 * button. One finger pans (native scrolling). Closed by the × button, Escape,
 * or a single tap on the empty stage.
 *
 * It is mounted on the document body (above the app's own bars, which a
 * shadow-root overlay cannot rise over) and therefore carries its own inline
 * styles, drawn from the design tokens.
 */

/** Largest zoom, as a multiple of the diagram's natural size. */
export const FIGURE_ZOOM_MAX = 4
const DOUBLE_TAP_MS = 320
const DOUBLE_TAP_SLOP = 32
const TAP_MOVE_SLOP = 10
const STAGE_PADDING = 16

export type FigureZoomMode = 'fit' | 'actual' | 'free'

export interface FigureZoom {
  readonly scale: number
  readonly fitScale: number
  readonly mode: FigureZoomMode
  /** Zoom to `scale`, keeping the point under (clientX, clientY) — default the stage centre — still. */
  zoomTo(scale: number, clientX?: number, clientY?: number): void
  fit(): void
  /** fit ⇄ 1:1 (from anything but fit, back to fit). */
  toggle(clientX?: number, clientY?: number): void
}

function naturalSize(svg: SVGSVGElement): { width: number; height: number } {
  const box = svg.viewBox?.baseVal
  if (box && box.width > 0 && box.height > 0) return { width: box.width, height: box.height }
  const rect = svg.getBoundingClientRect()
  return { width: Math.max(1, rect.width), height: Math.max(1, rect.height) }
}

export function openMermaidFullscreen(preview: HTMLElement): HTMLElement | null {
  const svg = preview.querySelector('svg')
  if (!svg) return null
  const doc = preview.ownerDocument
  const view = doc.defaultView
  doc.querySelector('.mermaid-fullscreen')?.dispatchEvent(new Event('mermaid-fullscreen-close'))
  doc.querySelector('.mermaid-fullscreen')?.remove()
  const natural = naturalSize(svg)

  const overlay = doc.createElement('div')
  overlay.className = 'mermaid-fullscreen'
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-label', 'Diagram')
  overlay.tabIndex = -1
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483000', 'display:flex', 'flex-direction:column',
    'background:var(--mn-color-surface-editor,#fffdf8)', 'color:var(--mn-color-text-primary,#1f2933)',
    'overscroll-behavior:contain',
  ].join(';')

  const bar = doc.createElement('div')
  bar.className = 'mermaid-fullscreen-bar'
  bar.style.cssText = [
    'flex:none', 'display:flex', 'align-items:center', 'gap:8px',
    'padding:max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) 4px max(8px, env(safe-area-inset-left))',
  ].join(';')
  const buttonStyle = [
    'flex:none', 'min-width:44px', 'height:44px', 'padding:0 12px', 'border:0', 'border-radius:999px',
    'background:var(--mn-color-surface-sunken,rgba(15,23,42,.06))', 'color:inherit', 'cursor:pointer',
  ]
  const zoomButton = doc.createElement('button')
  zoomButton.type = 'button'
  zoomButton.className = 'mermaid-fullscreen-zoom'
  zoomButton.style.cssText = [...buttonStyle, 'font:600 14px/1 var(--mn-font-chrome,system-ui,sans-serif)', 'font-variant-numeric:tabular-nums'].join(';')
  const hint = doc.createElement('span')
  hint.className = 'mermaid-fullscreen-hint'
  const coarse = view?.matchMedia?.('(pointer: coarse)').matches ?? false
  hint.textContent = coarse ? 'Pinch or double-tap to zoom' : 'Double-click or ctrl + scroll to zoom'
  hint.style.cssText = [
    'flex:1', 'min-width:0', 'overflow:hidden', 'text-overflow:ellipsis', 'white-space:nowrap', 'text-align:center',
    'color:var(--mn-color-text-tertiary,#697386)', 'font:400 12px/1.3 var(--mn-font-chrome,system-ui,sans-serif)',
  ].join(';')
  const close = doc.createElement('button')
  close.type = 'button'
  close.className = 'mermaid-fullscreen-close'
  close.setAttribute('aria-label', 'Close diagram')
  close.textContent = '×'
  close.style.cssText = [...buttonStyle, 'padding:0', 'font:500 26px/1 var(--mn-font-chrome,system-ui,sans-serif)'].join(';')
  bar.append(zoomButton, hint, close)

  // The stage scrolls (one-finger pan is native); pinch is ours, so the page
  // itself never zooms (touch-action leaves only panning to the browser).
  const stage = doc.createElement('div')
  stage.className = 'mermaid-fullscreen-stage'
  stage.style.cssText = [
    'position:relative', 'flex:1', 'min-height:0', 'display:flex', 'overflow:auto', `padding:${STAGE_PADDING}px`,
    'box-sizing:border-box', 'touch-action:pan-x pan-y', '-webkit-overflow-scrolling:touch', 'overscroll-behavior:contain',
  ].join(';')
  // The canvas has the zoomed size; auto margins centre it while it is
  // smaller than the stage and collapse to 0 (scrollable) when it is larger.
  const canvas = doc.createElement('div')
  canvas.className = 'mermaid-fullscreen-canvas'
  canvas.style.cssText = 'flex:none;margin:auto;position:relative'
  const copy = svg.cloneNode(true) as SVGSVGElement
  copy.removeAttribute('style')
  copy.setAttribute('width', '100%')
  copy.setAttribute('height', '100%')
  copy.style.cssText = 'display:block;width:100%;height:100%;max-width:none'
  canvas.appendChild(copy)
  stage.appendChild(canvas)
  overlay.append(bar, stage)

  let scale = 1
  let fitScale = 1
  let mode: FigureZoomMode = 'fit'
  const computeFit = (): number => {
    const width = stage.clientWidth - STAGE_PADDING * 2
    const height = stage.clientHeight - STAGE_PADDING * 2
    if (width <= 0 || height <= 0) return 1
    // Fitted, but a small diagram is never blown up past twice its size.
    return Math.min(width / natural.width, height / natural.height, 2)
  }
  const minScale = (): number => Math.min(fitScale, 1) * 0.5
  const describe = (): void => {
    overlay.dataset.zoom = scale.toFixed(3)
    overlay.dataset.zoomMode = mode
    if (mode === 'fit') {
      zoomButton.textContent = '1:1'
      zoomButton.setAttribute('aria-label', 'Show the diagram at actual size')
    } else {
      zoomButton.textContent = 'Fit'
      zoomButton.setAttribute('aria-label', 'Fit the diagram to the screen')
    }
  }
  const zoomTo = (next: number, clientX?: number, clientY?: number, nextMode: FigureZoomMode = 'free'): void => {
    const clamped = Math.min(Math.max(next, minScale()), Math.max(FIGURE_ZOOM_MAX, fitScale))
    const rect = stage.getBoundingClientRect()
    const anchorX = clientX === undefined ? stage.clientWidth / 2 : clientX - rect.left
    const anchorY = clientY === undefined ? stage.clientHeight / 2 : clientY - rect.top
    // The diagram point under the anchor, in natural units, before…
    const pointX = (stage.scrollLeft + anchorX - canvas.offsetLeft) / scale
    const pointY = (stage.scrollTop + anchorY - canvas.offsetTop) / scale
    scale = clamped
    mode = nextMode
    canvas.style.width = `${Math.round(natural.width * scale)}px`
    canvas.style.height = `${Math.round(natural.height * scale)}px`
    // …stays under it after.
    stage.scrollLeft = pointX * scale + canvas.offsetLeft - anchorX
    stage.scrollTop = pointY * scale + canvas.offsetTop - anchorY
    describe()
  }
  const zoom: FigureZoom = {
    get scale() { return scale },
    get fitScale() { return fitScale },
    get mode() { return mode },
    zoomTo: (next, x, y) => zoomTo(next, x, y, Math.abs(next - fitScale) < 0.005 ? 'fit' : Math.abs(next - 1) < 0.005 ? 'actual' : 'free'),
    fit: () => {
      fitScale = computeFit()
      zoomTo(fitScale, undefined, undefined, 'fit')
      stage.scrollLeft = 0
      stage.scrollTop = 0
    },
    toggle: (x, y) => {
      if (mode === 'fit') zoomTo(fitScale < 0.99 ? 1 : Math.min(fitScale * 2, FIGURE_ZOOM_MAX), x, y, fitScale < 0.99 ? 'actual' : 'free')
      else zoom.fit()
    },
  }
  ;(overlay as HTMLElement & { figureZoom?: FigureZoom }).figureZoom = zoom

  zoomButton.addEventListener('click', () => zoom.toggle())

  // ── pinch (two fingers) and double tap ────────────────────────────────
  let pinch: { distance: number; scale: number } | null = null
  let tapStart: { x: number; y: number; at: number } | null = null
  let lastTap: { x: number; y: number; at: number } | null = null
  let pendingDismiss: ReturnType<typeof setTimeout> | null = null
  const cancelDismiss = (): void => {
    if (pendingDismiss) clearTimeout(pendingDismiss)
    pendingDismiss = null
  }
  const distance = (a: Touch, b: Touch): number => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
  stage.addEventListener('touchstart', (event) => {
    if (event.touches.length === 2) {
      event.preventDefault()
      pinch = { distance: distance(event.touches[0], event.touches[1]), scale }
      tapStart = null
      cancelDismiss()
    } else if (event.touches.length === 1) {
      const t = event.touches[0]
      tapStart = { x: t.clientX, y: t.clientY, at: Date.now() }
    }
  }, { passive: false })
  stage.addEventListener('touchmove', (event) => {
    if (pinch && event.touches.length === 2) {
      event.preventDefault()
      const [a, b] = [event.touches[0], event.touches[1]]
      zoom.zoomTo(pinch.scale * (distance(a, b) / Math.max(1, pinch.distance)), (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2)
    } else if (tapStart && event.touches.length === 1) {
      const t = event.touches[0]
      if (Math.hypot(t.clientX - tapStart.x, t.clientY - tapStart.y) > TAP_MOVE_SLOP) tapStart = null
    }
  }, { passive: false })
  stage.addEventListener('touchend', (event) => {
    if (pinch && event.touches.length < 2) {
      pinch = null
      return
    }
    if (!tapStart || event.touches.length > 0) return
    const t = event.changedTouches[0]
    const tap = { x: t.clientX, y: t.clientY, at: Date.now() }
    tapStart = null
    if (lastTap && tap.at - lastTap.at < DOUBLE_TAP_MS && Math.hypot(tap.x - lastTap.x, tap.y - lastTap.y) < DOUBLE_TAP_SLOP) {
      // A double tap: no synthetic click/dblclick follows.
      event.preventDefault()
      cancelDismiss()
      lastTap = null
      zoom.toggle(tap.x, tap.y)
      return
    }
    lastTap = tap
  })
  stage.addEventListener('touchcancel', () => {
    pinch = null
    tapStart = null
  })
  // iOS Safari's own gesture events would zoom the page.
  overlay.addEventListener('gesturestart', event => event.preventDefault())
  overlay.addEventListener('gesturechange', event => event.preventDefault())
  // Trackpad pinch arrives as ctrl + wheel.
  stage.addEventListener('wheel', (event) => {
    if (!event.ctrlKey) return
    event.preventDefault()
    zoom.zoomTo(scale * Math.exp(-event.deltaY * 0.01), event.clientX, event.clientY)
  }, { passive: false })
  stage.addEventListener('dblclick', (event) => {
    event.preventDefault()
    cancelDismiss()
    zoom.toggle(event.clientX, event.clientY)
  })
  // A single tap on the empty stage closes — after the double-tap window.
  stage.addEventListener('click', (event) => {
    if (event.target !== stage) return
    cancelDismiss()
    pendingDismiss = setTimeout(dismiss, DOUBLE_TAP_MS)
  })

  const refit = (): void => {
    const wasFit = mode === 'fit'
    fitScale = computeFit()
    if (wasFit) zoom.fit()
    else describe()
  }
  const dismiss = (): void => {
    cancelDismiss()
    overlay.remove()
    doc.removeEventListener('keydown', onKey, true)
    view?.removeEventListener('resize', refit)
  }
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') dismiss()
  }
  close.addEventListener('click', dismiss)
  overlay.addEventListener('mermaid-fullscreen-close', dismiss)
  doc.addEventListener('keydown', onKey, true)
  view?.addEventListener('resize', refit)
  doc.body.appendChild(overlay)
  zoom.fit()
  close.focus()
  return overlay
}
