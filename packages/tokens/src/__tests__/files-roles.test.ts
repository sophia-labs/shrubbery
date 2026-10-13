/**
 * THE `--mn-files-*` COMPONENT-TIER ROLES (design §9). NO MOCKS: real token CSS,
 * resolved through the root-element cascade in `token-cascade.ts`.
 *
 * Why they exist. The folder canvas must be able to go period under 98 (desktop
 * icons: no card, white captions on the teal, a navy highlight) without Files
 * knowing which skin is active, and without a palette object or a
 * `getComputedStyle` resolver. So the canvas reads six roles, each defaulting to
 * a semantic role, and a skin overrides only the ones it wants to change.
 * Hot Dog Stand falls out of the defaults (yellow desktop, silver cards, black
 * ink); its two-line override, if Vera wants desktop icons there too, lives on
 * that skin's own branch.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ALL_SKIN_THEMES, SKIN_THEME_MATRIX, compositeOver, contrast, effectiveTokens, layerDeclarations, paintedColour,
  resolveToken, type RootAttributes, type Rgba,
} from './token-cascade.js'
import { REPO_ROOT, stripComments } from './token-reference-scan.js'

const ROLES = [
  '--mn-files-canvas-surface',
  '--mn-files-card-surface',
  '--mn-files-label-ink',
  '--mn-files-label-selected-wash',
  '--mn-files-label-selected-ink',
  '--mn-files-glyph-stroke',
  '--mn-files-grid-step',
] as const
const COLOUR_ROLES = ROLES.filter(name => name !== '--mn-files-grid-step')

const declared = layerDeclarations().filter(d => d.name.startsWith('--mn-files-'))
const rootDefault = (name: string) => declared.find(d => d.file.endsWith('/component.css') && d.selector === ':root' && d.name === name)
const resolved = (root: RootAttributes, name: string) => resolveToken(effectiveTokens(root), name)
const colour = (root: RootAttributes, name: string) => {
  const painted = paintedColour(resolved(root, name))
  if (!painted) throw new Error(`${name} does not resolve to a readable colour under ${root.skin}/${root.theme}: ${resolved(root, name)}`)
  return painted
}

describe('--mn-files-* roles: the component tier declares them', () => {
  it('declares all seven on :root in component.css, each reading a semantic role (the grid step is a length)', () => {
    expect(ROLES.map(name => [name, rootDefault(name)?.value])).toEqual([
      ['--mn-files-canvas-surface', 'var(--mn-color-surface-canvas)'],
      ['--mn-files-card-surface', 'var(--mn-color-surface-raised)'],
      ['--mn-files-label-ink', 'var(--mn-color-text-primary)'],
      ['--mn-files-label-selected-wash', 'var(--mn-color-interactive-selected)'],
      ['--mn-files-label-selected-ink', 'var(--mn-color-text-primary)'],
      ['--mn-files-glyph-stroke', 'var(--mn-color-text-quiet)'],
      ['--mn-files-grid-step', '8px'],
    ])
  })

  it('lets a skin override them: 98 goes period; Hot Dog Stand states the defaults (its completeness rule); no other skin does', () => {
    const overrides = declared.filter(d => !(d.file.endsWith('/component.css') && d.selector === ':root'))
    expect([...new Set(overrides.map(d => `${d.file.split('/').pop()} ${d.selector}`))].sort()).toEqual([
      'skin-98.css [data-skin="98"]', 'skin-hotdog-stand.css [data-skin="hotdog-stand"]',
    ])
    const five = [
      '--mn-files-card-surface', '--mn-files-glyph-stroke', '--mn-files-label-ink', '--mn-files-label-selected-ink',
      '--mn-files-label-selected-wash',
    ]
    for (const skin of ['skin-98.css', 'skin-hotdog-stand.css']) {
      expect(overrides.filter(d => d.file.endsWith(`/${skin}`)).map(d => d.name).sort(), skin).toEqual(five)
    }
    // Hot Dog Stand's are the defaults, word for word: the silver card falls out of the roles, as designed.
    for (const d of overrides.filter(d => d.file.endsWith('/skin-hotdog-stand.css'))) {
      expect(d.value, d.name).toBe(rootDefault(d.name)?.value)
    }
  })
})

describe('--mn-files-* roles: every skin and theme resolves all seven to something usable', () => {
  for (const root of SKIN_THEME_MATRIX) {
    it(`${root.skin} ${root.theme}`, () => {
      expect(resolved(root, '--mn-files-grid-step')).toBe('8px')
      for (const name of COLOUR_ROLES) {
        expect(paintedColour(resolved(root, name)), `${name} = ${resolved(root, name)}`).not.toBeNull()
      }
      // The defaults are the semantic roles, resolved in this very skin.
      if (root.skin !== '98') {
        expect(resolved(root, '--mn-files-canvas-surface')).toBe(resolved(root, '--mn-color-surface-canvas'))
        expect(resolved(root, '--mn-files-card-surface')).toBe(resolved(root, '--mn-color-surface-raised'))
        expect(resolved(root, '--mn-files-label-ink')).toBe(resolved(root, '--mn-color-text-primary'))
        expect(resolved(root, '--mn-files-label-selected-wash')).toBe(resolved(root, '--mn-color-interactive-selected'))
        expect(resolved(root, '--mn-files-label-selected-ink')).toBe(resolved(root, '--mn-color-text-primary'))
        expect(resolved(root, '--mn-files-glyph-stroke')).toBe(resolved(root, '--mn-color-text-quiet'))
      }
    })
  }

  it('gives a selected label a wash that is a painted colour (not the transparent the formula defect produced) in Garden, research and greenhouse', () => {
    for (const root of [{ skin: 'garden', theme: 'light' }, { skin: 'research', theme: 'light' }, { skin: 'greenhouse', theme: 'light' }] as const) {
      expect(colour(root, '--mn-files-label-selected-wash')[3], `${root.skin} selected wash`).toBeGreaterThan(0)
    }
  })
})

describe('--mn-files-* roles: 98 goes period (desktop icons)', () => {
  for (const theme of ['light', 'dark'] as const) {
    const root = { skin: '98', theme } as const
    it(`${theme}: no card, white captions on the desktop, a navy highlight with white ink`, () => {
      expect(resolved(root, '--mn-files-card-surface')).toBe('transparent')
      expect(colour(root, '--mn-files-label-ink')).toEqual([255, 255, 255, 1])
      expect(colour(root, '--mn-files-label-selected-wash')).toEqual([0, 0, 128, 1])
      expect(colour(root, '--mn-files-label-selected-ink')).toEqual([255, 255, 255, 1])
      // The glyph is drawn in the system frame colour on the desktop: black on the teal, white on the black.
      expect(resolved(root, '--mn-files-glyph-stroke')).toBe(resolved(root, '--mn-color-border-strong'))
    })

    it(`${theme}: the caption clears AA on the desktop, and the selected caption clears it on its highlight`, () => {
      expect(contrast(colour(root, '--mn-files-label-ink'), colour(root, '--mn-files-canvas-surface'))).toBeGreaterThanOrEqual(4.5)
      expect(contrast(colour(root, '--mn-files-label-selected-ink'), colour(root, '--mn-files-label-selected-wash'))).toBeGreaterThanOrEqual(4.5)
    })
  }

  it('light 98 sits on the teal desktop (#008080): white 4.78:1, where the old black label was 4.4:1', () => {
    const root = { skin: '98', theme: 'light' } as const
    expect(colour(root, '--mn-files-canvas-surface')).toEqual([0, 128, 128, 1])
    const white = contrast(colour(root, '--mn-files-label-ink'), colour(root, '--mn-files-canvas-surface'))
    const black = contrast([0, 0, 0, 1], colour(root, '--mn-files-canvas-surface'))
    expect(white).toBeGreaterThan(4.7)
    expect(black).toBeLessThan(4.5)
  })
})

/**
 * THE GLYPH IS LEGIBLE (follow-up to review V4; WCAG 1.4.11 non-text contrast).
 * Wave 0 drew the glyph's outline in `--mn-color-border-strong`, a border role
 * made to sit quietly beside content, not to carry an icon: 1.57:1 against the
 * Garden tree, 1.63:1 on a dark Garden card, 1.44:1 in research. An icon the
 * eye must find needs 3:1 against what it sits on. This measures the stroke the
 * component actually uses (read from `mn-file-glyph.ts`, so a change of role is
 * measured, not assumed) against every surface the glyph can sit on, in every
 * skin and theme the app can apply.
 *
 *   the card       --mn-files-card-surface, painted over the canvas (transparent in
 *                  98: the glyph then sits on the desktop itself)
 *   the tree       the panel, painted over the shell
 *   the list       the base surface
 *   its own paper  --mn-color-surface-editor, on its card
 * and, selected (accent stroke): the list's selected wash, the tree's accent
 * wash, the paper and the card. A translucent surface (Glass, research's panel)
 * is judged by what it lets through, so every surface is composited.
 */
function glyphStrokeRoles(): { rest: string; selected: string } {
  const css = stripComments(readFileSync(join(REPO_ROOT, 'packages/components/src/mn-file-glyph.ts'), 'utf8'))
  const found: { rest: string[]; selected: string[] } = { rest: [], selected: [] }
  for (const rule of css.matchAll(/([^{}`]+)\{([^{}]*)\}/g)) {
    const stroke = rule[2]!.match(/(?<![\w-])stroke:\s*var\((--[\w-]+)/)
    if (stroke) (rule[1]!.includes(':host([selected])') ? found.selected : found.rest).push(stroke[1]!)
  }
  expect([...new Set(found.rest)], 'the glyph strokes its outline in exactly one role at rest').toHaveLength(1)
  expect([...new Set(found.selected)], 'and in exactly one role when selected').toHaveLength(1)
  return { rest: found.rest[0]!, selected: found.selected[0]! }
}

function glyphGrounds(root: RootAttributes) {
  const tokens = effectiveTokens(root)
  const colour = (name: string): Rgba => {
    const painted = paintedColour(resolveToken(tokens, name))
    if (!painted) throw new Error(`${root.skin}/${root.theme} ${name} is not a readable colour: ${resolveToken(tokens, name)}`)
    return painted
  }
  const white: Rgba = [255, 255, 255, 1]
  const base = compositeOver(colour('--mn-color-surface-base'), white)
  const canvas = compositeOver(colour('--mn-files-canvas-surface'), white)
  const card = compositeOver(colour('--mn-files-card-surface'), canvas)
  const panel = compositeOver(colour('--mn-color-panel-bg'), base)
  const paper = compositeOver(colour('--mn-color-surface-editor'), card)
  return { colour, card, panel, base, paper,
    listSelected: compositeOver(colour('--mn-color-interactive-selected'), base),
    treeSelected: compositeOver(colour('--mn-color-surface-accent-strong'), panel) }
}

const ratio = (stroke: Rgba, ground: Rgba) => contrast(compositeOver(stroke, ground), ground)
const WCAG_NON_TEXT = 3

describe('the glyph is legible: its outline reaches 3:1 on every surface, in every skin and theme', () => {
  it('measures every legal skin and theme (each skin in both themes, Hot Dog Stand included; Mithras is light-only)', () => {
    expect(ALL_SKIN_THEMES.map(root => `${root.skin}/${root.theme}`).sort()).toEqual([
      'garden/light', 'garden/dark', 'emporium/light', 'emporium/dark', '98/light', '98/dark', 'glass/light', 'glass/dark',
      'mithras/light', 'research/light', 'research/dark', 'greenhouse/light', 'greenhouse/dark', 'observatory/light', 'observatory/dark',
      // Hot Dog Stand reached main after wave 0 (10-04); it is measured like every other skin.
      'hotdog-stand/light', 'hotdog-stand/dark',
    ].sort())
  })

  it('at rest: the stroke role against the card, the tree, the list and its own paper', () => {
    const { rest } = glyphStrokeRoles()
    const failures: string[] = []
    for (const root of ALL_SKIN_THEMES) {
      const g = glyphGrounds(root), stroke = g.colour(rest)
      for (const [where, ground] of Object.entries({ card: g.card, tree: g.panel, list: g.base, paper: g.paper })) {
        const value = ratio(stroke, ground)
        if (value < WCAG_NON_TEXT) failures.push(`${root.skin}/${root.theme} ${rest} on the ${where}: ${value.toFixed(2)}:1`)
      }
    }
    expect(failures).toEqual([])
  })

  it('selected: the accent stroke against the list’s selected wash, the tree’s accent wash, its paper and its card', () => {
    const { selected } = glyphStrokeRoles()
    const failures: string[] = []
    for (const root of ALL_SKIN_THEMES) {
      const g = glyphGrounds(root), stroke = g.colour(selected)
      for (const [where, ground] of Object.entries({ list: g.listSelected, tree: g.treeSelected, paper: g.paper, card: g.card })) {
        const value = ratio(stroke, ground)
        if (value < WCAG_NON_TEXT) failures.push(`${root.skin}/${root.theme} ${selected} on the ${where}: ${value.toFixed(2)}:1`)
      }
    }
    expect(failures).toEqual([])
  })

  it('is measured by a meter that would have caught the old role: border-strong failed in seven combinations', () => {
    const failing = ALL_SKIN_THEMES.filter(root => {
      const g = glyphGrounds(root), stroke = g.colour('--mn-color-border-strong')
      return [g.card, g.panel, g.base, g.paper].some(ground => ratio(stroke, ground) < WCAG_NON_TEXT)
    }).map(root => `${root.skin}/${root.theme}`)
    expect(failing.sort()).toEqual(['garden/light', 'garden/dark', 'emporium/light', 'research/light', 'research/dark', 'greenhouse/light', 'observatory/light'].sort())
  })
})
