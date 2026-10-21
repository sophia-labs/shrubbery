/**
 * audio-playlist.ts — the pure queue logic behind `mn-audio-player`.
 *
 * A playlist is a list of tracks in their authored order, a PLAY ORDER over it
 * (the authored order, or a shuffle), a position in that play order, and a
 * repeat mode. Everything here is a pure function of those, so the element's
 * next/previous/shuffle behaviour is tested without a browser and without an
 * audio element.
 *
 * Behaviour (the Winamp conventions, which listeners already know):
 *   - next by hand wraps from the last track to the first; at the end of a
 *     track (auto) it stops after the last unless repeat is 'all'.
 *   - repeat 'one' replays the same track when it ends; next/previous by hand
 *     still move.
 *   - previous restarts the current track when more than 3 s have played.
 *   - turning shuffle on keeps the current track current and shuffles the rest
 *     after it; turning it off returns to the authored order at the same track.
 *   - the shuffle is seeded (mulberry32), so a given seed is a given order.
 */

export type MnRepeatMode = 'off' | 'all' | 'one'

export const MN_REPEAT_MODES: readonly MnRepeatMode[] = ['off', 'all', 'one']

/** The repeat mode after `mode` in the button's cycle (off → all → one → off). */
export function nextRepeatMode(mode: MnRepeatMode): MnRepeatMode {
  return MN_REPEAT_MODES[(MN_REPEAT_MODES.indexOf(mode) + 1) % MN_REPEAT_MODES.length]
}

/** A small, fast, seeded PRNG (mulberry32): the same seed gives the same shuffle. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The play order over `count` tracks: `[0..count)` in authored order, or, when
 * shuffled, a seeded permutation that starts with `anchor` (the track playing
 * when shuffle was turned on) so the music does not jump.
 */
export function playOrder(count: number, shuffle: boolean, seed = 1, anchor: number | null = null): number[] {
  const order = Array.from({ length: Math.max(0, count) }, (_, i) => i)
  if (!shuffle || order.length < 2) return order
  const rand = seededRandom(seed)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  if (anchor !== null && anchor >= 0 && anchor < count) {
    order.splice(order.indexOf(anchor), 1)
    order.unshift(anchor)
  }
  return order
}

/**
 * The track index to play after `current` (a track index, not a position), or
 * null to stop. `auto` is true when the current track just ended by itself.
 */
export function nextTrackIndex(
  order: readonly number[],
  current: number | null,
  repeat: MnRepeatMode,
  auto: boolean,
): number | null {
  if (order.length === 0) return null
  if (current === null) return order[0]
  if (auto && repeat === 'one') return current
  const position = order.indexOf(current)
  if (position === -1) return order[0]
  if (position < order.length - 1) return order[position + 1]
  if (auto && repeat === 'off') return null
  return order[0]
}

/** What "previous" does: restart the current track, or move to another one. */
export interface PreviousStep {
  readonly index: number
  readonly restart: boolean
}

/** Previous: past 3 s restart the current track; else the one before it in play order (wrapping). */
export function previousTrackIndex(
  order: readonly number[],
  current: number | null,
  currentTime: number,
): PreviousStep | null {
  if (order.length === 0) return null
  if (current === null) return { index: order[0], restart: false }
  if (currentTime > 3) return { index: current, restart: true }
  const position = order.indexOf(current)
  if (position === -1) return { index: order[0], restart: false }
  const before = position === 0 ? order.length - 1 : position - 1
  return { index: order[before], restart: false }
}

/** Seconds as `m:ss` (or `h:mm:ss`); an unknown duration is an em dash, never a zero. */
export function formatClock(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '—'
  const whole = Math.floor(seconds)
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = whole % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
