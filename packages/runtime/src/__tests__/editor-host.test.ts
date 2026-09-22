/**
 * SE4 test (1/2) — PURE computeHostVars + R-FIXED-CB forbidden-prop guard.
 *
 * computeHostVars is the pure rect-math mirror of the host's positioning (the
 * live pixel positioning is browser-mode territory; happy-dom has no layout
 * engine so getBoundingClientRect → 0). This test exercises the REAL function
 * against REAL literal rects and asserts:
 *   - it writes EXACTLY the four float vars --editor-x/y/w/h relative to `.main`,
 *   - NONE of the containing-block-establishing props (transform/filter/
 *     clip-path/backdrop-filter/will-change/contain/perspective/mask) appear in
 *     its output keys NOR in the host element's static styles (R-FIXED-CB).
 *
 * NO MOCKS: computeHostVars is a pure function over real DOMRect-shaped values;
 * the host's styles are read from the REAL ShEditorHost.styles cssText.
 */

import { afterEach, describe, it, expect } from 'vitest'
import { computeHostVars, ShEditorHost } from '../editor-host.js'

const FORBIDDEN_CB_PROPS = [
  'transform',
  'filter',
  'clip-path',
  'backdrop-filter',
  'will-change',
  'contain',
  'perspective',
  'mask',
]

function hostDeclaration(cssText: string): string {
  const normalized = cssText.replace(/\/\*[\s\S]*?\*\//g, '').toLowerCase()
  const match = /:host\s*\{([^}]*)\}/.exec(normalized)
  expect(match).not.toBeNull()
  return match?.[1] ?? ''
}

afterEach(() => {
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('data-editor-material')
})

describe('computeHostVars — pure rect math (R-FIXED-CB)', () => {
  it('gives the editable ProseMirror root its required whitespace semantics', () => {
    expect(ShEditorHost.styles.cssText).toMatch(
      /\.editor-mount\s+\.ProseMirror\s*\{[^}]*white-space:\s*pre-wrap\s*;/,
    )
  })

  it('reflects both physical-page preferences without relying on :host-context', async () => {
    document.documentElement.dataset.editorMaterial = 'paper'
    const host = document.createElement('sh-editor-host') as ShEditorHost
    document.body.appendChild(host)
    expect(host.getAttribute('editor-material')).toBe('paper')
    expect(host.hasAttribute('data-editor-material')).toBe(false)
    expect(ShEditorHost.styles.cssText).toContain(":host([editor-material='paper'])")
    expect(ShEditorHost.styles.cssText).toContain(":host([editor-material='classic-word'])")
    expect(ShEditorHost.styles.cssText).not.toContain(':host-context([data-editor-material')

    document.documentElement.dataset.editorMaterial = 'classic-word'
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(host.getAttribute('editor-material')).toBe('classic-word')

    document.documentElement.removeAttribute('data-editor-material')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(host.hasAttribute('editor-material')).toBe(false)
  })

  it('writes EXACTLY the four float vars relative to .main', () => {
    const anchor = { left: 250, top: 80, width: 600, height: 420 }
    const main = { left: 50, top: 60 }
    const vars = computeHostVars(anchor, main)
    expect(vars).toEqual({
      '--editor-x': '200px', // 250 - 50
      '--editor-y': '20px', // 80 - 60
      '--editor-w': '600px',
      '--editor-h': '420px',
    })
    // EXACTLY four keys, nothing else.
    expect(Object.keys(vars).sort()).toEqual(['--editor-h', '--editor-w', '--editor-x', '--editor-y'])
  })

  it('handles a zero-origin .main (anchor coords pass through)', () => {
    const vars = computeHostVars({ left: 0, top: 0, width: 100, height: 100 }, { left: 0, top: 0 })
    expect(vars).toEqual({
      '--editor-x': '0px',
      '--editor-y': '0px',
      '--editor-w': '100px',
      '--editor-h': '100px',
    })
  })

  it('output keys contain NONE of the containing-block-establishing props', () => {
    const vars = computeHostVars({ left: 1, top: 2, width: 3, height: 4 }, { left: 0, top: 0 })
    const keysJoined = Object.keys(vars).join(' ').toLowerCase()
    for (const prop of FORBIDDEN_CB_PROPS) {
      expect(keysJoined).not.toContain(prop)
    }
  })

  it("the host element's static styles establish NO containing block (R-FIXED-CB)", () => {
    // The real Lit CSSResult cssText, narrowed to the actual :host declaration.
    // Nested editor rules may use transforms for local UI effects; only :host can
    // break fixed-position descendants by becoming the containing block.
    const cssText = hostDeclaration(ShEditorHost.styles.cssText)
    for (const prop of FORBIDDEN_CB_PROPS) {
      expect(cssText).not.toMatch(new RegExp(`(?:^|;)\\s*${prop}\\s*:`))
    }
    // It DOES position via the four float vars (proof it is the float host).
    expect(cssText).toContain('--editor-x')
    expect(cssText).toContain('--editor-y')
    expect(cssText).toContain('--editor-w')
    expect(cssText).toContain('--editor-h')
  })
})
