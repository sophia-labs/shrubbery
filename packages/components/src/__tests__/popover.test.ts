/**
 * REAL tests for the popover helper — NO MOCKS. Real elements
 * (`document.createElement`) appended to the real `document.body`; where a
 * test needs a layout rect (happy-dom computes none), a real
 * `getBoundingClientRect` function is assigned on the real element instance
 * — a real stub of a real method, not a mock framework.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { ReactiveController, ReactiveControllerHost } from 'lit'
import {
  hidePopover,
  isPopoverOpen,
  positionPopover,
  PopoverController,
  showPopover,
} from '../popover.js'

function rect(overrides: Partial<DOMRect>): DOMRect {
  const base: DOMRect = {
    x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0,
    toJSON() { return this },
  }
  return { ...base, ...overrides }
}

function withRect(el: HTMLElement, r: Partial<DOMRect>): void {
  el.getBoundingClientRect = () => rect(r)
}

/** A real object implementing the ReactiveControllerHost contract — not a framework mock. */
function realHost(): ReactiveControllerHost & { controllers: ReactiveController[]; updateRequests: number } {
  const controllers: ReactiveController[] = []
  return {
    controllers,
    updateRequests: 0,
    addController(controller) {
      controllers.push(controller)
    },
    removeController(controller) {
      const index = controllers.indexOf(controller)
      if (index >= 0) controllers.splice(index, 1)
    },
    requestUpdate() {
      this.updateRequests += 1
    },
    updateComplete: Promise.resolve(true),
  }
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('showPopover / hidePopover / isPopoverOpen', () => {
  it('sets and clears the popover-open attribute fallback without throwing', () => {
    const el = document.createElement('div')
    document.body.append(el)

    expect(isPopoverOpen(el)).toBe(false)

    showPopover(el)
    expect(el.hasAttribute('popover-open')).toBe(true)
    expect(isPopoverOpen(el)).toBe(true)

    hidePopover(el)
    expect(el.hasAttribute('popover-open')).toBe(false)
    expect(isPopoverOpen(el)).toBe(false)
  })

  it('does not throw when el.showPopover/hidePopover are undefined (the happy-dom path)', () => {
    const el = document.createElement('div')
    document.body.append(el)
    expect('showPopover' in el).toBe(false)

    expect(() => showPopover(el)).not.toThrow()
    expect(() => hidePopover(el)).not.toThrow()
  })
})

describe('positionPopover', () => {
  it('bottom-start: aligns top to anchor bottom + gap, left to anchor left', () => {
    const anchor = document.createElement('button')
    const popover = document.createElement('div')
    document.body.append(anchor, popover)
    withRect(anchor, { top: 100, bottom: 130, left: 50, right: 150, width: 100, height: 30 })
    withRect(popover, { width: 200, height: 80 })

    positionPopover(anchor, popover, { placement: 'bottom-start', gap: 6, padding: 8 })

    expect(popover.style.top).toBe(`${130 + 6}px`)
    expect(popover.style.left).toBe('50px')
  })

  it('bottom-end: aligns the popover right edge to the anchor right edge', () => {
    const anchor = document.createElement('button')
    const popover = document.createElement('div')
    document.body.append(anchor, popover)
    withRect(anchor, { top: 100, bottom: 130, left: 400, right: 460, width: 60, height: 30 })
    withRect(popover, { width: 150, height: 60 })

    positionPopover(anchor, popover, { placement: 'bottom-end', gap: 4, padding: 8 })

    expect(popover.style.left).toBe(`${460 - 150}px`)
    expect(popover.style.top).toBe(`${130 + 4}px`)
  })

  it('flips bottom -> top when the anchor sits near the viewport bottom', () => {
    Object.defineProperty(window, 'innerHeight', { value: 400, configurable: true })
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true })
    const anchor = document.createElement('button')
    const popover = document.createElement('div')
    document.body.append(anchor, popover)
    withRect(anchor, { top: 370, bottom: 390, left: 50, right: 150, width: 100, height: 20 })
    withRect(popover, { width: 200, height: 80 })

    positionPopover(anchor, popover, { placement: 'bottom-start', gap: 6, padding: 8 })

    // bottom placement (390 + 6 = 396, + height 80 = 476) overflows innerHeight 400 -> flips above.
    expect(popover.style.top).toBe(`${370 - 80 - 6}px`)
  })

  it('flips top -> bottom when a top placement would overflow above the viewport', () => {
    Object.defineProperty(window, 'innerHeight', { value: 400, configurable: true })
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true })
    const anchor = document.createElement('button')
    const popover = document.createElement('div')
    document.body.append(anchor, popover)
    withRect(anchor, { top: 20, bottom: 40, left: 50, right: 150, width: 100, height: 20 })
    withRect(popover, { width: 200, height: 80 })

    positionPopover(anchor, popover, { placement: 'top-start', gap: 6, padding: 8 })

    // top placement (20 - 80 - 6 = -66) is under the padding floor -> flips below.
    expect(popover.style.top).toBe(`${40 + 6}px`)
  })

  it('clamps left for a wide popover near the right edge', () => {
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
    Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true })
    const anchor = document.createElement('button')
    const popover = document.createElement('div')
    document.body.append(anchor, popover)
    withRect(anchor, { top: 100, bottom: 130, left: 450, right: 490, width: 40, height: 30 })
    withRect(popover, { width: 300, height: 60 })

    positionPopover(anchor, popover, { placement: 'bottom-start', gap: 6, padding: 8 })

    expect(popover.style.left).toBe(`${500 - 300 - 8}px`)
  })

  it('centers bare bottom/top placements on the anchor midpoint', () => {
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true })
    const anchor = document.createElement('button')
    const popover = document.createElement('div')
    document.body.append(anchor, popover)
    withRect(anchor, { top: 100, bottom: 130, left: 400, right: 500, width: 100, height: 30 })
    withRect(popover, { width: 60, height: 20 })

    positionPopover(anchor, popover, { placement: 'bottom', gap: 6, padding: 8 })

    // Anchor midpoint 450, popover half-width 30 -> left 420.
    expect(popover.style.left).toBe('420px')
  })

  it('is a no-op if either element is missing', () => {
    const popover = document.createElement('div')
    document.body.append(popover)
    expect(() => positionPopover(null as unknown as Element, popover)).not.toThrow()
    expect(popover.style.left).toBe('')
  })
})

describe('PopoverController', () => {
  it('show() opens the popover and writes an anchored position when shouldPosition is true', () => {
    const host = realHost()
    const anchor = document.createElement('button')
    const popover = document.createElement('div')
    document.body.append(anchor, popover)
    withRect(anchor, { top: 100, bottom: 130, left: 50, right: 150, width: 100, height: 30 })
    withRect(popover, { width: 200, height: 80 })

    const controller = new PopoverController(host, {
      anchor: () => anchor,
      popover: () => popover,
      placement: 'bottom-start',
      gap: 7,
    })

    expect(controller.open).toBe(false)
    controller.show()
    expect(controller.open).toBe(true)
    expect(popover.hasAttribute('popover-open')).toBe(true)
    expect(popover.style.top).toBe(`${130 + 7}px`)
    expect(popover.style.left).toBe('50px')
  })

  it('show() with shouldPosition: () => false leaves left/top empty and open still true', () => {
    const host = realHost()
    const anchor = document.createElement('button')
    const popover = document.createElement('div')
    document.body.append(anchor, popover)
    withRect(anchor, { top: 100, bottom: 130, left: 50, right: 150, width: 100, height: 30 })
    withRect(popover, { width: 200, height: 80 })
    popover.style.left = '999px'
    popover.style.top = '999px'

    const controller = new PopoverController(host, {
      anchor: () => anchor,
      popover: () => popover,
      shouldPosition: () => false,
    })

    controller.show()
    expect(controller.open).toBe(true)
    expect(popover.style.left).toBe('')
    expect(popover.style.top).toBe('')
  })

  it('hide() closes the popover', () => {
    const host = realHost()
    const anchor = document.createElement('button')
    const popover = document.createElement('div')
    document.body.append(anchor, popover)
    withRect(anchor, { top: 0, bottom: 20, left: 0, right: 20, width: 20, height: 20 })
    withRect(popover, { width: 40, height: 40 })

    const controller = new PopoverController(host, {
      anchor: () => anchor,
      popover: () => popover,
    })

    controller.show()
    expect(controller.open).toBe(true)
    controller.hide()
    expect(controller.open).toBe(false)
    expect(popover.hasAttribute('popover-open')).toBe(false)
  })

  it('reads placement/shouldPosition fresh on each show() so desktop<->mobile can flip without reconstruction', () => {
    const host = realHost()
    const anchor = document.createElement('button')
    const popover = document.createElement('div')
    document.body.append(anchor, popover)
    withRect(anchor, { top: 100, bottom: 130, left: 50, right: 150, width: 100, height: 30 })
    withRect(popover, { width: 200, height: 80 })

    let mobile = false
    const controller = new PopoverController(host, {
      anchor: () => anchor,
      popover: () => popover,
      shouldPosition: () => !mobile,
    })

    controller.show()
    expect(popover.style.top).not.toBe('')

    controller.hide()
    mobile = true
    controller.show()
    expect(popover.style.top).toBe('')
  })

  it('guards null anchor/popover getters (safe when the host conditionally renders the popover)', () => {
    const host = realHost()
    const controller = new PopoverController(host, {
      anchor: () => null,
      popover: () => null,
    })
    expect(controller.open).toBe(false)
    expect(() => controller.show()).not.toThrow()
    expect(() => controller.hide()).not.toThrow()
    expect(() => controller.reposition()).not.toThrow()
  })

  it('hostDisconnected() hides the popover (not just detaches listeners) — regression r1', () => {
    // A disconnected-while-open popover that keeps reporting `open` (and
    // keeps its native/attribute popover-open state) would resurface
    // pre-opened and mispositioned if anything ever reinserted it — the
    // native Popover API itself auto-closes on removal from the document,
    // so the attribute fallback must mirror that here.
    const host = realHost()
    const anchor = document.createElement('button')
    const popover = document.createElement('div')
    document.body.append(anchor, popover)
    withRect(anchor, { top: 0, bottom: 20, left: 0, right: 20, width: 20, height: 20 })
    withRect(popover, { width: 40, height: 40 })

    const controller = new PopoverController(host, {
      anchor: () => anchor,
      popover: () => popover,
    })

    controller.show()
    expect(controller.open).toBe(true)
    expect(() => controller.hostDisconnected()).not.toThrow()

    expect(controller.open).toBe(false)
    expect(popover.hasAttribute('popover-open')).toBe(false)
  })

  it('hostDisconnected() detaches reposition listeners — a later scroll does not move the popover', () => {
    const host = realHost()
    const anchor = document.createElement('button')
    const popover = document.createElement('div')
    document.body.append(anchor, popover)
    withRect(anchor, { top: 0, bottom: 20, left: 0, right: 20, width: 20, height: 20 })
    withRect(popover, { width: 40, height: 40 })

    const controller = new PopoverController(host, {
      anchor: () => anchor,
      popover: () => popover,
    })

    controller.show()
    const positionedTop = popover.style.top
    const positionedLeft = popover.style.left
    expect(positionedTop).not.toBe('')

    controller.hostDisconnected()

    // Move the anchor far away and dispatch scroll: if a reposition listener
    // were still attached this would rewrite popover.style.top/left. It must
    // not — the observable proof that detachListeners() actually ran, not
    // merely that dispatching scroll didn't throw.
    withRect(anchor, { top: 900, bottom: 940, left: 700, right: 760, width: 60, height: 40 })
    window.dispatchEvent(new Event('scroll'))
    window.dispatchEvent(new Event('resize'))

    expect(popover.style.top).toBe(positionedTop)
    expect(popover.style.left).toBe(positionedLeft)
  })

  it('attaches/detaches reposition listeners on the popover document\'s own view, not always the top-level window', () => {
    // Real iframe, real distinct `contentWindow` — a popover element hosted
    // in another document must observe scroll/resize on ITS viewport, not
    // whatever `window` happens to mean in the module scope that
    // instantiated the controller.
    const host = realHost()
    const iframe = document.createElement('iframe')
    document.body.append(iframe)
    const frameDocument = iframe.contentDocument!
    const frameWindow = iframe.contentWindow as unknown as Window & typeof globalThis
    const anchor = frameDocument.createElement('button')
    const popover = frameDocument.createElement('div')
    frameDocument.body.append(anchor, popover)
    withRect(anchor, { top: 0, bottom: 20, left: 0, right: 20, width: 20, height: 20 })
    withRect(popover, { width: 40, height: 40 })
    Object.defineProperty(frameWindow, 'innerWidth', { value: 800, configurable: true })
    Object.defineProperty(frameWindow, 'innerHeight', { value: 600, configurable: true })

    let topWindowScrollAdds = 0
    let frameScrollAdds = 0
    let frameScrollRemoves = 0
    const topAdd = window.addEventListener.bind(window)
    const frameAdd = frameWindow.addEventListener.bind(frameWindow)
    const frameRemove = frameWindow.removeEventListener.bind(frameWindow)
    window.addEventListener = ((type: string, ...rest: unknown[]) => {
      if (type === 'scroll') topWindowScrollAdds += 1
      // @ts-expect-error real function wrapped with real args, not a mock framework
      return topAdd(type, ...rest)
    }) as typeof window.addEventListener
    frameWindow.addEventListener = ((type: string, ...rest: unknown[]) => {
      if (type === 'scroll') frameScrollAdds += 1
      // @ts-expect-error real function wrapped with real args, not a mock framework
      return frameAdd(type, ...rest)
    }) as typeof frameWindow.addEventListener
    frameWindow.removeEventListener = ((type: string, ...rest: unknown[]) => {
      if (type === 'scroll') frameScrollRemoves += 1
      // @ts-expect-error real function wrapped with real args, not a mock framework
      return frameRemove(type, ...rest)
    }) as typeof frameWindow.removeEventListener

    try {
      const controller = new PopoverController(host, {
        anchor: () => anchor,
        popover: () => popover,
      })

      controller.show()
      expect(frameScrollAdds).toBe(1)
      expect(topWindowScrollAdds).toBe(0)

      controller.hide()
      expect(frameScrollRemoves).toBe(1)
    } finally {
      window.addEventListener = topAdd
      frameWindow.addEventListener = frameAdd
      frameWindow.removeEventListener = frameRemove
    }
  })
})
