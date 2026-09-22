import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { MnContinuityActionDetail, MnContinuityStatus } from '../mn-continuity-status.js'

beforeAll(async () => {
  await import('../mn-continuity-status.js')
})

afterEach(() => {
  document.body.innerHTML = ''
})

async function mount(configure?: (element: MnContinuityStatus) => void): Promise<MnContinuityStatus> {
  const element = document.createElement('mn-continuity-status') as MnContinuityStatus
  configure?.(element)
  document.body.appendChild(element)
  await element.updateComplete
  return element
}

describe('mn-continuity-status', () => {
  it('stays quiet when ready has no useful confirmation copy', async () => {
    const element = await mount()
    expect(element.shadowRoot?.querySelector('[role]')).toBeNull()
  })

  it('announces background progress politely without blocking the surface', async () => {
    const element = await mount((node) => {
      node.state = 'reconnecting'
      node.detail = 'Recent work remains available.'
    })
    const status = element.shadowRoot?.querySelector('[role="status"]')
    expect(status?.getAttribute('aria-live')).toBe('polite')
    expect(status?.getAttribute('aria-busy')).toBe('true')
    expect(status?.textContent).toContain('Reconnecting')
    expect(status?.textContent).toContain('Recent work remains available.')
  })

  it('uses an alert and emits a controlled recovery intent for errors', async () => {
    const element = await mount((node) => {
      node.state = 'error'
      node.label = 'Could not refresh Browse'
      node.actionLabel = 'Try again'
    })
    let detail: MnContinuityActionDetail | undefined
    element.addEventListener('continuity-action', (event) => {
      detail = (event as CustomEvent<MnContinuityActionDetail>).detail
    })

    const alert = element.shadowRoot?.querySelector('[role="alert"]')
    const button = element.shadowRoot?.querySelector('button')
    expect(alert?.getAttribute('aria-live')).toBe('assertive')
    expect(button?.textContent).toBe('Try again')
    button?.click()
    expect(detail).toEqual({ state: 'error' })
  })

  it('renders an explicit ready confirmation only when the host supplies it', async () => {
    const element = await mount((node) => {
      node.label = 'Saved'
      node.variant = 'inline'
    })
    const status = element.shadowRoot?.querySelector('[role="status"]')
    expect(status?.textContent).toContain('Saved')
    expect(status?.getAttribute('aria-busy')).toBe('false')
    expect(status?.getAttribute('data-variant')).toBe('inline')
  })
})
