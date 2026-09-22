/**
 * Tokens — the design-token system rendered for review.
 *
 * The Palette story renders the PROPOSED Emporium dark-purple ramp + the live
 * accent/identity roles, reading them from the real tokens via getComputedStyle
 * AND from the exported constants — so Vera can review the purple RENDERED and
 * tune the hexes. Flip the Skin/Theme toolbar globals to see Garden, Emporium,
 * Research, and Greenhouse, light vs dark. NO mock token bag — every swatch resolves a live
 * --mn-* var.
 */
import { html } from 'lit'
import type { Meta, StoryObj } from '@storybook/web-components'
import { PURPLE_RAMP, EMPORIUM_ACCENT, RESEARCH_ACCENT, GREENHOUSE_ACCENT } from '@shrubbery/tokens'

const meta: Meta = {
  title: 'Tokens/Palette',
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj

/** A swatch reading a live CSS var (resolved by the cascade under the skin). */
function swatch(label: string, cssVar: string, sub?: string) {
  return html`
    <div style="display:flex;flex-direction:column;gap:4px;min-width:120px;">
      <div
        style="height:56px;border:1px solid var(--mn-color-border-default);
               border-radius:var(--mn-radius-surface);background:${cssVar};"
      ></div>
      <div style="font-size:12px;font-weight:600;">${label}</div>
      ${sub ? html`<div style="font-size:11px;color:var(--mn-color-text-tertiary);font-family:var(--mn-font-mono);">${sub}</div>` : ''}
    </div>
  `
}

/** A fixed-hex swatch (the documented ramp value, independent of the skin). */
function rampSwatch(step: string | number, hex: string) {
  return html`
    <div style="display:flex;flex-direction:column;gap:4px;min-width:96px;">
      <div style="height:48px;border:1px solid rgba(0,0,0,0.1);border-radius:4px;background:${hex};"></div>
      <div style="font-size:11px;font-weight:600;">purple-${step}</div>
      <div style="font-size:11px;color:var(--mn-color-text-tertiary);font-family:var(--mn-font-mono);">${hex}</div>
    </div>
  `
}

export const SemanticRoles: Story = {
  render: () => html`
    <div style="font-family:var(--mn-font-chrome);">
      <h2 style="margin:0 0 4px;">Semantic accent / identity roles (live under the active skin)</h2>
      <p style="margin:0 0 16px;color:var(--mn-color-text-secondary);font-size:13px;">
        Flip the <b>Skin</b> toolbar control: Garden = fern, Emporium = dark purple,
        Research = SRS blue ${RESEARCH_ACCENT.accent}, Greenhouse = sans Garden green
        ${GREENHOUSE_ACCENT.accent}. Flip <b>Theme</b> for light/dark.
        These read the live <code>--mn-*</code> vars.
      </p>
      <div style="display:flex;flex-wrap:wrap;gap:16px;">
        ${swatch('accent', 'var(--mn-color-accent)', 'primary action')}
        ${swatch('accent-hover', 'var(--mn-color-accent-hover)')}
        ${swatch('accent-active', 'var(--mn-color-accent-active)')}
        ${swatch('text-accent', 'var(--mn-color-text-accent)')}
        ${swatch('text-accent-strong', 'var(--mn-color-text-accent-strong)')}
        ${swatch('surface-accent', 'var(--mn-color-surface-accent)')}
        ${swatch('border-strong', 'var(--mn-color-border-strong)', 'rule-strong')}
        ${swatch('surface-base', 'var(--mn-color-surface-base)')}
        ${swatch('top-bar-bg', 'var(--mn-top-bar-bg)')}
      </div>
    </div>
  `,
}

export const EmporiumPurpleRamp: Story = {
  render: () => html`
    <div style="font-family:var(--mn-font-chrome);">
      <h2 style="margin:0 0 4px;">Emporium dark-purple ramp</h2>
      <p style="margin:0 0 16px;color:var(--mn-color-text-secondary);font-size:13px;">
        Tune the hexes in
        <code>packages/tokens/css/reference.css</code> (<code>--mn-ref-purple-*</code>).
        light accent = purple-400 ${EMPORIUM_ACCENT.accent} (Vera's pick) ·
        accent-strong = purple-700 ${EMPORIUM_ACCENT.accentStrong} ·
        rule-strong = purple-300 ${EMPORIUM_ACCENT.ruleStrong} ·
        dark accent = purple-300 ${EMPORIUM_ACCENT.accentDark}.
      </p>
      <div style="display:flex;flex-wrap:wrap;gap:12px;">
        ${Object.entries(PURPLE_RAMP).map(([step, hex]) => rampSwatch(step, hex))}
      </div>
    </div>
  `,
}
