/**
 * catalog.ts — the LOCAL PLAYOUT fixtures: the idle/story clip shelf.
 *
 * The visual catalog that used to live here (character/props/scenes as
 * hardcoded literals) has been absorbed by the REFERENCE WEB — entities,
 * studies, and relations authored in src/catalog/reference-web-config.ts,
 * fossilized to src/catalog/reference-web.nt, and decoded at boot through the
 * same static TripleSource path as the layout (see main.ts). Catalog is data.
 *
 * What remains here is playout furniture: the locally rendered fixture MP4s
 * that carry the feed between generated stories.
 */

export interface LocalClip {
  id: string
  src: string
  poster: string
  label: string
  kind: 'idle' | 'shot'
  durationSeconds: number
  storyIndex?: number
}

export const clips: Record<string, LocalClip> = {
  idleGlasshouse: {
    id: 'clip:idle-glasshouse',
    src: '/clips/idle-glasshouse.mp4',
    poster: '/stills/idle-glasshouse.svg',
    label: 'idle · listening',
    kind: 'idle',
    durationSeconds: 5,
  },
  idleNight: {
    id: 'clip:idle-night',
    src: '/clips/idle-night.mp4',
    poster: '/stills/idle-night.svg',
    label: 'idle · thinking',
    kind: 'idle',
    durationSeconds: 5,
  },
  cactusGlasshouse: {
    id: 'clip:cactus-glasshouse',
    src: '/clips/cactus-glasshouse.mp4',
    poster: '/stills/cactus-glasshouse.svg',
    label: 'shot · cactus reveal',
    kind: 'shot',
    durationSeconds: 5,
  },
  cactusNight: {
    id: 'clip:cactus-night',
    src: '/clips/cactus-night.mp4',
    poster: '/stills/cactus-night.svg',
    label: 'shot · nocturnal cactus',
    kind: 'shot',
    durationSeconds: 5,
  },
  lanternGlasshouse: {
    id: 'clip:lantern-glasshouse',
    src: '/clips/lantern-glasshouse.mp4',
    poster: '/stills/lantern-glasshouse.svg',
    label: 'shot · daylight moon',
    kind: 'shot',
    durationSeconds: 5,
  },
  lanternNight: {
    id: 'clip:lantern-night',
    src: '/clips/lantern-night.mp4',
    poster: '/stills/lantern-night.svg',
    label: 'shot · moon confidant',
    kind: 'shot',
    durationSeconds: 5,
  },
}
