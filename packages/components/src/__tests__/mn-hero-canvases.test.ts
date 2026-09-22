/**
 * REAL hero canvases — Garden visual surfaces lifted as pure components.
 *
 * These own only local rendering state. Unsupported canvas/WebGL environments
 * must still upgrade and render stable DOM rather than coupling to a host.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import '../garden-hero-canvas.js'
import '../sophia-hero-canvas.js'
import type { GardenHeroCanvas } from '../garden-hero-canvas.js'
import type { SophiaHeroCanvas } from '../sophia-hero-canvas.js'

async function mount<T extends HTMLElement & { updateComplete: Promise<unknown> }>(
  tag: string,
  setup?: (el: T) => void,
): Promise<T> {
  const el = document.createElement(tag) as T
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

describe('hero canvas registrations', () => {
  beforeAll(() => {
    expect(customElements.get('garden-hero-canvas')).toBeDefined()
    expect(customElements.get('sophia-hero-canvas')).toBeDefined()
  })

  it('garden-hero-canvas renders a stable shadow canvas from controlled props', async () => {
    const el = await mount<GardenHeroCanvas>('garden-hero-canvas', (node) => {
      node.blobCount = 3
      node.animated = false
    })

    expect(el.blobCount).toBe(3)
    expect(el.animated).toBe(false)
    expect(el.shadowRoot!.querySelector('canvas')).not.toBeNull()
  })

  it('sophia-hero-canvas renders a stable canvas/fallback surface without host state', async () => {
    const el = await mount<SophiaHeroCanvas>('sophia-hero-canvas', (node) => {
      node.nodeCount = 4
      node.animated = false
      node.autoRotate = false
    })

    expect(el.nodeCount).toBe(4)
    expect(el.animated).toBe(false)
    expect(el.autoRotate).toBe(false)
    expect(el.shadowRoot!.querySelector('canvas')).not.toBeNull()
  })

  it('can disconnect both renderers without throwing', async () => {
    const garden = await mount<GardenHeroCanvas>('garden-hero-canvas', (node) => {
      node.animated = false
    })
    const sophia = await mount<SophiaHeroCanvas>('sophia-hero-canvas', (node) => {
      node.animated = false
    })

    expect(() => {
      garden.remove()
      sophia.remove()
    }).not.toThrow()
  })
})
