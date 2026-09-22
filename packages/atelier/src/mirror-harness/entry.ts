/**
 * mirror harness entry — the throwaway page module mounted by renderPortrait
 * (../mirror.ts) inside real headless Chromium. Not published, not imported
 * by anything except the Vite dev server mirror.ts boots for the duration of
 * one render.
 *
 * It registers <mn-vtuber> the exact same way a real host does — a
 * side-effect import of the real module, not a stub or a fake — mounts one
 * instance sized to the requested pixel box, and reports the FIRST terminal
 * status ('ready' | 'fallback' | 'error') back to Node once two animation
 * frames have actually painted it. Event-driven throughout: no polling, no
 * arbitrary sleeps.
 */
import '../mn-vtuber.js'
import type { MnVtuberStatusDetail } from '../mn-vtuber/types.js'

interface MirrorHarnessConfig {
  modelUrl: string
  appearance?: Record<string, unknown>
  expression?: string
  cameraFrame?: string
  width: number
  height: number
}

declare global {
  interface Window {
    __mirrorConfig?: MirrorHarnessConfig
    __mirrorReport?: (detail: MnVtuberStatusDetail) => void
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

const config = window.__mirrorConfig
if (!config) {
  throw new Error('mirror harness: window.__mirrorConfig was not injected before navigation')
}

// Belt-and-suspenders against the host page's own default margins — the
// component's :host already fills whatever box it's given.
document.documentElement.style.margin = '0'
document.body.style.margin = '0'

const el = document.createElement('mn-vtuber') as HTMLElement & Record<string, unknown>
el.style.display = 'block'
el.style.width = `${config.width}px`
el.style.height = `${config.height}px`
// A static portrait: no continuous idle-sway/blink animation loop, so the
// screenshot is of one settled pose rather than an arbitrary animated instant.
el.animated = false
if (config.expression) el.expression = config.expression
if (config.cameraFrame) el.cameraFrame = config.cameraFrame
if (config.appearance) el.appearance = config.appearance

let reported = false
el.addEventListener('mn-vtuber-status', (event) => {
  if (reported) return
  const detail = (event as CustomEvent<MnVtuberStatusDetail>).detail
  // 'idle'/'loading' are transient — wait for a TERMINAL status, and ignore
  // any stray event from a load the harness didn't itself kick off (the
  // component's own first-render cycle can fire one before modelUrl lands).
  if (detail.status === 'loading' || detail.status === 'idle') return
  if (detail.modelUrl !== config.modelUrl) return
  reported = true
  void (async () => {
    await nextFrame()
    await nextFrame()
    window.__mirrorReport?.(detail)
  })()
})

// Set modelUrl BEFORE the element ever connects (Lit defers its first render
// until connectedCallback), so the very first load the component attempts is
// already the real one — no spurious empty-modelUrl 'fallback' event.
el.modelUrl = config.modelUrl
document.body.appendChild(el)
