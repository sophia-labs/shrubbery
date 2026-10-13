/**
 * routes.ts — PURE: the rail's sections, the stage's route, and track resolution.
 *
 * Everything here is a total function of the parsed Library plus a route id, so
 * the rail, the stage, and the transport all agree by construction and none of
 * them re-derives navigation from strings of its own. No DOM, no Lit.
 */

import { playableOf, sampleCount, type Library, type MediaRef } from '../library/model.js'
import { mediaUrl } from './media.js'
import type { Track } from './audio-player.js'

/** A route id is a stable, URL-safe string the rail emits and the stage reads. */
export type RouteId = string

export const ROUTE = {
  voice: (name: string): RouteId => `voice:${name}`,
  beds: 'beds' as RouteId,
  renders: 'renders' as RouteId,
  recordings: 'recordings' as RouteId,
  analysis: 'analysis' as RouteId,
  technique: 'technique' as RouteId,
}

export interface RailItem {
  readonly id: RouteId
  readonly label: string
  /** A real count from the graph, or undefined when counting is meaningless. */
  readonly count: number | undefined
  /** A short, measured hint (never invented prose). */
  readonly hint: string | undefined
}

export interface RailSection {
  readonly id: string
  readonly label: string
  readonly items: readonly RailItem[]
}

/** Hz → a compact display string. */
export function hz(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(2)} kHz` : `${Math.round(value)} Hz`
}

/** Build the rail straight from the graph. Empty groups are OMITTED, never
 *  stubbed: a library with no renders shows no Renders section. */
export function railSections(library: Library): readonly RailSection[] {
  const sections: RailSection[] = []

  if (library.voices.length > 0) {
    sections.push({
      id: 'voices',
      label: 'Voices',
      items: library.voices.map((v) => ({
        id: ROUTE.voice(v.name),
        label: v.name,
        count: v.samples.length,
        hint: v.f0Median === undefined ? undefined : hz(v.f0Median),
      })),
    })
  }

  const material: RailItem[] = []
  if (library.beds.length > 0) {
    material.push({ id: ROUTE.beds, label: 'Noise beds', count: library.beds.length, hint: undefined })
  }
  if (library.renders.length > 0) {
    material.push({ id: ROUTE.renders, label: 'Renders', count: library.renders.length, hint: undefined })
  }
  if (library.recordings.length > 0) {
    material.push({
      id: ROUTE.recordings,
      label: 'Source recording',
      count: library.recordings.length,
      hint: undefined,
    })
  }
  if (material.length > 0) sections.push({ id: 'material', label: 'Material', items: material })

  const notes: RailItem[] = []
  if (library.figures.length > 0) {
    notes.push({ id: ROUTE.analysis, label: 'Analysis', count: library.figures.length, hint: undefined })
  }
  if (library.techniques.length > 0) {
    notes.push({ id: ROUTE.technique, label: 'Shifting', count: library.techniques.length, hint: undefined })
  }
  if (notes.length > 0) sections.push({ id: 'notes', label: 'Notes', items: notes })

  return sections
}

/** The route the app opens on: the first voice, else the first item there is. */
export function defaultRoute(library: Library): RouteId | null {
  const sections = railSections(library)
  return sections[0]?.items[0]?.id ?? null
}

/** Every route the rail offers, flattened — used for keyboard traversal. */
export function allRouteIds(library: Library): readonly RouteId[] {
  return railSections(library).flatMap((s) => s.items.map((i) => i.id))
}

// ── Track resolution ─────────────────────────────────────────────────────────

/** Build a playable Track, or null when the resource carries no audio media
 *  (an image-only figure, or a manifest entry whose file is missing on disk). */
export function trackFor(opts: {
  iri: string
  label: string
  subtitle: string
  media: readonly MediaRef[]
  declaredDuration?: number | undefined
}): Track | null {
  const playable = playableOf(opts.media)
  if (!playable) return null
  return {
    iri: opts.iri,
    label: opts.label,
    subtitle: opts.subtitle,
    src: mediaUrl(playable.path),
    declaredDuration: opts.declaredDuration,
  }
}

/** The one-line provenance the app bar shows — every number measured. */
export function librarySummary(library: Library): string {
  const bits: string[] = [`${library.voices.length} voices`, `${sampleCount(library)} samples`]
  if (library.renders.length > 0) bits.push(`${library.renders.length} renders`)
  if (library.sampleRate !== undefined) bits.push(`${(library.sampleRate / 1000).toFixed(1)} kHz`)
  return bits.join(' · ')
}
