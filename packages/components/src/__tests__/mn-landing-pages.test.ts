/**
 * REAL landing page component tests.
 *
 * The landing pages render Garden/Sophia brochure surfaces but keep host effects
 * out of @shrubbery/components: CTA analytics, consent persistence, and navigation
 * handling are shell-owned.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import '../garden-landing.js'
import '../sophia-labs-landing.js'
import type { GardenLanding, MnLandingActionDetail } from '../garden-landing.js'
import type { SophiaLabsLanding } from '../sophia-labs-landing.js'

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

const sr = (el: HTMLElement) => el.shadowRoot!

describe('Garden/Sophia landing pages - real custom elements', () => {
  beforeAll(() => {
    expect(customElements.get('garden-landing')).toBeDefined()
    expect(customElements.get('sophia-labs-landing')).toBeDefined()
  })

  it('garden-landing renders the page surface and emits shell-owned CTA intents', async () => {
    const el = await mount<GardenLanding>('garden-landing', (node) => {
      node.appHref = '#app'
      node.discordHref = '#discord'
      node.emailHref = 'mailto:test@example.com'
      node.screenshotSrc = '/preview.jpg'
      node.mobileScreenshotSrc = '/mobile.jpg'
    })
    const actions: MnLandingActionDetail[] = []
    el.addEventListener('mn-landing-action', (event) => {
      actions.push((event as CustomEvent<MnLandingActionDetail>).detail)
    })

    expect(sr(el).querySelector('garden-hero-canvas')).not.toBeNull()
    expect(sr(el).querySelector('.wordmark')?.textContent).toBe('Garden')
    expect((sr(el).querySelector('.btn-primary') as HTMLAnchorElement).getAttribute('href')).toBe('#app')

    ;(sr(el).querySelector('.btn-primary') as HTMLAnchorElement).click()
    expect(actions).toEqual([
      { landing: 'garden', action: 'signup', placement: 'hero', href: '#app' },
    ])

    ;(sr(el).querySelector('.arch-node') as HTMLButtonElement).click()
    await el.updateComplete
    expect(sr(el).querySelector('.arch-detail')?.textContent).toContain('Documents stay readable')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await el.updateComplete
    expect(sr(el).querySelector('.arch-detail')?.textContent).toContain('Click a layer')

    el.remove()
  })

  it('sophia-labs-landing renders the research-studio page and emits CTA intents', async () => {
    const el = await mount<SophiaLabsLanding>('sophia-labs-landing', (node) => {
      node.gardenHref = '#garden'
      node.emailHref = 'mailto:test@example.com'
    })
    const actions: MnLandingActionDetail[] = []
    el.addEventListener('mn-landing-action', (event) => {
      actions.push((event as CustomEvent<MnLandingActionDetail>).detail)
    })

    expect(sr(el).querySelector('sophia-hero-canvas')).not.toBeNull()
    expect(sr(el).querySelector('.wordmark')?.textContent).toBe('Sophia Labs')
    expect((sr(el).querySelector('.project-link') as HTMLAnchorElement).getAttribute('href')).toBe('#garden')

    ;(sr(el).querySelector('.project-link') as HTMLAnchorElement).click()
    expect(actions).toEqual([
      { landing: 'sophia', action: 'garden', placement: 'projects', href: '#garden' },
    ])

    el.remove()
  })
})
