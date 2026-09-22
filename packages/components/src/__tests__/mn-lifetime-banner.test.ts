import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type {
  MnLifetimeBanner,
  MnLifetimeBannerDetail,
  MnLifetimeBannerState,
  MnLifetimeReason,
} from '../mn-lifetime-banner.js'

beforeAll(async () => {
  await import('../mn-lifetime-banner.js')
})

afterEach(() => {
  document.body.innerHTML = ''
})

async function mount(state?: MnLifetimeBannerState | null): Promise<MnLifetimeBanner> {
  const element = document.createElement('mn-lifetime-banner') as MnLifetimeBanner
  if (state !== undefined) element.state = state
  document.body.appendChild(element)
  await element.updateComplete
  return element
}

function state(overrides: Partial<MnLifetimeBannerState> = {}): MnLifetimeBannerState {
  return {
    reason: 'graph-recreated',
    graphTitle: 'Field Notes',
    previousLife: 'a1b2c3d4',
    parkedDocuments: 2,
    parkedOperations: 3,
    testimony: "stale graph incarnation: expected a1b2c3d4, actual e5f6a7b8",
    ...overrides,
  }
}

describe('mn-lifetime-banner', () => {
  it('renders NOTHING when state is null — no reserved space, no placeholder', async () => {
    const element = await mount(null)
    expect(element.shadowRoot?.querySelector('[role]')).toBeNull()
    expect(element.shadowRoot?.textContent?.trim()).toBe('')
  })

  const reasonHeadlines: readonly [MnLifetimeReason, string][] = [
    ['graph-recreated', 'Field Notes was recreated while you were away.'],
    ['graph-name-taken', 'Field Notes already existed when your copy tried to create it.'],
    ['graph-already-gone', 'Field Notes had already ended when your copy tried to delete it.'],
  ]

  for (const [reason, headline] of reasonHeadlines) {
    it(`renders its own headline for reason "${reason}"`, async () => {
      const element = await mount(state({ reason }))
      const status = element.shadowRoot?.querySelector('[role="status"]')
      expect(status?.querySelector('strong')?.textContent).toBe(headline)
    })
  }

  it('renders the testimony verbatim inside the disclosure, and it is absent from the headline text', async () => {
    const testimony = "stale graph incarnation: expected a1b2c3d4, actual e5f6a7b8"
    const element = await mount(state({ testimony }))
    const summary = element.shadowRoot?.querySelector('details summary')
    expect(summary?.textContent).toBe('What the server said')
    const testimonyEl = element.shadowRoot?.querySelector('.testimony')
    expect(testimonyEl?.textContent).toBe(testimony)
    const headline = element.shadowRoot?.querySelector('strong')
    expect(headline?.textContent).not.toContain(testimony)
  })

  it('suppresses the secondary action at zero counts, and shows it otherwise', async () => {
    const zero = await mount(state({ parkedDocuments: 0, parkedOperations: 0 }))
    expect(zero.shadowRoot?.querySelector('.secondary-btn')).toBeNull()
    expect(zero.shadowRoot?.querySelector('.banner-counts')?.textContent).toBe('Nothing of yours was waiting.')

    const nonZero = await mount(state({ parkedDocuments: 1, parkedOperations: 0 }))
    expect(nonZero.shadowRoot?.querySelector('.secondary-btn')).not.toBeNull()
    expect(nonZero.shadowRoot?.querySelector('.banner-counts')?.textContent).toBe('1 parked document')
  })

  it('carries role="status" and aria-live="polite" — a standing condition, never role="alert"', async () => {
    const element = await mount(state())
    const status = element.shadowRoot?.querySelector('[role="status"]')
    expect(status?.getAttribute('aria-live')).toBe('polite')
    expect(status?.getAttribute('aria-atomic')).toBe('true')
    expect(element.shadowRoot?.querySelector('[role="alert"]')).toBeNull()
  })

  it('fires mn-lifetime-primary and mn-lifetime-secondary exactly once with the right detail', async () => {
    const element = await mount(state({ reason: 'graph-already-gone' }))
    const primaryDetails: MnLifetimeBannerDetail[] = []
    const secondaryDetails: MnLifetimeBannerDetail[] = []
    element.addEventListener('mn-lifetime-primary', (event) => {
      primaryDetails.push((event as CustomEvent<MnLifetimeBannerDetail>).detail)
    })
    element.addEventListener('mn-lifetime-secondary', (event) => {
      secondaryDetails.push((event as CustomEvent<MnLifetimeBannerDetail>).detail)
    })

    element.shadowRoot?.querySelector<HTMLButtonElement>('.primary-btn')?.click()
    element.shadowRoot?.querySelector<HTMLButtonElement>('.secondary-btn')?.click()

    expect(primaryDetails).toEqual([{ reason: 'graph-already-gone' }])
    expect(secondaryDetails).toEqual([{ reason: 'graph-already-gone' }])
  })

  it('busy makes both actions inert: disabled, and the click handlers no-op', async () => {
    const element = await mount(state({ busy: true }))
    const primary = element.shadowRoot?.querySelector<HTMLButtonElement>('.primary-btn')
    const secondary = element.shadowRoot?.querySelector<HTMLButtonElement>('.secondary-btn')
    expect(primary?.disabled).toBe(true)
    expect(secondary?.disabled).toBe(true)
    expect(primary?.textContent?.trim()).toBe("Loading this graph's current life…")

    let fired = false
    element.addEventListener('mn-lifetime-primary', () => { fired = true })
    primary?.click()
    expect(fired).toBe(false)
  })
})
