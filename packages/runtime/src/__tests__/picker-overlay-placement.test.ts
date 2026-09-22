import { describe, expect, it } from 'vitest'
import { placeEditorOverlay } from '../picker/install-glue.js'

describe('editor overlay placement contract', () => {
  const viewport = { width: 1000, height: 800 }
  const picker = { width: 360, height: 420 }

  it('prefers the caret below with the shared gap', () => {
    expect(placeEditorOverlay(
      { left: 200, right: 202, top: 100, bottom: 120 },
      viewport,
      picker,
    )).toEqual({ left: 200, top: 128, side: 'below' })
  })

  it('flips above when the requested surface cannot fit below', () => {
    expect(placeEditorOverlay(
      { left: 200, right: 202, top: 740, bottom: 760 },
      viewport,
      picker,
    )).toEqual({ left: 200, top: 312, side: 'above' })
  })

  it('clamps a right-edge anchor inside the viewport margin', () => {
    expect(placeEditorOverlay(
      { left: 980, right: 982, top: 100, bottom: 120 },
      viewport,
      picker,
    )).toEqual({ left: 628, top: 128, side: 'below' })
  })

  it('uses an intentional upper-center fallback, never the accidental origin', () => {
    const placed = placeEditorOverlay(null, viewport, picker)
    expect(placed).toEqual({ left: 320, top: 144, side: 'fallback' })
    expect(placed.left).toBeGreaterThan(0)
    expect(placed.top).toBeGreaterThan(0)
  })

  it('keeps an oversized surface inside a compact viewport', () => {
    expect(placeEditorOverlay(
      { left: 270, right: 272, top: 210, bottom: 220 },
      { width: 300, height: 240 },
      picker,
    )).toEqual({ left: 12, top: 12, side: 'below' })
  })

  it('clamps inside a panned visual viewport while the mobile keyboard is open', () => {
    const keyboardViewport = { left: 6, top: 292, width: 390, height: 344 }

    expect(placeEditorOverlay(
      { left: 360, right: 362, top: 400, bottom: 420 },
      keyboardViewport,
      { width: 320, height: 240 },
    )).toEqual({ left: 64, top: 384, side: 'below' })

    expect(placeEditorOverlay(null, keyboardViewport, { width: 320, height: 240 }))
      .toEqual({ left: 41, top: 353.92, side: 'fallback' })
  })
})
