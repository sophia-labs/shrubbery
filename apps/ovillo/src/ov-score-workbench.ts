/**
 * ov-score-workbench — the score editor at #/score/<slug>: Hoja's MUS mode on a
 * piece's score, checked as you type and rendered by its Ariadne World in this
 * page (`mountMusWorkbench`, the engine as wasm in a Worker).
 *
 * The take plays in `mn-audio-player` (the workbench's `player` seam): the
 * take's own WAV, its waveform, and its energy trace in the player's Energy
 * screen, through the app's one engine; the verdict face shows the receipt's
 * ledger beside it. The engine refuses any track that is not an Ariadne World,
 * so a score that names one never renders.
 *
 * A render is honest work: the World simulated sample by sample, about a minute
 * for a 30-second piece, with progress. So the first bars are offered too.
 *
 * Loaded on demand (the editor brings TipTap), light DOM inside the app's
 * shadow root so the app's styles reach it.
 */

import { LitElement, html, nothing, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import '@shrubbery/components/mus-verdict'
import type { MusTake } from '@shrubbery/hoja/mus'
import { createMusWasmEngine, mountMusWorkbench, type MusWasmEngine, type MusWorkbench } from '@shrubbery/runtime/mus'
import { parseEnergyTrace, type AudioPlayer, type MnAudioTrack, type MnWaveformPeaks } from '@shrubbery/components/audio'
import { barCount, excerptScore } from './score-excerpt.js'

export interface ScoreWorkbenchPiece {
  readonly iri: string
  readonly slug: string
  readonly title: string
  readonly note?: string
  readonly score: string
}

const EXCERPT_BARS = 2

/** The take's waveform peaks (10 ms min/max of the mono mix), as the graph's peaks files are. */
function peaksOf(take: MusTake): MnWaveformPeaks {
  const spp = Math.round(take.sampleRate / 100)
  const n = Math.ceil(take.frames / spp)
  const peaks = new Array<number>(n * 2)
  for (let b = 0; b < n; b++) {
    let lo = 0
    let hi = 0
    const end = Math.min(take.frames, (b + 1) * spp)
    for (let i = b * spp; i < end; i++) {
      const v = (take.left[i] + take.right[i]) / 2
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    peaks[2 * b] = lo
    peaks[2 * b + 1] = hi
  }
  return { sr: take.sampleRate, samplesPerPeak: spp, peaks }
}

@customElement('ov-score-workbench')
export class OvScoreWorkbench extends LitElement {
  /** The piece whose MUS score is edited. */
  @property({ attribute: false }) piece: ScoreWorkbenchPiece | null = null
  /** The app's audio engine: the take plays through it, like every piece. */
  @property({ attribute: false }) engine: AudioPlayer | null = null
  /** The MUS engine's module (same-origin). */
  @property({ type: String }) wasm = ''

  @state() private bars = 0

  private bench: MusWorkbench | null = null
  private musEngine: Promise<MusWasmEngine> | null = null
  private takes = new WeakMap<MusTake, MnAudioTrack>()
  private urls: string[] = []

  createRenderRoot(): HTMLElement {
    return this
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    this.unmount()
    void this.musEngine?.then((e) => e.dispose(), () => undefined)
    this.musEngine = null
    for (const url of this.urls) URL.revokeObjectURL(url)
    this.urls = []
  }

  /** What the mounted bench was made from: a new piece object with the same score is not a new score. */
  private mountedKey = ''

  protected updated(changed: PropertyValues): void {
    if (!changed.has('piece') && !changed.has('wasm') && !changed.has('bars')) return
    const key = this.piece ? `${this.piece.iri}\u0000${this.wasm}\u0000${this.score}` : ''
    if (key === this.mountedKey && this.bench) return
    this.mountedKey = key
    this.mount()
  }

  /** The score on screen: the whole score, or its first bars. */
  get score(): string {
    const s = this.piece?.score ?? ''
    return this.bars > 0 ? excerptScore(s, this.bars) : s
  }

  /** The workbench (tests and the browser check reach it here). */
  get workbench(): MusWorkbench | null {
    return this.bench
  }

  private trackFor(take: MusTake): MnAudioTrack {
    const have = this.takes.get(take)
    if (have) return have
    const url = URL.createObjectURL(new Blob([take.wav as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }))
    this.urls.push(url)
    const worlds = take.receipt.ariadneWorlds ?? []
    const track: MnAudioTrack = {
      id: `urn:ovillo:take:${take.receipt.renderDigest}`,
      title: `${this.piece?.title ?? 'The score'}, your take`,
      subtitle: `${worlds.length === 1 ? 'one Ariadne World' : `${worlds.length} Ariadne Worlds`} · ${take.receipt.engineVersion}`,
      src: url,
      duration: take.frames / take.sampleRate,
      peaks: peaksOf(take),
      energy: parseEnergyTrace(take.energy),
    }
    this.takes.set(take, track)
    return track
  }

  private unmount(): void {
    this.bench?.dispose()
    this.bench = null
    this.mountedKey = ''
  }

  private mount(): void {
    const host = this.querySelector<HTMLElement>('.workbench-host')
    if (!host || !this.piece || !this.wasm) return
    const key = this.mountedKey
    this.unmount()
    this.mountedKey = key
    // One engine (one Worker) for the element's life; the verdict face says if it cannot load.
    this.musEngine ??= createMusWasmEngine({ wasm: this.wasm })
    this.bench = mountMusWorkbench(host, {
      score: this.score,
      title: this.bars > 0 ? `${this.piece.title}: the first ${this.bars} bars` : this.piece.title,
      notes: this.piece.note,
      engine: this.musEngine,
      label: `Score of ${this.piece.title}`,
      player: (take) => html`<mn-audio-player variant="single" bare .tracks=${[this.trackFor(take)]} .engine=${this.engine}></mn-audio-player>`,
    })
  }

  render() {
    const p = this.piece
    if (!p) return nothing
    const total = barCount(p.score)
    return html`<div class="score-bench">
      <p class="prose bench-intro">
        Edit the score; it is checked as you type. <b>Render</b> plays it on its Ariadne World, simulated here in your
        browser sample by sample: <b>about a minute for a 30-second piece</b>, with a bar that shows how far it has got.
        The take plays below with its energy, and the ledger beside it is the World's own.
      </p>
      <div class="excerpt" role="group" aria-label="How much of the score">
        <button type="button" class="pl" aria-pressed=${String(this.bars === 0)} data-excerpt="all"
          @click=${() => { this.bars = 0 }}>The whole score<span class="count">${total} bars</span></button>
        ${total > EXCERPT_BARS
          ? html`<button type="button" class="pl" aria-pressed=${String(this.bars === EXCERPT_BARS)} data-excerpt=${String(EXCERPT_BARS)}
              @click=${() => { this.bars = EXCERPT_BARS }}>The first ${EXCERPT_BARS} bars<span class="count">a few seconds to render</span></button>`
          : nothing}
      </div>
      <div class="workbench-host"></div>
    </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ov-score-workbench': OvScoreWorkbench
  }
}

