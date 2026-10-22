/**
 * audio-player.ts — the one audio element a player owns, PROMOTED from Aviary.
 *
 * HISTORY. This began as `apps/aviary/src/shell/audio-player.ts`, a shell-side
 * module, when no shared component played audio (`mn-tts-player` is a purely
 * presentational transport that emits intent and plays nothing). `mn-audio-player`
 * needed the same engine, so it moved here verbatim in behaviour and API; Aviary
 * now imports it from `@shrubbery/components/audio-player`. What was ADDED is
 * additive only: `onEnded` (a playlist needs to know a track finished, which
 * the state's `paused @ 0` cannot tell apart from a pause), and an optional
 * Web Audio tap (`analyse: true` → `analyser()`), which Aviary does not use.
 *
 * BACKEND-FREE. An HTMLAudioElement and (optionally) an AudioContext: browser
 * media APIs, no store, no auth, no host. The `src` is whatever the caller gives.
 *
 * ONE ELEMENT, NOT ONE PER ROW. A single element makes "playing" a single,
 * unambiguous piece of state, which is what every view renders.
 *
 * ERRORS ARE STATE, NOT CONSOLE NOISE. A failed load lands in `error` verbatim
 * and the views show it; nothing retries silently and nothing pretends the
 * track is playing.
 *
 * THE TAP. `analyse: true` routes the element through
 * `MediaElementAudioSourceNode → AnalyserNode → destination`, created lazily on
 * the first play (inside the user's gesture, so the context may start). Once an
 * element is routed it stays routed: the audio is heard through the graph from
 * then on. Media must be same-origin or served with CORS, or the tap hears
 * silence; a cross-origin `src` is therefore loaded with `crossOrigin =
 * 'anonymous'` once the tap exists, so it either plays analysed or fails
 * honestly. Where Web Audio does not exist (happy-dom, old engines) `analyser()`
 * is `null` and playback is unaffected.
 */

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error'

/** What the shell hands the player: an addressable, already-resolved sound. */
export interface Track {
  /** The graph IRI of the thing being played — the identity rows compare on. */
  readonly iri: string
  readonly label: string
  readonly subtitle: string
  readonly src: string
  /** Duration from the graph, when the graph knows it. */
  readonly declaredDuration: number | undefined
}

export interface PlaybackState {
  readonly status: PlaybackStatus
  readonly track: Track | null
  readonly currentTime: number
  /** The element's measured duration once metadata loads; else the declared one. */
  readonly duration: number | undefined
  readonly error: string | null
}

export interface AudioPlayer {
  get(): PlaybackState
  subscribe(listener: (state: PlaybackState) => void): () => void
  /** Play `track` from `startAt`; restarts if it is already the current track. */
  play(track: Track, startAt?: number): void
  /** Play/pause the given track — the row and the transport both call this. */
  toggle(track: Track): void
  pause(): void
  stop(): void
  seek(seconds: number): void
  /** Called once each time a track plays to its end (not on pause or stop). */
  onEnded(listener: (track: Track) => void): () => void
  /** The Web Audio analyser over the element, or null (no tap requested, no Web Audio, or not yet played). */
  analyser(): AnalyserNode | null
  /** The element, exposed so a browser test can assert a REAL src is attached. */
  readonly element: HTMLAudioElement
}

export interface AudioPlayerOptions {
  /** Tap the element into Web Audio on first play, for live visualizers. Default false. */
  readonly analyse?: boolean
  /** The analyser's FFT size (a power of two, 32..32768). Default 2048. */
  readonly fftSize?: number
}

const IDLE: PlaybackState = {
  status: 'idle',
  track: null,
  currentTime: 0,
  duration: undefined,
  error: null,
}

/** Turn a MediaError into the honest, human message it deserves. */
function mediaErrorMessage(el: HTMLAudioElement): string {
  const err = el.error
  if (!err) return 'audio failed to load (no MediaError reported)'
  const names: Record<number, string> = {
    1: 'MEDIA_ERR_ABORTED — the fetch was aborted',
    2: 'MEDIA_ERR_NETWORK — a network error interrupted the download',
    3: 'MEDIA_ERR_DECODE — the media could not be decoded',
    4: 'MEDIA_ERR_SRC_NOT_SUPPORTED — the source is unsupported or was not served',
  }
  const base = names[err.code] ?? `MediaError code ${err.code}`
  return err.message ? `${base}: ${err.message}` : base
}

type AudioContextCtor = new () => AudioContext

function audioContextCtor(): AudioContextCtor | null {
  const g = globalThis as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor }
  return g.AudioContext ?? g.webkitAudioContext ?? null
}

function isCrossOrigin(src: string): boolean {
  if (typeof location === 'undefined') return false
  try {
    return new URL(src, location.href).origin !== location.origin
  } catch {
    return false
  }
}

export function createAudioPlayer(
  audio: HTMLAudioElement = new Audio(),
  options: AudioPlayerOptions = {},
): AudioPlayer {
  audio.preload = 'metadata'

  let state: PlaybackState = IDLE
  const listeners = new Set<(s: PlaybackState) => void>()
  const endedListeners = new Set<(track: Track) => void>()
  let context: AudioContext | null = null
  let analyserNode: AnalyserNode | null = null
  let tapFailed = false

  const emit = (next: Partial<PlaybackState>): void => {
    state = { ...state, ...next }
    for (const listener of listeners) listener(state)
  }

  /** Build the tap once, inside a play gesture. Never throws; a failure leaves playback untouched. */
  function ensureTap(): void {
    if (!options.analyse || tapFailed) return
    if (context) {
      if (context.state === 'suspended') void context.resume().catch(() => undefined)
      return
    }
    const Ctor = audioContextCtor()
    if (!Ctor) {
      tapFailed = true
      return
    }
    try {
      context = new Ctor()
      const source = context.createMediaElementSource(audio)
      analyserNode = context.createAnalyser()
      analyserNode.fftSize = options.fftSize ?? 2048
      analyserNode.smoothingTimeConstant = 0.72
      source.connect(analyserNode)
      analyserNode.connect(context.destination)
      if (context.state === 'suspended') void context.resume().catch(() => undefined)
    } catch {
      tapFailed = true
      analyserNode = null
    }
  }

  audio.addEventListener('loadedmetadata', () => {
    emit({ duration: Number.isFinite(audio.duration) ? audio.duration : state.duration })
  })
  audio.addEventListener('timeupdate', () => emit({ currentTime: audio.currentTime }))
  audio.addEventListener('playing', () => emit({ status: 'playing', error: null }))
  audio.addEventListener('pause', () => {
    // A pause fired by end-of-track is reported by 'ended', not here.
    if (!audio.ended && state.status !== 'idle') emit({ status: 'paused' })
  })
  audio.addEventListener('ended', () => {
    const track = state.track
    emit({ status: 'paused', currentTime: 0 })
    if (track) for (const listener of endedListeners) listener(track)
  })
  audio.addEventListener('error', () => {
    // An element emptied by stop() reports an error for the missing src; that is not a failure.
    if (state.status === 'idle' && state.track === null) return
    emit({ status: 'error', error: mediaErrorMessage(audio) })
  })

  function play(track: Track, startAt = 0): void {
    ensureTap()
    const sameTrack = state.track?.iri === track.iri && audio.src.endsWith(track.src)
    if (!sameTrack) {
      if (context && isCrossOrigin(track.src)) audio.crossOrigin = 'anonymous'
      audio.src = track.src
      audio.load()
    }
    emit({
      status: 'loading',
      track,
      currentTime: startAt,
      duration: sameTrack ? state.duration ?? track.declaredDuration : track.declaredDuration,
      error: null,
    })
    if (startAt > 0 || !sameTrack) {
      try {
        audio.currentTime = startAt
      } catch {
        // Seeking before metadata is a legal no-op; the browser applies it once it can.
      }
    }
    void audio.play().catch((cause: unknown) => {
      // Autoplay refusal and decode failures both land here, verbatim. A play()
      // interrupted by a newer load is not a failure of the newer track.
      if (cause instanceof Error && cause.name === 'AbortError') return
      emit({ status: 'error', error: cause instanceof Error ? cause.message : String(cause) })
    })
  }

  return {
    element: audio,
    get: () => state,
    subscribe(listener) {
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    },
    play,
    toggle(track) {
      if (state.track?.iri === track.iri && state.status === 'playing') {
        audio.pause()
        return
      }
      if (state.track?.iri === track.iri && state.status === 'paused') {
        ensureTap()
        void audio.play().catch((cause: unknown) => {
          emit({ status: 'error', error: cause instanceof Error ? cause.message : String(cause) })
        })
        return
      }
      play(track)
    },
    pause() {
      audio.pause()
    },
    stop() {
      audio.pause()
      state = IDLE
      audio.removeAttribute('src')
      audio.load()
      for (const listener of listeners) listener(state)
    },
    seek(seconds) {
      if (state.track === null) return
      try {
        audio.currentTime = seconds
        emit({ currentTime: seconds })
      } catch (cause) {
        emit({ error: cause instanceof Error ? cause.message : String(cause) })
      }
    },
    onEnded(listener) {
      endedListeners.add(listener)
      return () => endedListeners.delete(listener)
    },
    analyser: () => analyserNode,
  }
}
