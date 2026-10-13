/**
 * Mithras Flow → Shrubbery reference tokens (the ONE copy of Flow's values).
 *
 * The Mithras skin (css/skin-mithras.css) never types a Flow hex. It reads the
 * `--mn-ref-flow-*` tokens in css/flow-tokens.css, and that file is GENERATED
 * by this function from Flow's own stylesheet — the byte-pinned vendored copy
 * at apps/flow/vendor/flow/src/styles.css (VENDOR.md: fork commit + sha256).
 * The token test regenerates it from that source on every run and fails if
 * the committed file differs, so Flow's palette cannot drift silently from
 * the skin that imitates it.
 *
 *   node packages/tokens/scripts/generate-flow-tokens.mts
 *
 * Pure (no fs): the script and the test own the I/O.
 */

export interface FlowTokenProvenance {
  /** Repository-relative path of the stylesheet read. */
  readonly sourcePath: string
  /** Fork commit the vendored stylesheet was taken from (VENDOR.md). */
  readonly forkCommit: string
  /** sha256 of the stylesheet bytes. */
  readonly sha256: string
}

/** Flow's `:root` custom properties we lift, in declaration order. */
const FLOW_ROOT_VARS = ['ink', 'ink-soft', 'ink-faint', 'line', 'paper', 'paper-dim', 'warn'] as const

/** The shippable part of a font stack: every family except the GT faces. */
export const FLOW_UNSHIPPABLE_FAMILIES = ['GT Eesti', 'GT Pantheon'] as const

function required(match: RegExpMatchArray | null, what: string): string {
  if (!match?.[1]) throw new Error(`flow-tokens: could not find ${what} in Flow's styles.css`)
  return match[1].trim()
}

function block(css: string, selectorPattern: string, what: string): string {
  return required(css.match(new RegExp(`(?:^|\\n)${selectorPattern}\\s*\\{([^}]*)\\}`)), what)
}

function decl(body: string, prop: string, what: string): string {
  const escaped = prop.replace(/[-]/g, '\\-')
  return required(body.match(new RegExp(`(?:^|[;\\s])${escaped}\\s*:\\s*([^;]+);`)), what)
}

/** Drop the GT faces (licence unresolved, never shipped) from a font stack. */
export function shippableFontStack(stack: string): string {
  return stack
    .split(',')
    .map(part => part.trim())
    .filter(part => !FLOW_UNSHIPPABLE_FAMILIES.some(family => part.replace(/['"]/g, '') === family))
    .join(', ')
}

/** Extract the Flow values the skin needs from Flow's own stylesheet. */
export function extractFlowTokens(stylesCss: string): Readonly<Record<string, string>> {
  const root = block(stylesCss, ':root', ':root block')
  const tokens: Record<string, string> = {}
  for (const name of FLOW_ROOT_VARS) tokens[name] = decl(root, `--${name}`, `--${name}`)
  tokens['font'] = shippableFontStack(decl(root, 'font-family', ':root font-family'))
  tokens['font-display'] = shippableFontStack(decl(root, '--display', '--display'))
  tokens['weight-body'] = decl(root, 'font-weight', ':root font-weight')
  tokens['weight-strong'] = decl(block(stylesCss, 'b,\\s*strong', 'b, strong block'), 'font-weight', 'strong weight')
  // The one hard, zero-blur offset shadow Flow gives its floating controls.
  const controls = block(stylesCss, '\\.react-flow__controls-button', 'controls-button block')
  tokens['shadow-hard'] = decl(controls, 'box-shadow', 'controls shadow')
  tokens['control-edge-width'] = required(decl(controls, 'border', 'controls border').match(/^([\d.]+px)/), 'controls border width')
  // Flow's toolbar: the label voice (uppercase, tracked) and the bar's padding.
  const toolbar = block(stylesCss, '\\.toolbar', '.toolbar block')
  tokens['toolbar-padding'] = decl(toolbar, 'padding', 'toolbar padding')
  const toolbarButton = block(stylesCss, '\\.toolbar button', '.toolbar button block')
  tokens['label-size'] = decl(toolbarButton, 'font-size', 'toolbar label size')
  tokens['label-tracking'] = decl(toolbarButton, 'letter-spacing', 'toolbar label tracking')
  // Flow's selection focus: a solid ink outline, offset from the edge.
  tokens['focus-width'] = required(stylesCss.match(/outline:\s*(\d+px) solid var\(--ink\);\s*outline-offset:\s*\d+px/), 'focus width')
  tokens['focus-offset'] = required(stylesCss.match(/outline:\s*\d+px solid var\(--ink\);\s*outline-offset:\s*(\d+px)/), 'focus offset')
  // Flow's marquee selection wash: ink mixed at N% into transparency.
  tokens['selection-wash'] = required(stylesCss.match(/\.react-flow__selection\s*\{[^}]*color-mix\(in srgb, var\(--ink\) (\d+%)/), 'selection wash')
  return tokens
}

/** Render css/flow-tokens.css from Flow's stylesheet. Deterministic. */
export function renderFlowTokensCss(stylesCss: string, provenance: FlowTokenProvenance): string {
  const tokens = extractFlowTokens(stylesCss)
  const lines = Object.entries(tokens).map(([name, value]) => `  --mn-ref-flow-${name}: ${value};`)
  return [
    '/* ═══ REFERENCE: Mithras Flow (GENERATED — do not edit by hand) ══════════════',
    ' * Flow\'s own design values, lifted verbatim for skin-mithras.css. The skin',
    ' * reads ONLY these; it never types a Flow value itself.',
    ' *',
    ` *   source:  ${provenance.sourcePath}`,
    ` *   fork:    mithras-flow-fork @ ${provenance.forkCommit} (apps/flow/vendor/flow/VENDOR.md)`,
    ` *   sha256:  ${provenance.sha256}`,
    ' *',
    ' * Regenerate: node packages/tokens/scripts/generate-flow-tokens.mts',
    ' * The token test regenerates this from the source and fails on any drift.',
    ' * Font stacks drop GT Eesti / GT Pantheon: their licence is unresolved and',
    ' * Shrubbery\'s Flow build ships neither (apps/flow DIVERGENCE.md PIX-002), so',
    ' * the stack below is exactly what Flow itself renders on mithras.local.',
    ' * ──────────────────────────────────────────────────────────────────────────── */',
    '',
    ':root {',
    ...lines,
    '}',
    '',
  ].join('\n')
}

/** Repository-relative location of Flow's vendored stylesheet + its ledger. */
export const FLOW_STYLES_PATH = 'apps/flow/vendor/flow/src/styles.css'
export const FLOW_VENDOR_LEDGER_PATH = 'apps/flow/vendor/flow/VENDOR.md'

/**
 * Read the source + provenance through caller-supplied I/O (the script uses
 * node:fs + node:crypto; the test does the same) so this module stays pure.
 */
export function flowTokenSource(
  read: (repoRelativePath: string) => string,
  sha256: (text: string) => string,
): { stylesCss: string; provenance: FlowTokenProvenance } {
  const stylesCss = read(FLOW_STYLES_PATH)
  const ledger = read(FLOW_VENDOR_LEDGER_PATH)
  const forkCommit = required(ledger.match(/\*\*Commit\*\*:\s*`([0-9a-f]{7,40})`/), 'fork commit in VENDOR.md')
  return { stylesCss, provenance: { sourcePath: FLOW_STYLES_PATH, forkCommit, sha256: sha256(stylesCss) } }
}
