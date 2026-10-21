/**
 * The whiteboard in Sophia's clothes (Vera, 2026-10-21: "unified sophia styling everywhere like the workflow canvas
 * does"). Two things live here:
 *
 *  1. `WHITEBOARD_THEME_CSS`: Excalidraw styles itself from custom properties on `.excalidraw` (light) and
 *     `.excalidraw.theme--dark` (dark). We re-point every one of them at a `--mn-*` token, so the toolbar, menus,
 *     properties panel, colour picker, popups, dialogs and toasts take the chrome font, the Sophia surfaces and
 *     borders and the Sophia accent instead of Excalidraw purple. The tokens already follow the app's theme and skin
 *     (they inherit into the shadow root), so the dark theme needs no second table here. The canvas itself is
 *     Excalidraw's: in dark mode it is inverted by a filter (`--theme-filter`), which is why shape colours below are
 *     the LIGHT Sophia values. Fallbacks after each token are the light Sophia values, for a host without tokens.
 *  2. `WHITEBOARD_DEFAULTS`: what a new element looks like when a person draws it. The agent's drawing tool
 *     (gardend `whiteboard/scene.rs`) writes the same values, so a board reads as one hand.
 */

/** Excalidraw's built-in font ids (`FONT_FAMILY` in the pinned build). */
export const WB_FONT = { Virgil: 1, Helvetica: 2, Cascadia: 3, Excalifont: 5, Nunito: 6, 'Lilita One': 7, 'Comic Shanns': 8, 'Liberation Sans': 9 } as const

/** Sophia ink (parchment-900), light value. */
export const WB_INK = '#1d1c19'

/** appState `currentItem*`: the person's defaults for NEW elements. Existing elements are never touched. */
export const WHITEBOARD_DEFAULTS = {
  currentItemStrokeColor: WB_INK,
  currentItemBackgroundColor: 'transparent',
  currentItemFillStyle: 'solid',
  currentItemStrokeWidth: 1,
  currentItemStrokeStyle: 'solid',
  currentItemRoughness: 0,
  currentItemOpacity: 100,
  currentItemFontFamily: WB_FONT.Nunito,
  currentItemFontSize: 20,
  currentItemTextAlign: 'left',
  currentItemRoundness: 'round',
  currentItemArrowType: 'elbow',
  currentItemStartArrowhead: null,
  currentItemEndArrowhead: 'arrow',
} as const

export const WHITEBOARD_THEME_CSS = `
.excalidraw, .excalidraw.theme--dark {
  --ui-font: var(--mn-font-chrome, 'Literata Variable', Georgia, serif);

  /* Surfaces: islands (toolbar, panels) are raised; popups and menus float above them. */
  --island-bg-color: var(--mn-color-surface-raised, #fffefa);
  --island-bg-color-alt: var(--mn-color-surface-subtle, #f7f5f0);
  --popup-bg-color: var(--mn-color-surface-elevated, #fffefa);
  --popup-secondary-bg-color: var(--mn-color-surface-sunken, #eeeae2);
  --popup-text-color: var(--mn-color-text-primary, #1d1c19);
  --popup-text-inverted-color: var(--mn-color-text-inverse, #fbfaf6);
  --sidebar-bg-color: var(--mn-color-surface-raised, #fffefa);
  --default-bg-color: var(--mn-color-surface-canvas, #fffefa);
  --overlay-bg-color: var(--mn-color-backdrop, rgba(24, 29, 24, 0.26));
  --mobile-action-button-bg: var(--mn-color-surface-raised, #fffefa);

  /* Text and icons. */
  --text-primary-color: var(--mn-color-text-primary, #1d1c19);
  --color-on-surface: var(--mn-color-text-primary, #1d1c19);
  --icon-fill-color: var(--mn-color-text-primary, #1d1c19);
  --keybinding-color: var(--mn-color-text-tertiary, #635e57);
  --input-label-color: var(--mn-color-text-secondary, #5a564f);
  --color-gray-60: var(--mn-color-text-tertiary, #635e57);
  --link-color: var(--mn-color-text-link, #4338ca);
  --link-color-hover: var(--mn-color-text-link-hover, #312e81);
  --link-color-active: var(--mn-color-text-link-hover, #312e81);

  /* Inputs, borders, hover and pressed washes. */
  --input-bg-color: var(--mn-color-surface-canvas, #fffefa);
  --input-border-color: var(--mn-color-border-default, #dfdad0);
  --input-hover-bg-color: var(--mn-color-surface-hover, rgba(30, 69, 48, 0.055));
  --default-border-color: var(--mn-color-border-default, #dfdad0);
  --dialog-border-color: var(--mn-color-border-default, #dfdad0);
  --sidebar-border-color: var(--mn-color-border-default, #dfdad0);
  --avatar-border-color: var(--mn-color-border-default, #dfdad0);
  --color-outline: var(--mn-color-border-strong, #cbc5ba);
  --button-hover-bg: var(--mn-color-surface-hover, rgba(30, 69, 48, 0.055));
  --button-active-bg: var(--mn-color-surface-accent, #eef6f0);
  --button-active-border: var(--mn-color-border-accent, #326f4c);
  --button-gray-1: var(--mn-color-surface-active, rgba(30, 69, 48, 0.1));
  --button-gray-2: var(--mn-color-border-default, #dfdad0);
  --button-gray-3: var(--mn-color-border-strong, #cbc5ba);
  --color-surface-high: var(--mn-color-surface-hover, rgba(30, 69, 48, 0.055));
  --color-surface-mid: var(--mn-color-surface-subtle, #f7f5f0);
  --color-surface-low: var(--mn-color-surface-sunken, #eeeae2);
  --color-surface-lowest: var(--mn-color-surface-raised, #fffefa);
  --color-border-outline: var(--mn-color-border-strong, #cbc5ba);
  --color-border-outline-variant: var(--mn-color-border-default, #dfdad0);
  --scrollbar-thumb: var(--mn-color-border-strong, #cbc5ba);
  --scrollbar-thumb-hover: var(--mn-color-text-tertiary, #635e57);

  /* The accent. Excalidraw's brand purple becomes Sophia's accent everywhere it is used:
     active tool, selection, focus, sliders, primary buttons. */
  --color-primary: var(--mn-color-accent, #326f4c);
  --color-primary-darker: var(--mn-color-accent-hover, #265a3d);
  --color-primary-darkest: var(--mn-color-accent-active, #1e4530);
  --color-primary-hover: var(--mn-color-accent-hover, #265a3d);
  --color-primary-light: var(--mn-color-surface-accent, #eef6f0);
  --color-primary-light-darker: var(--mn-color-surface-accent-strong, #dbecde);
  --color-selection: var(--mn-color-accent, #326f4c);
  --color-brand-hover: var(--mn-color-accent-hover, #265a3d);
  --color-brand-active: var(--mn-color-accent-active, #1e4530);
  --color-on-primary-container: var(--mn-color-text-accent-strong, #265a3d);
  --color-surface-primary-container: var(--mn-color-surface-accent-strong, #dbecde);
  --color-icon-white: var(--mn-color-text-on-accent, #fbfaf6);
  --color-promo: var(--mn-color-accent, #326f4c);
  --color-logo-icon: var(--mn-color-accent, #326f4c);
  --color-logo-text: var(--mn-color-text-title, #11110f);
  --select-highlight-color: var(--mn-color-accent, #326f4c);
  --focus-highlight-color: color-mix(in srgb, var(--mn-color-accent, #326f4c) 40%, transparent);
  --color-slider-track: var(--mn-color-surface-accent-strong, #dbecde);
  --color-slider-thumb: var(--mn-color-accent, #326f4c);
  --button-special-active-bg-color: var(--mn-color-surface-accent, #eef6f0);
  --icon-green-fill-color: var(--mn-color-text-success, #469c70);

  /* Status colours. */
  --color-danger: var(--mn-color-danger, #be123c);
  --color-danger-dark: var(--mn-color-danger-border, #fecdd3);
  --color-danger-darker: var(--mn-color-danger-strong, #9f1239);
  --color-danger-darkest: var(--mn-color-danger-strong, #9f1239);
  --color-danger-text: var(--mn-color-text-danger, #be123c);
  --color-danger-background: var(--mn-color-danger-surface, #fff1f2);
  --color-danger-icon-background: var(--mn-color-danger-border, #fecdd3);
  --color-danger-color: var(--mn-color-text-danger, #be123c);
  --color-danger-icon-color: var(--mn-color-text-danger, #be123c);
  --button-destructive-bg-color: var(--mn-color-danger-surface, #fff1f2);
  --button-destructive-color: var(--mn-color-text-danger, #be123c);
  --color-warning: var(--mn-color-warning-surface, #fffbeb);
  --color-warning-dark: var(--mn-color-warning-border, #fde68a);
  --color-warning-darker: var(--mn-color-warning, #d97706);
  --color-warning-darkest: var(--mn-color-warning-strong, #b45309);
  --color-warning-background: var(--mn-color-warning-surface, #fffbeb);
  --color-warning-icon-background: var(--mn-color-warning-border, #fde68a);
  --color-warning-color: var(--mn-color-text-primary, #1d1c19);
  --color-warning-icon-color: var(--mn-color-warning-strong, #b45309);
  --color-text-warning: var(--mn-color-text-primary, #1d1c19);
  --color-success: var(--mn-color-success-surface, #eff8f3);
  --color-success-darker: var(--mn-color-success-border, #b6dfc8);
  --color-success-darkest: var(--mn-color-success-border, #b6dfc8);
  --color-success-text: var(--mn-color-text-success, #469c70);
  --color-success-contrast: var(--mn-color-success, #469c70);
  --color-success-contrast-hover: var(--mn-color-success-strong, #2f7a55);
  --color-success-contrast-active: var(--mn-color-success-strong, #2f7a55);
  --color-badge: var(--mn-color-text-success, #469c70);
  --background-color-badge: var(--mn-color-success-surface, #eff8f3);

  /* Shape of the chrome: small radii and the soft Sophia shadows, as the workflow canvas has. */
  --border-radius-md: var(--mn-radius-default, 4px);
  --border-radius-lg: var(--mn-radius-control, 6px);
  --shadow-island: var(--mn-shadow-sm, 0 1px 2px rgba(30, 27, 22, 0.055));
  --shadow-island-stronger: var(--mn-shadow-md, 0 8px 24px rgba(30, 27, 22, 0.075));
  --modal-shadow: var(--mn-shadow-modal, 0 28px 72px rgba(30, 27, 22, 0.15));
  --sidebar-shadow: var(--mn-shadow-lg, 0 18px 54px rgba(30, 27, 22, 0.12));
  --library-dropdown-shadow: var(--mn-shadow-md, 0 8px 24px rgba(30, 27, 22, 0.075));
}

/* The canvas is transparent, so the pane's Sophia surface shows through. */
.excalidraw, .excalidraw.theme--dark { background: transparent; }
.excalidraw .Island, .excalidraw .popover, .excalidraw .Modal__content, .excalidraw .color-picker,
.excalidraw .dropdown-menu .dropdown-menu-container, .excalidraw .context-menu, .excalidraw .Sidebar {
  border: 1px solid var(--mn-color-border-subtle, rgba(64, 61, 56, 0.11));
}
.excalidraw .divider, .excalidraw .context-menu-item-separator { background-color: var(--mn-color-border-subtle, rgba(64, 61, 56, 0.11)); border-color: var(--mn-color-border-subtle, rgba(64, 61, 56, 0.11)); }
.excalidraw :is(button, input:not(.color-picker-input), select) { font-family: inherit; }
.excalidraw .Toast { background-color: var(--mn-color-surface-overlay, #30352d); color: var(--mn-color-text-primary, #e6e8e2); border: 1px solid var(--mn-color-border-default, #dfdad0); box-shadow: var(--mn-shadow-md, none); border-radius: var(--mn-radius-control, 6px); }
.excalidraw .Toast .Toast__message, .excalidraw .Toast .close svg { color: var(--mn-color-text-primary, #1d1c19); }

/* Nothing in Sophia sends a person to excalidraw.com, GitHub, Discord or a hosted library. */
.excalidraw .library-menu-browse-button,
.excalidraw .HelpDialog__header,
.excalidraw .library-menu-items__no-items__hint,
.excalidraw .welcome-screen-decor-hint,
.excalidraw .excalidraw-plus-promo,
.excalidraw a[href^="https://libraries.excalidraw.com"],
.excalidraw a[href^="https://plus.excalidraw.com"],
.excalidraw a[href^="https://github.com"],
.excalidraw a[href^="https://discord.gg"],
.excalidraw a[href^="https://docs.excalidraw.com"],
.excalidraw a[href^="http://docs.excalidraw.com"] { display: none !important; }
`

// --- the colour picker's palette -------------------------------------------------------------------------------

/** One Sophia reference ramp step: the `--mn-ref-*` token, and its light value as the fallback. */
type Step = readonly [token: string, fallback: string]
const s = (token: string, fallback: string): Step => [token, fallback]

/**
 * Excalidraw's picker shows open-color families, five shades each (indexes 0..4: a wash, a fill, a mid, a stroke,
 * a deep). Each family becomes a Sophia ramp from `reference.css`; hues Sophia has no ramp for (pink, orange,
 * bronze, gray) borrow the nearest neighbours so the grid keeps its shape.
 */
const FAMILIES: Record<string, readonly Step[]> = {
  gray: [s('ink-950', '#f6f7f2'), s('ink-800', '#d8dad3'), s('ink-600', '#a2a79d'), s('ink-500', '#767d71'), s('ink-400', '#555b50')],
  red: [s('carmine-50', '#fff1f2'), s('carmine-200', '#fecdd3'), s('carmine-400', '#fb7185'), s('carmine-500', '#f43f5e'), s('carmine-700', '#be123c')],
  pink: [s('carmine-50', '#fff1f2'), s('carmine-100', '#ffe4e6'), s('carmine-300', '#fda4af'), s('carmine-400', '#fb7185'), s('carmine-600', '#e11d48')],
  grape: [s('purple-50', '#f5f3fb'), s('purple-200', '#d2c4ed'), s('purple-400', '#9472ce'), s('purple-500', '#6d28d9'), s('purple-600', '#5b21b6')],
  violet: [s('indigo-50', '#eef2ff'), s('indigo-200', '#c7d2fe'), s('indigo-400', '#818cf8'), s('indigo-500', '#6366f1'), s('indigo-600', '#4f46e5')],
  blue: [s('cobalt-100', '#dae8f4'), s('cobalt-200', '#b6d0e8'), s('cobalt-300', '#8fb5d8'), s('cobalt-400', '#5a8cc0'), s('cobalt-500', '#1a5fa3')],
  cyan: [s('azure-100', '#d6f0f9'), s('azure-200', '#9ddcf1'), s('azure-300', '#52c1e1'), s('azure-400', '#02a2c5'), s('azure-500', '#0388a5')],
  teal: [s('moss-50', '#eff8f3'), s('moss-200', '#aedac4'), s('moss-300', '#85c5a6'), s('moss-500', '#469c70'), s('moss-600', '#36815c')],
  green: [s('fern-50', '#eef6f0'), s('fern-200', '#bcdac3'), s('fern-400', '#6da27c'), s('fern-500', '#4a8860'), s('fern-600', '#326f4c')],
  yellow: [s('ochre-50', '#fffbeb'), s('ochre-200', '#fde68a'), s('ochre-300', '#fcd34d'), s('ochre-400', '#fbbf24'), s('ochre-600', '#d97706')],
  orange: [s('ochre-100', '#fef3c7'), s('ochre-300', '#fcd34d'), s('ochre-500', '#f59e0b'), s('ochre-600', '#d97706'), s('ochre-700', '#b45309')],
  bronze: [s('parchment-100', '#eeeae2'), s('parchment-300', '#cbc5ba'), s('parchment-400', '#9d978d'), s('parchment-500', '#777269'), s('parchment-600', '#5a564f')],
}

interface ExcalidrawCommon {
  COLOR_PALETTE: Record<string, string | string[]>
  DEFAULT_ELEMENT_STROKE_PICKS: string[]
  DEFAULT_ELEMENT_BACKGROUND_PICKS: string[]
  BUCKET_FILL_BACKGROUND_PICKS?: string[]
  DEFAULT_ELEMENT_STROKE_COLOR_PALETTE?: Record<string, string | string[]>
  DEFAULT_ELEMENT_BACKGROUND_COLOR_PALETTE?: Record<string, string | string[]>
}

let paletteApplied = false

/**
 * Re-colour Excalidraw's picker in place with Sophia's ramps. Excalidraw builds its grids and top picks from one
 * palette object and arrays that share its shade arrays, so the shades are rewritten where they sit and the picks
 * are rebuilt. Idempotent. A build that no longer matches this shape is left as it is (the picker keeps working).
 */
export function applySophiaPalette(common: unknown, tokenValue: (token: string) => string = () => ''): void {
  if (paletteApplied) return
  const c = common as Partial<ExcalidrawCommon>
  const pal = c.COLOR_PALETTE
  if (!pal || !c.DEFAULT_ELEMENT_STROKE_PICKS || !c.DEFAULT_ELEMENT_BACKGROUND_PICKS) return
  const hex = ([token, fallback]: Step): string => (tokenValue(`--mn-ref-${token}`) || fallback).toLowerCase()
  for (const [family, steps] of Object.entries(FAMILIES)) {
    const shades = pal[family]
    if (!Array.isArray(shades) || shades.length !== steps.length) return
    steps.forEach((step, i) => { shades[i] = hex(step) })
  }
  const ink = tokenValue('--mn-ref-parchment-900') || WB_INK
  pal.black = ink
  for (const grid of [c.DEFAULT_ELEMENT_STROKE_COLOR_PALETTE, c.DEFAULT_ELEMENT_BACKGROUND_COLOR_PALETTE]) if (grid && 'black' in grid) grid.black = ink
  const pick = (family: string, i: number): string => (pal[family] as string[])[i]!
  const strokes = [ink, pick('red', 4), pick('green', 4), pick('blue', 4), pick('yellow', 4)]
  const fills = [pal.transparent as string, pick('red', 1), pick('green', 1), pick('blue', 1), pick('yellow', 1)]
  strokes.forEach((v, i) => { c.DEFAULT_ELEMENT_STROKE_PICKS![i] = v })
  fills.forEach((v, i) => { c.DEFAULT_ELEMENT_BACKGROUND_PICKS![i] = v })
  c.BUCKET_FILL_BACKGROUND_PICKS?.forEach((_, i) => { if (i > 0) c.BUCKET_FILL_BACKGROUND_PICKS![i] = fills[i]! })
  paletteApplied = true
}
