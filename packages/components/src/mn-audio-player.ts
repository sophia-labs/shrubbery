/**
 * mn-audio-player — a playlist player with calm, honest visualizers.
 *
 * WHAT IT IS. The audio engine Aviary proved (`createAudioPlayer`, one
 * HTMLAudioElement, errors as state) with a playlist around it and three
 * visualizers inside a display "screen", in the spirit of the Winamp/Milkdrop
 * era (a numbered playlist with durations, a clock that flips to remaining
 * time, a spectrum with falling peak caps, an oscilloscope, click the screen
 * to change it) but drawn in Sophia's design language: role tokens, Literata
 * and Source Sans, tabular mono numerals, cards, light and dark.
 *
 * THE VISUALIZERS.
 *   - Waveform scrubber: the track's peaks (a file), the played part in the
 *     accent, touches ticked under it; a slider for pointer and keyboard.
 *   - Spectrum and scope: live, from an AnalyserNode tapped off the one audio
 *     element (the engine's `analyse` option).
 *   - Energy: the one only an Ariadne World has. The World's stored energy by
 *     body (strings, box, room …) from the render's energy trace, played in
 *     sync with the audio: a meter per body with peak hold, the whole piece's
 *     traces with a moving playhead, and every touch as a mark (and, when the
 *     touches name strings, a light per string that flashes as it is plucked).
 *     Levels are 10·log10 E in dB re one of the World's own energy units (the
 *     receipt's joules, not calibrated), on a 60 dB window.
 *
 * CONTROLLED WHERE IT MATTERS. Tracks come in as data (`tracks`); the player
 * owns playback (it is a player) through an engine it creates, or one the
 * shell passes in (`engine`) so several players on a page share one sound.
 * It loads a track's peaks and energy JSON from the URLs the track names
 * (same-origin static files) through `loader`, which a shell may replace.
 * It emits intent and state as composed events; it reaches no store.
 *
 * KEYBOARD (focus inside the player, or anywhere with `global-keys`):
 *   Space / K play–pause · ← → seek 5 s · Shift+← → previous / next ·
 *   J / L seek 10 s · N / P next / previous · S shuffle · R repeat ·
 *   M next visualizer · and Winamp's Z X C V B (previous, play, pause, stop, next).
 *   In the playlist: ↑ ↓ Home End move, Enter plays.
 * MEDIA SESSION: title, Ariadne line and playlist name; play, pause, stop,
 * previous, next and seek from the OS and the lock screen.
 */

import { LocaleController, localeSource, t, translate } from '@shrubbery/nucleus'
import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'
import { createAudioPlayer, type AudioPlayer, type PlaybackState, type Track } from './audio-player.js'
import {
  formatClock,
  nextRepeatMode,
  nextTrackIndex,
  playOrder,
  previousTrackIndex,
  type MnRepeatMode,
} from './audio-playlist.js'
import {
  energyAt,
  energyLevel,
  energyPolylines,
  parseEnergyTrace,
  parsePeaks,
  peakBins,
  spectrumBands,
  touchedStrings,
  touchesBetween,
  type MnEnergyTrace,
  type MnWaveformPeaks,
} from './audio-visuals.js'

export interface MnAudioTrack {
  /** Identity (the graph IRI). */
  readonly id: string
  readonly title: string
  /** One line under the title (the engine, the World). */
  readonly subtitle?: string
  /** The audio URL. */
  readonly src: string
  /** Declared duration in seconds, until the media says. */
  readonly duration?: number
  readonly tags?: readonly string[]
  /** Where "open" goes (the piece's page); absent = no open button. */
  readonly href?: string
  readonly peaks?: MnWaveformPeaks | null
  readonly peaksUrl?: string
  readonly energy?: MnEnergyTrace | null
  readonly energyUrl?: string
}

export type MnVisualizerMode = 'energy' | 'spectrum' | 'scope'
export const MN_VISUALIZER_MODES: readonly MnVisualizerMode[] = ['energy', 'spectrum', 'scope']
export type MnAudioPlayerVariant = 'full' | 'single'

export type MnAudioDataLoader = (url: string, kind: 'peaks' | 'energy') => Promise<unknown>

export type MnAudioTrackChangeReason = 'select' | 'next' | 'previous' | 'auto' | 'engine' | 'cue'

export interface MnAudioTrackChangeDetail {
  readonly id: string
  readonly index: number
  readonly reason: MnAudioTrackChangeReason
}

export interface MnAudioPlaybackDetail {
  readonly id: string | null
  readonly status: PlaybackState['status']
  readonly currentTime: number
  readonly duration: number | undefined
  readonly error: string | null
}

export interface MnAudioOpenDetail {
  readonly id: string
  readonly href: string
}

const SPECTRUM_BARS = 40
const METER_PEAK_FALL_PER_S = 0.45
const CAP_FALL_PER_S = 0.55
const LED_DECAY_S = 0.22

/** Which player last started each engine: only that one advances the playlist when a track ends. */
const ENGINE_OWNERS = new WeakMap<AudioPlayer, MnAudioPlayer>()

/** Shared JSON cache (several players, one file). */
const DATA_CACHE = new Map<string, Promise<unknown>>()

const defaultLoader: MnAudioDataLoader = async (url) => {
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`GET ${url} → ${response.status}`)
  return response.json()
}

function toEngineTrack(t: MnAudioTrack): Track {
  return { iri: t.id, label: t.title, subtitle: t.subtitle ?? '', src: t.src, declaredDuration: t.duration }
}

/** A number with a true minus sign (U+2212), as type sets it. */
function signed(n: number): string {
  return n < 0 ? `−${Math.abs(n)}` : String(n)
}

function isTextEntry(target: EventTarget | undefined): boolean {
  if (!(target instanceof HTMLElement)) return false
  return /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable
}

/*
 * SVG is built as ONE string per <svg> and rendered with unsafeHTML (the icons.ts
 * approach): a nested Lit \`html\` fragment of <line>/<polyline> would be parsed in
 * the HTML namespace in a real browser, and happy-dom drops Lit \`svg\` fragments.
 * Every value interpolated below is a number or an escaped string.
 */
const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

const TRACE_SVG = new WeakMap<MnEnergyTrace, string>()

function traceSvg(trace: MnEnergyTrace): string {
  const cached = TRACE_SVG.get(trace)
  if (cached) return cached
  const lines = energyPolylines(trace, 1000, 100, 700)
  const grid = [0, 20, 40, 60].map((d) => 100 - (d / 60) * 100)
  const label = `Stored energy of the ${trace.bodies.map((b) => b.label.toLowerCase()).join(', ')} over the piece, ${trace.touches.length} touches`
  const svg =
    `<svg viewBox="0 0 1000 100" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">` +
    grid.map((y) => `<line class="grid" x1="0" x2="1000" y1="${y}" y2="${y}"></line>`).join('') +
    lines.map((pts, i) => `<polyline points="${pts}" style="stroke: var(--mn-audio-body-${(i % 4) + 1})" data-body="${esc(trace.bodies[i].id)}"></polyline>`).join('') +
    `<line class="head" x1="0" x2="0" y1="0" y2="100"></line></svg>`
  TRACE_SVG.set(trace, svg)
  return svg
}

const WAVE_PATH = new WeakMap<MnWaveformPeaks, string>()

function wavePath(peaks: MnWaveformPeaks): string {
  const cached = WAVE_PATH.get(peaks)
  if (cached) return cached
  const bins = peakBins(peaks, 240)
  const n = bins.length / 2
  const w = 1000 / n
  const parts: string[] = []
  for (let i = 0; i < n; i++) {
    const lo = Math.min(-0.02, bins[2 * i])
    const hi = Math.max(0.02, bins[2 * i + 1])
    const y0 = 50 - hi * 46
    const y1 = 50 - lo * 46
    parts.push(`M${(i * w + w * 0.15).toFixed(2)} ${y0.toFixed(2)}h${(w * 0.7).toFixed(2)}V${y1.toFixed(2)}h${(-w * 0.7).toFixed(2)}Z`)
  }
  const d = parts.join('')
  WAVE_PATH.set(peaks, d)
  return d
}

function waveSvg(cls: string, d: string): string {
  return `<svg class="${cls}" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true"><path d="${d}"></path></svg>`
}

function ticksSvg(trace: MnEnergyTrace, duration: number): string {
  const ticks = trace.touches
    .map((t) => {
      const x = ((t.t / duration) * 1000).toFixed(2)
      return `<line x1="${x}" x2="${x}" y1="94" y2="100"></line>`
    })
    .join('')
  return `<svg class="ticks" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">${ticks}</svg>`
}

interface Palette {
  readonly accent: string
  readonly muted: string
  readonly grid: string
  readonly text: string
}

@customElement('mn-audio-player')
export class MnAudioPlayer extends SkinAware(LitElement) {
  protected readonly _locale = new LocaleController(this)

  static styles = [
    unsafeCSS(iconStyles),
    css`
      :host {
        display: block;
        container-type: inline-size;
        container-name: mn-audio-player;
        color: var(--mn-color-text-primary, #1f2a24);
        font-family: var(--mn-font-sans, system-ui, sans-serif);
        --mn-audio-body-1: var(--mn-chart-categorical-1, #2f7fa8);
        --mn-audio-body-2: var(--mn-chart-categorical-2, #c75b39);
        --mn-audio-body-3: var(--mn-chart-categorical-3, #7b61c9);
        --mn-audio-body-4: var(--mn-chart-categorical-4, #6f7d16);
        --mn-audio-screen-height: 196px;
        /* A knob: a shell may set it on the element to give the playlist more or less room. */
        --mn-audio-playlist-max-height: 620px;
      }
      * {
        box-sizing: border-box;
      }
      .layout {
        display: grid;
        gap: var(--mn-space-4, 16px);
        min-width: 0;
      }
      @container mn-audio-player (min-width: 780px) {
        .layout[data-variant='full'] {
          grid-template-columns: minmax(0, 1.6fr) minmax(260px, 1fr);
          align-items: start;
        }
      }
      .deck,
      .list-card {
        min-width: 0;
        background: var(--mn-color-surface-raised, var(--mn-color-surface-base, #fff));
        border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
        border-radius: var(--mn-radius-surface, 10px);
        box-shadow: var(--mn-shadow-card, 0 1px 3px rgb(0 0 0 / 0.05));
      }
      .deck {
        padding: var(--mn-space-4, 16px);
        display: grid;
        gap: var(--mn-space-3, 12px);
      }

      /* ── Now playing ─────────────────────────────────────────────── */
      .now {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 2px var(--mn-space-3, 12px);
        align-items: start;
      }
      .eyebrow {
        font-size: 0.6875rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--mn-color-text-secondary, #4b5563);
        font-family: var(--mn-font-sans, system-ui, sans-serif);
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .eyebrow .status[data-status='playing'] {
        color: var(--mn-color-text-accent, var(--mn-color-accent, #4a8b6f));
      }
      .eyebrow .status[data-status='error'] {
        color: var(--mn-color-text-danger, #b91c1c);
      }
      .title {
        grid-column: 1;
        margin: 2px 0 0;
        font-family: var(--mn-font-display, Georgia, serif);
        font-size: 1.375rem;
        line-height: 1.2;
        font-weight: 500;
        overflow-wrap: anywhere;
        color: var(--mn-color-text-title, var(--mn-color-text-primary, #1f2a24));
      }
      .subtitle {
        grid-column: 1;
        margin: 0;
        color: var(--mn-color-text-secondary, #4b5563);
        font-size: 0.875rem;
        overflow-wrap: anywhere;
      }
      .clock {
        grid-column: 2;
        grid-row: 1 / span 3;
        align-self: start;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        font-family: var(--mn-font-mono, ui-monospace, monospace);
        font-variant-numeric: tabular-nums;
        text-align: right;
        cursor: pointer;
        padding: 2px 4px;
        border-radius: var(--mn-radius-control, 6px);
      }
      .clock .elapsed {
        display: block;
        font-size: 1.5rem;
        line-height: 1.1;
        letter-spacing: -0.01em;
      }
      .clock .total {
        display: block;
        font-size: 0.75rem;
        color: var(--mn-color-text-secondary, #4b5563);
      }
      .clock:hover {
        background: var(--mn-color-surface-hover, rgb(0 0 0 / 0.04));
      }
      .tags {
        grid-column: 1;
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 4px;
      }
      .tag {
        font-size: 0.75rem;
        padding: 1px 8px;
        border-radius: var(--mn-radius-full, 999px);
        background: var(--mn-color-surface-sunken, #f3f4f6);
        color: var(--mn-color-text-secondary, #4b5563);
      }
      .error {
        margin: 0;
        padding: 8px 10px;
        border-radius: var(--mn-radius-control, 6px);
        background: var(--mn-color-danger-surface, #fef2f2);
        color: var(--mn-color-text-danger, #b91c1c);
        font-size: 0.8125rem;
        overflow-wrap: anywhere;
      }

      /* ── The screen ──────────────────────────────────────────────── */
      .screen {
        position: relative;
        height: var(--mn-audio-screen-height);
        border-radius: var(--mn-radius-md, 8px);
        background: var(--mn-color-surface-sunken, #f3f4f6);
        border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
        overflow: hidden;
        cursor: pointer;
      }
      .modes {
        position: absolute;
        top: 6px;
        right: 6px;
        z-index: 2;
        display: inline-flex;
        padding: 2px;
        gap: 2px;
        border-radius: var(--mn-radius-full, 999px);
        background: color-mix(in srgb, var(--mn-color-surface-base, #fff) 82%, transparent);
        border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      }
      .modes button {
        border: 0;
        background: transparent;
        color: var(--mn-color-text-secondary, #4b5563);
        font: inherit;
        font-size: 0.6875rem;
        letter-spacing: 0.04em;
        padding: 2px 8px;
        border-radius: var(--mn-radius-full, 999px);
        cursor: pointer;
      }
      .modes button[aria-pressed='true'] {
        background: var(--mn-color-accent, #4a8b6f);
        color: var(--mn-color-on-accent, #fff);
      }
      .modes button:disabled {
        opacity: 0.4;
        cursor: default;
      }
      .screen-caption {
        position: absolute;
        left: 10px;
        bottom: 6px;
        z-index: 1;
        font-size: 0.6875rem;
        color: var(--mn-color-text-muted, #6b7280);
        font-family: var(--mn-font-mono, ui-monospace, monospace);
        pointer-events: none;
        max-width: calc(100% - 20px);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .analyser {
        position: absolute;
        inset: 0;
      }
      canvas.viz {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        display: block;
      }
      .axis {
        position: absolute;
        bottom: 6px;
        right: 10px;
        display: flex;
        gap: 10px;
        font-size: 0.625rem;
        color: var(--mn-color-text-muted, #6b7280);
        font-family: var(--mn-font-mono, ui-monospace, monospace);
        pointer-events: none;
      }

      /* Energy */
      .energy {
        position: absolute;
        inset: 0;
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 10px;
        padding: 30px 12px 22px;
      }
      .meters {
        display: flex;
        gap: 10px;
        align-items: stretch;
        height: 100%;
      }
      .meter {
        display: grid;
        grid-template-rows: auto minmax(0, 1fr) auto;
        justify-items: center;
        gap: 3px;
        width: 54px;
      }
      .meter .db {
        font-family: var(--mn-font-mono, ui-monospace, monospace);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        font-size: 0.6875rem;
        color: var(--mn-color-text-secondary, #4b5563);
      }
      .meter .tube {
        position: relative;
        width: 14px;
        border-radius: 4px;
        background: color-mix(in srgb, var(--c) 14%, var(--mn-color-surface-base, #fff));
        overflow: hidden;
      }
      .meter .fill {
        position: absolute;
        inset: 0;
        background: var(--c);
        transform-origin: 50% 100%;
        transform: scaleY(0);
        border-radius: 4px;
        opacity: 0.88;
      }
      .meter .peak {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        height: 2px;
        background: var(--mn-color-text-primary, #1f2a24);
        opacity: 0.55;
      }
      .meter .name {
        font-size: 0.6875rem;
        color: var(--mn-color-text-secondary, #4b5563);
      }
      .trace {
        position: relative;
        min-width: 0;
        display: grid;
        grid-template-rows: minmax(0, 1fr) auto;
        gap: 4px;
      }
      .trace svg {
        width: 100%;
        height: 100%;
        display: block;
        overflow: visible;
      }
      .trace polyline {
        fill: none;
        stroke-width: 1.25;
        vector-effect: non-scaling-stroke;
        stroke-linejoin: round;
        opacity: 0.9;
      }
      .trace .grid {
        stroke: var(--mn-color-border-subtle, #e5e7eb);
        stroke-width: 1;
        vector-effect: non-scaling-stroke;
      }
      .trace .head {
        stroke: var(--mn-color-text-primary, #1f2a24);
        stroke-width: 1;
        vector-effect: non-scaling-stroke;
        opacity: 0.6;
      }
      .marks {
        position: relative;
        height: 6px;
      }
      .marks i {
        position: absolute;
        top: 0;
        width: 1px;
        height: 6px;
        background: var(--mn-color-text-muted, #6b7280);
        opacity: 0.6;
      }
      .leds {
        position: absolute;
        top: 0;
        left: 0;
        display: flex;
        gap: 4px;
        align-items: center;
        font-family: var(--mn-font-mono, ui-monospace, monospace);
        font-size: 0.5625rem;
        color: var(--mn-color-text-muted, #6b7280);
      }
      .leds .led {
        display: inline-grid;
        place-items: center;
        width: 13px;
        height: 13px;
        border-radius: 50%;
        background: var(--mn-audio-body-1);
        color: var(--mn-color-on-accent, #fff);
        opacity: 0.16;
      }
      .viz-note {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 24px;
        text-align: center;
        color: var(--mn-color-text-secondary, #4b5563);
        font-size: 0.8125rem;
        pointer-events: none;
      }

      /* ── Scrubber ────────────────────────────────────────────────── */
      .scrub {
        position: relative;
        height: 48px;
        border-radius: var(--mn-radius-sm, 4px);
        cursor: pointer;
        touch-action: none;
        outline: none;
      }
      .scrub:focus-visible {
        box-shadow: 0 0 0 2px var(--mn-color-border-focus, var(--mn-color-focus, #2563eb));
      }
      .scrub svg {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        display: block;
      }
      .scrub .base path {
        fill: var(--mn-color-text-muted, #9ca3af);
        opacity: 0.45;
      }
      .scrub .played {
        clip-path: inset(0 calc(100% - var(--p, 0%)) 0 0);
      }
      .scrub .played path {
        fill: var(--mn-color-accent, #4a8b6f);
      }
      .scrub .ticks {
        pointer-events: none;
      }
      .scrub .ticks line {
        stroke: var(--mn-color-text-muted, #9ca3af);
        stroke-width: 1;
        vector-effect: non-scaling-stroke;
      }
      .scrub .flat {
        position: absolute;
        left: 0;
        right: 0;
        top: 50%;
        height: 4px;
        margin-top: -2px;
        border-radius: 2px;
        background: var(--mn-color-surface-sunken, #e5e7eb);
      }
      .scrub .flat .bar {
        height: 100%;
        width: var(--p, 0%);
        border-radius: 2px;
        background: var(--mn-color-accent, #4a8b6f);
      }
      .scrub .hover {
        position: absolute;
        top: -2px;
        bottom: -2px;
        width: 1px;
        background: var(--mn-color-text-primary, #1f2a24);
        opacity: 0.4;
        pointer-events: none;
      }
      .scrub .hover-label {
        position: absolute;
        top: -20px;
        transform: translateX(-50%);
        font-family: var(--mn-font-mono, ui-monospace, monospace);
        font-size: 0.6875rem;
        padding: 1px 4px;
        border-radius: 3px;
        background: var(--mn-color-surface-overlay, var(--mn-color-surface-base, #fff));
        border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
        pointer-events: none;
        white-space: nowrap;
      }

      /* ── Transport ───────────────────────────────────────────────── */
      .transport {
        display: flex;
        align-items: center;
        gap: var(--mn-space-2, 8px);
        flex-wrap: wrap;
      }
      .transport .spacer {
        flex: 1 1 auto;
      }
      .btn {
        display: inline-grid;
        place-items: center;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        border: 1px solid transparent;
        background: transparent;
        color: var(--mn-color-text-primary, #1f2a24);
        cursor: pointer;
        padding: 0;
        position: relative;
      }
      .btn:hover {
        background: var(--mn-color-surface-hover, rgb(0 0 0 / 0.05));
      }
      .btn:focus-visible,
      .clock:focus-visible,
      .modes button:focus-visible,
      .row:focus-visible,
      .open:focus-visible {
        outline: 2px solid var(--mn-color-border-focus, var(--mn-color-focus, #2563eb));
        outline-offset: 1px;
      }
      .btn.play {
        width: 48px;
        height: 48px;
        background: var(--mn-color-accent, #4a8b6f);
        color: var(--mn-color-on-accent, #fff);
      }
      .btn.play:hover {
        background: var(--mn-color-accent-hover, var(--mn-color-accent, #3f7860));
      }
      .btn[aria-pressed='true'] {
        color: var(--mn-color-text-accent, var(--mn-color-accent, #4a8b6f));
        background: var(--mn-color-surface-accent-subtle, color-mix(in srgb, var(--mn-color-accent, #4a8b6f) 12%, transparent));
      }
      .btn .one {
        position: absolute;
        right: 4px;
        bottom: 3px;
        font-size: 0.5625rem;
        font-weight: 700;
        font-family: var(--mn-font-mono, ui-monospace, monospace);
      }
      .btn:disabled {
        opacity: 0.4;
        cursor: default;
      }
      .position {
        font-family: var(--mn-font-mono, ui-monospace, monospace);
        font-variant-numeric: tabular-nums;
        font-size: 0.75rem;
        color: var(--mn-color-text-secondary, #4b5563);
      }

      /* ── Playlist ────────────────────────────────────────────────── */
      .list-card {
        overflow: hidden;
        display: flex;
        flex-direction: column;
        max-height: var(--mn-audio-playlist-max-height);
      }
      .list-card ol {
        overflow-y: auto;
        min-height: 0;
      }
      .list-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
        padding: 12px 14px 8px;
        border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      }
      .list-head h3 {
        margin: 0;
        font-size: 0.9375rem;
        font-weight: var(--mn-font-weight-medium, 560);
        font-family: var(--mn-font-display, Georgia, serif);
      }
      .list-head .sum {
        font-family: var(--mn-font-mono, ui-monospace, monospace);
        font-variant-numeric: tabular-nums;
        font-size: 0.75rem;
        color: var(--mn-color-text-secondary, #4b5563);
        white-space: nowrap;
      }
      ol {
        list-style: none;
        margin: 0;
        padding: 4px;
      }
      .row {
        display: grid;
        grid-template-columns: 2.25em minmax(0, 1fr) auto auto;
        gap: 2px 10px;
        align-items: center;
        padding: 8px 10px;
        border-radius: var(--mn-radius-control, 6px);
        cursor: pointer;
      }
      .row:hover {
        background: var(--mn-color-surface-hover, rgb(0 0 0 / 0.04));
      }
      .row[aria-selected='true'] {
        background: var(--mn-color-surface-selected, var(--mn-color-surface-accent-subtle, rgb(74 139 111 / 0.1)));
      }
      .row .n {
        font-family: var(--mn-font-mono, ui-monospace, monospace);
        font-variant-numeric: tabular-nums;
        font-size: 0.75rem;
        color: var(--mn-color-text-muted, #6b7280);
        text-align: right;
      }
      .row .t {
        min-width: 0;
      }
      .row .t b {
        display: block;
        font-weight: var(--mn-font-weight-medium, 560);
        font-size: 0.9375rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .row .t span {
        display: block;
        font-size: 0.75rem;
        color: var(--mn-color-text-secondary, #4b5563);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .row .d {
        font-family: var(--mn-font-mono, ui-monospace, monospace);
        font-variant-numeric: tabular-nums;
        font-size: 0.75rem;
        color: var(--mn-color-text-secondary, #4b5563);
      }
      .open {
        display: inline-grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        color: var(--mn-color-text-secondary, #4b5563);
        border: 0;
        background: transparent;
        cursor: pointer;
        padding: 0;
      }
      .open:hover {
        background: var(--mn-color-surface-hover, rgb(0 0 0 / 0.06));
        color: var(--mn-color-text-primary, #1f2a24);
      }
      .bars {
        display: inline-flex;
        align-items: flex-end;
        gap: 1.5px;
        height: 11px;
      }
      .bars i {
        width: 2px;
        height: 100%;
        background: var(--mn-color-accent, #4a8b6f);
        border-radius: 1px;
        transform-origin: bottom;
        animation: mn-audio-bars 0.9s ease-in-out infinite;
      }
      .bars i:nth-child(2) {
        animation-delay: -0.3s;
      }
      .bars i:nth-child(3) {
        animation-delay: -0.6s;
      }
      .bars[data-paused] i {
        animation-play-state: paused;
      }
      @keyframes mn-audio-bars {
        0%,
        100% {
          transform: scaleY(0.3);
        }
        50% {
          transform: scaleY(1);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .bars i {
          animation: none;
          transform: scaleY(0.7);
        }
      }
      .empty {
        padding: 18px;
        color: var(--mn-color-text-secondary, #4b5563);
        font-size: 0.875rem;
      }
      @container mn-audio-player (max-width: 480px) {
        :host {
          --mn-audio-screen-height: 216px;
        }
        .deck {
          padding: 12px;
        }
        .title {
          font-size: 1.1875rem;
        }
        .clock .elapsed {
          font-size: 1.25rem;
        }
        .energy {
          grid-template-columns: minmax(0, 1fr);
          grid-template-rows: 82px minmax(0, 1fr);
          padding: 30px 10px 22px;
        }
        .meters {
          justify-content: center;
        }
        .meter {
          grid-template-columns: 3.5em minmax(0, 1fr) 3.4em;
          grid-template-rows: none;
          align-items: center;
          width: auto;
          flex: 1 1 0;
        }
        .meters {
          flex-direction: column;
          gap: 4px;
        }
        .meter .tube {
          width: 100%;
          height: 10px;
          grid-row: 1;
          grid-column: 2;
        }
        .meter .fill {
          transform-origin: 0 50%;
        }
        .meter .peak {
          top: 0;
          bottom: 0;
          left: 0;
          right: auto;
          width: 2px;
          height: auto;
        }
        .meter .name {
          grid-column: 1;
          grid-row: 1;
          justify-self: start;
        }
        .meter .db {
          grid-column: 3;
          grid-row: 1;
          justify-self: end;
        }
        .row {
          grid-template-columns: 2em minmax(0, 1fr) auto auto;
          padding: 8px 6px;
        }
      }
    `,
  ]

  /** The playlist, in its authored order. */
  @property({ attribute: false }) tracks: readonly MnAudioTrack[] = []
  /** The playlist's name (the list header and the Media Session album). */
  @property({ type: String }) label = 'Playlist'
  /** The track to show when this player is not the one sounding (an id from `tracks`). */
  @property({ type: String, attribute: 'selected-id' }) selectedId = ''
  @property({ type: Boolean, reflect: true }) shuffle = false
  @property({ type: String, reflect: true }) repeat: MnRepeatMode = 'off'
  /** '' = energy when the track has a trace, else spectrum. */
  @property({ type: String, reflect: true }) visualizer: MnVisualizerMode | '' = ''
  /** 'full' = deck + playlist; 'single' = deck only. */
  @property({ type: String, reflect: true }) variant: MnAudioPlayerVariant = 'full'
  /** Leave the title, subtitle and tags to the page around the player (the clock and status stay). */
  @property({ type: Boolean, reflect: true }) bare = false
  /** Listen for the keyboard shortcuts on the whole page (when nothing else takes them). */
  @property({ type: Boolean, attribute: 'global-keys' }) globalKeys = false
  /** The shuffle's seed (a given seed is a given order). */
  @property({ type: Number }) seed = 7
  /** A shared engine; absent, the player makes its own (with the Web Audio tap). */
  @property({ attribute: false }) engine: AudioPlayer | null = null
  /** How peaks/energy JSON are fetched. */
  @property({ attribute: false }) loader: MnAudioDataLoader = defaultLoader

  @state() private playback: PlaybackState = { status: 'idle', track: null, currentTime: 0, duration: undefined, error: null }
  @state() private cuedIndex = 0
  @state() private showRemaining = false
  @state() private hover: { x: number; t: number } | null = null
  @state() private dataVersion = 0

  private order: number[] = []
  private ownEngine: AudioPlayer | null = null
  private unsubscribe: (() => void) | null = null
  private unsubscribeEnded: (() => void) | null = null
  private boundEngine: AudioPlayer | null = null
  private raf = 0
  private lastFrameAt = 0
  private lastPaintT = -1
  private meterPeaks: number[] = []
  private caps = new Float32Array(SPECTRUM_BARS)
  private ledAt = new Map<number, number>()
  private palette: Palette | null = null
  private paletteKey = ''
  private resize: ResizeObserver | null = null
  private observedCanvas: HTMLCanvasElement | null = null
  private dataErrors = new Map<string, string>()
  private peaksCache = new Map<string, MnWaveformPeaks>()
  private energyCache = new Map<string, MnEnergyTrace>()
  private lastEmittedTrack = ''
  private mediaSessionBound = false
  private vizFrames = 0
  private dragging = false
  private metersHorizontal: boolean | null = null

  // ── Engine ────────────────────────────────────────────────────────────────

  /** The engine in use (the shared one, or this player's own). */
  get activeEngine(): AudioPlayer {
    if (this.engine) return this.engine
    if (!this.ownEngine) this.ownEngine = createAudioPlayer(new Audio(), { analyse: true })
    return this.ownEngine
  }

  private bindEngine(): void {
    const engine = this.activeEngine
    if (this.boundEngine === engine) return
    this.unbindEngine()
    this.boundEngine = engine
    this.unsubscribe = engine.subscribe((s) => {
      const was = this.playback.status
      this.playback = s
      if (s.status === 'playing' && was !== 'playing') this.startLoop()
      this.syncMediaSession()
      this.dispatchEvent(new CustomEvent<MnAudioPlaybackDetail>('mn-audio-playback', {
        detail: { id: s.track?.iri ?? null, status: s.status, currentTime: s.currentTime, duration: s.duration, error: s.error },
        bubbles: true,
        composed: true,
      }))
    })
    this.unsubscribeEnded = engine.onEnded((track) => {
      if (ENGINE_OWNERS.get(engine) !== this) return
      const index = this.tracks.findIndex((t) => t.id === track.iri)
      if (index === -1) return
      const next = nextTrackIndex(this.order, index, this.repeat, true)
      if (next === null) return
      this.playIndex(next, 'auto')
    })
  }

  private unbindEngine(): void {
    this.unsubscribe?.()
    this.unsubscribeEnded?.()
    this.unsubscribe = null
    this.unsubscribeEnded = null
    this.boundEngine = null
  }

  connectedCallback(): void {
    super.connectedCallback()
    this.bindEngine()
    window.addEventListener('keydown', this.onWindowKey)
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    window.removeEventListener('keydown', this.onWindowKey)
    this.unbindEngine()
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    this.resize?.disconnect()
    this.resize = null
    this.observedCanvas = null
    // A player that made its own engine silences it when it leaves the page.
    if (this.ownEngine && !this.engine) this.ownEngine.pause()
  }

  // ── Derived state ─────────────────────────────────────────────────────────

  /** The index (in `tracks`) of the engine's current track, or -1. */
  private get soundingIndex(): number {
    const iri = this.playback.track?.iri
    return iri ? this.tracks.findIndex((t) => t.id === iri) : -1
  }

  /** The track the deck shows: the sounding one if it is ours, else the cued one. */
  get currentIndex(): number {
    const sounding = this.soundingIndex
    if (sounding !== -1) return sounding
    return Math.min(Math.max(0, this.cuedIndex), Math.max(0, this.tracks.length - 1))
  }

  get currentTrack(): MnAudioTrack | null {
    return this.tracks[this.currentIndex] ?? null
  }

  /** True when the deck's track is the one the engine holds. */
  private get live(): boolean {
    return this.soundingIndex !== -1 && this.soundingIndex === this.currentIndex
  }

  private get status(): PlaybackState['status'] {
    return this.live ? this.playback.status : 'idle'
  }

  private get duration(): number | undefined {
    const t = this.currentTrack
    if (!t) return undefined
    if (this.live && this.playback.duration !== undefined) return this.playback.duration
    const peaks = this.peaksFor(t)
    return t.duration ?? (peaks ? (peaks.peaks.length / 2) * peaks.samplesPerPeak / peaks.sr : undefined)
  }

  private get time(): number {
    return this.live ? this.activeEngine.element.currentTime || this.playback.currentTime : 0
  }

  get effectiveVisualizer(): MnVisualizerMode {
    if (this.visualizer) return this.visualizer
    const t = this.currentTrack
    return t && (t.energy || t.energyUrl) ? 'energy' : 'spectrum'
  }

  private peaksFor(t: MnAudioTrack): MnWaveformPeaks | null {
    return t.peaks ?? (t.peaksUrl ? this.peaksCache.get(t.peaksUrl) ?? null : null)
  }

  private energyFor(t: MnAudioTrack): MnEnergyTrace | null {
    return t.energy ?? (t.energyUrl ? this.energyCache.get(t.energyUrl) ?? null : null)
  }

  // ── Public controls ───────────────────────────────────────────────────────

  /** Play the track with `id` (or the deck's track). */
  play(id?: string): void {
    const index = id ? this.tracks.findIndex((t) => t.id === id) : this.currentIndex
    if (index === -1) return
    if (index === this.currentIndex && this.live && this.playback.status === 'paused') {
      ENGINE_OWNERS.set(this.activeEngine, this)
      this.activeEngine.toggle(toEngineTrack(this.tracks[index]))
      return
    }
    if (index === this.currentIndex && this.live && this.playback.status === 'playing') return
    this.playIndex(index, 'select')
  }

  pause(): void {
    if (this.live) this.activeEngine.pause()
  }

  toggle(): void {
    if (this.live && (this.playback.status === 'playing' || this.playback.status === 'loading')) this.pause()
    else this.play()
  }

  stop(): void {
    if (this.live) this.activeEngine.stop()
  }

  next(): void {
    const index = nextTrackIndex(this.order, this.tracks.length ? this.currentIndex : null, this.repeat, false)
    if (index === null) return
    this.moveTo(index, 'next')
  }

  previous(): void {
    const step = previousTrackIndex(this.order, this.tracks.length ? this.currentIndex : null, this.time)
    if (!step) return
    if (step.restart) {
      this.seek(0)
      return
    }
    this.moveTo(step.index, 'previous')
  }

  seek(seconds: number): void {
    const d = this.duration
    const t = Math.max(0, d !== undefined ? Math.min(seconds, d) : seconds)
    if (this.live) {
      this.activeEngine.seek(t)
      this.lastPaintT = -1
      this.ledAt.clear()
      this.paintFrame(t)
    } else if (this.currentTrack) {
      this.playIndex(this.currentIndex, 'select', t)
    }
  }

  /** Next/previous: keep playing if playing, else just move the cue. */
  private moveTo(index: number, reason: MnAudioTrackChangeReason): void {
    const sounding = this.live && (this.playback.status === 'playing' || this.playback.status === 'loading')
    if (sounding) this.playIndex(index, reason)
    else {
      if (this.live) this.activeEngine.stop()
      this.cuedIndex = index
      this.emitTrackChange(reason)
    }
  }

  private playIndex(index: number, reason: MnAudioTrackChangeReason, startAt = 0): void {
    const track = this.tracks[index]
    if (!track) return
    const engine = this.activeEngine
    ENGINE_OWNERS.set(engine, this)
    this.cuedIndex = index
    this.lastPaintT = -1
    this.ledAt.clear()
    engine.play(toEngineTrack(track), startAt)
    this.bindMediaSession()
    this.emitTrackChange(reason)
  }

  private emitTrackChange(reason: MnAudioTrackChangeReason): void {
    const t = this.currentTrack
    if (!t || t.id === this.lastEmittedTrack) return
    this.lastEmittedTrack = t.id
    this.dispatchEvent(new CustomEvent<MnAudioTrackChangeDetail>('mn-audio-track-change', {
      detail: { id: t.id, index: this.currentIndex, reason },
      bubbles: true,
      composed: true,
    }))
  }

  private setVisualizer(mode: MnVisualizerMode): void {
    if (mode === this.effectiveVisualizer && this.visualizer) return
    this.visualizer = mode
    this.dispatchEvent(new CustomEvent('mn-audio-visualizer-change', { detail: { mode }, bubbles: true, composed: true }))
  }

  private cycleVisualizer(): void {
    const modes = this.availableModes()
    const i = modes.indexOf(this.effectiveVisualizer)
    this.setVisualizer(modes[(i + 1) % modes.length])
  }

  private availableModes(): MnVisualizerMode[] {
    const t = this.currentTrack
    const energy = !!(t && (t.energy || t.energyUrl))
    return MN_VISUALIZER_MODES.filter((m) => m !== 'energy' || energy)
  }

  private toggleShuffle(): void {
    this.shuffle = !this.shuffle
    this.dispatchEvent(new CustomEvent('mn-audio-shuffle-change', { detail: { shuffle: this.shuffle }, bubbles: true, composed: true }))
  }

  private cycleRepeat(): void {
    this.repeat = nextRepeatMode(this.repeat)
    this.dispatchEvent(new CustomEvent('mn-audio-repeat-change', { detail: { repeat: this.repeat }, bubbles: true, composed: true }))
  }

  private open(track: MnAudioTrack): void {
    if (!track.href) return
    this.dispatchEvent(new CustomEvent<MnAudioOpenDetail>('mn-audio-open', {
      detail: { id: track.id, href: track.href },
      bubbles: true,
      composed: true,
      cancelable: true,
    }))
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  protected willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('engine')) {
      if (this.isConnected) this.bindEngine()
    }
    if (changed.has('selectedId') || changed.has('tracks')) {
      const i = this.selectedId ? this.tracks.findIndex((t) => t.id === this.selectedId) : -1
      if (i !== -1 && this.soundingIndex === -1) this.cuedIndex = i
      else if (changed.has('selectedId') && i !== -1) this.cuedIndex = i
    }
    if (changed.has('tracks') || changed.has('shuffle') || changed.has('seed')) {
      this.order = playOrder(this.tracks.length, this.shuffle, this.seed, this.tracks.length ? this.currentIndex : null)
    }
    if (changed.has('visualizer') && this.visualizer && !MN_VISUALIZER_MODES.includes(this.visualizer)) this.visualizer = ''
  }

  protected updated(changed: PropertyValues<this>): void {
    super.updated(changed)
    this.loadData()
    this.emitTrackChange(this.live ? 'engine' : 'cue')
    this.dataset.status = this.status
    this.dataset.visualizer = this.effectiveVisualizer
    this.dataset.trackId = this.currentTrack?.id ?? ''
    const key = `${this.resolvedSkin}|${this.resolvedTheme}`
    if (key !== this.paletteKey) {
      this.paletteKey = key
      this.palette = null
    }
    this.observeCanvas()
    this.metersHorizontal = null
    this.paintFrame(this.time)
  }

  /** Load the deck's track's peaks and energy (and the next one's, quietly). */
  private loadData(): void {
    const targets = [this.currentTrack]
    const next = nextTrackIndex(this.order, this.currentIndex, this.repeat, false)
    if (next !== null) targets.push(this.tracks[next] ?? null)
    for (const t of targets) {
      if (!t) continue
      if (!t.peaks && t.peaksUrl) this.fetchData(t.peaksUrl, 'peaks')
      if (!t.energy && t.energyUrl) this.fetchData(t.energyUrl, 'energy')
    }
  }

  private fetchData(url: string, kind: 'peaks' | 'energy'): void {
    const have = kind === 'peaks' ? this.peaksCache.has(url) : this.energyCache.has(url)
    if (have || this.dataErrors.has(url)) return
    const key = `${kind} ${url}`
    let pending = DATA_CACHE.get(key)
    if (!pending) {
      pending = this.loader(url, kind)
      DATA_CACHE.set(key, pending)
      pending.catch(() => DATA_CACHE.delete(key))
    }
    void pending
      .then((json) => {
        if (kind === 'peaks') this.peaksCache.set(url, parsePeaks(json))
        else this.energyCache.set(url, parseEnergyTrace(json))
      })
      .catch((cause: unknown) => {
        this.dataErrors.set(url, cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        this.dataVersion++
      })
  }

  // ── Keyboard ──────────────────────────────────────────────────────────────

  private readonly onWindowKey = (event: KeyboardEvent): void => {
    if (!this.globalKeys || event.defaultPrevented) return
    const path = event.composedPath()
    if (path.includes(this)) return // handled by the host listener
    const target = path[0]
    if (target instanceof HTMLElement && target !== document.body && target !== document.documentElement) {
      // Only when nothing that takes keys has focus.
      if (isTextEntry(target) || /^(BUTTON|A|SELECT)$/.test(target.tagName) || target.getAttribute('role')) return
    }
    this.handleKey(event, target)
  }

  private onKey(event: KeyboardEvent): void {
    this.handleKey(event, event.composedPath()[0])
  }

  private handleKey(event: KeyboardEvent, target: EventTarget | undefined): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (isTextEntry(target)) return
    const el = target instanceof HTMLElement ? target : null
    const onButton = !!el && (el.tagName === 'BUTTON' || el.getAttribute('role') === 'option')
    const onSlider = !!el && el.getAttribute('role') === 'slider'
    const key = event.key
    const lower = key.length === 1 ? key.toLowerCase() : key
    let handled = true
    switch (lower) {
      case ' ':
        if (onButton) return
        this.toggle()
        break
      case 'k':
        this.toggle()
        break
      case 'ArrowLeft':
        if (onSlider && !event.shiftKey) return
        if (event.shiftKey) this.previous()
        else this.seek(this.time - 5)
        break
      case 'ArrowRight':
        if (onSlider && !event.shiftKey) return
        if (event.shiftKey) this.next()
        else this.seek(this.time + 5)
        break
      case 'j':
        this.seek(this.time - 10)
        break
      case 'l':
        this.seek(this.time + 10)
        break
      case 'n':
      case 'b':
        this.next()
        break
      case 'p':
      case 'z':
        this.previous()
        break
      case 'x':
        this.play()
        break
      case 'c':
        this.toggle()
        break
      case 'v':
        this.stop()
        break
      case 's':
        this.toggleShuffle()
        break
      case 'r':
        this.cycleRepeat()
        break
      case 'm':
        this.cycleVisualizer()
        break
      default:
        handled = false
    }
    if (handled) event.preventDefault()
  }

  private onListKey(event: KeyboardEvent, index: number): void {
    const rows = [...(this.renderRoot.querySelectorAll<HTMLElement>('.row') ?? [])]
    let to = -1
    if (event.key === 'ArrowDown') to = Math.min(rows.length - 1, index + 1)
    else if (event.key === 'ArrowUp') to = Math.max(0, index - 1)
    else if (event.key === 'Home') to = 0
    else if (event.key === 'End') to = rows.length - 1
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      this.rowActivate(index)
      return
    } else return
    event.preventDefault()
    event.stopPropagation()
    rows[to]?.focus()
  }

  private rowActivate(index: number): void {
    if (index === this.currentIndex && this.live) this.toggle()
    else this.playIndex(index, 'select')
  }

  // ── Scrubber ──────────────────────────────────────────────────────────────

  private timeAt(event: PointerEvent): number {
    const el = event.currentTarget as HTMLElement
    const r = el.getBoundingClientRect()
    const f = r.width > 0 ? Math.min(1, Math.max(0, (event.clientX - r.left) / r.width)) : 0
    return f * (this.duration ?? 0)
  }

  private onScrubDown(event: PointerEvent): void {
    if (!this.duration) return
    this.dragging = true
    ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
    this.seek(this.timeAt(event))
  }

  private onScrubMove(event: PointerEvent): void {
    if (!this.duration) return
    const el = event.currentTarget as HTMLElement
    const r = el.getBoundingClientRect()
    this.hover = { x: event.clientX - r.left, t: this.timeAt(event) }
    if (this.dragging) this.seek(this.hover.t)
  }

  private onScrubUp(event: PointerEvent): void {
    this.dragging = false
    ;(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId)
  }

  private onScrubKey(event: KeyboardEvent): void {
    const d = this.duration ?? 0
    const step = event.shiftKey ? 30 : 5
    let t: number | null = null
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') t = this.time - step
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') t = this.time + step
    else if (event.key === 'PageDown') t = this.time - 30
    else if (event.key === 'PageUp') t = this.time + 30
    else if (event.key === 'Home') t = 0
    else if (event.key === 'End') t = Math.max(0, d - 0.25)
    if (t === null || event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) return
    event.preventDefault()
    event.stopPropagation()
    this.seek(t)
  }

  // ── Media Session ─────────────────────────────────────────────────────────

  private bindMediaSession(): void {
    if (this.mediaSessionBound || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    this.mediaSessionBound = true
    const ms = navigator.mediaSession
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null): void => {
      try {
        ms.setActionHandler(action, handler)
      } catch {
        // An action this browser does not know.
      }
    }
    set('play', () => this.play())
    set('pause', () => this.pause())
    set('stop', () => this.stop())
    set('previoustrack', () => this.previous())
    set('nexttrack', () => this.next())
    set('seekbackward', (d) => this.seek(this.time - (d.seekOffset ?? 10)))
    set('seekforward', (d) => this.seek(this.time + (d.seekOffset ?? 10)))
    set('seekto', (d) => {
      if (d.seekTime !== undefined) this.seek(d.seekTime)
    })
  }

  private syncMediaSession(): void {
    if (!this.mediaSessionBound || ENGINE_OWNERS.get(this.activeEngine) !== this) return
    const ms = navigator.mediaSession
    const t = this.currentTrack
    try {
      if (t && this.live && typeof MediaMetadata !== 'undefined') {
        const title = ms.metadata?.title
        if (title !== t.title) {
          ms.metadata = new MediaMetadata({ title: t.title, artist: t.subtitle ?? '', album: this.label })
        }
      }
      ms.playbackState = this.status === 'playing' ? 'playing' : this.status === 'paused' ? 'paused' : 'none'
      const d = this.duration
      if (this.live && d && Number.isFinite(d) && ms.setPositionState) {
        ms.setPositionState({ duration: d, position: Math.min(d, Math.max(0, this.playback.currentTime)), playbackRate: 1 })
      }
    } catch {
      // Media Session is a courtesy; a refusal changes nothing about playback.
    }
  }

  // ── Painting (one rAF loop while sounding) ────────────────────────────────

  private startLoop(): void {
    if (this.raf || typeof requestAnimationFrame === 'undefined') return
    this.lastFrameAt = 0
    this.raf = requestAnimationFrame(this.frame)
  }

  private readonly frame = (now: number): void => {
    this.raf = 0
    if (!this.isConnected) return
    const dt = this.lastFrameAt ? Math.min(0.1, (now - this.lastFrameAt) / 1000) : 1 / 60
    this.lastFrameAt = now
    this.paintFrame(this.time, dt)
    const sounding = this.live && (this.playback.status === 'playing' || this.playback.status === 'loading')
    const settling = this.caps.some((c) => c > 0.002) || this.meterPeaks.some((p) => p > 0.002)
    if (sounding || settling) this.raf = requestAnimationFrame(this.frame)
  }

  private readPalette(): Palette {
    if (this.palette) return this.palette
    const cs = getComputedStyle(this)
    const v = (name: string, fallback: string): string => cs.getPropertyValue(name).trim() || fallback
    this.palette = {
      accent: v('--mn-color-accent', '#4a8b6f'),
      muted: v('--mn-color-text-muted', '#9ca3af'),
      grid: v('--mn-color-border-subtle', '#e5e7eb'),
      text: v('--mn-color-text-secondary', '#4b5563'),
    }
    return this.palette
  }

  private observeCanvas(): void {
    const canvas = this.renderRoot.querySelector<HTMLCanvasElement>('canvas.viz')
    if (canvas === this.observedCanvas) return
    this.resize?.disconnect()
    this.observedCanvas = canvas
    if (!canvas || typeof ResizeObserver === 'undefined') return
    this.resize = new ResizeObserver(() => {
      const dpr = Math.min(2, globalThis.devicePixelRatio || 1)
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr))
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr))
      this.paintFrame(this.time)
    })
    this.resize.observe(canvas)
  }

  /** Paint everything that moves with time, without a Lit render. */
  private paintFrame(t: number, dt = 0): void {
    const root = this.renderRoot as ShadowRoot | null
    if (!root?.querySelector) return
    const d = this.duration
    const p = d && d > 0 ? Math.min(100, Math.max(0, (t / d) * 100)) : 0
    const scrub = root.querySelector<HTMLElement>('.scrub')
    if (scrub) {
      scrub.style.setProperty('--p', `${p.toFixed(3)}%`)
      scrub.setAttribute('aria-valuenow', String(Math.round(t)))
      scrub.setAttribute('aria-valuetext', `${formatClock(t)} of ${formatClock(d)}`)
    }
    const elapsed = root.querySelector<HTMLElement>('.clock .elapsed')
    if (elapsed) elapsed.textContent = this.showRemaining && d !== undefined ? `−${formatClock(Math.max(0, d - t))}` : formatClock(t)
    const mode = this.effectiveVisualizer
    if (mode === 'energy') this.paintEnergy(root, t, dt)
    else this.paintAnalyser(root, mode, dt)
    this.vizFrames++
    this.dataset.vizFrames = String(this.vizFrames)
    this.lastPaintT = t
  }

  private paintEnergy(root: ShadowRoot, t: number, dt: number): void {
    const track = this.currentTrack
    const trace = track ? this.energyFor(track) : null
    if (!trace) return
    const levels = energyAt(trace, t)
    const meters = root.querySelectorAll<HTMLElement>('.meter')
    if (this.metersHorizontal === null) {
      const box = meters[0]?.parentElement
      this.metersHorizontal = box ? getComputedStyle(box).flexDirection === 'column' : false
    }
    const horizontal = this.metersHorizontal
    levels.forEach((db, i) => {
      const meter = meters[i]
      if (!meter) return
      const level = energyLevel(trace, db)
      const peak = Math.max(level, (this.meterPeaks[i] ?? 0) - METER_PEAK_FALL_PER_S * dt)
      this.meterPeaks[i] = peak
      const fill = meter.querySelector<HTMLElement>('.fill')
      const cap = meter.querySelector<HTMLElement>('.peak')
      if (fill) fill.style.transform = horizontal ? `scaleX(${level.toFixed(4)})` : `scaleY(${level.toFixed(4)})`
      if (cap) cap.style.transform = horizontal ? `translateX(${(peak * (meter.querySelector<HTMLElement>('.tube')?.clientWidth ?? 0)).toFixed(1)}px)` : `translateY(${(-peak * (meter.querySelector<HTMLElement>('.tube')?.clientHeight ?? 0)).toFixed(1)}px)`
      meter.dataset.level = level.toFixed(3)
      const label = meter.querySelector<HTMLElement>('.db')
      if (label) label.textContent = db <= trace.loDb + 0.05 ? '—' : `${signed(Math.round(db))} dB`
    })
    const head = root.querySelector<SVGLineElement>('.trace .head')
    if (head) {
      const x = ((t / trace.durationSeconds) * 1000).toFixed(2)
      head.setAttribute('x1', x)
      head.setAttribute('x2', x)
    }
    // Touch lights: a touch passed since the last paint lights its string.
    if (this.lastPaintT >= 0 && t >= this.lastPaintT && t - this.lastPaintT < 0.5) {
      for (const touch of touchesBetween(trace, this.lastPaintT, t)) {
        if (touch.string !== undefined) this.ledAt.set(touch.string, touch.t)
      }
    }
    for (const led of root.querySelectorAll<HTMLElement>('.led')) {
      const s = Number(led.dataset.string)
      const at = this.ledAt.get(s)
      const glow = at === undefined ? 0 : Math.exp(-Math.max(0, t - at) / LED_DECAY_S)
      led.style.opacity = (0.16 + 0.84 * glow).toFixed(3)
      led.dataset.lit = glow > 0.5 ? 'true' : 'false'
    }
  }

  private paintAnalyser(root: ShadowRoot, mode: 'spectrum' | 'scope', dt: number): void {
    const canvas = root.querySelector<HTMLCanvasElement>('canvas.viz')
    const ctx = canvas?.getContext?.('2d') ?? null
    if (!canvas || !ctx) return
    const w = canvas.width
    const h = canvas.height
    const pal = this.readPalette()
    ctx.clearRect(0, 0, w, h)
    const analyser = this.live ? this.activeEngine.analyser() : null
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1)
    const top = 30 * dpr
    const bottom = 22 * dpr
    const plotH = Math.max(1, h - top - bottom)
    if (mode === 'spectrum') {
      const bins = new Uint8Array(analyser ? analyser.frequencyBinCount : 0)
      if (analyser) analyser.getByteFrequencyData(bins)
      const bands = analyser
        ? spectrumBands(bins, analyser.context.sampleRate, analyser.fftSize, SPECTRUM_BARS)
        : new Float32Array(SPECTRUM_BARS)
      const gap = 3 * dpr
      const pad = 12 * dpr
      const barW = Math.max(1, (w - 2 * pad - gap * (SPECTRUM_BARS - 1)) / SPECTRUM_BARS)
      ctx.fillStyle = pal.grid
      ctx.fillRect(pad, top + plotH, w - 2 * pad, Math.max(1, dpr))
      for (let b = 0; b < SPECTRUM_BARS; b++) {
        const v = bands[b]
        const x = pad + b * (barW + gap)
        const bh = v * plotH
        ctx.globalAlpha = 0.85
        ctx.fillStyle = pal.accent
        if (bh > 0.5) ctx.fillRect(x, top + plotH - bh, barW, bh)
        const cap = Math.max(v, this.caps[b] - CAP_FALL_PER_S * dt)
        this.caps[b] = cap
        ctx.globalAlpha = 0.9
        ctx.fillStyle = pal.text
        if (cap > 0.004) ctx.fillRect(x, top + plotH - cap * plotH - 2 * dpr, barW, Math.max(1, 1.5 * dpr))
      }
      ctx.globalAlpha = 1
      canvas.dataset.energy = bands.reduce((a, v) => a + v, 0).toFixed(3)
    } else {
      const samples = new Uint8Array(analyser ? analyser.fftSize : 0)
      if (analyser) analyser.getByteTimeDomainData(samples)
      const mid = top + plotH / 2
      ctx.strokeStyle = pal.grid
      ctx.lineWidth = Math.max(1, dpr)
      ctx.beginPath()
      ctx.moveTo(0, mid)
      ctx.lineTo(w, mid)
      ctx.stroke()
      if (samples.length > 0) {
        ctx.strokeStyle = pal.accent
        ctx.lineWidth = 1.5 * dpr
        ctx.beginPath()
        let energy = 0
        for (let i = 0; i < samples.length; i++) {
          const v = (samples[i] - 128) / 128
          energy += Math.abs(v)
          const x = (i / (samples.length - 1)) * w
          const y = mid - v * (plotH / 2) * 0.95
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
        canvas.dataset.energy = (energy / samples.length).toFixed(4)
      }
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  private renderEnergy(track: MnAudioTrack): TemplateResult {
    const trace = this.energyFor(track)
    const err = track.energyUrl ? this.dataErrors.get(track.energyUrl) : undefined
    if (!trace) {
      return html`<div class="viz-note" data-energy-state=${err ? 'error' : 'loading'}>
        ${err ? `The energy trace could not be read: ${err}` : 'Reading the World’s energy trace…'}
      </div>`
    }
    const strings = touchedStrings(trace)
    return html`<div class="energy" data-energy-state="ready">
      <div class="meters" aria-hidden="true">
        ${trace.bodies.map((b, i) => html`<div class="meter" data-body=${b.id} style=${`--c: var(--mn-audio-body-${(i % 4) + 1})`}>
          <span class="db">—</span>
          <div class="tube"><div class="fill"></div><div class="peak"></div></div>
          <span class="name">${b.label}</span>
        </div>`)}
      </div>
      <div class="trace">
        ${unsafeHTML(traceSvg(trace))}
        <div class="marks" aria-hidden="true">
          ${trace.touches.map((touch) => html`<i style=${`left: ${((touch.t / trace.durationSeconds) * 100).toFixed(3)}%`}></i>`)}
        </div>
      </div>
      ${strings.length > 0
        ? html`<div class="leds" aria-hidden="true" style="top: 9px; left: 12px;">
            ${strings.map((s) => html`<span class="led" data-string=${s}>${s}</span>`)}
          </div>`
        : nothing}
    </div>`
  }

  private renderScreen(track: MnAudioTrack | null): TemplateResult {
    const mode = this.effectiveVisualizer
    const modes = this.availableModes()
    const energy = track ? this.energyFor(track) : null
    const analyserReady = this.live && this.activeEngine.analyser() !== null
    const caption =
      mode === 'energy'
        ? energy
          ? `10·log₁₀ E · dB re the World's unit · ${signed(Math.round(energy.loDb))} to ${signed(Math.round(energy.hiDb))} dB${energy.unitInferred ? ' · unit inferred' : ''}${energy.worlds.length > 1 ? ` · ${energy.worlds.length} Worlds summed` : ''}`
          : 'stored energy by body'
        : mode === 'spectrum'
          ? 'live spectrum · log Hz'
          : 'live waveform'
    return html`<div class="screen" data-mode=${mode}
      @click=${(e: Event) => { if (!(e.target as HTMLElement).closest('.modes')) this.cycleVisualizer() }}>
      <div class="modes" role="group" aria-label=${t('Visualizer')}>
        ${MN_VISUALIZER_MODES.map((m) => html`<button type="button" aria-pressed=${String(m === mode)}
          ?disabled=${!modes.includes(m)} data-mode=${m}
          @click=${(e: Event) => { e.stopPropagation(); this.setVisualizer(m) }}>${m === 'energy' ? 'Energy' : m === 'spectrum' ? 'Spectrum' : 'Scope'}</button>`)}
      </div>
      ${mode === 'energy' && track
        ? this.renderEnergy(track)
        : html`<div class="analyser">
            <canvas class="viz" aria-hidden="true"></canvas>
            ${mode === 'spectrum'
              ? html`<div class="axis" aria-hidden="true"><span>40</span><span>250</span><span>1k</span><span>4k</span><span>16k Hz</span></div>`
              : nothing}
            ${!analyserReady
              ? html`<div class="viz-note">${this.live && this.playback.status === 'playing'
                  ? 'This browser gives no Web Audio analyser for the sound.'
                  : 'Drawn live from the sound while it plays.'}</div>`
              : nothing}
          </div>`}
      <span class="screen-caption">${caption}</span>
    </div>`
  }

  private renderScrubber(track: MnAudioTrack | null): TemplateResult {
    const peaks = track ? this.peaksFor(track) : null
    const d = this.duration
    const energy = track ? this.energyFor(track) : null
    return html`<div class="scrub" role="slider" tabindex="0" aria-label=${t('Seek')}
        aria-valuemin="0" aria-valuemax=${String(Math.round(d ?? 0))} aria-valuenow="0"
        data-has-peaks=${peaks ? 'true' : 'false'}
        @pointerdown=${this.onScrubDown} @pointermove=${this.onScrubMove} @pointerup=${this.onScrubUp}
        @pointercancel=${this.onScrubUp} @pointerleave=${() => { this.hover = null }}
        @keydown=${this.onScrubKey}>
      ${peaks
        ? unsafeHTML(waveSvg('base', wavePath(peaks)) + waveSvg('played', wavePath(peaks)))
        : html`<div class="flat"><div class="bar"></div></div>`}
      ${energy && d ? unsafeHTML(ticksSvg(energy, d)) : nothing}
      ${this.hover
        ? html`<div class="hover" style=${`left: ${this.hover.x}px`}></div><div class="hover-label" style=${`left: ${this.hover.x}px`}>${formatClock(this.hover.t)}</div>`
        : nothing}
    </div>`
  }

  private renderDeck(): TemplateResult {
    const track = this.currentTrack
    const status = this.status
    const playing = status === 'playing' || status === 'loading'
    const d = this.duration
    const statusText = status === 'playing' ? 'Now playing' : status === 'loading' ? 'Loading' : status === 'paused' ? 'Paused' : status === 'error' ? 'Could not play' : 'Ready'
    const error = this.live ? this.playback.error : null
    return html`<section class="deck" aria-label=${t('Player')}>
      <div class="now">
        <div class="eyebrow">
          <span class="status" data-status=${status}>${statusText}</span>
          ${this.tracks.length > 1 ? html`<span class="position">${String(this.currentIndex + 1).padStart(2, '0')} / ${String(this.tracks.length).padStart(2, '0')}</span>` : nothing}
        </div>
        ${this.bare ? nothing : html`<h2 class="title">${track?.title ?? t('Nothing to play')}</h2>`}
        ${track?.subtitle && !this.bare ? html`<p class="subtitle">${track.subtitle}</p>` : nothing}
        ${track?.tags?.length && !this.bare ? html`<div class="tags">${track.tags.map((tag) => html`<span class="tag">${tag}</span>`)}</div>` : nothing}
        <button class="clock" type="button" title=${t('Elapsed / remaining')}
          aria-label=${this.showRemaining ? t('Showing time remaining; show time elapsed') : t('Showing time elapsed; show time remaining')}
          @click=${() => { this.showRemaining = !this.showRemaining }}>
          <span class="elapsed">0:00</span><span class="total">${formatClock(d)}</span>
        </button>
      </div>
      ${error ? html`<p class="error" role="alert">${error}</p>` : nothing}
      ${this.renderScreen(track)}
      ${this.renderScrubber(track)}
      <div class="transport">
        <button class="btn" type="button" aria-label=${t('Previous')} title=${t('Previous (P)')} ?disabled=${this.tracks.length === 0}
          @click=${() => this.previous()}>${icon('skip-back', { size: 18 })}</button>
        <button class="btn play" type="button" data-action="toggle" ?disabled=${!track}
          aria-label=${playing ? `Pause ${track?.title ?? ''}` : `Play ${track?.title ?? ''}`}
          @click=${() => this.toggle()}>${icon(playing ? 'pause' : 'play', { size: 22 })}</button>
        <button class="btn" type="button" aria-label=${t('Next')} title=${t('Next (N)')} ?disabled=${this.tracks.length === 0}
          @click=${() => this.next()}>${icon('skip-forward', { size: 18 })}</button>
        <span class="spacer"></span>
        ${this.variant === 'full'
          ? html`<button class="btn" type="button" aria-label=${t('Shuffle')} title=${t('Shuffle (S)')} aria-pressed=${String(this.shuffle)}
                @click=${() => this.toggleShuffle()}>${icon('shuffle', { size: 17 })}</button>
              <button class="btn" type="button" aria-label=${`Repeat: ${this.repeat}`} title=${t('Repeat (R)')} aria-pressed=${String(this.repeat !== 'off')}
                data-repeat=${this.repeat} @click=${() => this.cycleRepeat()}>${icon(this.repeat === 'one' ? 'repeat-1' : 'repeat', { size: 17 })}</button>`
          : nothing}
      </div>
    </section>`
  }

  private renderList(): TemplateResult {
    const total = this.tracks.reduce((s, t) => s + (t.duration ?? 0), 0)
    const allKnown = this.tracks.every((t) => t.duration !== undefined)
    const current = this.currentIndex
    const playing = this.live && this.playback.status === 'playing'
    return html`<section class="list-card" aria-label=${this.label}>
      <div class="list-head">
        <h3>${this.label}</h3>
        <span class="sum">${this.tracks.length} ${this.tracks.length === 1 ? 'piece' : 'pieces'} · ${allKnown ? formatClock(total) : '—'}</span>
      </div>
      ${this.tracks.length === 0
        ? html`<div class="empty">${t('No pieces.')}</div>`
        : html`<ol role="listbox" aria-label=${this.label}>
            ${this.tracks.map((t, i) => html`<li class="row" role="option" tabindex=${i === current ? '0' : '-1'}
                aria-selected=${String(i === current)} data-id=${t.id} data-index=${i}
                @click=${(e: Event) => { if (!(e.target as HTMLElement).closest('.open')) this.rowActivate(i) }}
                @keydown=${(e: KeyboardEvent) => this.onListKey(e, i)}>
              <span class="n">${i === current && this.live && (playing || this.playback.status === 'paused')
                ? html`<span class="bars" aria-label=${playing ? 'playing' : 'paused'} ?data-paused=${!playing}><i></i><i></i><i></i></span>`
                : String(i + 1).padStart(2, '0')}</span>
              <span class="t"><b>${t.title}</b>${t.subtitle || t.tags?.length ? html`<span>${[t.tags?.join(' · '), t.subtitle].filter(Boolean).join(' — ')}</span>` : nothing}</span>
              <span class="d">${formatClock(t.duration)}</span>
              ${t.href
                ? html`<button class="open" type="button" aria-label=${`Open ${t.title}`} title=${translate(localeSource.get(), 'Open the piece')}
                    @click=${(e: Event) => { e.stopPropagation(); this.open(t) }}>${icon('arrow-up-right', { size: 15 })}</button>`
                : html`<span></span>`}
            </li>`)}
          </ol>`}
    </section>`
  }

  render() {
    void this.dataVersion
    return html`<div class="layout" data-variant=${this.variant} @keydown=${this.onKey}>
      ${this.renderDeck()}
      ${this.variant === 'full' ? this.renderList() : nothing}
    </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-audio-player': MnAudioPlayer
  }
}
