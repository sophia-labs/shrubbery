/**
 * REAL test of the shared chrome identity metadata — NO MOCKS. The top and app bars
 * read `chromeSkinMeta(activeSkin)` to show the current visual identity with a
 * truthful label and an icon; both must be real, for every identity in the shared
 * cycle. (The components package never imports token code — it is an island — so
 * the identities are listed here, as the bars' own tests list theirs.)
 */
import { describe, it, expect } from 'vitest'
import { chromeSkinMeta, type ChromeSkinId } from '../chrome-skin.js'
import { hasIcon } from '../icons.js'

const SHARED_CYCLE: ReadonlyArray<readonly [ChromeSkinId, string]> = [
  ['garden', 'Garden'],
  ['emporium', 'Sophia'],
  ['98', '98'],
  ['glass', 'Glass'],
  ['mithras', 'Mithras'],
  ['hotdog-stand', 'Hotdog Stand'],
]

describe('chrome skin metadata', () => {
  it.each(SHARED_CYCLE)('%s is labelled %s and carries an icon the registry has', (id, label) => {
    const meta = chromeSkinMeta(id)
    expect(meta.label).toBe(label)
    expect(hasIcon(meta.icon), `icon "${meta.icon}"`).toBe(true)
  })

  it('every identity in the cycle has its own label and its own icon', () => {
    const metas = SHARED_CYCLE.map(([id]) => chromeSkinMeta(id))
    expect(new Set(metas.map(m => m.label)).size).toBe(SHARED_CYCLE.length)
    expect(new Set(metas.map(m => m.icon)).size).toBe(SHARED_CYCLE.length)
  })

  it('an unknown identity reads as Garden rather than throwing', () => {
    expect(chromeSkinMeta('no-such-skin' as ChromeSkinId).label).toBe('Garden')
  })
})
