/**
 * object-card-kind-parity.test.ts — guards `object-card-view-element.ts`'s
 * `kind.css` DUPLICATION against drift (WS1 §6.4, master spec §3 Slice 2).
 *
 * `.mn-kind[data-kind="…"]` markup does NOT light the global `kind.css` on
 * its own inside a shadow root — CSS selectors never cross a shadow
 * boundary, only inherited custom PROPERTY VALUES do — so the element
 * reproduces, token-driven, every kind it actually emits. Reads `kind.css`
 * from disk (the `stance-register-parity.test.ts` / `kind-register-parity.
 * test.ts` method) and asserts: for each kind the healthy card uses, every
 * `--mn-kind-*` custom property `kind.css` sets under that kind's selector is
 * also set, to the identical `var(...)` expression, inside the component's
 * own `static styles` text.
 *
 * SLICE HISTORY (object-card-view-element.ts's own header): Slice 2 shipped
 * six of kind.css's seven kinds — `identity`, `state`, `metric`, `prose`,
 * `reference` (record fields, §6.9) and `testimony` (the footer's
 * last-writer slot, and — Slice 5 — per-proposal bylines). Slice 5 adds the
 * seventh, `affordance` (the proposal action buttons: keep / compose /
 * inspect), completing the set.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ShObjectCardView } from '../object-card-view-element.js'

const KIND_CSS_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../tokens/css/kind.css')
const KIND_CSS = readFileSync(KIND_CSS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const COMPONENT_CSS = (ShObjectCardView.styles as { cssText: string }).cssText

const KINDS_THIS_CARD_USES = ['identity', 'state', 'metric', 'prose', 'reference', 'testimony', 'affordance'] as const

/** Every `--mn-kind-*: value` declaration inside kind.css's block for `[data-kind="{kind}"]` (bare or with a descendant selector). */
function kindDeclarations(css: string, kind: string): readonly (readonly [string, string])[] {
  const declarations: Array<readonly [string, string]> = []
  // Match every rule whose selector CONTAINS `[data-kind="{kind}"]` (bare or
  // as a descendant-selector prefix, e.g. `.mn-kind[data-kind="metric"] .mn-kind-value`).
  const ruleRegex = /([^{}]*\[data-kind="([a-z]+)"\][^{}]*)\{([^{}]*)\}/g
  for (const match of css.matchAll(ruleRegex)) {
    const [, , matchedKind, body] = match
    if (matchedKind !== kind) continue
    for (const decl of body.matchAll(/(--mn-kind-[a-z-]+)\s*:\s*([^;]+);/g)) {
      declarations.push([decl[1].trim(), decl[2].trim()])
    }
  }
  return declarations
}

describe('card.object kind.css parity — no drift between the global sheet and the shadow-scoped duplication', () => {
  it.each(KINDS_THIS_CARD_USES)('every --mn-kind-* declaration kind.css sets for [data-kind="%s"] is reproduced identically', (kind) => {
    const declarations = kindDeclarations(KIND_CSS, kind)
    expect(declarations.length).toBeGreaterThan(0)
    for (const [property, value] of declarations) {
      // The component's own stylesheet must declare the SAME property with
      // the SAME value (a `var(...)` expression, never a re-invented hex),
      // somewhere in its text — not necessarily inside an identical selector
      // shape (the component may attach it to a nested `.mn-kind-*` child
      // class exactly as kind.css itself does).
      const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const declRegex = new RegExp(`${escaped}\\s*:\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*;`)
      expect(COMPONENT_CSS, `${property}: ${value} (kind="${kind}") missing or drifted in the component's static styles`).toMatch(
        declRegex,
      )
    }
  })

  it('reproduces the bare .mn-kind base rule (color: var(--mn-kind-text))', () => {
    expect(COMPONENT_CSS).toMatch(/\.mn-kind\s*\{[^}]*color:\s*var\(--mn-kind-text\)/)
  })
})
