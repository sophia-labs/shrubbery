/**
 * @shrubbery/tokens — TS surface.
 *
 * Backend-free. No stores, no auth, no lit. This module exports:
 *   1. the {skin, theme, stance, editor material} → root-attribute map (the sux ConfigValue.appliesAttribute
 *      pattern, made executable), and a tiny applier that stamps those attributes
 *      on a root element (documentElement by default);
 *   2. the documented Emporium purple ramp (exact hexes) + the named accent
 *      values, so Storybook + tests assert against constants rather than
 *      re-typing hexes.
 *
 * The CSS lives in ../css/tokens.css (the import the organism + Storybook pull).
 * This TS map is the SOLE programmatic applier — it does not read or write any
 * store; a host (organism / Storybook decorator) calls applySkinTheme() in
 * response to a chrome event or a sux ConfigValue selection.
 */

// ── Dimension value types (mirror the sux ConfigValue literalValue set) ───────

/**
 * dim-skin values.
 *
 * Garden, Emporium (the user-facing Sophia identity), 98, and Glass form the
 * global visual-identity cycle. Research and Greenhouse remain first-class,
 * app-owned skins on the same token axis, but are not part of that global
 * shared chrome control.
 */
export type Skin = 'garden' | 'emporium' | '98' | 'glass' | 'research' | 'greenhouse' | 'observatory'

export const VISUAL_IDENTITY_SKINS = ['garden', 'emporium', '98', 'glass'] as const
export type VisualIdentitySkin = (typeof VISUAL_IDENTITY_SKINS)[number]

export const SKIN_LABELS: Readonly<Record<Skin, string>> = {
  garden: 'Garden',
  emporium: 'Sophia',
  '98': '98',
  glass: 'Glass',
  research: 'Research',
  greenhouse: 'Greenhouse',
  observatory: 'Observatory',
}

export function isSkin(value: unknown): value is Skin {
  return typeof value === 'string' && value in SKIN_APPLICATIONS
}

export function isVisualIdentitySkin(value: unknown): value is VisualIdentitySkin {
  return typeof value === 'string'
    && (VISUAL_IDENTITY_SKINS as readonly string[]).includes(value)
}

/** Advance the global Garden → Sophia → 98 → Glass → Garden identity cycle. */
export function nextVisualIdentitySkin(value: Skin | string): VisualIdentitySkin {
  const index = (VISUAL_IDENTITY_SKINS as readonly string[]).indexOf(value)
  return index < 0
    ? 'garden'
    : VISUAL_IDENTITY_SKINS[(index + 1) % VISUAL_IDENTITY_SKINS.length]
}

/** dim-theme values. 'light' (default) | 'dark'. (orthogonal to skin) */
export type Theme = 'light' | 'dark'

/** Orthogonal editor material posture. Continuous is the unobtrusive default. */
export type EditorMaterial = 'continuous' | 'paper' | 'classic-word'

/** dim-stance values. Orthogonal posture/register axis. */
export type Stance = 'room' | 'bench' | 'constitution' | 'dispatch' | 'contested'

/**
 * The four ROOM postures `applyStance` may stamp on a root element.
 * `contested` is excluded by construction: it is a per-VALUE Law IV posture on
 * one Meaningful Object, never a whole-room posture — narrowing `applyStance`'s
 * parameter to this type means "stamp contested on `<html>`" does not compile.
 */
export type RoomPostureStance = Exclude<Stance, 'contested'>
export const ROOM_POSTURE_STANCES = ['room', 'bench', 'constitution', 'dispatch'] as const satisfies readonly RoomPostureStance[]

/** DisplayKind values. Pure render-value register axis. */
export type DisplayKindRegister = 'identity' | 'state' | 'metric' | 'prose' | 'reference' | 'testimony' | 'affordance'

/**
 * A single skin/theme value's DOM application, mirroring sux:ConfigValue:
 *   - literalValue       — the value id (e.g. 'emporium')
 *   - appliesAttribute   — the VERBATIM CSS/DOM hook string (documentation +
 *                          the selector this value lights up), exactly like the
 *                          sux:appliesAttribute literal carried in the graph.
 *   - attr / value       — the executable form: which attribute to set, to what.
 *                          `value === null` means REMOVE the attribute (the
 *                          "[data-skin] absent (removeAttribute)" sux convention
 *                          for the default value).
 */
export interface ConfigValueApplication {
  readonly literalValue: string
  readonly appliesAttribute: string
  readonly attr: string
  readonly value: string | null
}

// ── dim-skin — appliesAttribute map (matches GARDEN_DEFAULT dim-skin) ─────────

export const SKIN_APPLICATIONS: Readonly<Record<Skin, ConfigValueApplication>> = {
  // Garden is the default: it REMOVES data-skin (the :root + skin-garden defaults
  // already carry the Garden identity). Mirrors GARDEN_DEFAULT val-skin-garden's
  // appliesAttribute exactly.
  garden: {
    literalValue: 'garden',
    appliesAttribute: '[data-skin] absent (removeAttribute)',
    attr: 'data-skin',
    value: null,
  },
  // Emporium stamps [data-skin=emporium] — the selector skin-emporium.css lights.
  emporium: {
    literalValue: 'emporium',
    appliesAttribute: '[data-skin=emporium]',
    attr: 'data-skin',
    value: 'emporium',
  },
  // 98 stamps the classic desktop/window-system identity.
  '98': {
    literalValue: '98',
    appliesAttribute: '[data-skin=98]',
    attr: 'data-skin',
    value: '98',
  },
  // Glass stamps the luminous translucent desktop identity.
  glass: {
    literalValue: 'glass',
    appliesAttribute: '[data-skin=glass]',
    attr: 'data-skin',
    value: 'glass',
  },
  // Research stamps [data-skin=research] - the SRS scholar-desk skin.
  research: {
    literalValue: 'research',
    appliesAttribute: '[data-skin=research]',
    attr: 'data-skin',
    value: 'research',
  },
  // Greenhouse stamps [data-skin=greenhouse] - the sans Garden research workspace.
  greenhouse: {
    literalValue: 'greenhouse',
    appliesAttribute: '[data-skin=greenhouse]',
    attr: 'data-skin',
    value: 'greenhouse',
  },
  // Observatory stamps [data-skin=observatory] - the night-room dashboard skin.
  observatory: {
    literalValue: 'observatory',
    appliesAttribute: '[data-skin=observatory]',
    attr: 'data-skin',
    value: 'observatory',
  },
}

// ── dim-theme — appliesAttribute map (light/dark; system resolved by host) ────

export const THEME_APPLICATIONS: Readonly<Record<Theme, ConfigValueApplication>> = {
  light: {
    literalValue: 'light',
    appliesAttribute: '[data-theme=light]',
    attr: 'data-theme',
    value: 'light',
  },
  dark: {
    literalValue: 'dark',
    appliesAttribute: '[data-theme=dark]',
    attr: 'data-theme',
    value: 'dark',
  },
}

// ── editor material — continuous canvas / physical-page presentations ─────

export const EDITOR_MATERIAL_APPLICATIONS: Readonly<Record<EditorMaterial, ConfigValueApplication>> = {
  continuous: {
    literalValue: 'continuous',
    appliesAttribute: '[data-editor-material] absent (removeAttribute)',
    attr: 'data-editor-material',
    value: null,
  },
  paper: {
    literalValue: 'paper',
    appliesAttribute: '[data-editor-material=paper]',
    attr: 'data-editor-material',
    value: 'paper',
  },
  'classic-word': {
    literalValue: 'classic-word',
    appliesAttribute: '[data-editor-material=classic-word]',
    attr: 'data-editor-material',
    value: 'classic-word',
  },
}

// ── dim-stance — appliesAttribute map (orthogonal posture/register axis) ─────

export const STANCE_APPLICATIONS: Readonly<Record<Stance, ConfigValueApplication>> = {
  room: {
    literalValue: 'room',
    appliesAttribute: '[data-stance=room]',
    attr: 'data-stance',
    value: 'room',
  },
  bench: {
    literalValue: 'bench',
    appliesAttribute: '[data-stance=bench]',
    attr: 'data-stance',
    value: 'bench',
  },
  constitution: {
    literalValue: 'constitution',
    appliesAttribute: '[data-stance=constitution]',
    attr: 'data-stance',
    value: 'constitution',
  },
  dispatch: {
    literalValue: 'dispatch',
    appliesAttribute: '[data-stance=dispatch]',
    attr: 'data-stance',
    value: 'dispatch',
  },
  contested: {
    literalValue: 'contested',
    appliesAttribute: '[data-stance=contested]',
    attr: 'data-stance',
    value: 'contested',
  },
}

// ── dim-kind — appliesAttribute map (render-layer value registers) ───────────

export const KIND_APPLICATIONS: Readonly<Record<DisplayKindRegister, ConfigValueApplication>> = {
  identity: {
    literalValue: 'identity',
    appliesAttribute: '[data-kind=identity]',
    attr: 'data-kind',
    value: 'identity',
  },
  state: {
    literalValue: 'state',
    appliesAttribute: '[data-kind=state]',
    attr: 'data-kind',
    value: 'state',
  },
  metric: {
    literalValue: 'metric',
    appliesAttribute: '[data-kind=metric]',
    attr: 'data-kind',
    value: 'metric',
  },
  prose: {
    literalValue: 'prose',
    appliesAttribute: '[data-kind=prose]',
    attr: 'data-kind',
    value: 'prose',
  },
  reference: {
    literalValue: 'reference',
    appliesAttribute: '[data-kind=reference]',
    attr: 'data-kind',
    value: 'reference',
  },
  testimony: {
    literalValue: 'testimony',
    appliesAttribute: '[data-kind=testimony]',
    attr: 'data-kind',
    value: 'testimony',
  },
  affordance: {
    literalValue: 'affordance',
    appliesAttribute: '[data-kind=affordance]',
    attr: 'data-kind',
    value: 'affordance',
  },
}

// ── The applier — the SOLE programmatic stamp of skin/theme attributes ────────

/** Minimal element surface we touch (keeps this DOM-lib-free for typecheck). */
export interface AttrTarget {
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
}

function apply(target: AttrTarget, a: ConfigValueApplication): void {
  if (a.value === null) target.removeAttribute(a.attr)
  else target.setAttribute(a.attr, a.value)
}

/**
 * Stamp the {skin, theme} pair onto a root element.
 *
 * Defaults to document.documentElement (the <html> element), the same root
 * garden's stores set data-theme / data-skin on. Pass an explicit target in
 * tests or a Storybook decorator. Returns the applied attribute pairs (for
 * assertions / logging) — it does NOT read any store.
 */
export function applySkinTheme(
  opts: { skin: Skin; theme: Theme; target?: AttrTarget },
): { skin: ConfigValueApplication; theme: ConfigValueApplication } {
  const target =
    opts.target ??
    (typeof document !== 'undefined'
      ? (document.documentElement as unknown as AttrTarget)
      : undefined)
  const skin = SKIN_APPLICATIONS[opts.skin]
  const theme = THEME_APPLICATIONS[opts.theme]
  if (target) {
    apply(target, skin)
    apply(target, theme)
  }
  return { skin, theme }
}

/**
 * Stamp the DisplayKind register onto a kinded element (parallel to applyStance,
 * driven by KIND_APPLICATIONS). Unlike skin/theme/stance this targets the KINDED
 * ELEMENT itself (the `.mn-kind` span), not the document root — kind is a
 * per-value register, not a page posture — so `target` is required.
 */
export function applyKind(
  opts: { kind: DisplayKindRegister; target: AttrTarget },
): ConfigValueApplication {
  const kind = KIND_APPLICATIONS[opts.kind]
  apply(opts.target, kind)
  return kind
}

/** Stamp only the skin axis, preserving every other root dimension. */
export function applySkin(
  opts: { skin: Skin; target?: AttrTarget },
): ConfigValueApplication {
  const target =
    opts.target ??
    (typeof document !== 'undefined'
      ? (document.documentElement as unknown as AttrTarget)
      : undefined)
  const skin = SKIN_APPLICATIONS[opts.skin]
  if (target) apply(target, skin)
  return skin
}

/** Stamp only the light/dark theme axis, preserving the active skin. */
export function applyTheme(
  opts: { theme: Theme; target?: AttrTarget },
): ConfigValueApplication {
  const target =
    opts.target ??
    (typeof document !== 'undefined'
      ? (document.documentElement as unknown as AttrTarget)
      : undefined)
  const theme = THEME_APPLICATIONS[opts.theme]
  if (target) apply(target, theme)
  return theme
}

/**
 * Stamp the orthogonal stance axis onto a root element. Accepts only the four
 * ROOM postures — `contested` is a per-VALUE stance, never a room stance, so
 * `applyStance({stance:'contested'})` fails to compile (D-8).
 */
export function applyStance(
  opts: { stance: RoomPostureStance; target?: AttrTarget },
): ConfigValueApplication {
  const target =
    opts.target ??
    (typeof document !== 'undefined'
      ? (document.documentElement as unknown as AttrTarget)
      : undefined)
  const stance = STANCE_APPLICATIONS[opts.stance]
  if (target) apply(target, stance)
  return stance
}

/** Stamp the orthogonal editor-material preference onto a root element. */
export function applyEditorMaterial(
  opts: { material: EditorMaterial; target?: AttrTarget },
): ConfigValueApplication {
  const target =
    opts.target ??
    (typeof document !== 'undefined'
      ? (document.documentElement as unknown as AttrTarget)
      : undefined)
  const material = EDITOR_MATERIAL_APPLICATIONS[opts.material]
  if (target) apply(target, material)
  return material
}

// ── Documented Emporium purple ramp (exact hexes — Vera tunes these here) ─────

/**
 * The Emporium dark-purple reference ramp. These are the exact hexes in
 * css/reference.css (--mn-ref-purple-*). Exported so Storybook swatches + the
 * token tests reference the constants instead of re-typing values. The skin
 * ACCENT is purple-400 (#9472CE) — Vera's iter-4a pick; change a hex here AND in
 * reference.css together (the test asserts they agree).
 */
export const PURPLE_RAMP = {
  50: '#F5F3FB',
  100: '#E9E3F6',
  200: '#D2C4ED',
  300: '#B59FE0',
  400: '#9472CE',
  500: '#6D28D9',
  600: '#5B21B6',
  700: '#4C1D95',
  800: '#3B1577',
  900: '#2A0E57',
} as const

/** The named Emporium accent roles (light), for swatches + assertions. */
export const EMPORIUM_ACCENT = {
  /** accent (primary) = purple-400 #9472CE (Vera's iter-4a pick) */
  accent: PURPLE_RAMP[400],
  /** accent-strong = purple-700 (kept deep for legibility on headings/badges) */
  accentStrong: PURPLE_RAMP[700],
  /** rule-strong = purple-300 */
  ruleStrong: PURPLE_RAMP[300],
  /** dark accent (lightened for contrast) = purple-300 */
  accentDark: PURPLE_RAMP[300],
  /** purple-400 #9472CE RGB channel triple (drives interactive washes) */
  accentChannel: '148 114 206',
} as const

/** The deterministic Diatype-like sans family Emporium sets for chrome + display. */
export const EMPORIUM_FONT_SANS =
  "'Public Sans Variable', 'Public Sans', 'ABC Diatype', -apple-system, 'Helvetica Neue', sans-serif"

/** Canonical 98 system colors used by the classic desktop skin. */
export const NINETY_EIGHT_PALETTE = {
  desktop: '#008080',
  face: '#C0C0C0',
  highlight: '#FFFFFF',
  light: '#DFDFDF',
  shadow: '#808080',
  dark: '#000000',
  caption: '#000080',
  captionEnd: '#1084D0',
  selection: '#000080',
} as const

/** Deterministic compact sans stack in place of period-specific platform fonts. */
export const NINETY_EIGHT_FONT_SANS =
  "'Public Sans Variable', 'Public Sans', Arial, sans-serif"

/** Canonical Glass colors used by the translucent desktop skin. */
export const GLASS_PALETTE = {
  sky: '#3A92CF',
  skyDeep: '#174E86',
  teal: '#35C3D8',
  glow: '#B9F4FF',
  panel: '#EAF7FF',
  ink: '#102A43',
  darkPanel: '#142B45',
} as const

/** Crisp humanist sans stack for Glass chrome. */
export const GLASS_FONT_SANS =
  "'Public Sans Variable', 'Public Sans', -apple-system, 'Helvetica Neue', sans-serif"

/** The SRS/research scholar-desk accent roles (light), for swatches + assertions. */
export const RESEARCH_ACCENT = {
  /** accent (primary) = muted blue-lavender */
  accent: '#586f93',
  /** accent-strong = deeper research blue */
  accentStrong: '#324864',
  /** rule-strong = cool pane edge */
  ruleStrong: '#c7cedb',
  /** dark accent = lightened research blue */
  accentDark: '#a9bad8',
  /** #586f93 RGB channel triple (drives interactive washes) */
  accentChannel: '88 111 147',
} as const

/** The serif family token value Research sets for chrome + prose + display. */
export const RESEARCH_FONT_SERIF =
  "'Literata Variable', 'Literata', Georgia, 'Times New Roman', serif"

/** The Greenhouse sans-Garden research workspace accent roles (light). */
export const GREENHOUSE_ACCENT = {
  /** accent (primary) = botanical workspace green */
  accent: '#2f7d5f',
  /** accent-strong = deeper greenhouse green */
  accentStrong: '#1f553f',
  /** rule-strong = greenhouse glass edge */
  ruleStrong: '#adc6b9',
  /** dark accent = lightened greenhouse green */
  accentDark: '#88c9ac',
  /** #2f7d5f RGB channel triple (drives interactive washes) */
  accentChannel: '47 125 95',
} as const

/**
 * The Greenhouse stance-annunciator hues (light) — the master switch's lit chip.
 * The shell adds exactly two stance colors: Room wears the workspace accent; the
 * Constitution stance wears its own quiet violet. Change a hex here AND in
 * skin-greenhouse.css together (the token test asserts they agree). These are the
 * only stance hues the shell will ever carry (folio 02).
 */
export const GREENHOUSE_STANCE = {
  /** Room stance annunciator = the greenhouse accent (green identity). */
  roomInk: GREENHOUSE_ACCENT.accent,
  /** Constitution stance annunciator ink — quiet violet. */
  constitutionInk: '#6b5a8e',
  /** Constitution annunciator border — pale violet. */
  constitutionEdge: '#cec3e3',
  /** Constitution annunciator wash — near-white violet. */
  constitutionWash: '#f3eff9',
} as const

/**
 * The `contested` stance's skin-neutral annunciator triple (§6.6.3). Reuses
 * the RESERVED `--mn-ref-status-critical-*` wine swatch — a contest is a
 * healthy, expected outcome of concurrent authorship, not an error severity,
 * but it borrows the one hue already reserved for "beyond danger without
 * leaving the carmine family." Exported so the token test asserts these
 * constants agree with `reference.css`/`semantic.css`/`theme-dark.css`
 * instead of re-typing hexes (the `GREENHOUSE_STANCE` precedent). Vera tunes
 * the dark/edge/wash values; the light ink is the existing RESERVED wine and
 * does not move.
 */
export const CONTESTED_STANCE = {
  ink: '#880134',
  inkDark: '#e6a3ba',
  edgeLight: '#e8c6d2',
  edgeDark: '#5c2237',
  washLight: '#fbf1f4',
  washDark: '#2a1019',
} as const

/** The sans family token value Greenhouse sets for chrome, prose, and display. */
export const GREENHOUSE_FONT_SANS =
  "'Inter Variable', 'Inter', 'Public Sans Variable', 'Public Sans', 'Source Sans 3 Variable', 'Source Sans 3', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

/** The Garden (default) accent + font, for the contrast assertion. */
export const GARDEN_ACCENT = {
  /** accent (primary) = fern-600 */
  accent: '#376d57',
  /** fern-500 RGB channel triple */
  accentChannel: '79 134 107',
} as const

export const GARDEN_FONT_CHROME =
  "'Literata Variable', 'Literata', Georgia, 'Times New Roman', serif"

// ── The Observatory dataviz palette (machine-validated, B1 aesthetic pass) ────

/**
 * The Observatory chart palette's categorical hues — 5 fixed slots, one
 * validated swatch per theme. Exported so tests + any future palette
 * inspector assert against the SAME constants the CSS carries (reference.css
 * --mn-ref-chart-*, semantic.css/theme-dark.css --mn-chart-categorical-*).
 * Change a hex here AND in those files together (the token test asserts they
 * agree). Slot order is FIXED — color follows the entity, never rank.
 */
export const OBSERVATORY_CHART_CATEGORICAL = {
  azure: { light: '#0388a5', dark: '#028fad' },
  terracotta: { light: '#c34517', dark: '#d45c36' },
  violet: { light: '#794acb', dark: '#916cdf' },
  chartreuse: { light: '#798201', dark: '#848f03' },
  magenta: { light: '#a63794', dark: '#c158ae' },
} as const

/** The sequential ramp (one hue, azure, light→dark) — theme-invariant. */
export const OBSERVATORY_CHART_SEQUENTIAL_AZURE = {
  100: '#d6f0f9',
  200: '#9ddcf1',
  300: '#52c1e1',
  400: '#02a2c5',
  500: '#0388a5',
  600: '#016278',
  700: '#003f4e',
} as const

/** The diverging scale (azure cool pole / terracotta warm pole + neutral midpoint). */
export const OBSERVATORY_CHART_DIVERGING = {
  light: {
    coolFar: '#0088a5', coolMid: '#6abfd9', coolNear: '#d0e1e7',
    mid: '#eeeae2',
    warmNear: '#ebdad5', warmMid: '#e39d87', warmFar: '#c65029',
  },
  dark: {
    coolFar: '#0195b5', coolMid: '#00758e', coolNear: '#3b5158',
    mid: '#42473e',
    warmNear: '#5c4841', warmMid: '#99533d', warmFar: '#d0603d',
  },
} as const

/**
 * The RESERVED status quad (good/warning/serious/critical) — never a series
 * color; good/warning/serious reuse exact existing moss/ochre/carmine ramp
 * steps (matches theme-dark.css's own success/danger semantics), critical is
 * the one genuinely new swatch.
 */
export const OBSERVATORY_CHART_STATUS = {
  light: { good: '#2b6549', warning: '#f59e0b', serious: '#e11d48', critical: '#880134' },
  dark: { good: '#469c70', warning: '#f59e0b', serious: '#f43f5e', critical: '#b43c6b' },
} as const

/**
 * The Observatory (night-room dashboard) skin's accent roles. Unlike every
 * other skin, the BASELINE ([data-skin=observatory], no dark theme) is
 * already the dark-optimized azure swatch — the room has no daylight
 * register. `accentTrueNight` is the further-brightened accent the
 * [data-theme=dark][data-skin=observatory] composition uses.
 */
export const OBSERVATORY_ACCENT = {
  accent: OBSERVATORY_CHART_CATEGORICAL.azure.dark,
  accentHover: OBSERVATORY_CHART_SEQUENTIAL_AZURE[400],
  accentActive: OBSERVATORY_CHART_SEQUENTIAL_AZURE[300],
  accentChannel: '2 143 173',
  accentTrueNight: OBSERVATORY_CHART_SEQUENTIAL_AZURE[300],
  accentTrueNightChannel: '82 193 225',
} as const

// ── The z-layer contract (single source of truth for stacking order) ─────────

/** The z-layer contract. Values MUST match css/z-layers.css (the token test asserts they agree). */
export const Z_LAYERS = {
  deliveryShell: 700,
  wireOverlay: 800,
  dropdownBackdrop: 900,
  dropdown: 1000,
  popover: 1100,
  tooltip: 1200,
  modalBackdrop: 1300,
  modal: 1400,
  overlay: 1500,
  toast: 1600,
} as const
