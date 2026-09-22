/**
 * happy-dom-globals.mts — install a REAL happy-dom DOM as the Node globals, as a
 * SIDE EFFECT, at module-eval time.
 *
 * This module MUST be the FIRST import in any standalone script that renders via
 * @shrubbery/runtime under plain Node/tsx. Why first: lit-html captures
 * `const d = document` at ITS module-eval time, so `document` must already be a
 * real DOM before lit-html is (transitively) imported. ESM evaluates imported
 * modules depth-first in source order, so importing this first guarantees the
 * globals are in place before the render-host's lit dependency evaluates.
 *
 * happy-dom is a REAL DOM implementation — allowed by the no-mock rule (the same
 * environment vitest uses for the integration test).
 */
import { Window } from 'happy-dom'

const win = new Window()
const g = globalThis as Record<string, unknown>
g.window = win
g.document = win.document
g.customElements = win.customElements

// Mirror the DOM classes Lit / the render host reference (navigator is a
// read-only global in Node, so it is intentionally left alone).
for (const key of [
  'HTMLElement',
  'Element',
  'Node',
  'Document',
  'DocumentFragment',
  'Comment',
  'Text',
  'Event',
  'CustomEvent',
  'ShadowRoot',
  'CSSStyleSheet',
  'NodeFilter',
] as const) {
  const v = (win as unknown as Record<string, unknown>)[key]
  if (v) g[key] = v
}

export {}
