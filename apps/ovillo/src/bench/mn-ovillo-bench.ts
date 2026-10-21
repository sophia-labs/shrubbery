/**
 * mn-ovillo-bench — the live bench: a simulated guitarist played into an
 * Ariadne World, in this page (ovillo-web as WebAssembly in an AudioWorklet).
 *
 * Ported from the ovillo site's bench (site/bench/bench.js at 95aae48) and
 * redrawn in Sophia's language instead of the instrument-CRT doctrine: cards,
 * role tokens, Sophia controls (buttons, selects, sliders), light and dark. What
 * it shows is the bench's own telemetry, honestly: the strings that sound and
 * where they are fretted, the configuration map (X: from the string body to the
 * B♭ bore; Y: one patch parameter), the World's stored energy by body
 * (material, reservoir, space) in the player's meter-and-trace language, the
 * spectrum (the guitar dry, and the World), the DSP load and the live closure
 * residual. Nothing here synthesizes a note: the guitar's pickup signal touches
 * the World and the World sounds.
 *
 * Class C: persistent and non-relocatable (an AudioContext and a worklet). It
 * starts quiet: no AudioContext until a gesture (Start audio, a string, a key),
 * the master at −12 dB. Leaving the page closes its audio.
 *
 * The worklet is the bench's own (bench-worklet.js, verbatim); the module comes
 * from `wasm` through `fetchWasmBytes` + `addWasmWorklet` (@shrubbery/runtime/wasm).
 */

import { LitElement, css, html, nothing, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { addWasmWorklet, fetchWasmBytes } from '@shrubbery/runtime/wasm'
import { formatQuantity } from '@shrubbery/components/audio'
import { makeFft } from './fft.js'

const WORKLET_URL = new URL('./bench-worklet.js', import.meta.url)
const N = 4096
const STRING_NAMES = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4']
const STRING_KEYS = ['z', 'x', 'c', 'v', 'b', 'n']
const FRETS = 12
/** The knobs the bench offers (ovillo-dsp's Ariadne PARAMS indices). */
const KNOBS = [6, 7, 9, 13, 14, 4, 16]
const HISTORY = 300 // 10 s of World energies at the worklet's 30 frames a second
const BODIES = [
  { key: 'material', label: 'Material', about: 'the bodies: strings, plate, bore' },
  { key: 'reservoir', label: 'Reservoir', about: 'the energy the patch holds in store' },
  { key: 'space', label: 'Space', about: 'the shared space' },
] as const

interface BenchParam { readonly index: number; readonly id: string; readonly label: string; readonly min: number; readonly max: number; readonly value: number }
interface BenchPattern { readonly id: string; readonly label: string; readonly about: string }
export interface BenchInfo {
  readonly sampleRate: number
  readonly planDigest: string
  readonly maxFrames: number
  readonly params: readonly BenchParam[]
  readonly patterns: readonly BenchPattern[]
  readonly pickups: readonly string[]
  readonly pickup: number
  readonly mapY: readonly number[]
  readonly slots: Readonly<Record<string, number>> & { readonly count: number }
}

/** A score the bench can play (the graph's bench scores, `ovillo-score-json`). */
export interface BenchScore {
  readonly id: string
  readonly title: string
  readonly json: string
}

type AudioState = 'off' | 'starting' | 'on' | 'suspended' | 'error'

const dbToGain = (db: number): number => 10 ** (db / 20)
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)
const db10 = (e: number): number => 10 * Math.log10(Math.max(e, 1e-30))

function signed(n: number): string {
  return n < 0 ? `−${Math.abs(n)}` : String(n)
}

@customElement('mn-ovillo-bench')
export class MnOvilloBench extends LitElement {
  static styles = css`
    :host {
      display: block;
      container-type: inline-size;
      color: var(--mn-color-text-primary, #1f2a24);
      font-family: var(--mn-font-sans, system-ui, sans-serif);
      --b1: var(--mn-chart-categorical-1, #0388a5);
      --b2: var(--mn-chart-categorical-2, #c34517);
      --b3: var(--mn-chart-categorical-3, #7b61c9);
    }
    * { box-sizing: border-box; }
    .bench { display: grid; gap: 14px; outline: none; min-width: 0; }
    .eyebrow { font-size: 0.6875rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--mn-color-text-secondary, #4b5563); }
    h2 { margin: 2px 0 4px; font-family: var(--mn-font-display, Georgia, serif); font-weight: 500; font-size: clamp(1.4rem, 1.1rem + 1.2vw, 2rem); line-height: 1.15; }
    h3 { margin: 0 0 8px; font-family: var(--mn-font-display, Georgia, serif); font-weight: 500; font-size: 1rem; }
    .lead { margin: 0; max-width: 70ch; font-family: var(--mn-font-prose, Georgia, serif); line-height: 1.5; }
    .status { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .chip { font-family: var(--mn-font-mono, ui-monospace, monospace); font-variant-numeric: tabular-nums; font-size: 0.75rem;
      padding: 2px 9px; border-radius: 999px; background: var(--mn-color-surface-sunken, #f3f4f6); color: var(--mn-color-text-secondary, #4b5563); }
    .chip[data-state='on'] { background: var(--mn-color-success-surface, #ecfdf3); color: var(--mn-color-text-success, #166534); }
    .chip[data-state='warn'] { background: var(--mn-color-warning-surface, #fffbeb); color: var(--mn-color-text-warning, #92400e); }
    .chip[data-state='bad'] { background: var(--mn-color-danger-surface, #fef2f2); color: var(--mn-color-text-danger, #b91c1c); }
    .card { background: var(--mn-color-surface-raised, var(--mn-color-surface-base, #fff)); border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-surface, 10px); padding: 14px; min-width: 0; }
    .transport { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; }
    .about { flex-basis: 100%; margin: 0; font-size: 0.8125rem; color: var(--mn-color-text-secondary, #4b5563); }
    button { font: inherit; font-size: 0.875rem; padding: 7px 14px; border-radius: var(--mn-radius-control, 6px); cursor: pointer;
      border: 1px solid var(--mn-color-border-default, #d1d5db); background: var(--mn-color-surface-base, #fff); color: inherit; }
    button.primary { background: var(--mn-color-accent, #326f4c); border-color: var(--mn-color-accent, #326f4c); color: var(--mn-color-on-accent, #fff); }
    button[aria-pressed='true'] { background: var(--mn-color-surface-accent-subtle, #e8f1ea); border-color: var(--mn-color-accent, #326f4c); }
    button:disabled { opacity: 0.5; cursor: default; }
    button:focus-visible, select:focus-visible, input:focus-visible, .bench:focus-visible, canvas:focus-visible {
      outline: 2px solid var(--mn-color-border-focus, var(--mn-color-focus, #2563eb)); outline-offset: 2px; }
    label.field { display: inline-flex; align-items: center; gap: 8px; font-size: 0.8125rem; color: var(--mn-color-text-secondary, #4b5563); }
    select { font: inherit; font-size: 0.875rem; padding: 6px 8px; border-radius: var(--mn-radius-control, 6px);
      border: 1px solid var(--mn-color-border-default, #d1d5db); background: var(--mn-color-surface-base, #fff); color: var(--mn-color-text-primary, #1f2a24); }
    input[type='range'] { accent-color: var(--mn-color-accent, #326f4c); width: 130px; }
    .num { font-family: var(--mn-font-mono, ui-monospace, monospace); font-variant-numeric: tabular-nums; font-size: 0.75rem; min-width: 5.5em; display: inline-block; }
    .grid { display: grid; gap: 14px; grid-template-columns: minmax(0, 1fr); }
    @container (min-width: 820px) { .grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } .wide { grid-column: 1 / -1; } }
    canvas { display: block; width: 100%; border-radius: var(--mn-radius-md, 8px); background: var(--mn-color-surface-sunken, #f3f4f6);
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb); touch-action: none; }
    canvas.strings { height: 190px; cursor: pointer; }
    canvas.map { height: 260px; cursor: crosshair; }
    canvas.trace { height: 150px; }
    canvas.spectrum { height: 200px; }
    .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 8px; }
    .row .spacer { flex: 1; }
    .meters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 10px; }
    .meter { display: grid; gap: 4px; }
    .meter .name { font-size: 0.8125rem; display: flex; justify-content: space-between; gap: 6px; }
    .meter .db { font-family: var(--mn-font-mono, ui-monospace, monospace); font-variant-numeric: tabular-nums; font-size: 0.75rem; color: var(--mn-color-text-secondary, #4b5563); }
    .tube { position: relative; height: 10px; border-radius: 5px; overflow: hidden; background: color-mix(in srgb, var(--c) 15%, var(--mn-color-surface-base, #fff)); }
    .tube .fill { position: absolute; inset: 0; background: var(--c); transform-origin: 0 50%; transform: scaleX(0); border-radius: 5px; }
    .caption { font-family: var(--mn-font-mono, ui-monospace, monospace); font-size: 0.6875rem; color: var(--mn-color-text-muted, #6b7280); margin: 6px 0 0; }
    .knobs { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px 18px; }
    .knob { display: grid; grid-template-columns: 6.5em minmax(0, 1fr) auto; gap: 8px; align-items: center; font-size: 0.8125rem; }
    .knob input { width: 100%; }
    .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    .strings-keys { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .strings-keys button { padding: 4px 10px; font-family: var(--mn-font-mono, ui-monospace, monospace); font-size: 0.75rem; }
    .msg { margin: 0; font-size: 0.875rem; color: var(--mn-color-text-secondary, #4b5563); }
    .msg[data-bad] { color: var(--mn-color-text-danger, #b91c1c); }
  `

  /** The bench's module (ovillo-web), same-origin. */
  @property({ type: String }) wasm = ''
  /** Scores from the graph the bench can play. */
  @property({ attribute: false }) scores: readonly BenchScore[] = []

  @state() private audio: AudioState = 'off'
  @state() private info: BenchInfo | null = null
  @state() private params: number[] = []
  @state() private playing = false
  @state() private pattern = 0
  @state() private pickup = 2
  @state() private bpm = 92
  @state() private masterDb = -12
  @state() private muted = false
  @state() private mapY = 0
  @state() private upper: 'spectrum' | 'scope' = 'spectrum'
  @state() private message = 'The bench is quiet. Start audio, then pluck a string or let the guitarist play.'
  @state() private messageBad = false
  @state() private scoreId = ''
  @state() private tick = 0

  private ctx: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  private starting: Promise<void> | null = null
  private slots: Float64Array | null = null
  private load = 0
  private dry = new Float32Array(N)
  private wet = new Float32Array(N)
  private specDry = new Float32Array(N / 2)
  private specWet = new Float32Array(N / 2)
  private hold = new Float32Array(N / 2).fill(-200)
  private fresh = false
  private fft = makeFft(N)
  private world: Array<[number, number, number]> = []
  private trail: Array<[number, number, number]> = []
  private limitedAt = -1e9
  private lastLimited = 0
  private raf = 0
  private lastTick = 0
  private scoreWait = new Map<number, { resolve: (text: string) => void; reject: (e: Error) => void }>()
  private scoreSeq = 0
  private resize: ResizeObserver | null = null
  private dragging = false

  /** Is the World sounding in this page (tests and the browser check read it)? */
  get audioState(): AudioState {
    return this.audio
  }

  /** The latest telemetry slot values by name (tests and the browser check read it). */
  get telemetry(): Record<string, number> | null {
    if (!this.slots || !this.info) return null
    const out: Record<string, number> = { load: this.load }
    for (const [name, index] of Object.entries(this.info.slots)) if (name !== 'count') out[name] = this.slots[index]
    return out
  }

  connectedCallback(): void {
    super.connectedCallback()
    this.dataset.audio = this.audio
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    this.resize?.disconnect()
    this.resize = null
    this.node?.disconnect()
    void this.ctx?.close().catch(() => undefined)
    this.node = null
    this.ctx = null
    this.starting = null
    this.audio = 'off'
  }

  protected firstUpdated(): void {
    if (typeof ResizeObserver !== 'undefined') {
      this.resize = new ResizeObserver(() => this.draw())
      for (const c of this.renderRoot.querySelectorAll('canvas')) this.resize.observe(c)
    }
    this.draw()
  }

  protected updated(changed: PropertyValues): void {
    this.dataset.audio = this.audio
    if (changed.has('audio') || changed.has('upper')) this.draw()
  }

  // ── Audio ──────────────────────────────────────────────────────────────────

  /** Start the World (on a gesture). Resolves once it sounds. */
  start(): Promise<void> {
    if (this.node && this.ctx) {
      if (this.ctx.state !== 'running') return this.ctx.resume().then(() => { this.audio = 'on' })
      return Promise.resolve()
    }
    if (this.starting) return this.starting
    this.starting = (async () => {
      this.audio = 'starting'
      this.say('Starting the World…')
      const ctx = new AudioContext({ latencyHint: 'balanced' })
      try {
        const bytes = await fetchWasmBytes(this.wasm)
        const { node, info } = await addWasmWorklet<BenchInfo>(ctx, WORKLET_URL, 'ovillo', bytes, {
          node: { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] },
          init: { master: { gain: dbToGain(this.masterDb), mute: this.muted } },
          timeoutMs: 30_000,
        })
        node.port.onmessage = (e: MessageEvent) => this.onMessage(e.data as Record<string, unknown>)
        node.connect(ctx.destination)
        this.ctx = ctx
        this.node = node
        this.info = info
        this.params = info.params.map((p) => p.value)
        this.pickup = info.pickup ?? 2
        this.send({ op: 'master', gain: dbToGain(this.masterDb), mute: this.muted })
        if (ctx.state !== 'running') await ctx.resume()
        this.audio = ctx.state === 'running' ? 'on' : 'suspended'
        this.say('The World is on. Play the guitarist, or pluck a string (Z X C V B N).')
        this.loop()
      } catch (error) {
        void ctx.close().catch(() => undefined)
        this.starting = null
        this.audio = 'error'
        this.say(`No audio: ${error instanceof Error ? error.message : String(error)}`, true)
        throw error
      }
    })()
    return this.starting
  }

  private send(message: Record<string, unknown>, transfer: Transferable[] = []): void {
    this.node?.port.postMessage(message, transfer)
  }

  private onMessage(m: Record<string, unknown>): void {
    const info = this.info
    if (m.op === 'frame' && info) {
      const buf = m.buf as ArrayBuffer
      const f = new Float32Array(buf, 0, 2 * N)
      this.dry.set(f.subarray(0, N))
      this.wet.set(f.subarray(N, 2 * N))
      const view = new Float64Array(buf, 2 * N * 4, info.slots.count)
      if (!this.slots || this.slots.length !== view.length) this.slots = new Float64Array(view.length)
      this.slots.set(view)
      this.load = Number(m.load)
      this.fresh = true
      this.send({ op: 'return', buf }, [buf])
      this.ingest()
    } else if (m.op === 'score') {
      const wait = this.scoreWait.get(Number(m.id))
      this.scoreWait.delete(Number(m.id))
      const text = String(m.text ?? '')
      if (wait) (m.ok ? wait.resolve(text) : wait.reject(new Error(text)))
      if (m.ok) {
        try {
          const j = JSON.parse(text) as { name?: string; tempo?: number; seconds?: number; events_written?: number }
          this.say(`Playing the score “${j.name ?? 'score'}”: ${j.tempo} BPM, ${Number(j.seconds).toFixed(1)} s, ${j.events_written} events.`)
        } catch {
          this.say(`Playing the score: ${text}`)
        }
      } else this.say(`The bench refused the score: ${text}`, true)
    } else if (m.op === 'info') {
      this.info = m.info as BenchInfo
      this.params = this.info.params.map((p) => p.value)
    }
  }

  private ingest(): void {
    const s = this.slots
    const S = this.info?.slots
    if (!s || !S) return
    this.world.push([db10(s[S.material]), db10(s[S.reservoir]), db10(s[S.space])])
    if (this.world.length > HISTORY) this.world.shift()
    if (s[S.safetyLimitedFrames] > this.lastLimited) this.limitedAt = performance.now()
    this.lastLimited = s[S.safetyLimitedFrames]
    const pi = s[S.pattern] | 0
    if (pi !== this.pattern) this.pattern = pi
    const now = performance.now()
    if (now - this.lastTick > 200) {
      this.lastTick = now
      this.tick++
    }
  }

  // ── Controls ───────────────────────────────────────────────────────────────

  private say(text: string, bad = false): void {
    this.message = text
    this.messageBad = bad
  }

  /** Pluck a string (0 = low E … 5 = high E) at a fret. */
  pluck(string: number, fret = 0, velocity = 0.7): Promise<void> {
    return this.start().then(() => this.send({ op: 'pluck', string, fret, velocity }))
  }

  private transport(on: boolean): void {
    this.playing = on
    this.send({ op: 'transport', on })
    this.say(on ? `The guitarist plays ${this.patternInfo()?.label.toLowerCase() ?? ''}: ${this.patternInfo()?.about ?? ''}.` : 'Stopped: what rings, rings out.')
  }

  /** Start the guitarist on a pattern (by id or index). */
  playPattern(pattern: string | number): Promise<void> {
    return this.start().then(() => {
      const i = typeof pattern === 'number' ? pattern : this.info!.patterns.findIndex((p) => p.id === pattern)
      if (i < 0) throw new Error(`no pattern ${pattern}`)
      this.pattern = i
      this.send({ op: 'pattern', index: i })
      this.transport(true)
    })
  }

  private patternInfo(): BenchPattern | undefined {
    return this.info?.patterns[this.pattern]
  }

  private setParam(index: number, value: number): void {
    const p = this.info?.params[index]
    if (!p) return
    const v = clamp(value, p.min, p.max)
    const next = [...this.params]
    next[index] = v
    this.params = next
    this.send({ op: 'param', index, value: v })
  }

  private setMaster(db: number, mute: boolean): void {
    this.masterDb = clamp(Math.round(db * 10) / 10, -60, 0)
    this.muted = mute
    this.send({ op: 'master', gain: dbToGain(this.masterDb), mute: this.muted })
  }

  private playScore(): void {
    const score = this.scores.find((s) => s.id === this.scoreId) ?? this.scores[0]
    if (!score) return
    void this.start().then(() => new Promise<string>((resolve, reject) => {
      const id = ++this.scoreSeq
      this.scoreWait.set(id, { resolve, reject })
      this.send({ op: 'score', json: score.json, id })
      this.playing = true
    })).catch(() => undefined)
  }

  private onKey(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const t = e.composedPath()[0]
    if (t instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return
    const k = e.key.toLowerCase()
    const si = STRING_KEYS.indexOf(k)
    if (si >= 0) {
      e.preventDefault()
      if (!e.repeat) void this.pluck(si, 0, e.shiftKey ? 0.95 : 0.7).catch(() => undefined)
      return
    }
    if (e.key === ' ' && !(t instanceof HTMLButtonElement)) {
      e.preventDefault()
      void this.start().then(() => this.transport(!this.playing)).catch(() => undefined)
    } else if (e.key === '0') {
      this.send({ op: 'reset' })
      this.say('The World is at rest.')
    } else if (e.key === '\\') {
      this.setMaster(this.masterDb, !this.muted)
    }
  }

  // ── Pointer: the strings and the map ───────────────────────────────────────

  private stringsGeom(w: number, h: number) {
    const top = 14
    const bottom = 22
    const gap = (h - top - bottom) / 5
    const L = 40
    const R = 64
    const span = w - L - R
    const fretX = (k: number): number => L + ((1 - 2 ** (-k / 12)) / 0.5) * span
    return { top, gap, L, R, span, fretX }
  }

  private onStringsDown(e: PointerEvent): void {
    e.preventDefault()
    const c = e.currentTarget as HTMLCanvasElement
    const r = c.getBoundingClientRect()
    const g = this.stringsGeom(r.width, r.height)
    const yi = clamp(Math.round((e.clientY - r.top - g.top) / g.gap), 0, 5)
    const x = e.clientX - r.left
    let fret = 0
    for (let f = 1; f <= FRETS; f++) if (x > g.fretX(f - 1)) fret = f
    if (x < g.fretX(0)) fret = 0
    void this.pluck(5 - yi, fret, 0.75).catch(() => undefined)
  }

  private squareGeom(w: number, h: number) {
    const s = Math.max(40, Math.min(w - 60, h - 40))
    return { s, x: (w - s) / 2, y: 12 }
  }

  private mapAt(e: PointerEvent, c: HTMLCanvasElement): void {
    const r = c.getBoundingClientRect()
    const q = this.squareGeom(r.width, r.height)
    const x = clamp((e.clientX - r.left - q.x) / q.s, 0, 1)
    const y = clamp(1 - (e.clientY - r.top - q.y) / q.s, 0, 1)
    this.setParam(0, x)
    const yi = this.info?.mapY[this.mapY] ?? 4
    const p = this.info?.params[yi]
    if (p) this.setParam(yi, p.min + y * (p.max - p.min))
    this.trail.push([x, y, performance.now()])
    if (this.trail.length > 400) this.trail.shift()
  }

  private onMapDown(e: PointerEvent): void {
    e.preventDefault()
    const c = e.currentTarget as HTMLCanvasElement
    void this.start().then(() => {
      this.dragging = true
      try { c.setPointerCapture(e.pointerId) } catch { /* fine */ }
      this.mapAt(e, c)
    }).catch(() => undefined)
  }

  // ── Drawing (canvas, in Sophia's colours) ──────────────────────────────────

  private loop(): void {
    if (this.raf || typeof requestAnimationFrame === 'undefined') return
    const step = (): void => {
      this.raf = 0
      if (!this.isConnected || !this.node) return
      this.draw()
      this.raf = requestAnimationFrame(step)
    }
    this.raf = requestAnimationFrame(step)
  }

  private colors() {
    const cs = getComputedStyle(this)
    const v = (n: string, f: string): string => cs.getPropertyValue(n).trim() || f
    return {
      text: v('--mn-color-text-primary', '#1f2a24'),
      muted: v('--mn-color-text-muted', '#6b7280'),
      grid: v('--mn-color-border-subtle', '#e5e7eb'),
      accent: v('--mn-color-accent', '#326f4c'),
      b1: v('--mn-chart-categorical-1', '#0388a5'),
      b2: v('--mn-chart-categorical-2', '#c34517'),
      b3: v('--mn-chart-categorical-3', '#7b61c9'),
      font: v('--mn-font-mono', 'ui-monospace, monospace'),
    }
  }

  private begin(c: HTMLCanvasElement | null) {
    if (!c) return null
    const g = c.getContext?.('2d') ?? null
    if (!g) return null
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1)
    const w = Math.max(1, c.clientWidth)
    const h = Math.max(1, c.clientHeight)
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr)
      c.height = Math.round(h * dpr)
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, h)
    return { g, w, h }
  }

  private draw(): void {
    const root = this.renderRoot as ShadowRoot | null
    if (!root?.querySelector) return
    const col = this.colors()
    if (this.fresh) {
      this.fft.mag(this.dry, this.specDry)
      this.fft.mag(this.wet, this.specWet)
      for (let i = 0; i < this.specWet.length; i++) if (this.specWet[i] > this.hold[i]) this.hold[i] = this.specWet[i]
      this.fresh = false
    }
    this.drawStrings(root.querySelector('canvas.strings'), col)
    this.drawMap(root.querySelector('canvas.map'), col)
    this.drawWorld(root.querySelector('canvas.trace'), col)
    if (this.upper === 'spectrum') this.drawSpectrum(root.querySelector('canvas.spectrum'), col)
    else this.drawScope(root.querySelector('canvas.spectrum'), col)
    this.paintMeters(root)
  }

  private paintMeters(root: ShadowRoot): void {
    const last = this.world[this.world.length - 1]
    const meters = root.querySelectorAll<HTMLElement>('.meter')
    meters.forEach((m, i) => {
      const db = last ? last[i] : -200
      const level = clamp((db + 160) / 160, 0, 1)
      const fill = m.querySelector<HTMLElement>('.fill')
      if (fill) fill.style.transform = `scaleX(${level.toFixed(4)})`
      m.dataset.level = level.toFixed(3)
      const label = m.querySelector<HTMLElement>('.db')
      if (label) label.textContent = last && db > -159 ? `${signed(Math.round(db))} dB` : '—'
    })
  }

  private drawStrings(c: HTMLCanvasElement | null, col: ReturnType<MnOvilloBench['colors']>): void {
    const b = this.begin(c)
    if (!b) return
    const { g, w, h } = b
    const q = this.stringsGeom(w, h)
    g.font = `11px ${col.font}`
    for (let f = 0; f <= FRETS; f++) {
      g.strokeStyle = f === 0 ? col.muted : col.grid
      g.lineWidth = f === 0 ? 2 : 1
      g.beginPath()
      g.moveTo(q.fretX(f), q.top - 4)
      g.lineTo(q.fretX(f), q.top + 5 * q.gap + 4)
      g.stroke()
    }
    g.fillStyle = col.muted
    g.textAlign = 'center'
    for (const f of [3, 5, 7, 9, 12]) g.fillText(String(f), (q.fretX(f - 1) + q.fretX(f)) / 2, h - 6)
    const s = this.slots
    const S = this.info?.slots
    for (let yi = 0; yi < 6; yi++) {
      const string = 5 - yi
      const y = q.top + yi * q.gap
      const sounding = s && S ? ((s[S.sounding] | 0) >> string) & 1 : 0
      const level = s && S ? s[S.stringLevel + string] : 0
      g.globalAlpha = sounding ? clamp(0.5 + 0.5 * clamp((20 * Math.log10(Math.max(level, 1e-12)) + 60) / 50, 0, 1), 0.5, 1) : 0.45
      g.strokeStyle = col.b1
      g.lineWidth = sounding ? 2.5 : 1.25
      g.beginPath()
      g.moveTo(q.L - 6, y)
      g.lineTo(q.L + q.span, y)
      g.stroke()
      g.globalAlpha = 1
      g.fillStyle = sounding ? col.text : col.muted
      g.textAlign = 'left'
      g.fillText(STRING_NAMES[string], 4, y + 4)
      g.textAlign = 'right'
      if (s && S && sounding) {
        const fret = s[S.stringFret + string] | 0
        const x = fret === 0 ? q.L - 10 : (q.fretX(fret - 1) + q.fretX(fret)) / 2
        g.fillStyle = col.accent
        g.beginPath()
        g.arc(x, y, 4.5, 0, Math.PI * 2)
        g.fill()
        g.fillStyle = col.text
        g.fillText(`${s[S.stringHz + string].toFixed(1)} Hz`, w - 4, y + 4)
      } else {
        g.fillStyle = col.muted
        g.fillText('—', w - 4, y + 4)
      }
    }
  }

  private drawMap(c: HTMLCanvasElement | null, col: ReturnType<MnOvilloBench['colors']>): void {
    const b = this.begin(c)
    if (!b) return
    const { g, w, h } = b
    const q = this.squareGeom(w, h)
    const yi = this.info?.mapY[this.mapY] ?? 4
    const p = this.info?.params[yi]
    const x = this.params.length ? this.params[0] : 0.06
    const yv = p && this.params.length ? (this.params[yi] - p.min) / (p.max - p.min) : 0.28
    g.lineWidth = 1
    for (let i = 0; i <= 10; i++) {
      g.strokeStyle = i === 5 ? col.muted : col.grid
      g.globalAlpha = i === 5 ? 0.4 : 1
      g.beginPath()
      g.moveTo(q.x + (i * q.s) / 10, q.y)
      g.lineTo(q.x + (i * q.s) / 10, q.y + q.s)
      g.moveTo(q.x, q.y + (i * q.s) / 10)
      g.lineTo(q.x + q.s, q.y + (i * q.s) / 10)
      g.stroke()
    }
    g.globalAlpha = 1
    // The configuration: a wash from the string body (left) to the B♭ bore (right).
    const grad = g.createLinearGradient(q.x, 0, q.x + q.s, 0)
    grad.addColorStop(0, col.b1)
    grad.addColorStop(1, col.b2)
    g.globalAlpha = 0.08
    g.fillStyle = grad
    g.fillRect(q.x, q.y, q.s, q.s)
    g.globalAlpha = 1
    g.font = `11px ${col.font}`
    g.fillStyle = col.muted
    g.textAlign = 'left'
    g.fillText('string body', q.x, q.y + q.s + 16)
    g.textAlign = 'right'
    g.fillText('B♭ bore', q.x + q.s, q.y + q.s + 16)
    const now = performance.now()
    this.trail = this.trail.filter((pt) => now - pt[2] < 4000)
    g.strokeStyle = col.accent
    for (let i = 1; i < this.trail.length; i++) {
      const a = this.trail[i - 1]
      const t = this.trail[i]
      g.globalAlpha = Math.max(0.08, 0.6 * (1 - (now - t[2]) / 4000))
      g.beginPath()
      g.moveTo(q.x + a[0] * q.s, q.y + (1 - a[1]) * q.s)
      g.lineTo(q.x + t[0] * q.s, q.y + (1 - t[1]) * q.s)
      g.stroke()
    }
    g.globalAlpha = 1
    const cx = q.x + x * q.s
    const cy = q.y + (1 - yv) * q.s
    g.fillStyle = col.accent
    g.beginPath()
    g.arc(cx, cy, 6, 0, Math.PI * 2)
    g.fill()
  }

  private drawWorld(c: HTMLCanvasElement | null, col: ReturnType<MnOvilloBench['colors']>): void {
    const b = this.begin(c)
    if (!b) return
    const { g, w, h } = b
    const L = 36
    const pw = w - L - 6
    const ph = h - 16
    const top = 0
    const bot = -160
    const dy = (d: number): number => 4 + ((top - d) / (top - bot)) * ph
    g.font = `10px ${col.font}`
    g.fillStyle = col.muted
    g.textAlign = 'right'
    for (let d = top; d >= bot; d -= 40) {
      g.strokeStyle = col.grid
      g.beginPath()
      g.moveTo(L, dy(d))
      g.lineTo(L + pw, dy(d))
      g.stroke()
      g.fillText(signed(d), L - 4, dy(d) + 3)
    }
    const n = this.world.length
    if (!n) return
    const colors = [col.b1, col.b2, col.b3]
    for (let k = 0; k < 3; k++) {
      g.strokeStyle = colors[k]
      g.lineWidth = 1.5
      g.beginPath()
      for (let i = 0; i < n; i++) {
        const x = L + pw - ((n - 1 - i) / (HISTORY - 1)) * pw
        const y = dy(clamp(this.world[i][k], bot, top))
        if (i === 0) g.moveTo(x, y)
        else g.lineTo(x, y)
      }
      g.stroke()
    }
  }

  private drawSpectrum(c: HTMLCanvasElement | null, col: ReturnType<MnOvilloBench['colors']>): void {
    const b = this.begin(c)
    if (!b) return
    const { g, w, h } = b
    const L = 36
    const pw = w - L - 6
    const ph = h - 20
    const sr = this.ctx?.sampleRate ?? 48000
    const f0 = 20
    const f1 = Math.min(20000, sr / 2)
    const fx = (f: number): number => L + (Math.log10(f / f0) / Math.log10(f1 / f0)) * pw
    const dy = (d: number): number => 4 + ((0 - d) / 120) * ph
    g.font = `10px ${col.font}`
    g.strokeStyle = col.grid
    for (const f of [100, 1000, 10000]) {
      g.beginPath()
      g.moveTo(fx(f), 4)
      g.lineTo(fx(f), 4 + ph)
      g.stroke()
    }
    for (let d = 0; d >= -120; d -= 40) {
      g.beginPath()
      g.moveTo(L, dy(d))
      g.lineTo(L + pw, dy(d))
      g.stroke()
    }
    g.fillStyle = col.muted
    g.textAlign = 'center'
    for (const [f, t] of [[100, '100'], [1000, '1k'], [10000, '10k Hz']] as const) g.fillText(t, fx(f), h - 4)
    g.textAlign = 'right'
    for (let d = 0; d >= -120; d -= 40) g.fillText(signed(d), L - 4, dy(d) + 3)
    if (!this.node) {
      g.textAlign = 'center'
      g.fillText('quiet until audio starts', L + pw / 2, 4 + ph / 2)
      return
    }
    const trace = (spec: Float32Array, color: string, alpha = 1, dash: number[] = []): void => {
      g.strokeStyle = color
      g.globalAlpha = alpha
      g.lineWidth = 1.4
      g.setLineDash(dash)
      g.beginPath()
      let started = false
      let colX = -1
      let best = -Infinity
      const flush = (): void => {
        if (colX < 0) return
        const y = dy(clamp(best, -120, 0))
        if (!started) { g.moveTo(colX, y); started = true } else g.lineTo(colX, y)
      }
      for (let i = 1; i < spec.length; i++) {
        const f = (i * sr) / N
        if (f < f0 || f > f1) continue
        const x = Math.round(fx(f))
        if (x !== colX) { flush(); colX = x; best = spec[i] } else if (spec[i] > best) best = spec[i]
      }
      flush()
      g.stroke()
      g.setLineDash([])
      g.globalAlpha = 1
    }
    trace(this.hold, col.accent, 0.35, [2, 3])
    trace(this.specDry, col.muted, 0.9)
    trace(this.specWet, col.accent)
  }

  private drawScope(c: HTMLCanvasElement | null, col: ReturnType<MnOvilloBench['colors']>): void {
    const b = this.begin(c)
    if (!b) return
    const { g, w, h } = b
    const mid = h / 2
    g.strokeStyle = col.grid
    g.beginPath()
    g.moveTo(0, mid)
    g.lineTo(w, mid)
    g.stroke()
    if (!this.node) return
    const sr = this.ctx?.sampleRate ?? 48000
    const span = Math.round((20 * sr) / 1000)
    let trig = N - span - 1
    for (let i = N - span - 2; i > 1; i--) if (this.dry[i - 1] < 0 && this.dry[i] >= 0) { trig = i; break }
    for (const [buf, color] of [[this.dry, col.muted], [this.wet, col.accent]] as const) {
      g.strokeStyle = color
      g.lineWidth = 1.4
      g.beginPath()
      for (let k = 0; k < span; k++) {
        const x = (k / span) * w
        const y = clamp(mid - ((buf[trig + k] || 0) / 0.4) * (h / 2), 0, h)
        if (k === 0) g.moveTo(x, y)
        else g.lineTo(x, y)
      }
      g.stroke()
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  private chips() {
    void this.tick
    const s = this.slots
    const S = this.info?.slots
    const on = this.audio === 'on'
    const load = this.load * 100
    const guard = s && S ? ['Guard ok', 'Guard fading', 'Guard resting', 'Guard returning'][s[S.guard] | 0] ?? 'Guard' : 'Guard —'
    const resid = s && S ? formatQuantity(s[S.closureResidual], 'J') : null
    return html`<div class="status" aria-label="The bench's state">
      <span class="chip" data-state=${on ? 'on' : this.audio === 'error' ? 'bad' : ''} data-chip="audio">${this.audio === 'off' ? 'Audio off' : this.audio === 'starting' ? 'Starting…' : this.audio === 'error' ? 'No audio' : this.audio === 'suspended' ? 'Audio suspended' : `Audio on · ${((this.ctx?.sampleRate ?? 48000) / 1000).toFixed(0)} kHz`}</span>
      <span class="chip" data-state=${!on ? '' : load > 100 ? 'bad' : load > 70 ? 'warn' : 'on'} data-chip="load">DSP load ${on ? `${load.toFixed(0)}%` : '—'}</span>
      <span class="chip" data-chip="residual" title="The World's closure residual, live (its own energy units)">Closure residual ${resid ? resid.text : '—'}</span>
      <span class="chip" data-state=${s && S && (s[S.guard] | 0) ? 'warn' : ''} data-chip="guard">${guard}</span>
      <span class="chip" data-state=${performance.now() - this.limitedAt < 500 ? 'warn' : ''} data-chip="limit">Safety limiter</span>
      <span class="chip" data-state=${this.muted ? 'warn' : ''} data-chip="master">Master ${signed(this.masterDb)} dB${this.muted ? ' · muted' : ''}</span>
      ${this.info ? html`<span class="chip" title=${this.info.planDigest}>plan ${this.info.planDigest.slice(7, 19)}</span>` : nothing}
    </div>`
  }

  render() {
    const info = this.info
    const on = !!this.node
    const patterns = (info?.patterns ?? []).map((p, i) => ({ p, i })).filter(({ p }) => p.id !== 'score' && p.id !== 'off')
    const yIndex = info?.mapY[this.mapY] ?? 4
    return html`<section class="bench" tabindex="0" aria-label="The bench: a simulated guitarist played into an Ariadne World. Z X C V B N pluck the open strings; Space starts and stops the guitarist."
      @keydown=${this.onKey}>
      <header>
        <span class="eyebrow">The bench</span>
        <h2>A guitarist, played into an Ariadne World</h2>
        <p class="lead">Nothing here synthesizes a note: a simulated guitar's pickup signal touches the World, and the World sounds,
          live in this page. It starts quiet; nothing plays until you start it.</p>
        ${this.chips()}
      </header>
      <div class="card transport">
        <button type="button" class=${on ? '' : 'primary'} data-action="start" ?disabled=${this.audio === 'starting'}
          @click=${() => { if (on && this.ctx?.state === 'running') { void this.ctx.suspend().then(() => { this.audio = 'suspended' }) } else void this.start().catch(() => undefined) }}>
          ${!on ? 'Start audio' : this.ctx?.state === 'running' ? 'Pause audio' : 'Resume audio'}</button>
        <button type="button" data-action="guitarist" aria-pressed=${String(this.playing)} ?disabled=${this.audio === 'starting'}
          @click=${() => void this.start().then(() => this.transport(!this.playing)).catch(() => undefined)}>${this.playing ? 'Stop the guitarist' : 'The guitarist plays'}</button>
        <label class="field">Pattern
          <select aria-label="Pattern" ?disabled=${!info} @change=${(e: Event) => void this.playPattern(Number((e.target as HTMLSelectElement).value))}>
            ${patterns.length ? patterns.map(({ p, i }) => html`<option value=${i} ?selected=${i === this.pattern}>${p.label.toLowerCase()}</option>`) : html`<option>wander</option>`}
          </select></label>
        <label class="field">Pickup
          <select aria-label="Pickup" ?disabled=${!info} @change=${(e: Event) => { this.pickup = Number((e.target as HTMLSelectElement).value); this.send({ op: 'pickup', index: this.pickup }) }}>
            ${(info?.pickups ?? ['bridge sc']).map((p, i) => html`<option value=${i} ?selected=${i === this.pickup}>${p.toLowerCase()}</option>`)}
          </select></label>
        <label class="field">Tempo <input type="range" min="40" max="220" step="1" .value=${String(this.bpm)} aria-label="Tempo"
          @input=${(e: Event) => { this.bpm = Number((e.target as HTMLInputElement).value); this.send({ op: 'tempo', bpm: this.bpm }) }}><span class="num">${this.bpm} BPM</span></label>
        <label class="field">Master <input type="range" min="-60" max="0" step="0.5" .value=${String(this.masterDb)} aria-label="Master level"
          @input=${(e: Event) => this.setMaster(Number((e.target as HTMLInputElement).value), this.muted)}><span class="num">${signed(this.masterDb)} dB</span></label>
        <button type="button" aria-pressed=${String(this.muted)} data-action="mute" @click=${() => this.setMaster(this.masterDb, !this.muted)}>${this.muted ? 'Unmute' : 'Mute'}</button>
        <p class="about">${this.patternInfo()?.about ?? 'Patterns: a generative chord wander, Travis picking, a 12-bar shuffle, sparse ambient, a slow melody, and the original loops.'}</p>
      </div>
      <div class="grid">
        <div class="card">
          <h3>The strings</h3>
          <canvas class="strings" aria-label="The six strings: tap a fret to pluck it" @pointerdown=${this.onStringsDown}></canvas>
          <div class="strings-keys" role="group" aria-label="Pluck an open string">
            ${STRING_NAMES.map((name, i) => html`<button type="button" data-string=${i} @click=${() => void this.pluck(i, 0, 0.7).catch(() => undefined)}>${name} · ${STRING_KEYS[i].toUpperCase()}</button>`)}
          </div>
        </div>
        <div class="card">
          <div class="row"><h3>The configuration</h3><span class="spacer"></span>
            <label class="field">Y <select aria-label="The map's vertical axis" @change=${(e: Event) => { this.mapY = Number((e.target as HTMLSelectElement).value) }}>
              ${(info?.mapY ?? [4]).map((pi, i) => html`<option value=${i} ?selected=${i === this.mapY}>${(info?.params[pi]?.label ?? 'drive').toLowerCase()}</option>`)}
            </select></label></div>
          <canvas class="map" aria-label=${`The configuration map: across, from the string body to the B♭ bore; up, ${info?.params[yIndex]?.label.toLowerCase() ?? 'drive'}. Drag to move through it.`}
            @pointerdown=${this.onMapDown}
            @pointermove=${(e: PointerEvent) => { if (this.dragging) { e.preventDefault(); this.mapAt(e, e.currentTarget as HTMLCanvasElement) } }}
            @pointerup=${() => { this.dragging = false }} @pointercancel=${() => { this.dragging = false }}></canvas>
          <p class="caption">across: ${this.params.length ? this.params[0].toFixed(3) : '0.060'} (string body → B♭ bore) · up: ${info && this.params.length ? this.params[yIndex].toFixed(3) : '—'}</p>
        </div>
        <div class="card wide">
          <h3>The World's energy</h3>
          <div class="meters">
            ${BODIES.map((b, i) => html`<div class="meter" data-body=${b.key} style=${`--c: var(--b${i + 1})`} title=${b.about}>
              <span class="name">${b.label}<span class="db">—</span></span>
              <div class="tube"><div class="fill"></div></div>
            </div>`)}
          </div>
          <canvas class="trace" aria-label="The World's stored energy by body over the last 10 seconds"></canvas>
          <p class="caption">10·log₁₀ E · dB re the World's energy unit · the last 10 s · material (the bodies), reservoir, space</p>
        </div>
        <div class="card">
          <div class="row"><h3>${this.upper === 'spectrum' ? 'Spectrum' : 'Scope'}</h3><span class="spacer"></span>
            <button type="button" aria-pressed=${String(this.upper === 'spectrum')} @click=${() => { this.upper = 'spectrum' }}>Spectrum</button>
            <button type="button" aria-pressed=${String(this.upper === 'scope')} @click=${() => { this.upper = 'scope' }}>Scope</button></div>
          <canvas class="spectrum" aria-label="The guitar before the World, and the World's sound"></canvas>
          <p class="caption">grey: the guitar, dry · accent: the World · dashed: the World's peak hold · dBFS, log Hz</p>
        </div>
        <div class="card">
          <h3>Knobs</h3>
          <div class="knobs">
            ${KNOBS.map((pi) => {
              const p = info?.params[pi]
              return html`<label class="knob"><span>${(p?.label ?? '—').toLowerCase()}</span>
                <input type="range" ?disabled=${!p} min=${p?.min ?? 0} max=${p?.max ?? 1} step=${p ? (p.max - p.min) / 200 : 0.01}
                  .value=${String(this.params[pi] ?? p?.value ?? 0)} aria-label=${p?.label ?? 'knob'}
                  @input=${(e: Event) => this.setParam(pi, Number((e.target as HTMLInputElement).value))}>
                <span class="num">${p ? (this.params[pi] ?? p.value).toFixed(p.max > 2 ? 2 : 3) : '—'}</span></label>`
            })}
          </div>
          <div class="row" style="margin-top:12px">
            <button type="button" ?disabled=${!on} @click=${() => { this.send({ op: 'defaultPatch' }); this.say('The default patch.') }}>Default patch</button>
            <button type="button" ?disabled=${!on} @click=${() => { this.send({ op: 'reset' }); this.say('The World is at rest.') }}>Reset the World</button>
            <button type="button" ?disabled=${!on} @click=${() => this.send({ op: 'muteStrings' })}>Mute the strings</button>
          </div>
          ${this.scores.length
            ? html`<div class="row" style="margin-top:4px"><label class="field">Score
                <select aria-label="A bench score from the gallery" @change=${(e: Event) => { this.scoreId = (e.target as HTMLSelectElement).value }}>
                  ${this.scores.map((s) => html`<option value=${s.id} ?selected=${s.id === this.scoreId}>${s.title}</option>`)}
                </select></label>
                <button type="button" @click=${() => this.playScore()}>Play the score</button></div>`
            : nothing}
        </div>
      </div>
      <p class="msg" role="status" ?data-bad=${this.messageBad}>${this.message}</p>
    </section>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-ovillo-bench': MnOvilloBench
  }
}
