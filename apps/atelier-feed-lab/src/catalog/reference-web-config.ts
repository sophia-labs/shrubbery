/**
 * reference-web-config.ts — the reference web's AUTHORING form.
 *
 * This is where the web is written down; the app does NOT boot from this
 * literal. `scripts/emit-reference-web.mts` serializes it (reference-web-codec)
 * into `src/catalog/reference-web.nt` — a fossil-v1 N-Triples document read at
 * boot through the same static TripleSource path as the layout — and derives
 * `src/catalog/reference-web.json`, the server's projection OF THE FOSSIL.
 * Catalog is data; this file is the pen.
 *
 * Seven kinds, ratified 2026-07-31 (design doc atelier-reference-web-design-
 * 20260731, Decisions): technique splits out of atmosphere from day one — the
 * illustration-medium identity is first-class, seeded pending. Entities
 * without a providerReference and without an embedded-in host are PENDING:
 * visible in the composer, honest about needing a reference study, never
 * selectable for spend.
 *
 * Composition notes and invariants are Claude's drafts, Vera's to edit —
 * they are the web's soul (ratified decision 2). The ready entities' language
 * is distilled from the working E1 storyboard prompt so a compiled pack keeps
 * the density that made the moon anchors beautiful.
 */

import type { WebEntity } from './reference-web-codec.js'

/** The graph id the fossil claims — the app's own, same as the layout. */
export const REFERENCE_WEB_GRAPH_ID = 'atelier-feed-lab'

export const REFERENCE_WEB: readonly WebEntity[] = [
  // ── character — identity sources. Inviolable. ──────────────────────────────
  {
    id: 'character:avatar-sample-a',
    kind: 'character',
    name: 'AvatarSample_A',
    description: 'Real VRM fixture · deterministic headless source plate · browser-private',
    accent: '#9bcba4',
    providerReference: 'vtuber-source.png',
    compositionNotes:
      'She holds the right vertical third with her eyes near the upper-right intersection, and she is the still center of every frame: the world changes around her while she changes by degrees. Her gaze always moves first — attention, then expression, then at last the body. Hands are deliberate and few; poses settle completely, each calm enough to stand as the exact first or final frame of a shot. The left two-thirds belongs to what she is attending to, never to her.',
    invariant: 'her recognizable face, black bob haircut, body proportions, and unmistakable identity',
    relations: [
      { kind: 'holds', target: 'prop:moon-lantern' },
      { kind: 'holds', target: 'prop:star-cactus' },
      { kind: 'wears', target: 'wardrobe:dark-hoodie' },
    ],
  },

  // ── wardrobe — garments as their own entities. The hoodie still rides
  //    embedded in the source plate (v1): its invariant line is generated
  //    rather than hand-repeated; the avatar-suite dresser swaps it later. ────
  {
    id: 'wardrobe:dark-hoodie',
    kind: 'wardrobe',
    name: 'Dark hoodie',
    description: 'Her default garment — pixels still live inside the source plate',
    accent: '#6e7480',
    compositionNotes:
      'A soft dark mass that shapes her silhouette against any lit ground; it drinks light rather than returning it, keeping her face the brightest thing she owns. The folds are slow fabric — they carry breath and small movement so her stillness is never frozen. Hood down, sleeves loose; the drape reads as weight, not costume.',
    invariant: 'the same dark hoodie — its soft weight, loose sleeves, and unbroken silhouette',
    relations: [{ kind: 'embedded-in', target: 'character:avatar-sample-a' }],
  },

  // ── props — holdable / relatable objects ───────────────────────────────────
  {
    id: 'prop:star-cactus',
    kind: 'prop',
    name: 'Star cactus',
    description: 'Tiny blue-green cactus in a hand-painted coral pot',
    accent: '#afcd78',
    thumbnail: '/catalog/star-cactus.svg',
    providerReference: 'star-cactus.png',
    compositionNotes:
      'It sits grounded at the lower-left thirds intersection at true hand-held scale — a small thing that must stay small to stay believable. The painted coral pot anchors it to table or earth; the blue-green body keeps its star-form geometry from every angle. Only the flower is permitted to change state; everything else about it is furniture, faithful across every frame.',
    invariant: 'its star-form blue-green body, its exact hand-painted coral pot, and its small hand-held scale',
    relations: [{ kind: 'pairs-with', target: 'scene:glasshouse' }],
  },
  {
    id: 'prop:moon-lantern',
    kind: 'prop',
    name: 'Moon lantern',
    description: 'A cloudy glass lamp with a captive crescent moon',
    accent: '#efca72',
    thumbnail: '/catalog/moon-lantern.svg',
    providerReference: 'moon-lantern.png',
    compositionNotes:
      'It stands at the lower-left thirds intersection and its light obeys a strict discipline: a local pool, warm and breathing, never a scene-wide fill. The cloudy glass keeps its drum shape readable even lit; the captive crescent inside is the emotional register of the frame — contained, stirring, or risen — and its gold must survive every palette. What escapes the glass touches only what is near: her hands, the near path, the closest leaves.',
    invariant: "its cloudy glass drum and the captive crescent's warm gold",
    relations: [{ kind: 'pairs-with', target: 'scene:night-window' }],
  },
  {
    id: 'prop:paper-drum-lantern',
    kind: 'prop',
    name: 'Paper-drum lantern',
    description: 'A paper-drum lantern in the moon color — paper texture over the drum form',
    accent: '#e0b96a',
    providerReference: 'paper-drum-lantern.png',
    compositionNotes:
      "The moon-lantern's older sibling: the same drum, translated into paper. Its light does not shine so much as breathe — the paper grain reads through the glow like skin over a candle, brightest at the belly, dim at the ribs. It is carried low, near the hands, or set on earth; it belongs to the walk, not the table. In the moon color, so lantern and moon can be mistaken for each other at distance — that mistake is the point.",
    invariant: 'its paper-drum form, the visible paper grain through its glow, and the moon color',
    relations: [
      { kind: 'pairs-with', target: 'scene:forking-garden' },
      { kind: 'variant-of', target: 'prop:moon-lantern' },
    ],
  },
  {
    id: 'prop:path-lights',
    kind: 'prop',
    name: 'Path-lights',
    description: 'Small lights stringing both forks of the path — the swarming futures',
    accent: '#d9c27a',
    providerReference: 'path-lights.png',
    compositionNotes:
      'The swarming futures, given pixels. They string both forks of the path into depth — each one a point, never a lamp; no single light may claim a shape or a source. Their scale halves with distance while their warmth stays constant, so the path reads as inhabited rather than decorated. They change in sequence, near to far or far to near, one at a time and never all at once; their waking or dying is the garden speaking.',
    invariant: 'small warm points of light in even sequence along both forks, receding with distance',
    relations: [{ kind: 'pairs-with', target: 'scene:forking-garden' }],
  },
  {
    id: 'prop:the-letter',
    kind: 'prop',
    name: 'The letter',
    description: 'A crimson sheet faded pink; minute illegible calligraphy, crossed out',
    accent: '#d98a8a',
    providerReference: 'the-letter.png',
    compositionNotes:
      'A crimson sheet gone pink with a century, soft-edged, light as breath. The calligraphy is minute and utterly illegible — brush-rhythm, not writing; one clean stroke crosses it out. It exists to be held and to catch light: near the lower-center intersection, tilted so the sheet takes the lantern warmth on its face. It is the only paper in the world of the piece; nothing else in frame may carry marks.',
    invariant: 'the crimson-faded-pink sheet, its minute illegible brush calligraphy, and the single crossing stroke',
    relations: [{ kind: 'pairs-with', target: 'scene:forking-garden' }],
  },

  // ── scenes — settings ──────────────────────────────────────────────────────
  {
    id: 'scene:glasshouse',
    kind: 'scene',
    name: 'Glasshouse',
    description: 'Sunlit greenhouse, unruly leaves, old amber glass',
    accent: '#abc66f',
    thumbnail: '/catalog/glasshouse.svg',
    providerReference: 'glasshouse.png',
    compositionNotes:
      'It composes in three planes without being asked: unruly leaves crossing the extreme foreground, soft and dark; her and whatever she attends to in the midground; the amber-paned structure receding behind, sun coming through old glass like tea. The wetness matters — every leaf carries light. Its geometry may be reinterpreted freely, but its warmth may not: this is a kept place, humid and alive, and the air itself should look inhabited.',
    invariant: 'the warm overgrown glasshouse atmosphere — old amber panes, wet unruly leaves, sunlit humid air',
    relations: [],
  },
  {
    id: 'scene:night-window',
    kind: 'scene',
    name: 'Night window',
    description: 'Ink-blue studio window with rain and distant warm lights',
    accent: '#8ca9d2',
    thumbnail: '/catalog/night-window.svg',
    providerReference: 'night-window.png',
    compositionNotes:
      'The ink-blue room at night: window structure behind, reflections crossing the extreme foreground like a second weather. Rain owns the far side of the glass and condensation the near side — between them, time stays visible even when nothing else moves. The distant lights are warm and far and never resolve into sources. Interior light stays scarce, so whatever glows in the midground has no competition.',
    invariant: 'the rainy ink-blue window atmosphere — reflective glass, condensation, and distant unresolved warm lights',
    relations: [],
  },
  {
    id: 'scene:forking-garden',
    kind: 'scene',
    name: 'Forking garden',
    description: 'A garden path that forks: bifurcating gravel, tangled poplars, a low full moon, distant lattice glow',
    accent: '#8fae7c',
    providerReference: 'forking-garden.png',
    compositionNotes:
      'The path arrives from the lower-right and forks in the left two-thirds of the frame — one bifurcation close and unmistakable, a second farther and half-suggested, so the garden implies more forks than it shows. Both branches must stay legible into depth; neither may die in shadow. Tangled poplars close the sky except where the low full moon hangs, large but never dominant; at the end of one branch — only one — a lattice of warm light waits. Gravel underfoot, elemental earth at the verges: a garden walked for a hundred years and kept by no one.',
    invariant: 'the bifurcating gravel path with both branches legible, tangled poplars, the low full moon, and the single distant lattice glow',
    relations: [],
  },

  // ── atmosphere — palette / weather / lighting study cards. Advisory,
  //    never identity. ───────────────────────────────────────────────────────
  {
    id: 'atmosphere:ink-blue-rain',
    kind: 'atmosphere',
    name: 'Ink-blue rain',
    description: 'An ink-blue rain card: palette, weather, and the way lamplight blooms in wet air',
    accent: '#7c93c4',
    providerReference: 'ink-blue-rain.png',
    compositionNotes:
      'Advisory, never sovereign: it tunes the world without touching what things are. The palette settles toward ink-blue with warmth confined to sources; rain arrives as texture and hush, not as event. Its one optical signature is the bloom — lamplight opening in wet air, halos soft and honest. Under this card, darks stay blue rather than black, and no surface dries.',
    invariant: 'the ink-blue palette, rain as texture, and warm lamplight blooming in wet air',
    relations: [
      { kind: 'pairs-with', target: 'scene:forking-garden' },
      { kind: 'pairs-with', target: 'scene:night-window' },
    ],
  },

  // ── technique — the illustration-medium identity, first-class (ratified
  //    decision 1). Pending its first study; until then its invariant keeps
  //    doing the work the hardcoded VISUAL MEDIUM phrase does today. ─────────
  {
    id: 'technique:tactile-illustration',
    kind: 'technique',
    name: 'Tactile illustration',
    description: 'The illustration-medium identity — woven into every composed pack',
    accent: '#b0a08c',
    compositionNotes:
      'The medium is a material, not a filter: visible brush and paper tooth in every surface, edges drawn by a hand rather than resolved by a lens. Color stays restrained and warm-biased; light behaves physically but lands as pigment. Anatomy and hands stay coherent under all of it — expressiveness is spent on light, fabric, and weather, never on distorting the figure. If a frame could be mistaken for a photograph, the technique has failed.',
    invariant:
      'expressive tactile editorial animation: visible brush and paper texture, restrained warm palette, coherent anatomy and hands, natural material detail, cinematic depth',
    relations: [],
  },
]
