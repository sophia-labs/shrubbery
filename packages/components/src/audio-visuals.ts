/**
 * audio-visuals.ts — the pure data behind `mn-audio-player`'s visualizers.
 *
 * Three inputs, each a file a render writes beside its audio:
 *   - waveform PEAKS: `{ sr, samplesPerPeak, peaks: [min, max, …] }`;
 *   - the ENERGY TRACE of an Ariadne World: the stored energy of each body
 *     (strings, box, room …) every hop, plus the touches that put energy in;
 *   - the live SPECTRUM, which is not a file: an AnalyserNode's bytes.
 * And one record, the World's LEDGER (source work, control work, internal
 * loss, radiation, closure residual), formatted honestly with units.
 *
 * Two energy-trace shapes are read: the compact one the Ovillo graph builder
 * writes (`ovillo.energy.v1`: `channels` + `frames` + `touches`, with `units`
 * saying raw energy or decibels), and the engine's own
 * `mus.ariadne.energy-trace.v1` (`worlds[]`, per-body channels `string/6` …
 * `box/0` … `room`, summed here per body kind). A trace that does not say its
 * unit is read by inspection and says so (`unitInferred`).
 *
 * Pure: no DOM, no network. Every function is tested on real render data.
 */

export class MnMediaDataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MnMediaDataError'
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

// ── Waveform peaks ───────────────────────────────────────────────────────────

export interface MnWaveformPeaks {
  readonly sr: number
  readonly samplesPerPeak: number
  /** Interleaved min, max pairs, one pair per `samplesPerPeak` samples. */
  readonly peaks: readonly number[]
}

export function parsePeaks(json: unknown): MnWaveformPeaks {
  if (!isRecord(json)) throw new MnMediaDataError('peaks: expected an object')
  const { sr, samplesPerPeak, peaks } = json
  if (!finite(sr) || sr <= 0) throw new MnMediaDataError('peaks: `sr` must be a positive number')
  if (!finite(samplesPerPeak) || samplesPerPeak <= 0) throw new MnMediaDataError('peaks: `samplesPerPeak` must be a positive number')
  if (!Array.isArray(peaks) || peaks.length < 2 || peaks.length % 2 !== 0) {
    throw new MnMediaDataError('peaks: `peaks` must be an even-length array of min,max pairs')
  }
  for (const v of peaks) if (!finite(v)) throw new MnMediaDataError('peaks: every peak must be a finite number')
  return { sr, samplesPerPeak, peaks: peaks as number[] }
}

/** The seconds a peaks file covers. */
export function peaksDuration(p: MnWaveformPeaks): number {
  return ((p.peaks.length / 2) * p.samplesPerPeak) / p.sr
}

/**
 * Downsample to `bins` (min, max) pairs normalized by the loudest sample, so
 * the result is in [-1, 1]: `out[2i]` is bin i's min, `out[2i + 1]` its max.
 */
export function peakBins(p: MnWaveformPeaks, bins: number): Float32Array {
  const pairs = p.peaks.length / 2
  const n = Math.max(1, Math.floor(bins))
  const out = new Float32Array(n * 2)
  let top = 0
  for (const v of p.peaks) top = Math.max(top, Math.abs(v))
  const scale = top > 0 ? 1 / top : 0
  for (let b = 0; b < n; b++) {
    const from = Math.floor((b * pairs) / n)
    const to = Math.max(from + 1, Math.floor(((b + 1) * pairs) / n))
    let lo = 0
    let hi = 0
    for (let i = from; i < to && i < pairs; i++) {
      lo = Math.min(lo, p.peaks[2 * i])
      hi = Math.max(hi, p.peaks[2 * i + 1])
    }
    out[2 * b] = lo * scale
    out[2 * b + 1] = hi * scale
  }
  return out
}

// ── The energy trace ─────────────────────────────────────────────────────────

export interface MnEnergyBody {
  /** The body kind as the trace names it: 'strings', 'box', 'room', … */
  readonly id: string
  readonly label: string
  /** 10·log10 of the stored energy every hop (decibels re the trace's unit). */
  readonly db: Float32Array
}

export interface MnEnergyTouch {
  readonly t: number
  readonly string?: number
  readonly kind?: string
  readonly world?: string
}

export interface MnEnergyTrace {
  readonly hopSeconds: number
  readonly startSeconds: number
  /** The unit of the source numbers: raw energy ('J', the World's units) or decibels. */
  readonly unit: 'J' | 'dB'
  /** True when the file did not say its unit and it was read by inspection. */
  readonly unitInferred: boolean
  readonly bodies: readonly MnEnergyBody[]
  readonly touches: readonly MnEnergyTouch[]
  /** The Worlds the trace sums (instrument abbreviations), when it names them. */
  readonly worlds: readonly string[]
  readonly durationSeconds: number
  /** The display window: 3 dB above the 99.5th percentile, and 60 dB below that. */
  readonly hiDb: number
  readonly loDb: number
}

const BODY_LABELS: Record<string, string> = { strings: 'Strings', string: 'Strings', box: 'Box', room: 'Room', air: 'Air' }

function bodyLabel(id: string): string {
  return BODY_LABELS[id] ?? (id.length > 0 ? id.charAt(0).toUpperCase() + id.slice(1) : id)
}

/** The body kind a raw engine channel belongs to: `string/6` → strings, `box/0` → box, `room` → room. */
export function bodyKindOf(channel: string): string {
  const head = channel.split('/')[0]
  return head === 'string' ? 'strings' : head
}

function unitOf(json: Record<string, unknown>, frames: readonly (readonly number[])[]): { unit: 'J' | 'dB'; inferred: boolean } {
  const said = [json.unit, json.units, json.scale].filter((v): v is string => typeof v === 'string').join(' ').toLowerCase()
  if (said) {
    // "raw energy, not decibels" names decibels to deny them, so the denial is read first.
    if (/\bnot\s+(in\s+)?(db|decibels?)\b/.test(said)) return { unit: 'J', inferred: false }
    if (/\bdb\b|decibel/.test(said)) return { unit: 'dB', inferred: false }
    if (/\braw\b|joule|\blinear\b|\bj\b|energy/.test(said)) return { unit: 'J', inferred: false }
  }
  // Not said: stored energy is never negative; decibels of small energies are.
  for (const row of frames) for (const v of row) if (v < 0) return { unit: 'dB', inferred: true }
  return { unit: 'J', inferred: true }
}

function toTouch(raw: unknown, world?: string): MnEnergyTouch | null {
  if (!isRecord(raw)) return null
  const t = finite(raw.t) ? raw.t : finite(raw.seconds) ? raw.seconds : null
  if (t === null) return null
  return {
    t,
    ...(finite(raw.string) ? { string: raw.string } : {}),
    ...(typeof raw.kind === 'string' ? { kind: raw.kind } : {}),
    ...(typeof raw.world === 'string' ? { world: raw.world } : world ? { world } : {}),
  }
}

function percentile(values: Float32Array, q: number): number {
  const sorted = Float32Array.from(values).sort()
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))]
}

const FLOOR_J = 1e-30

/** Read either trace shape into bodies of decibels, touches, and a display window. */
export function parseEnergyTrace(json: unknown): MnEnergyTrace {
  if (!isRecord(json)) throw new MnMediaDataError('energy trace: expected an object')

  let hop: number
  let start = 0
  let ids: string[]
  let columns: number[][] // per body, per frame, in the source unit
  let touches: MnEnergyTouch[] = []
  let worlds: string[] = []
  let unit: { unit: 'J' | 'dB'; inferred: boolean }

  if (Array.isArray(json.frames) && Array.isArray(json.channels)) {
    // The compact shape: channels are already body kinds.
    if (!finite(json.hopSeconds) || json.hopSeconds <= 0) throw new MnMediaDataError('energy trace: `hopSeconds` must be positive')
    hop = json.hopSeconds
    start = finite(json.startSeconds) ? json.startSeconds : 0
    ids = json.channels.map((c) => String(c))
    const frames = json.frames as unknown[]
    columns = ids.map(() => new Array<number>(frames.length))
    frames.forEach((row, i) => {
      if (!Array.isArray(row) || row.length < ids.length) throw new MnMediaDataError(`energy trace: frame ${i} has ${Array.isArray(row) ? row.length : 0} values for ${ids.length} channels`)
      for (let c = 0; c < ids.length; c++) {
        const v = row[c]
        if (!finite(v)) throw new MnMediaDataError(`energy trace: frame ${i} channel ${ids[c]} is not a finite number`)
        columns[c][i] = v
      }
    })
    unit = unitOf(json, frames as number[][])
    for (const raw of Array.isArray(json.touches) ? json.touches : []) {
      const touch = toTouch(raw)
      if (touch) touches.push(touch)
    }
    if (Array.isArray(json.worlds)) {
      worlds = json.worlds.map((w) => (isRecord(w) && typeof w.world === 'string' ? w.world : typeof w === 'string' ? w : '')).filter(Boolean)
    }
  } else if (Array.isArray(json.worlds)) {
    // The engine's own shape: sum each World's per-body channels by kind, aligned on startSeconds.
    const raw = json.worlds.filter(isRecord)
    if (raw.length === 0) throw new MnMediaDataError('energy trace: the trace has no Worlds')
    const first = raw[0]
    if (!finite(first.hopSeconds) || first.hopSeconds <= 0) throw new MnMediaDataError('energy trace: `hopSeconds` must be positive')
    hop = first.hopSeconds
    ids = []
    for (const w of raw) for (const c of Array.isArray(w.channels) ? w.channels : []) {
      const kind = bodyKindOf(String(c))
      if (!ids.includes(kind)) ids.push(kind)
    }
    const total = Math.max(...raw.map((w) => Math.round((finite(w.startSeconds) ? w.startSeconds : 0) / hop) + (Array.isArray(w.frames) ? w.frames.length : 0)))
    columns = ids.map(() => new Array<number>(total).fill(0))
    for (const w of raw) {
      const channels = (Array.isArray(w.channels) ? w.channels : []).map((c) => ids.indexOf(bodyKindOf(String(c))))
      const offset = Math.round((finite(w.startSeconds) ? w.startSeconds : 0) / hop)
      const frames = Array.isArray(w.frames) ? w.frames : []
      frames.forEach((row, i) => {
        if (!Array.isArray(row)) return
        channels.forEach((col, c) => {
          const v = row[c]
          if (col >= 0 && finite(v)) columns[col][offset + i] += v
        })
      })
      const name = typeof w.instrument === 'string' ? w.instrument : undefined
      if (name) worlds.push(name)
      for (const t of Array.isArray(w.touches) ? w.touches : []) {
        const touch = toTouch(t, name)
        if (touch) touches.push(touch)
      }
    }
    unit = { unit: 'J', inferred: false } // the engine's trace is stored energy
  } else {
    throw new MnMediaDataError('energy trace: expected `channels` + `frames`, or the engine\'s `worlds`')
  }

  touches = touches.sort((a, b) => a.t - b.t)
  const bodies: MnEnergyBody[] = ids.map((id, c) => {
    const col = columns[c]
    const db = new Float32Array(col.length)
    for (let i = 0; i < col.length; i++) {
      db[i] = unit.unit === 'dB' ? col[i] : 10 * Math.log10(Math.max(col[i], FLOOR_J))
    }
    return { id, label: bodyLabel(id), db }
  })
  const frameCount = bodies[0]?.db.length ?? 0
  const all = new Float32Array(bodies.reduce((n, b) => n + b.db.length, 0))
  let k = 0
  for (const b of bodies) {
    all.set(b.db, k)
    k += b.db.length
  }
  const hiDb = percentile(all, 0.995) + 3
  return {
    hopSeconds: hop,
    startSeconds: start,
    unit: unit.unit,
    unitInferred: unit.inferred,
    bodies,
    touches,
    worlds,
    durationSeconds: start + frameCount * hop,
    hiDb,
    loDb: hiDb - 60,
  }
}

/** Each body's level in decibels at `t` seconds (linear between hops; the floor outside the trace). */
export function energyAt(trace: MnEnergyTrace, t: number): number[] {
  const x = (t - trace.startSeconds) / trace.hopSeconds
  return trace.bodies.map((b) => {
    if (!(x >= 0) || b.db.length === 0) return trace.loDb
    const i = Math.floor(x)
    if (i >= b.db.length - 1) return x > b.db.length ? trace.loDb : b.db[b.db.length - 1]
    const f = x - i
    return b.db[i] * (1 - f) + b.db[i + 1] * f
  })
}

/** A level in decibels as 0..1 of the trace's display window. */
export function energyLevel(trace: MnEnergyTrace, db: number): number {
  return Math.min(1, Math.max(0, (db - trace.loDb) / (trace.hiDb - trace.loDb)))
}

/**
 * One SVG polyline `points` string per body over the whole trace, in a
 * `width` × `height` box, at most `maxPoints` points each (each point the
 * loudest hop of its bucket, so plucks stay visible).
 */
export function energyPolylines(trace: MnEnergyTrace, width: number, height: number, maxPoints = 600): string[] {
  const span = trace.hiDb - trace.loDb
  return trace.bodies.map((b) => {
    const n = b.db.length
    if (n === 0) return ''
    const buckets = Math.min(maxPoints, n)
    const pts: string[] = []
    for (let k = 0; k < buckets; k++) {
      const from = Math.floor((k * n) / buckets)
      const to = Math.max(from + 1, Math.floor(((k + 1) * n) / buckets))
      let v = -Infinity
      for (let i = from; i < to; i++) v = Math.max(v, b.db[i])
      const t = trace.startSeconds + ((from + to) / 2) * trace.hopSeconds
      const x = (t / trace.durationSeconds) * width
      const y = height - (Math.min(1, Math.max(0, (v - trace.loDb) / span)) * height)
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`)
    }
    return pts.join(' ')
  })
}

/** The touches between two playhead positions (a < t <= b), for marks that light as they pass. */
export function touchesBetween(trace: MnEnergyTrace, a: number, b: number): MnEnergyTouch[] {
  if (!(b > a)) return []
  const out: MnEnergyTouch[] = []
  for (const touch of trace.touches) {
    if (touch.t > b) break
    if (touch.t > a) out.push(touch)
  }
  return out
}

/** The string numbers the trace's touches name, high to low (6 … 1 on a guitar). */
export function touchedStrings(trace: MnEnergyTrace): number[] {
  const seen = new Set<number>()
  for (const t of trace.touches) if (t.string !== undefined) seen.add(t.string)
  return [...seen].sort((a, b) => b - a)
}

// ── The live spectrum ────────────────────────────────────────────────────────

/**
 * Fold an analyser's frequency bins into `count` log-spaced bands from `fMin`
 * to `fMax` Hz, each the loudest bin it covers, as 0..1. A band narrower than
 * one bin takes the nearest bin.
 */
export function spectrumBands(
  bins: ArrayLike<number>,
  sampleRate: number,
  fftSize: number,
  count: number,
  fMin = 40,
  fMax = 16000,
  fullScale = 255,
): Float32Array {
  const out = new Float32Array(Math.max(0, count))
  const binHz = sampleRate / fftSize
  const top = Math.min(fMax, sampleRate / 2)
  const ratio = Math.log(top / fMin)
  for (let b = 0; b < out.length; b++) {
    const f0 = fMin * Math.exp((ratio * b) / out.length)
    const f1 = fMin * Math.exp((ratio * (b + 1)) / out.length)
    let i0 = Math.floor(f0 / binHz)
    let i1 = Math.floor(f1 / binHz)
    if (i1 <= i0) {
      i0 = Math.round(((f0 + f1) / 2) / binHz)
      i1 = i0 + 1
    }
    let v = 0
    for (let i = i0; i < i1 && i < bins.length; i++) v = Math.max(v, bins[i])
    out[b] = Math.min(1, v / fullScale)
  }
  return out
}

// ── The ledger, honestly with units ──────────────────────────────────────────

/** One World's energy ledger, as the render receipt states it: the World's own state units, which the receipt calls joules. */
export interface MnEnergyLedger {
  /** The World's instrument abbreviation (`gt`, `jj`, …). */
  readonly world: string
  readonly anatomy?: string
  readonly planDigest?: string
  readonly plucks?: number
  readonly hammerOns?: number
  readonly pullOffs?: number
  readonly slides?: number
  readonly sourceWork?: number
  readonly controlWork?: number
  readonly internalLoss?: number
  readonly radiation?: number
  readonly closureResidual?: number
  readonly maxFrameResidual?: number
}

export interface MnFormattedQuantity {
  /** e.g. '443.6' */
  readonly value: string
  /** e.g. 'nJ' */
  readonly unit: string
  /** e.g. '443.6 nJ' */
  readonly text: string
  /** The number as stated, in base units, e.g. '4.4360340433820897e-7 J'. */
  readonly exact: string
}

const SI: ReadonlyArray<readonly [number, string]> = [
  [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'],
  [1e-15, 'f'], [1e-18, 'a'], [1e-21, 'z'], [1e-24, 'y'],
]

/** A quantity with an SI prefix and four significant figures; the exact number rides along. */
export function formatQuantity(x: number | null | undefined, unit = 'J', digits = 4): MnFormattedQuantity | null {
  if (x === null || x === undefined || !Number.isFinite(x)) return null
  const exact = `${x.toExponential()} ${unit}`
  if (x === 0) return { value: '0', unit, text: `0 ${unit}`, exact: `0 ${unit}` }
  const mag = Math.abs(x)
  const [scale, prefix] = SI.find(([s]) => mag >= s) ?? SI[SI.length - 1]
  const scaled = x / scale
  const value = Number(scaled.toPrecision(digits)).toString()
  const u = `${prefix}${unit}`
  return { value, unit: u, text: `${value} ${u}`, exact }
}

export interface MnLedgerBalance {
  /** source work + control work */
  readonly workIn: number
  /** internal loss + radiation */
  readonly dissipated: number
  /** workIn − dissipated: the World's stored change, to the closure residual (computed here; the receipt states the parts) */
  readonly difference: number
  /** Shares of the work in, 0..1: internal loss, radiation, and the stored change (the difference). */
  readonly shares: { readonly internalLoss: number; readonly radiation: number; readonly difference: number }
  /** |closure residual| / work in, when the residual is stated. */
  readonly residualRatio: number | null
}

/** Where the work went, computed from the stated parts; null if a part is missing or no work went in. */
export function ledgerBalance(l: MnEnergyLedger): MnLedgerBalance | null {
  const { sourceWork, controlWork, internalLoss, radiation } = l
  if (![sourceWork, controlWork, internalLoss, radiation].every(finite)) return null
  const workIn = (sourceWork as number) + (controlWork as number)
  if (!(workIn > 0)) return null
  const dissipated = (internalLoss as number) + (radiation as number)
  const difference = workIn - dissipated
  return {
    workIn,
    dissipated,
    difference,
    shares: {
      internalLoss: (internalLoss as number) / workIn,
      radiation: (radiation as number) / workIn,
      difference: difference / workIn,
    },
    residualRatio: finite(l.closureResidual) ? Math.abs(l.closureResidual) / workIn : null,
  }
}
