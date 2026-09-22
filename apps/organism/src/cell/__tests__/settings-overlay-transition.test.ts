import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OrganismAppRouteMount } from '../app-routes.js'
import { createSettingsOverlayTransition } from '../settings-overlay-transition.js'

const mounted: HTMLElement[] = []

afterEach(() => {
  for (const element of mounted.splice(0)) element.remove()
  document.body.removeAttribute('data-organism-settings-open')
})

function routeMount(destroy = vi.fn()): OrganismAppRouteMount {
  return {
    route: { kind: 'settings', sectionId: 'account' },
    ready: Promise.resolve(),
    destroy,
  }
}

describe('in-place Settings transition', () => {
  it('keeps the prior screen mounted and inert while pushing the canonical route', async () => {
    const host = document.createElement('div')
    const workspace = document.createElement('main')
    const focusReturn = document.createElement('button')
    workspace.append(focusReturn)
    host.append(workspace)
    document.body.append(host)
    mounted.push(host)

    const pushes: string[] = []
    const back = vi.fn()
    const destroy = vi.fn()
    let closeFromRoute = (): void => undefined
    const transition = createSettingsOverlayTransition({
      host,
      history: {
        state: { workspace: 'garden' },
        pushState(data, _unused, url) {
          expect(data).toMatchObject({ workspace: 'garden', organismOverlayRoute: 'settings' })
          pushes.push(String(url))
        },
        back,
      },
      mount(overlay, _location, onClose) {
        closeFromRoute = onClose
        overlay.append(document.createElement('mn-settings-page'))
        return routeMount(destroy)
      },
    })

    expect(transition.open(
      new URL('https://garden.test/settings?source=cell&graph=vera#appearance'),
      { focusReturn },
    )).toBe(true)
    expect(pushes).toEqual(['/settings?source=cell&graph=vera#appearance'])
    expect(host.contains(workspace)).toBe(true)
    expect(host.inert).toBe(true)
    expect(host.getAttribute('aria-hidden')).toBe('true')
    expect(document.querySelector('[role="dialog"][aria-label="Settings"]')).not.toBeNull()
    expect(host.querySelector('.boot-placeholder')).toBeNull()
    expect(document.body.hasAttribute('data-organism-settings-open')).toBe(true)

    closeFromRoute()
    expect(back).toHaveBeenCalledOnce()
    expect(destroy).not.toHaveBeenCalled()

    expect(transition.handlePopState(new URL('https://garden.test/g/vera'))).toBe(true)
    expect(destroy).toHaveBeenCalledOnce()
    expect(host.contains(workspace)).toBe(true)
    expect(host.inert).toBe(false)
    expect(host.hasAttribute('aria-hidden')).toBe(false)
    expect(document.querySelector('.organism-settings-overlay')).toBeNull()

    await Promise.resolve()
  })

  it('reopens on Forward without pushing another history entry', () => {
    const host = document.createElement('div')
    host.append(document.createElement('main'))
    document.body.append(host)
    mounted.push(host)
    const pushState = vi.fn()
    const transition = createSettingsOverlayTransition({
      host,
      history: { state: null, pushState, back: vi.fn() },
      mount: () => routeMount(),
    })

    expect(transition.handlePopState(new URL('https://garden.test/settings#account'))).toBe(true)
    expect(transition.isOpen).toBe(true)
    expect(pushState).not.toHaveBeenCalled()
    transition.destroy()
  })

  it('leaves unrelated routes to the ordinary navigation path', () => {
    const host = document.createElement('div')
    document.body.append(host)
    mounted.push(host)
    const transition = createSettingsOverlayTransition({
      host,
      history: { state: null, pushState: vi.fn(), back: vi.fn() },
      mount: () => routeMount(),
    })

    expect(transition.open(new URL('https://garden.test/ops-health'))).toBe(false)
    expect(transition.handlePopState(new URL('https://garden.test/g/vera'))).toBe(false)
  })
})
