import { describe, expect, it } from 'vitest'
// The real Excalidraw constants, not a stand-in: the palette is rewritten in place on the pinned build's own objects.
import * as common from '@excalidraw/common'
import { applySophiaPalette, WB_FONT, WHITEBOARD_DEFAULTS, WHITEBOARD_THEME_CSS } from './whiteboard-theme.js'
import { collaboratorHue, COLLABORATOR_HUES } from './whiteboard-presence.js'

describe('the whiteboard in Sophia clothes', () => {
  it('draws new elements the Sophia way: architect, thin, rounded, solid, Nunito, elbow arrows', () => {
    expect(WHITEBOARD_DEFAULTS).toMatchObject({
      currentItemRoughness: 0, currentItemStrokeWidth: 1, currentItemFillStyle: 'solid',
      currentItemRoundness: 'round', currentItemArrowType: 'elbow', currentItemFontFamily: WB_FONT.Nunito,
    })
    expect(WHITEBOARD_DEFAULTS.currentItemStrokeColor).toBe('#1d1c19')
  })

  it('points every Excalidraw brand colour at a Sophia token', () => {
    for (const name of ['--color-primary', '--color-selection', '--island-bg-color', '--popup-bg-color', '--ui-font', '--color-danger']) {
      expect(WHITEBOARD_THEME_CSS).toMatch(new RegExp(`${name}: var\\(--mn-`))
    }
    expect(WHITEBOARD_THEME_CSS.toLowerCase()).not.toContain('6965db')
    expect(WHITEBOARD_THEME_CSS).toContain('library-menu-browse-button')
  })

  it('re-colours the picker with Sophia ramps, in place and once', () => {
    const c = common as unknown as Parameters<typeof applySophiaPalette>[0] & { COLOR_PALETTE: Record<string, string | string[]>; DEFAULT_ELEMENT_STROKE_PICKS: string[]; DEFAULT_ELEMENT_BACKGROUND_PICKS: string[] }
    const before = (c.COLOR_PALETTE.green as string[]).slice()
    expect(before[4]).toBe('#2f9e44')
    applySophiaPalette(c)
    expect((c.COLOR_PALETTE.green as string[])[4]).toBe('#326f4c')
    expect((c.COLOR_PALETTE.green as string[])[3]).toBe('#4a8860')
    expect(c.COLOR_PALETTE.black).toBe('#1d1c19')
    expect(c.DEFAULT_ELEMENT_STROKE_PICKS[0]).toBe('#1d1c19')
    expect(c.DEFAULT_ELEMENT_STROKE_PICKS[2]).toBe((c.COLOR_PALETTE.green as string[])[4])
    expect(c.DEFAULT_ELEMENT_BACKGROUND_PICKS[2]).toBe('#bcdac3')
    applySophiaPalette(c)
    expect((c.COLOR_PALETTE.green as string[])[4]).toBe('#326f4c')
  })

  it('gives a collaborator one stable Sophia hue by name', () => {
    expect(collaboratorHue('Vera')).toBe(collaboratorHue('Vera'))
    expect(COLLABORATOR_HUES).toContain(collaboratorHue('Eschaton'))
  })
})
