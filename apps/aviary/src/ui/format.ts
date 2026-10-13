/**
 * format.ts — PURE display formatting for measured values.
 *
 * The one rule: ABSENCE RENDERS AS AN EM DASH, never as zero. Every function
 * here takes `number | undefined` and returns the dash for `undefined`, so a
 * measurement the analysis pipeline did not produce is visibly missing rather
 * than silently plausible.
 */

export const DASH = '—'

export function seconds(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return DASH
  return value < 1 ? `${Math.round(value * 1000)} ms` : `${value.toFixed(2)} s`
}

/** mm:ss for a transport clock. */
export function clock(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value < 0) return '–:––'
  const total = Math.floor(value)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function hertz(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return DASH
  return value >= 1000 ? `${(value / 1000).toFixed(2)} kHz` : `${Math.round(value)} Hz`
}

/** Signed cents deviation, the way a tuner writes it. */
export function cents(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return DASH
  const rounded = Math.round(value)
  return `${rounded > 0 ? '+' : ''}${rounded}¢`
}

export function semitones(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return DASH
  return `${value.toFixed(1)} st`
}

export function decibels(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return DASH
  return `${value.toFixed(1)} dB`
}

export function text(value: string | undefined): string {
  return value === undefined || value === '' ? DASH : value
}

/** `A5 +23¢` — the pitch label a musician actually reads. */
export function pitchLabel(note: string | undefined, centsValue: number | undefined): string {
  if (note === undefined) return DASH
  if (centsValue === undefined) return note
  return `${note} ${cents(centsValue)}`
}
