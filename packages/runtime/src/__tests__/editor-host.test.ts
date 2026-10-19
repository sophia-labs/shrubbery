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
  document.documentElement.removeAttribute('data-skin')
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

  it('reflects zen mode onto the host, which then hides its toolbar', async () => {
    const host = document.createElement('sh-editor-host') as ShEditorHost
    document.body.appendChild(host)
    expect(ShEditorHost.styles.cssText).toMatch(/:host\(\[zen\]\) mn-editor-toolbar\s*\{\s*display: none/)
    expect(host.hasAttribute('zen')).toBe(false)
    document.documentElement.setAttribute('data-zen', '')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(host.hasAttribute('zen')).toBe(true)
    document.documentElement.removeAttribute('data-zen')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(host.hasAttribute('zen')).toBe(false)
  })

  it('reflects the ambient skin onto the host, in both directions, so a skin can re-scope the page', async () => {
    document.documentElement.dataset.skin = 'hotdog-stand'
    const host = document.createElement('sh-editor-host') as ShEditorHost
    document.body.appendChild(host)
    expect(host.getAttribute('editor-skin')).toBe('hotdog-stand')

    document.documentElement.dataset.skin = '98'
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(host.getAttribute('editor-skin')).toBe('98')

    document.documentElement.removeAttribute('data-skin')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(host.hasAttribute('editor-skin')).toBe(false)
    // Never data-skin: a host that carried it would match the skin's own blocks and re-declare the palette there.
    expect(host.hasAttribute('data-skin')).toBe(false)
  })

  it('re-scopes the continuous page for Hotdog Stand the way the paper materials do: every role from the sheet roles', () => {
    const css = ShEditorHost.styles.cssText.replace(/\s+/g, ' ')
    const open = ".editor-mount .ProseMirror {"
    const selector = `:host([editor-skin='hotdog-stand']:not([editor-material])) ${open}`
    expect(css).toContain(selector)
    const block = css.slice(css.indexOf(selector) + selector.length, css.indexOf('}', css.indexOf(selector)))
    // The descendants of the page read the shared roles (title, link, muted, code, caption, hover, rules).
    // Without this block a black heading sits over white paragraphs on a red page; with it, one scope.
    const MAP: ReadonlyArray<readonly [string, string]> = [
      ['--mn-color-text-primary', '--mn-editor-sheet-ink'],
      ['--mn-color-text-secondary', '--mn-editor-sheet-secondary'],
      ['--mn-color-text-tertiary', '--mn-editor-sheet-tertiary'],
      ['--mn-color-text-muted', '--mn-editor-sheet-tertiary'],
      ['--mn-color-text-quiet', '--mn-editor-sheet-tertiary'],
      ['--mn-color-text-title', '--mn-editor-sheet-title'],
      ['--mn-color-text-link', '--mn-editor-sheet-link'],
      ['--mn-color-text-link-hover', '--mn-editor-sheet-link-hover'],
      ['--mn-color-text-accent', '--mn-editor-sheet-accent'],
      ['--mn-color-text-accent-strong', '--mn-editor-sheet-accent'],
      ['--mn-color-surface-base', '--mn-editor-sheet-surface'],
      ['--mn-color-surface-editor', '--mn-editor-sheet-surface'],
      ['--mn-color-surface-raised', '--mn-editor-sheet-raised'],
      ['--mn-color-surface-elevated', '--mn-editor-sheet-raised'],
      ['--mn-color-surface-overlay', '--mn-editor-sheet-raised'],
      ['--mn-color-surface-subtle', '--mn-editor-sheet-sunken'],
      ['--mn-color-surface-warm', '--mn-editor-sheet-sunken'],
      ['--mn-color-surface-sunken', '--mn-editor-sheet-sunken'],
      ['--mn-color-surface-hover', '--mn-editor-sheet-hover'],
      ['--mn-color-surface-accent', '--mn-editor-sheet-wash'],
      ['--mn-color-surface-accent-subtle', '--mn-editor-sheet-wash'],
      ['--mn-color-surface-accent-strong', '--mn-editor-sheet-wash'],
      ['--mn-color-border-subtle', '--mn-editor-sheet-rule'],
      ['--mn-color-border-default', '--mn-editor-sheet-rule'],
      ['--mn-color-border-accent', '--mn-editor-sheet-accent'],
      ['--mn-color-accent', '--mn-editor-sheet-accent'],
    ]
    for (const [role, sheetRole] of MAP) {
      expect(block, role).toContain(`${role}: var(${sheetRole})`)
    }
    // Links carry no colour rule anywhere else (the browser's own blue is 4:1 on red and 1.9:1 on maroon): inside
    // the page they take the sheet's link role, underlined, and the hover role.
    expect(css).toContain(':host([editor-skin=\'hotdog-stand\']:not([editor-material])) .editor-mount .ProseMirror a { color: var(--mn-editor-sheet-link); text-decoration: underline; }')
    expect(css).toContain(':host([editor-skin=\'hotdog-stand\']:not([editor-material])) .editor-mount .ProseMirror a:hover { color: var(--mn-editor-sheet-link-hover); }')
    // The physical-page materials keep their own block (nothing was weakened), and the new block never reaches them.
    expect(css).toContain(":host([editor-material='paper']) .editor-mount .ProseMirror")
    expect(selector).toContain(':not([editor-material])')
  })

  it('keeps the yellow desk around the Hotdog Stand page at phone widths too (Vera: "at every width")', () => {
    // Every other skin's page goes edge to edge at 760px and below (width 100%, no margin, no frame). Hotdog
    // Stand's page is a Window on the yellow desk: below 760px it keeps a gutter (8px at the sides and the top, 16px
    // at the foot, for the frame's offset shadow) and the frame. The rule is keyed to the skin's own host attribute,
    // so no other skin's phone layout moves.
    const css = ShEditorHost.styles.cssText.replace(/\s+/g, ' ')
    const media = '@media (max-width: 760px) { :host([editor-skin=\'hotdog-stand\']:not([editor-material])) .editor-mount .ProseMirror {'
    expect(css, 'a phone-width block for the Hotdog Stand page').toContain(media)
    const block = css.slice(css.indexOf(media) + media.length, css.indexOf('}', css.indexOf(media)))
    expect(block).toContain('width: calc(100% - 16px);')
    expect(block).toContain('min-height: calc(100% - 24px);')
    expect(block).toContain('margin: 8px auto 16px;')
    expect(block).toContain('border: var(--mn-editor-sheet-border);')
    expect(block).toContain('box-shadow: var(--mn-editor-sheet-shadow);')
    // Nothing else moved: the shared phone rule (page edge to edge) is still there for every other skin.
    const shared = css.slice(css.indexOf('@media (max-width: 760px) { .editor-mount::before'))
    expect(shared).toContain('.editor-mount .ProseMirror { width: 100%; min-height: 100%; margin: 0;')
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
