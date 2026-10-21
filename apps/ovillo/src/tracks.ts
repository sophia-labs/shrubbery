/**
 * tracks.ts — a piece in the graph → a track the player plays.
 *
 * The track carries the piece's IRI (identity), its title and the Ariadne line
 * the graph states (`ovl:engine`), the audio and the peaks / energy-trace URLs
 * resolved to this page's origin (media.ts), and the duration the graph states.
 * A piece whose render names no audio is not playable and is left out of the
 * player's list (the gallery says how many were left out).
 */

import type { MnAudioTrack } from '@shrubbery/components/audio'
import { resolveMediaUrl, type MediaResolution } from './media.js'
import type { OvilloPiece } from './model.js'
import { routeHash } from './routes.js'

export function trackForPiece(piece: OvilloPiece, media: MediaResolution = {}): MnAudioTrack | null {
  const render = piece.render
  const src = resolveMediaUrl(render?.audio, media)
  if (!render || !src) return null
  const peaksUrl = resolveMediaUrl(render.peaks, media)
  const energyUrl = resolveMediaUrl(render.energyTrace, media)
  return {
    id: piece.iri,
    title: piece.title,
    ...(piece.engine ? { subtitle: piece.engine } : {}),
    src,
    ...(render.durationSeconds !== undefined ? { duration: render.durationSeconds } : {}),
    tags: piece.tags,
    href: routeHash({ name: 'piece', slug: piece.slug }),
    ...(peaksUrl ? { peaksUrl } : {}),
    ...(energyUrl ? { energyUrl } : {}),
  }
}

export function tracksFor(pieces: readonly OvilloPiece[], media: MediaResolution = {}): { tracks: MnAudioTrack[]; unplayable: number } {
  const tracks: MnAudioTrack[] = []
  let unplayable = 0
  for (const p of pieces) {
    const t = trackForPiece(p, media)
    if (t) tracks.push(t)
    else unplayable++
  }
  return { tracks, unplayable }
}
