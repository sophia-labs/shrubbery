/**
 * story-families.ts — the two story families, verbatim from the original
 * main.ts. They mirror the server's beat branch in vite.config.ts: appearance
 * lives in the reference images; this language names roles and continuity.
 */

export interface StoryFamily {
  impulse: string
  bridges: [string, string, string]
}

export const storyFamilies: Record<'cactus' | 'moon', StoryFamily> = {
  cactus: {
    impulse: 'A tiny ordinary discovery becomes quietly miraculous. She notices the cactus flower waking, follows the released star with patient wonder, and receives it as if the glasshouse itself has offered her a secret. The emotion should arrive gradually rather than as a punchline.',
    bridges: [
      'A→B. The closed flower wakes and opens into a warm five-pointed star. She notices slowly: her gaze moves first, then her expression softens into wonder. Keep her hands and the pot grounded; let the camera and foreground leaves barely drift.',
      'B→C. The small star lifts from the flower into the open left side of frame. Her eyes lead, then one hand follows without grabbing. Preserve the same screen direction and let the slow camera drift continue through the greenhouse depth.',
      'C→D. The star crosses gently toward her waiting hands. She receives and cups it rather than snatching it, then settles and looks toward the viewer. The camera arrives at the intimate endpoint without accelerating.',
    ],
  },
  moon: {
    impulse: 'A kept light wants to wander. She notices the lantern’s crescent waking, follows its slow ascent with patient wonder, and receives it as if the night itself has trusted her with a small moon. The emotion should arrive gradually rather than as a punchline.',
    bridges: [
      'A→B. The lantern brightens from within and the contained crescent begins to stir. She notices slowly: her gaze moves first, then her expression softens into wonder. Keep her hands and the lantern grounded; let the camera and window reflections barely drift.',
      'B→C. The small crescent lifts from the lantern into the open left side of frame. Her eyes lead, then one hand follows without grabbing. Preserve the same screen direction and let the slow camera drift continue through the rainy window depth.',
      'C→D. The crescent crosses gently toward her waiting hands. She receives and cups it rather than snatching it, then settles and looks toward the viewer. The camera arrives at the intimate endpoint without accelerating.',
    ],
  },
}

export function familyFor(propId: string): StoryFamily {
  return propId === 'prop:star-cactus' ? storyFamilies.cactus : storyFamilies.moon
}
