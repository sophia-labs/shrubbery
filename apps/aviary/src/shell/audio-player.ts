/**
 * audio-player.ts — SHELL-SIDE: the one audio element in the app.
 *
 * The engine that lived here was promoted to `@shrubbery/components/audio-player`
 * (2026-10-20), where `mn-audio-player` uses it too. Same API, same behaviour:
 * one HTMLAudioElement, UI elements as controlled views over its state, errors
 * as state rather than console noise. Aviary still owns its one element (see
 * main.ts) and does not ask for the Web Audio tap.
 */

export {
  createAudioPlayer,
  type AudioPlayer,
  type PlaybackState,
  type PlaybackStatus,
  type Track,
} from '@shrubbery/components/audio-player'
