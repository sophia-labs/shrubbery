/**
 * story-beats.ts — the per-story narrative beat families, SHARED server-side
 * language: vite.config.ts compiles them into storyboard prompts (legacy and
 * pack alike) and scripts/backfill-runs.mts records them into run ledgers.
 *
 * Moved verbatim from vite.config.ts (the strings are the prompt contract —
 * byte-identical); no browser imports, no DOM, no provider knowledge.
 */

export const CACTUS_BEATS = [
  'A — QUIET BEFORE: she sits on the right third and studies the cactus resting at the lower-left thirds intersection; the flower is closed; her hands are still.',
  'B — RECOGNITION: from the same continuous setup, the cactus flower opens into a warm five-pointed star; she has just noticed it; wonder replaces stillness.',
  'C — RELEASE: the star has lifted gently from the cactus into the negative space near the upper-left thirds intersection; she reaches toward it from screen-right and follows it with her gaze.',
  'D — RECEIVING: the slow camera move has arrived at an intimate medium close-up; she cups the floating star with both hands near the lower-center intersection and looks toward the viewer with quiet delight.',
]

export const MOON_BEATS = [
  'A — QUIET BEFORE: she sits on the right third and studies the moon lantern resting at the lower-left thirds intersection; the crescent is contained; her hands are still.',
  'B — RECOGNITION: from the same continuous setup, the lantern brightens and the crescent begins to rise; she has just noticed it; wonder replaces stillness.',
  'C — RELEASE: the crescent has floated into the negative space near the upper-left thirds intersection; she reaches toward it from screen-right and follows it with her gaze.',
  'D — RECEIVING: the slow camera move has arrived at an intimate medium close-up; she cups the floating crescent with both hands near the lower-center intersection and looks toward the viewer with quiet delight.',
]

// The Garden of Forking Paths, Story I — "In one of them, a friend"
// (adaptation doc atelier-garden-forking-paths-adaptation-20260731, beats ratified for the density probe).
export const GARDEN_STORY_I_BEATS = [
  'A — THE ROAD: she stands on the right third of the night garden path, arrested mid-step, hands still; the path forks in the left two-thirds among tangled poplars; the paper lantern rests unlit at the lower-left thirds intersection, its crescent contained and dark; the low full moon holds the sky.',
  'B — THE MEETING: same continuous scene; the lantern has woken — warm light through the paper, the crescent stirred upright — and the near fork of the path catches its glow; her gaze has just arrived at it; recognition is replacing wariness; nothing else has moved.',
  'C — THE SWARMING: the crescent has risen out of the lantern into the open upper-left, and small lights are waking along both forks of the path, near and far; she reaches from screen-right, eyes leading, feet staying.',
  'D — THE GUEST: the slow camera move has arrived at an intimate medium close-up; she cups the crescent with both hands near the lower-center intersection while both forks remain lit behind her, their lights leaning toward her; she settles and looks toward the viewer with gratitude, not triumph.',
]

/** The beat family a pack's primary prop selects — mirrors packBeats in
 *  vite.config.ts for the three authored families (used by the backfill,
 *  which only ever meets authored stories). */
export function beatsForPrimaryProp(propId: string | undefined): readonly string[] | null {
  if (propId === 'prop:star-cactus') return CACTUS_BEATS
  if (propId === 'prop:moon-lantern') return MOON_BEATS
  if (propId === 'prop:paper-drum-lantern') return GARDEN_STORY_I_BEATS
  return null
}
