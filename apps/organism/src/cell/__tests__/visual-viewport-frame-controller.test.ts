import { afterEach, describe, expect, it } from 'vitest'
import {
  OrganismVisualViewportFrameController,
  VISUAL_VIEWPORT_FRAME_CSS,
} from '../visual-viewport-frame-controller.js'

class TestMediaQueryList extends EventTarget {
  matches = true
  readonly media = '(max-width: 1024px)'
  onchange: ((this: MediaQueryList, ev: MediaQueryListEvent) => unknown) | null = null

  addListener(listener: ((this: MediaQueryList, ev: MediaQueryListEvent) => unknown) | null): void {
    if (listener) this.addEventListener('change', listener as EventListener)
  }

  removeListener(listener: ((this: MediaQueryList, ev: MediaQueryListEvent) => unknown) | null): void {
    if (listener) this.removeEventListener('change', listener as EventListener)
  }
}

class TestVisualViewport extends EventTarget {
  width = 390
  height = 844
  offsetTop = 0
  offsetLeft = 0

  setSize(width: number, height: number): void {
    this.width = width
    this.height = height
    this.dispatchEvent(new Event('resize'))
  }

  setPan(width: number, height: number, offsetTop: number, offsetLeft: number): void {
    this.width = width
    this.height = height
    this.offsetTop = offsetTop
    this.offsetLeft = offsetLeft
    this.dispatchEvent(new Event('scroll'))
  }
}

afterEach(() => {
  document.body.removeAttribute('data-organism-mobile-shell-active')
  document.body.removeAttribute('data-organism-route-viewport-frame')
  document.body.removeAttribute('data-organism-viewport-keyboard')
  document.documentElement.removeAttribute('data-organism-viewport-keyboard')
  delete document.documentElement.dataset.organismVisualViewportFrame
  delete document.documentElement.dataset.organismViewportStrategy
  document.documentElement.style.removeProperty('--organism-vvh')
  document.documentElement.style.removeProperty('--organism-vvw')
  document.documentElement.style.removeProperty('--organism-vv-top')
  document.documentElement.style.removeProperty('--organism-vv-left')
  document.documentElement.style.removeProperty('--mn-viewport-inset-bottom')
  document.documentElement.scrollLeft = 0
  document.documentElement.scrollTop = 0
  document.body.scrollLeft = 0
  document.body.scrollTop = 0
  document.getElementById('organism-visual-viewport-frame-styles')?.remove()
  document.getElementById('organism-visual-viewport-debug')?.remove()
})

describe('OrganismVisualViewportFrameController', () => {
  it('defaults to the follow strategy when no override is present', () => {
    document.body.setAttribute('data-organism-route-viewport-frame', '')
    const controller = new OrganismVisualViewportFrameController({
      document,
      matchMedia: () => new TestMediaQueryList() as unknown as MediaQueryList,
      visualViewport: new TestVisualViewport(),
      innerWidth: () => 390,
      innerHeight: () => 844,
    })
    expect(document.documentElement.dataset.organismViewportStrategy).toBe('follow')
    controller.destroy()
  })

  it('projects size only onto a fixed zero-origin route frame in pin strategy', () => {
    document.body.setAttribute('data-organism-route-viewport-frame', '')
    const viewport = new TestVisualViewport()
    const controller = new OrganismVisualViewportFrameController({
      document,
      matchMedia: () => new TestMediaQueryList() as unknown as MediaQueryList,
      visualViewport: viewport,
      innerWidth: () => 390,
      innerHeight: () => 844,
      strategy: 'pin',
      requestAnimationFrame: callback => {
        callback(0)
        return 1
      },
    })

    viewport.setSize(366, 500)

    expect(controller.isActive).toBe(true)
    expect(controller.isKeyboardOpen).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--organism-vvw')).toBe('366px')
    expect(document.documentElement.style.getPropertyValue('--organism-vvh')).toBe('500px')
    expect(document.documentElement.style.getPropertyValue('--organism-vv-top')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--organism-vv-left')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--mn-viewport-inset-bottom')).toBe('0px')
    expect(VISUAL_VIEWPORT_FRAME_CSS).toContain('inset: 0 auto auto 0')
    expect(VISUAL_VIEWPORT_FRAME_CSS).toContain('overflow-anchor: none')
    expect(VISUAL_VIEWPORT_FRAME_CSS).not.toContain('position: fixed !important;\n    inset: 0 !important;\n    width: 100%')
    controller.destroy()
  })

  it('pins captured root scroll while the keyboard is open and after it settles closed', () => {
    document.body.setAttribute('data-organism-mobile-shell-active', '')
    const viewport = new TestVisualViewport()
    const frames: FrameRequestCallback[] = []
    const position = { x: 7, y: 24 }
    const scrollCalls: Array<[number, number]> = []
    const scrollTo = (x: number, y: number): void => {
      scrollCalls.push([x, y])
      position.x = x
      position.y = y
    }
    const controller = new OrganismVisualViewportFrameController({
      document,
      matchMedia: () => new TestMediaQueryList() as unknown as MediaQueryList,
      visualViewport: viewport,
      innerWidth: () => 390,
      innerHeight: () => 844,
      scrollX: () => position.x,
      scrollY: () => position.y,
      scrollTo,
      requestAnimationFrame: callback => {
        frames.push(callback)
        return frames.length
      },
    })

    position.x = 0
    position.y = 180
    viewport.setSize(366, 500)
    frames.shift()!(0)
    frames.shift()!(16)
    expect(controller.isKeyboardOpen).toBe(true)
    expect(scrollCalls.at(-1)).toEqual([7, 24])
    expect(document.documentElement.hasAttribute('data-organism-viewport-keyboard')).toBe(true)
    expect(VISUAL_VIEWPORT_FRAME_CSS).toContain('height: var(--organism-vvh, 100dvh) !important')

    scrollCalls.length = 0
    viewport.setSize(390, 844)
    frames.shift()!(32)
    frames.shift()!(48)
    expect(controller.isKeyboardOpen).toBe(false)
    expect(scrollCalls).toContainEqual([7, 24])
    controller.destroy()
  })

  it('pre-focuses pointer-targeted editables without native root scrolling', () => {
    document.body.setAttribute('data-organism-route-viewport-frame', '')
    const scrollCalls: Array<[number, number]> = []
    const scrollTo = (x: number, y: number): void => { scrollCalls.push([x, y]) }
    const controller = new OrganismVisualViewportFrameController({
      document,
      matchMedia: () => new TestMediaQueryList() as unknown as MediaQueryList,
      visualViewport: new TestVisualViewport(),
      innerWidth: () => 390,
      innerHeight: () => 844,
      scrollTo,
      requestAnimationFrame: callback => {
        callback(0)
        return 1
      },
    })
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    const focusOptions: Array<FocusOptions | undefined> = []
    const nativeFocus = editable.focus.bind(editable)
    editable.focus = (options?: FocusOptions): void => {
      focusOptions.push(options)
      nativeFocus(options)
    }
    document.body.append(editable)

    expect(controller.isActive).toBe(true)
    editable.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }))

    expect(focusOptions).toEqual([{ preventScroll: true }])
    expect(scrollCalls).toContainEqual([0, 0])
    editable.remove()
    controller.destroy()
  })

  it('re-anchors screen roots to the visual viewport offset in follow strategy', () => {
    document.body.setAttribute('data-organism-route-viewport-frame', '')
    const viewport = new TestVisualViewport()
    const controller = new OrganismVisualViewportFrameController({
      document,
      matchMedia: () => new TestMediaQueryList() as unknown as MediaQueryList,
      visualViewport: viewport,
      innerWidth: () => 390,
      innerHeight: () => 844,
      strategy: 'follow',
      requestAnimationFrame: callback => {
        callback(0)
        return 1
      },
    })

    expect(document.documentElement.dataset.organismViewportStrategy).toBe('follow')
    expect(VISUAL_VIEWPORT_FRAME_CSS).toContain("[data-organism-viewport-strategy='follow']")
    expect(VISUAL_VIEWPORT_FRAME_CSS).toContain(
      'inset: var(--organism-vv-top, 0px) auto auto var(--organism-vv-left, 0px)',
    )

    viewport.setPan(366, 500, 58, 2)
    expect(controller.isKeyboardOpen).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--organism-vv-top')).toBe('58px')
    expect(document.documentElement.style.getPropertyValue('--organism-vv-left')).toBe('2px')

    viewport.setPan(390, 844, 0, 0)
    expect(controller.isKeyboardOpen).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--organism-vv-top')).toBe('0px')
    expect(document.documentElement.style.getPropertyValue('--mn-viewport-inset-bottom')).toBe('')

    controller.destroy()
    expect(document.documentElement.style.getPropertyValue('--organism-vv-top')).toBe('')
    expect(document.documentElement.dataset.organismViewportStrategy).toBeUndefined()
  })

  it('holds follow offsets at zero for a pinch-zoom pan with the keyboard closed', () => {
    document.body.setAttribute('data-organism-route-viewport-frame', '')
    const viewport = new TestVisualViewport()
    const controller = new OrganismVisualViewportFrameController({
      document,
      matchMedia: () => new TestMediaQueryList() as unknown as MediaQueryList,
      visualViewport: viewport,
      innerWidth: () => 390,
      innerHeight: () => 844,
      strategy: 'follow',
      requestAnimationFrame: callback => {
        callback(0)
        return 1
      },
    })

    // 144px shrink is under the 150px keyboard threshold: a zoom, not an IME.
    viewport.setPan(300, 700, 40, 12)
    expect(controller.isKeyboardOpen).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--organism-vv-top')).toBe('0px')
    expect(document.documentElement.style.getPropertyValue('--organism-vv-left')).toBe('0px')
    controller.destroy()
  })

  it('does not mistake a settled orientation change for the keyboard', () => {
    document.body.setAttribute('data-organism-route-viewport-frame', '')
    const viewport = new TestVisualViewport()
    const layout = { width: 390, height: 844 }
    const controller = new OrganismVisualViewportFrameController({
      document,
      matchMedia: () => new TestMediaQueryList() as unknown as MediaQueryList,
      visualViewport: viewport,
      innerWidth: () => layout.width,
      innerHeight: () => layout.height,
      requestAnimationFrame: callback => {
        callback(0)
        return 1
      },
    })

    layout.width = 844
    layout.height = 390
    viewport.setSize(844, 390)

    expect(controller.isKeyboardOpen).toBe(false)
    // Keyboard closed: no pixel override — 100dvh/100vw track the toolbar.
    expect(document.documentElement.style.getPropertyValue('--organism-vvw')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--organism-vvh')).toBe('')
    controller.destroy()
  })

  it('does not frame long-form routes that did not request the contract', () => {
    const controller = new OrganismVisualViewportFrameController({
      document,
      matchMedia: () => new TestMediaQueryList() as unknown as MediaQueryList,
      visualViewport: new TestVisualViewport(),
      innerWidth: () => 390,
      innerHeight: () => 844,
    })
    expect(controller.isActive).toBe(false)
    expect(document.documentElement.dataset.organismVisualViewportFrame).toBeUndefined()
    controller.destroy()
  })

  it('exposes opt-in native viewport diagnostics without affecting normal routes', () => {
    document.body.setAttribute('data-organism-route-viewport-frame', '')
    const viewport = new TestVisualViewport()
    const controller = new OrganismVisualViewportFrameController({
      document,
      matchMedia: () => new TestMediaQueryList() as unknown as MediaQueryList,
      visualViewport: viewport,
      innerWidth: () => 390,
      innerHeight: () => 844,
      debug: true,
      requestAnimationFrame: callback => {
        callback(0)
        return 1
      },
    })

    viewport.setSize(390, 500)

    const output = document.getElementById('organism-visual-viewport-debug') as HTMLOutputElement
    expect(output.value).toContain('keyboard=true')
    expect(output.value).toContain('vv=390x500')
    controller.destroy()
    expect(document.getElementById('organism-visual-viewport-debug')).toBeNull()
  })
})
