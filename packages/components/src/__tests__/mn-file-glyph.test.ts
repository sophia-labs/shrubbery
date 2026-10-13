/**
 * REAL mn-file-glyph test (review V4 / P1.12, design §4). NO MOCKS: the real
 * custom element, rendered in happy-dom, at all four sizes.
 *
 * The glyph is the ONE picture of a file and of a folder: the grid's folded-corner
 * paper with a type caption, and a folder, drawn at 16, 32, 64 and 96 px by the
 * tree, the list and the canvas. Strokes are `--mn-color-border-strong` at rest
 * and `--mn-color-text-accent` when selected: accent means selection, never
 * decoration. It reads tokens only, so every skin draws it without being told.
 */
import { describe, expect, it } from 'vitest'
import '../mn-file-glyph.js'
import { GLYPH_SIZES, fileGlyphGeometry, glyphCaption, snapGlyphSize, type MnFileGlyph } from '../mn-file-glyph.js'

async function mount(props: Partial<Pick<MnFileGlyph, 'kind' | 'type' | 'size' | 'selected' | 'label'>> = {}): Promise<MnFileGlyph> {
  const el = document.createElement('mn-file-glyph') as MnFileGlyph
  Object.assign(el, props)
  document.body.append(el)
  await el.updateComplete
  return el
}

const svg = (el: MnFileGlyph) => el.shadowRoot!.querySelector('svg')!
const art = (el: MnFileGlyph) => el.shadowRoot!.querySelector('.art')!
const cssText = (el: MnFileGlyph) => {
  const styles = (el.constructor as { styles?: unknown }).styles
  return [styles].flat().map(s => (s as { cssText?: string }).cssText ?? '').join('\n')
}

describe('mn-file-glyph: four sizes, one drawing', () => {
  it('is a registered custom element offering exactly the four sizes', () => {
    expect(window.customElements.get('mn-file-glyph')).toBeDefined()
    expect(GLYPH_SIZES).toEqual([16, 32, 64, 96])
  })

  for (const size of GLYPH_SIZES) {
    for (const kind of ['file', 'folder'] as const) {
      it(`draws a ${kind} at ${size}px: an svg of exactly ${size} by ${size}`, async () => {
        const el = await mount({ kind, size, type: 'pdf' })
        const art = svg(el)
        expect(art.getAttribute('width')).toBe(String(size))
        expect(art.getAttribute('height')).toBe(String(size))
        expect(art.getAttribute('viewBox')).toBe(`0 0 ${size} ${size}`)
        expect(el.getAttribute('size')).toBe(String(size))
        expect(art.querySelector(kind === 'file' ? '[data-part=paper]' : '[data-part=folder]')).not.toBeNull()
        expect(art.querySelector(kind === 'file' ? '[data-part=folder]' : '[data-part=paper]')).toBeNull()
      })
    }
  }

  it('defaults to a 32px file, and treats an unknown kind as a file', async () => {
    const el = await mount()
    expect([el.kind, el.size]).toEqual(['file', 32])
    expect(svg(el).querySelector('[data-part=paper]')).not.toBeNull()
    const odd = await mount({ kind: 'spreadsheet' as 'file' })
    expect(svg(odd).querySelector('[data-part=paper]')).not.toBeNull()
  })

  it('snaps any other size to the nearest of the four (a tie goes larger), never a fifth size', async () => {
    expect([10, 16, 20, 24, 30, 48, 50, 80, 96, 200].map(snapGlyphSize)).toEqual([16, 16, 16, 32, 32, 64, 64, 96, 96, 96])
    const el = await mount({ size: 50 as 64 })
    expect(svg(el).getAttribute('width')).toBe('64')
  })
})

describe('mn-file-glyph: the type caption', () => {
  it('is drawn from 32px up and not at 16px, where it could not be read', async () => {
    const at = async (size: 16 | 32 | 64 | 96) => svg(await mount({ size, type: 'PDF' })).querySelector('[data-part=caption]')?.textContent
    expect([await at(16), await at(32), await at(64), await at(96)]).toEqual([undefined, 'PDF', 'PDF', 'PDF'])
  })

  it('upper-cases the type, keeps four characters at most, and omits an empty one', async () => {
    expect([glyphCaption('pdf'), glyphCaption('epub'), glyphCaption('markdown'), glyphCaption('  '), glyphCaption('')]).toEqual(['PDF', 'EPUB', 'MARK', null, null])
    // Letters and digits only: a type can never inject markup into the drawing.
    expect([glyphCaption('.pdf'), glyphCaption('<b>x'), glyphCaption('a&b"c')]).toEqual(['PDF', 'BX', 'ABC'])
    expect(svg(await mount({ size: 64, type: '' })).querySelector('[data-part=caption]')).toBeNull()
  })

  it('never draws a caption on a folder', async () => {
    expect(svg(await mount({ kind: 'folder', size: 96, type: 'pdf' })).querySelector('[data-part=caption]')).toBeNull()
  })
})

describe('mn-file-glyph: geometry', () => {
  for (const size of GLYPH_SIZES) {
    for (const kind of ['file', 'folder'] as const) {
      it(`${kind} at ${size}px stays inside its box and is centred, with strokes the size can afford`, () => {
        const g = fileGlyphGeometry(kind, size)
        expect(g.stroke).toBe({ 16: 1, 32: 1, 64: 1.5, 96: 2 }[size])
        const outer = { left: g.box.x, right: g.box.x + g.box.w, top: g.box.y, bottom: g.box.y + g.box.h }
        expect(outer.left).toBeGreaterThanOrEqual(0)
        expect(outer.top).toBeGreaterThanOrEqual(0)
        expect(outer.right).toBeLessThanOrEqual(size)
        expect(outer.bottom).toBeLessThanOrEqual(size)
        expect(Math.abs(outer.left - (size - outer.right))).toBeLessThanOrEqual(0.5)
        // The outline is the stroke's centre line, inset by half a stroke so the outer edge meets the box.
        for (const [x, y] of g.outline) {
          expect(x).toBeGreaterThanOrEqual(g.box.x + g.stroke / 2 - 1e-9)
          expect(x).toBeLessThanOrEqual(g.box.x + g.box.w - g.stroke / 2 + 1e-9)
          expect(y).toBeGreaterThanOrEqual(g.box.y + g.stroke / 2 - 1e-9)
          expect(y).toBeLessThanOrEqual(g.box.y + g.box.h - g.stroke / 2 + 1e-9)
        }
      })
    }
  }

  it('puts every vertex of a one-pixel outline on a half pixel, so 16px and 32px outlines are crisp', () => {
    for (const size of [16, 32] as const) {
      for (const kind of ['file', 'folder'] as const) {
        const g = fileGlyphGeometry(kind, size)
        expect([g.box.x, g.box.y, g.box.w, g.box.h].every(Number.isInteger), `${kind} ${size} box`).toBe(true)
        for (const [x, y] of g.outline) {
          expect([x % 1, y % 1], `${kind} ${size} vertex ${x},${y}`).toEqual([0.5, 0.5])
        }
      }
    }
  })

  it('folds the corner of a file: a diagonal edge and a crease, with a fold the size of the corner', () => {
    const file = fileGlyphGeometry('file', 64)
    expect(file.fold!.size).toBeGreaterThan(0)
    const diagonals = file.outline.filter(([x, y], i) => {
      const [nx, ny] = file.outline[(i + 1) % file.outline.length]!
      return nx !== x && ny !== y
    })
    expect(diagonals).toHaveLength(1)
  })

  it('tabs the top of a folder: three levels on its outline (tab top, body top, bottom), no fold', () => {
    const folder = fileGlyphGeometry('folder', 64)
    expect(folder.fold).toBeNull()
    expect(new Set(folder.outline.map(([, y]) => y)).size).toBe(3)
  })

  it('draws the caption inside the paper, below the fold', () => {
    for (const size of [32, 64, 96] as const) {
      const g = fileGlyphGeometry('file', size)
      expect(g.caption).not.toBeNull()
      expect(g.caption!.x).toBe(size / 2)
      expect(g.caption!.y).toBeGreaterThan(g.box.y + g.fold!.size)
      expect(g.caption!.y).toBeLessThan(g.box.y + g.box.h)
    }
    expect(fileGlyphGeometry('file', 16).caption).toBeNull()
  })
})

describe('mn-file-glyph: tokens only, and accent means selection', () => {
  it('is decorative unless it is given a label', async () => {
    expect(art(await mount()).getAttribute('aria-hidden')).toBe('true')
    const named = art(await mount({ label: 'Datasheet, PDF' }))
    expect(named.getAttribute('role')).toBe('img')
    expect(named.getAttribute('aria-label')).toBe('Datasheet, PDF')
    expect(named.hasAttribute('aria-hidden')).toBe(false)
  })

  it('reflects selected, and does not select by default', async () => {
    expect((await mount()).hasAttribute('selected')).toBe(false)
    expect((await mount({ selected: true })).hasAttribute('selected')).toBe(true)
  })

  it('strokes with --mn-files-glyph-stroke at rest and --mn-color-text-accent when selected', async () => {
    const css = cssText(await mount())
    expect(css).toMatch(/stroke:\s*var\(--mn-files-glyph-stroke\)/)
    expect(css).not.toMatch(/--mn-color-border-strong/)
    expect(css).toMatch(/:host\(\[selected\]\)[^{]*\{[^}]*stroke:\s*var\(--mn-color-text-accent\)/)
  })

  it('carries no colour of its own: every paint is a --mn-* token (no hex, rgb() or named colour)', async () => {
    const css = cssText(await mount())
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(css).not.toMatch(/\brgba?\(/)
    expect(css).not.toMatch(/\b(?:fill|stroke|color)\s*:\s*(?!var\(|none|currentColor|inherit|transparent)[a-z]+\s*[;}]/i)
    for (const [, name] of css.matchAll(/var\((--mn-[\w-]+)/g)) expect(name).toMatch(/^--mn-(color|font|files)-/)
  })

  it('uses accent for selection and for nothing else', async () => {
    const rules = cssText(await mount()).split('}')
    const accented = rules.filter(rule => /accent/.test(rule))
    expect(accented.length).toBeGreaterThan(0)
    for (const rule of accented) expect(rule).toMatch(/:host\(\[selected\]\)/)
  })
})
