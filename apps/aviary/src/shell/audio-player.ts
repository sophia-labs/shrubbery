/**
 * audio-player.ts — SHELL-SIDE: the one audio element in the app.
 *
 * WHY IT LIVES HERE. `@shrubbery/components` is backend-free and owns no media
 * pipeline — `mn-tts-player`, the closest-looking primitive, is deliberately a
 * PURELY PRESENTATIONAL transport that emits intent and plays nothing. So the
 * actual `HTMLAudioElement` is a shell concern, like auth and HTTP: exactly one
 * lives here, the UI elements are controlled views over its state, and they
 * emit intent rather than reaching for a media API.
 *
 * ONE ELEMENT, NOT ONE PER ROW. 34 samples plus the renders would otherwise be
 * 40+ media elements racing each other; a single element also makes "playing"
 * a single, unambiguous piece of state, which is what the transport renders.
 *
 * ERRORS ARE STATE, NOT CONSOLE NOISE. A failed load lands in `error` verbatim
 * and the transport shows it; nothing retries silently and nothing pretends the
 * track is playing.
 */

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error'

/** What the shell hands the player: an addressable, already-resolved sound. */
export interface Track {
  /** The graph IRI of the thing being played — the identity rows compare on. */
  readonly iri: string
  readonly label: string
  readonly subtitle: string
  readonly src: string
  /** Duration from the graph, when the graph knows it (samples/beds do). */
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
  /** The element, exposed so a browser test can assert a REAL src is attached. */
  readonly element: HTMLAudioElement
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

export function createAudioPlayer(audio: HTMLAudioElement = new Audio()): AudioPlayer {
  audio.preload = 'metadata'

  let state: PlaybackState = IDLE
  const listeners = new Set<(s: PlaybackState) => void>()

  const emit = (next: Partial<PlaybackState>): void => {
    state = { ...state, ...next }
    for (const listener of listeners) listener(state)
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
  audio.addEventListener('ended', () => emit({ status: 'paused', currentTime: 0 }))
  audio.addEventListener('error', () => emit({ status: 'error', error: mediaErrorMessage(audio) }))

  function play(track: Track, startAt = 0): void {
    const sameTrack = state.track?.iri === track.iri && audio.src.endsWith(track.src)
    if (!sameTrack) {
      audio.src = track.src
      audio.load()
    }
    emit({
      status: 'loading',
      track,
      currentTime: startAt,
      duration: track.declaredDuration,
      error: null,
    })
    if (startAt > 0 || !sameTrack) {
      try {
        audio.currentTime = startAt
      } catch {
        // Seeking before metadata is a legal no-op; the seek below re-applies.
      }
    }
    void audio.play().catch((cause: unknown) => {
      // Autoplay refusal and decode failures both land here, verbatim.
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
      audio.removeAttribute('src')
      audio.load()
      state = IDLE
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
  }
}
