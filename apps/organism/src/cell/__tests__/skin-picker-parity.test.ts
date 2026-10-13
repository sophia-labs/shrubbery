/**
 * REAL parity test, NO MOCKS: the skin picker lists exactly the skins the registry says are in the
 * global identity set, in its order, with the registry's labels. The components package is an island
 * (it never imports token code), so it keeps its own list; this is where both are importable, and the
 * only thing that stops the two from drifting.
 */
import { describe, expect, it } from 'vitest'
import { CHROME_PICKER_SKINS, chromeSkinMeta, type ChromeSkinId } from '@shrubbery/components'
import { SKIN_LABELS, VISUAL_IDENTITY_SKINS } from '@shrubbery/tokens'

describe('the skin picker and the registry agree', () => {
  it('the picker lists the registry\'s identity set, in the registry\'s order', () => {
    expect([...CHROME_PICKER_SKINS]).toEqual([...VISUAL_IDENTITY_SKINS])
  })

  it('every entry carries the registry\'s label, and Hotdog Stand comes last', () => {
    for (const skin of VISUAL_IDENTITY_SKINS) {
      expect(chromeSkinMeta(skin as ChromeSkinId).label, skin).toBe(SKIN_LABELS[skin])
    }
    expect(CHROME_PICKER_SKINS[CHROME_PICKER_SKINS.length - 1]).toBe('hotdog-stand')
    expect(SKIN_LABELS['hotdog-stand']).toBe('Hotdog Stand')
  })
})
