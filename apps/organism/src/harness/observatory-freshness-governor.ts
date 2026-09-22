/**
 * observatory-freshness-governor.ts — the freshness governor's DOM
 * controller (ruling 3: "staleness: CONFESS"). Renders a permanently-visible,
 * tone-keyed strip naming the watermark/run/status/outcome **verbatim**, and
 * stamps `data-freshness` / `data-stale` on a page-level element so ANY
 * surface can key off of it — without ever hiding, dimming, blocking, or
 * editing a single rendered value.
 *
 * **The governor corrects BESIDE, never over.** It never mutates any element
 * belonging to a face or to the layout interpreter — it only ever touches
 * the strip it builds itself (appended inside `hostEl`), `stampEl`, and the
 * caller-supplied `registerEls`. See `render()`'s own comment for the
 * complete, closed list of what each verdict publishes.
 */
import { computeFreshnessVerdict, readLatestProjectionRun, type FreshnessTone, type FreshnessVerdict, type ProjectionRunObservation } from './observatory-freshness.js'
import type { QueryBlockService } from '@shrubbery/runtime'

export const OBSERVATORY_FRESHNESS_STYLE_ID = 'observatory-freshness-style'

export interface FreshnessGovernorOptions {
  readonly queryService: QueryBlockService
  readonly graphId: string
  /** The governor renders its own div inside this. */
  readonly hostEl: HTMLElement
  /** Default `document.documentElement`. */
  readonly stampEl?: HTMLElement
  /** Default `[]`. */
  readonly registerEls?: readonly HTMLElement[]
  /** Default 60; `<=0` disables re-querying. */
  readonly refreshSeconds?: number
  /** Default 15000 — wall-clock re-render. */
  readonly tickMs?: number
  readonly now?: () => number
  readonly visibility?: () => DocumentVisibilityState
  readonly onVerdict?: (verdict: FreshnessVerdict) => void
}

export interface FreshnessGovernor {
  /**
   * Renders the 'unknown / checking' strip synchronously, then fires the
   * first read. NEVER awaited by boot; never throws.
   */
  start(): void
  /** Single-flight. */
  refreshNow(): Promise<FreshnessVerdict>
  currentVerdict(): FreshnessVerdict
  /**
   * Clears both timers, removes the visibilitychange listener, removes the
   * strip, and removes EVERY attribute/class/custom-property it published.
   * The injected `<style>` is deliberately left in place.
   */
  dispose(): void
}

const RING_COLOR: Readonly<Record<FreshnessTone, string>> = {
  fresh: '#bfe3cd',
  warning: '#c79a12',
  stale: '#b42318',
  unknown: '#8a8577',
}

const OBSERVATORY_FRESHNESS_STYLE = `
.obs-freshness{display:flex;flex-wrap:wrap;align-items:baseline;gap:.35em 1em;padding:.4em .85em;font:12px/1.4 var(--mn-font-chrome,system-ui,sans-serif);color:var(--mn-color-text-primary,#1c1a17);background:var(--mn-color-surface-raised,#fff);border-bottom:2px solid var(--obs-freshness-ring,#8a8577)}
.obs-freshness [data-obs-freshness-dot]{color:var(--obs-freshness-ring,#8a8577);font-size:1.1em;line-height:1}
.obs-freshness [data-obs-freshness-headline]{font-weight:650}
.obs-freshness [data-obs-freshness-reason],.obs-freshness [data-obs-freshness-watermark],.obs-freshness [data-obs-freshness-run]{color:var(--mn-color-text-secondary,#666)}
.obs-freshness [data-obs-freshness-recheck]{margin-left:auto;font:inherit;padding:.2em .6em;border:1px solid var(--mn-color-border-default,#d6d3d1);border-radius:4px;background:var(--mn-color-surface-base,#fff);cursor:pointer}
.obs-freshness [data-obs-freshness-recheck]:disabled{opacity:.6;cursor:default}
.obs-stale{box-shadow:inset 0 0 0 3px var(--obs-freshness-ring,#8a8577)}
`

function ensureFreshnessStyle(doc: Document): void {
  if (doc.getElementById(OBSERVATORY_FRESHNESS_STYLE_ID)) return
  const style = doc.createElement('style')
  style.id = OBSERVATORY_FRESHNESS_STYLE_ID
  style.textContent = OBSERVATORY_FRESHNESS_STYLE
  doc.head.appendChild(style)
}

export function createObservatoryFreshnessGovernor(options: FreshnessGovernorOptions): FreshnessGovernor {
  const {
    queryService,
    graphId,
    hostEl,
    stampEl = document.documentElement,
    registerEls = [],
    refreshSeconds = 60,
    tickMs = 15000,
    now = () => Date.now(),
    visibility = () => document.visibilityState,
    onVerdict,
  } = options

  const doc = hostEl.ownerDocument ?? document
  ensureFreshnessStyle(doc)

  let lastRun: ProjectionRunObservation | null = null
  let lastFailure: string | null = 'checking the latest obs:ProjectionRun…'
  let lastQueryAtMs: number | null = null
  let inFlight: Promise<FreshnessVerdict> | null = null
  let disposed = false
  let intervalId: ReturnType<typeof setInterval> | null = null

  // ── strip DOM — createElement only, never innerHTML ──────────────────────
  const strip = doc.createElement('div')
  strip.className = 'obs-freshness'
  strip.setAttribute('role', 'status')
  strip.setAttribute('aria-live', 'polite')
  strip.setAttribute('aria-atomic', 'true')
  const dot = doc.createElement('span')
  dot.setAttribute('data-obs-freshness-dot', '')
  dot.setAttribute('aria-hidden', 'true')
  dot.textContent = '●'
  const headlineEl = doc.createElement('span')
  headlineEl.setAttribute('data-obs-freshness-headline', '')
  const reasonEl = doc.createElement('span')
  reasonEl.setAttribute('data-obs-freshness-reason', '')
  const watermarkEl = doc.createElement('span')
  watermarkEl.setAttribute('data-obs-freshness-watermark', '')
  const runEl = doc.createElement('span')
  runEl.setAttribute('data-obs-freshness-run', '')
  const recheckButton = doc.createElement('button')
  recheckButton.type = 'button'
  recheckButton.setAttribute('data-obs-freshness-recheck', '')
  recheckButton.title = 'Re-reads the latest obs:ProjectionRun. Panel data refreshes on its own cadence.'
  recheckButton.textContent = 'Re-check freshness'
  strip.append(dot, headlineEl, reasonEl, watermarkEl, runEl, recheckButton)

  let currentVerdictValue: FreshnessVerdict = computeFreshnessVerdict({
    run: null,
    nowMs: now(),
    graphId,
    failure: lastFailure,
  })

  /**
   * render(verdict) does EXACTLY five things and nothing else:
   *   1. the strip's own content + its own `data-freshness` (element-scoped
   *      styling — the DOM template's own `data-freshness="{tone}"`)
   *   2. `stampEl.dataset.freshness` — ALWAYS present, tracks the current tone
   *   3. `stampEl.dataset.stale` — present iff `verdict.stale` (the reversible latch)
   *   4. `stampEl`'s `--obs-freshness-ring` custom property — tone-keyed color
   *   5. every `registerEls` member's `obs-stale` class — toggled with `verdict.stale`
   * It NEVER sets display/visibility/opacity/filter/pointer-events/inert,
   * NEVER calls remove()/replaceChildren() on anything it did not create
   * itself, and NEVER reads or writes any element outside `hostEl`,
   * `stampEl`, `registerEls`, and `document.head` — the governor corrects
   * BESIDE, never over.
   */
  function render(verdict: FreshnessVerdict): void {
    // (1)
    strip.dataset.freshness = verdict.tone
    headlineEl.textContent = verdict.headline
    reasonEl.textContent = verdict.reason
    watermarkEl.textContent = verdict.watermarkLine
    runEl.textContent = verdict.runLine
    // (2)
    stampEl.dataset.freshness = verdict.tone
    // (3)
    if (verdict.stale) stampEl.dataset.stale = 'true'
    else delete stampEl.dataset.stale
    // (4)
    stampEl.style.setProperty('--obs-freshness-ring', RING_COLOR[verdict.tone])
    // (5)
    for (const el of registerEls) el.classList.toggle('obs-stale', verdict.stale)
  }

  function isDue(nowMs: number): boolean {
    if (refreshSeconds <= 0) return false
    if (lastQueryAtMs == null) return true
    return nowMs - lastQueryAtMs >= refreshSeconds * 1000
  }

  async function performRead(): Promise<FreshnessVerdict> {
    if (inFlight) return inFlight
    recheckButton.disabled = true
    const readPromise = (async (): Promise<FreshnessVerdict> => {
      lastQueryAtMs = now()
      try {
        lastRun = await readLatestProjectionRun({ queryService, graphId })
        lastFailure = null
      } catch (error) {
        lastFailure = error instanceof Error ? error.message : String(error)
      }
      const verdict = computeFreshnessVerdict({ run: lastRun, nowMs: now(), graphId, failure: lastFailure })
      currentVerdictValue = verdict
      render(verdict)
      onVerdict?.(verdict)
      return verdict
    })()
    inFlight = readPromise
    try {
      return await readPromise
    } finally {
      inFlight = null
      recheckButton.disabled = false
    }
  }

  function tick(): void {
    const nowMs = now()
    // Wall-clock age advances WITHOUT a query — recompute from the cached observation.
    const verdict = computeFreshnessVerdict({ run: lastRun, nowMs, graphId, failure: lastFailure })
    currentVerdictValue = verdict
    render(verdict)
    onVerdict?.(verdict)
    if (isDue(nowMs) && visibility() === 'visible') void performRead()
  }

  function onVisibilityChange(): void {
    if (visibility() !== 'visible') return
    if (isDue(now())) void performRead()
  }

  recheckButton.addEventListener('click', () => void performRead())

  return {
    start(): void {
      render(currentVerdictValue)
      hostEl.appendChild(strip)
      // ONE setInterval — no second timer (see this module's own contract doc).
      intervalId = setInterval(tick, tickMs)
      doc.addEventListener('visibilitychange', onVisibilityChange)
      void performRead()
    },
    refreshNow(): Promise<FreshnessVerdict> {
      return performRead()
    },
    currentVerdict(): FreshnessVerdict {
      return currentVerdictValue
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      if (intervalId != null) clearInterval(intervalId)
      intervalId = null
      doc.removeEventListener('visibilitychange', onVisibilityChange)
      strip.remove()
      delete stampEl.dataset.freshness
      delete stampEl.dataset.stale
      stampEl.style.removeProperty('--obs-freshness-ring')
      if (stampEl.style.length === 0) stampEl.removeAttribute('style')
      for (const el of registerEls) {
        el.classList.remove('obs-stale')
        if (el.classList.length === 0) el.removeAttribute('class')
      }
      // The injected <style> is deliberately left in place — shared across mounts.
    },
  }
}
