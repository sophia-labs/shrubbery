/**
 * mn-mus-take-player — the smallest honest player for one render (a "take") of a MUS score.
 *
 * One HTMLAudioElement over the take's own WAV (a blob: URL of the exact bytes the receipt's `renderDigest` digests),
 * a play/pause button, the clock, and a seek bar. It is the placeholder the verdict face uses until the shared
 * `mn-audio-player` lands; a host swaps it out through the verdict's `player` seam. Backend-free: the take comes in as
 * data, nothing goes out but `mn-mus-playback` events.
 *
 * Needs `media-src blob:` in the page's CSP.
 */
import { LitElement, css, html, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'

/** The parts of a take this player reads (structurally `MusTake` from `@shrubbery/hoja/mus`). */
export interface MnMusTakeLike {
  readonly wav: Uint8Array
  readonly frames: number
  readonly sampleRate: number
  readonly receipt?: { readonly renderDigest?: string }
}

export interface MnMusPlaybackDetail {
  readonly status: 'playing' | 'paused' | 'ended' | 'error'
  readonly currentTime: number
  readonly duration: number
}

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const s = Math.floor(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

@customElement('mn-mus-take-player')
export class MnMusTakePlayer extends SkinAware(LitElement) {
  static styles = css`
    :host { display: block; font-family: var(--mn-font-sans, system-ui, sans-serif); color: var(--mn-color-text-primary, #1d2420); }
    .row { display: flex; align-items: center; gap: 10px; min-width: 0; }
    button {
      flex: none; width: 34px; height: 34px; border-radius: 999px; cursor: pointer;
      border: 1px solid var(--mn-color-border-default, #c9d1cc);
      background: var(--mn-color-accent, #39765a); color: var(--mn-color-text-on-accent, #fff);
      font: inherit; font-size: 13px; display: grid; place-items: center;
    }
    button:disabled { opacity: 0.5; cursor: default; }
    button:focus-visible, input:focus-visible { outline: 2px solid var(--mn-color-focus-ring, #39765a); outline-offset: 2px; }
    input[type='range'] { flex: 1; min-width: 60px; accent-color: var(--mn-color-accent, #39765a); }
    .clock { flex: none; font-family: var(--mn-font-mono, ui-monospace, monospace); font-variant-numeric: tabular-nums; font-size: 12px; color: var(--mn-color-text-secondary, #4d5952); }
    .error { color: var(--mn-color-text-danger, #b3261e); font-size: 12px; margin-top: 4px; }
  `

  @property({ attribute: false }) take: MnMusTakeLike | null = null
  @property({ type: String }) label = 'Play the render'

  @state() private playing = false
  @state() private time = 0
  @state() private error: string | null = null

  private audio: HTMLAudioElement | null = null
  private url: string | null = null

  get duration(): number {
    return this.take ? this.take.frames / this.take.sampleRate : 0
  }

  /** The playback position, seconds (what a check reads to see playback advance). */
  get currentTime(): number {
    return this.audio?.currentTime ?? 0
  }

  get paused(): boolean {
    return this.audio?.paused ?? true
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback()
    this.release()
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('take')) {
      this.release()
      this.time = 0
      this.playing = false
      this.error = null
    }
  }

  private release(): void {
    if (this.audio) {
      this.audio.pause()
      this.audio.removeAttribute('src')
      this.audio = null
    }
    if (this.url) URL.revokeObjectURL(this.url)
    this.url = null
  }

  private element(): HTMLAudioElement | null {
    if (this.audio || !this.take) return this.audio
    this.url = URL.createObjectURL(new Blob([this.take.wav as BlobPart], { type: 'audio/wav' }))
    const audio = new Audio()
    audio.preload = 'auto'
    audio.src = this.url
    const emit = (status: MnMusPlaybackDetail['status']): void => {
      this.dispatchEvent(new CustomEvent<MnMusPlaybackDetail>('mn-mus-playback', {
        detail: { status, currentTime: audio.currentTime, duration: this.duration },
        bubbles: true,
        composed: true,
      }))
    }
    audio.addEventListener('timeupdate', () => { this.time = audio.currentTime })
    audio.addEventListener('play', () => { this.playing = true; emit('playing') })
    audio.addEventListener('pause', () => { this.playing = false; emit('paused') })
    audio.addEventListener('ended', () => { this.playing = false; emit('ended') })
    audio.addEventListener('error', () => {
      this.playing = false
      this.error = audio.error?.message || 'the browser could not play this WAV'
      emit('error')
    })
    this.audio = audio
    return audio
  }

  /** Play or pause. */
  async toggle(): Promise<void> {
    const audio = this.element()
    if (!audio) return
    if (audio.paused) {
      try {
        await audio.play()
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
      }
    } else {
      audio.pause()
    }
  }

  pause(): void {
    this.audio?.pause()
  }

  private seek(event: Event): void {
    const audio = this.element()
    if (!audio) return
    audio.currentTime = Number((event.target as HTMLInputElement).value)
    this.time = audio.currentTime
  }

  protected override render() {
    const duration = this.duration
    return html`<div class="player">
      <div class="row" part="row">
        <button type="button" ?disabled=${!this.take} aria-label=${this.playing ? 'Pause' : this.label} @click=${() => void this.toggle()}>
          ${this.playing ? '❚❚' : '▶'}
        </button>
        <input type="range" min="0" max=${duration || 0} step="0.01" .value=${String(this.time)} ?disabled=${!this.take}
          aria-label="Position" aria-valuetext=${`${formatClock(this.time)} of ${formatClock(duration)}`} @input=${this.seek} />
        <span class="clock" aria-live="off">${formatClock(this.time)} / ${formatClock(duration)}</span>
      </div>
      ${this.error ? html`<div class="error" role="alert">${this.error}</div>` : null}
    </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-mus-take-player': MnMusTakePlayer
  }
}
