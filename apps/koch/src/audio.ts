import { MORSE, type KochCharacter, type PracticeSettings } from './koch.js'

export interface ToneEvent {
  readonly startSeconds: number
  readonly durationSeconds: number
}

export interface MorseTimeline {
  readonly events: readonly ToneEvent[]
  readonly durationSeconds: number
  readonly ditSeconds: number
  readonly characterGapSeconds: number
  readonly wordGapSeconds: number
}

/** Preserve full-speed character shapes while stretching only the spaces. */
export function farnsworthTiming(characterWpm: number, effectiveWpm: number): {
  ditSeconds: number
  spacingUnitSeconds: number
} {
  const characterSpeed = Math.max(5, characterWpm)
  const effectiveSpeed = Math.max(3, Math.min(characterSpeed, effectiveWpm))
  const ditSeconds = 1.2 / characterSpeed
  // PARIS is 50 units: 31 character/element units and 19 spacing units.
  const spacingUnitSeconds = Math.max(
    ditSeconds,
    (60 / effectiveSpeed - 31 * ditSeconds) / 19,
  )
  return { ditSeconds, spacingUnitSeconds }
}

export function buildTimeline(
  groupedText: string,
  settings: Pick<PracticeSettings, 'characterWpm' | 'effectiveWpm'>,
): MorseTimeline {
  const { ditSeconds, spacingUnitSeconds } = farnsworthTiming(
    settings.characterWpm,
    settings.effectiveWpm,
  )
  const characterGapSeconds = 3 * spacingUnitSeconds
  const wordGapSeconds = 7 * spacingUnitSeconds
  const events: ToneEvent[] = []
  const chars = groupedText.toUpperCase().split('')
  let cursor = 0.22

  for (let index = 0; index < chars.length; index++) {
    const char = chars[index]
    if (char === ' ') continue
    const pattern = MORSE[char as KochCharacter]
    if (!pattern) continue
    for (let symbol = 0; symbol < pattern.length; symbol++) {
      const durationSeconds = pattern[symbol] === '-' ? 3 * ditSeconds : ditSeconds
      events.push({ startSeconds: cursor, durationSeconds })
      cursor += durationSeconds
      if (symbol < pattern.length - 1) cursor += ditSeconds
    }
    const next = chars[index + 1]
    cursor += next === ' ' ? wordGapSeconds : characterGapSeconds
  }

  return {
    events,
    durationSeconds: cursor + 0.18,
    ditSeconds,
    characterGapSeconds,
    wordGapSeconds,
  }
}

export class WebAudioMorsePlayer {
  private context: AudioContext | null = null
  private oscillator: OscillatorNode | null = null
  private gain: GainNode | null = null
  private stopTimer: ReturnType<typeof setTimeout> | null = null

  async play(
    groupedText: string,
    settings: Pick<PracticeSettings, 'characterWpm' | 'effectiveWpm' | 'toneHz'>,
  ): Promise<MorseTimeline> {
    this.stop()
    const timeline = buildTimeline(groupedText, settings)
    const AudioContextCtor = window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) throw new Error('This browser does not provide Web Audio.')

    const context = new AudioContextCtor()
    await context.resume()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = settings.toneHz
    gain.gain.value = 0
    oscillator.connect(gain)
    gain.connect(context.destination)

    const origin = context.currentTime
    for (const event of timeline.events) {
      const start = origin + event.startSeconds
      const end = start + event.durationSeconds
      gain.gain.setValueAtTime(0, Math.max(origin, start - 0.004))
      gain.gain.linearRampToValueAtTime(0.22, start)
      gain.gain.setValueAtTime(0.22, Math.max(start, end - 0.004))
      gain.gain.linearRampToValueAtTime(0, end)
    }
    oscillator.start(origin)
    oscillator.stop(origin + timeline.durationSeconds)

    this.context = context
    this.oscillator = oscillator
    this.gain = gain
    this.stopTimer = setTimeout(() => this.stop(), timeline.durationSeconds * 1000 + 100)
    return timeline
  }

  stop(): void {
    if (this.stopTimer) clearTimeout(this.stopTimer)
    this.stopTimer = null
    try {
      this.gain?.gain.cancelScheduledValues(0)
      this.gain?.gain.setValueAtTime(0, this.context?.currentTime ?? 0)
      this.oscillator?.stop()
    } catch {
      // An already-stopped oscillator is harmless.
    }
    void this.context?.close().catch(() => undefined)
    this.context = null
    this.oscillator = null
    this.gain = null
  }
}

/** Immediate local sidetone for straight-key practice; no network round-trip. */
export class WebAudioStraightKey {
  private context: AudioContext | null = null
  private oscillator: OscillatorNode | null = null
  private gain: GainNode | null = null
  private pressed = false

  async press(toneHz: number): Promise<void> {
    if (this.pressed) return
    this.pressed = true
    const AudioContextCtor = window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) throw new Error('This browser does not provide Web Audio.')
    const context = this.context ?? new AudioContextCtor()
    this.context = context
    await context.resume()
    if (!this.pressed) return
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = toneHz
    gain.gain.setValueAtTime(0, context.currentTime)
    gain.gain.linearRampToValueAtTime(0.2, context.currentTime + 0.004)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start()
    this.oscillator = oscillator
    this.gain = gain
  }

  release(): void {
    if (!this.pressed && !this.oscillator) return
    this.pressed = false
    const context = this.context
    const oscillator = this.oscillator
    const gain = this.gain
    this.oscillator = null
    this.gain = null
    if (!context || !oscillator || !gain) return
    try {
      const now = context.currentTime
      gain.gain.cancelScheduledValues(now)
      gain.gain.setValueAtTime(gain.gain.value, now)
      gain.gain.linearRampToValueAtTime(0, now + 0.004)
      oscillator.stop(now + 0.006)
    } catch {
      // Releasing an oscillator already retired by the browser is harmless.
    }
  }

  stop(): void {
    this.release()
    void this.context?.close().catch(() => undefined)
    this.context = null
  }
}
