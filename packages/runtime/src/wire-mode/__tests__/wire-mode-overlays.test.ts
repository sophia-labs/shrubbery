/**
 * Tests for the pure DOM overlay primitives.
 *
 * Happy-dom returns zeroes from getBoundingClientRect() for unmounted/empty
 * elements, so the position-correctness tests stub it via Object.defineProperty
 * on the target. We exercise: element creation + body attachment, scroll
 * listener install + cleanup, setTarget(null) hide / setTarget(element) show,
 * destroy idempotence + listener removal.
 *
 * Visual correctness (real BCR values, scroll behavior in a real layout) is
 * deferred to the atelier integration test in C5.
 */

import { afterEach, describe, expect, it } from 'vitest'
import {
  createSourceHighlightOverlay,
  createTargetHighlightOverlay,
} from '../wire-mode-overlays.js'

afterEach(() => {
  document.body.innerHTML = ''
})

function makeBlock(rect: { top: number; left: number; width: number; height: number }): HTMLElement {
  const el = document.createElement('div')
  el.setAttribute('data-block-id', 'block-x')
  document.body.appendChild(el)
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: () => ({}) }),
    configurable: true,
  })
  return el
}

describe('createSourceHighlightOverlay', () => {
  it('creates a #wire-source-highlight div in document.body', () => {
    const target = makeBlock({ top: 100, left: 50, width: 200, height: 40 })
    const handle = createSourceHighlightOverlay({ doc: document, target })
    expect(handle.element.id).toBe('wire-source-highlight')
    expect(handle.element.parentElement).toBe(document.body)
    expect(handle.element.style.position).toBe('fixed')
    expect(handle.element.style.pointerEvents).toBe('none')
    handle.destroy()
  })

  it('positions the overlay over the target with 4px padding', () => {
    const target = makeBlock({ top: 100, left: 50, width: 200, height: 40 })
    const handle = createSourceHighlightOverlay({ doc: document, target })
    expect(handle.element.style.top).toBe('96px')
    expect(handle.element.style.left).toBe('46px')
    expect(handle.element.style.width).toBe('208px')
    expect(handle.element.style.height).toBe('48px')
    handle.destroy()
  })

  it('repositions on capture-phase window scroll', () => {
    let rect = { top: 100, left: 50, width: 200, height: 40 }
    const target = document.createElement('div')
    document.body.appendChild(target)
    Object.defineProperty(target, 'getBoundingClientRect', {
      value: () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: () => ({}) }),
      configurable: true,
    })
    const handle = createSourceHighlightOverlay({ doc: document, target })
    expect(handle.element.style.top).toBe('96px')

    rect = { top: 250, left: 50, width: 200, height: 40 }
    window.dispatchEvent(new Event('scroll'))
    expect(handle.element.style.top).toBe('246px')
    handle.destroy()
  })

  it('destroy removes the element + uninstalls the scroll listener', () => {
    const target = makeBlock({ top: 0, left: 0, width: 1, height: 1 })
    const handle = createSourceHighlightOverlay({ doc: document, target })
    expect(document.getElementById('wire-source-highlight')).not.toBeNull()
    handle.destroy()
    expect(document.getElementById('wire-source-highlight')).toBeNull()
    // Scroll after destroy — the listener should be gone; assert no throw and
    // the element stays removed.
    window.dispatchEvent(new Event('scroll'))
    expect(document.getElementById('wire-source-highlight')).toBeNull()
  })

  it('destroy is idempotent', () => {
    const target = makeBlock({ top: 0, left: 0, width: 1, height: 1 })
    const handle = createSourceHighlightOverlay({ doc: document, target })
    handle.destroy()
    expect(() => handle.destroy()).not.toThrow()
  })
})

describe('createTargetHighlightOverlay', () => {
  it('creates a #wire-target-highlight div in document.body, initially hidden', () => {
    const handle = createTargetHighlightOverlay({ doc: document })
    expect(handle.element.id).toBe('wire-target-highlight')
    expect(handle.element.parentElement).toBe(document.body)
    expect(handle.element.style.display).toBe('none')
    handle.destroy()
  })

  it('setTarget(element) shows + positions the overlay', () => {
    const handle = createTargetHighlightOverlay({ doc: document })
    const target = makeBlock({ top: 200, left: 10, width: 100, height: 30 })
    handle.setTarget(target)
    expect(handle.element.style.display).toBe('')
    expect(handle.element.style.top).toBe('196px')
    expect(handle.element.style.left).toBe('6px')
    expect(handle.element.style.width).toBe('108px')
    expect(handle.element.style.height).toBe('38px')
    handle.destroy()
  })

  it('setTarget(null) hides the overlay', () => {
    const handle = createTargetHighlightOverlay({ doc: document })
    const target = makeBlock({ top: 0, left: 0, width: 10, height: 10 })
    handle.setTarget(target)
    expect(handle.element.style.display).toBe('')
    handle.setTarget(null)
    expect(handle.element.style.display).toBe('none')
    handle.destroy()
  })

  it('moves between targets via setTarget', () => {
    const handle = createTargetHighlightOverlay({ doc: document })
    const a = makeBlock({ top: 100, left: 0, width: 50, height: 20 })
    const b = makeBlock({ top: 300, left: 0, width: 50, height: 20 })
    handle.setTarget(a)
    expect(handle.element.style.top).toBe('96px')
    handle.setTarget(b)
    expect(handle.element.style.top).toBe('296px')
    handle.destroy()
  })

  it('scroll only repositions when there is a current target', () => {
    let bRect = { top: 300, left: 0, width: 50, height: 20 }
    const b = document.createElement('div')
    document.body.appendChild(b)
    Object.defineProperty(b, 'getBoundingClientRect', {
      value: () => ({ ...bRect, right: bRect.left + bRect.width, bottom: bRect.top + bRect.height, x: bRect.left, y: bRect.top, toJSON: () => ({}) }),
      configurable: true,
    })
    const handle = createTargetHighlightOverlay({ doc: document })
    // No target yet — scroll should not throw / not set position.
    window.dispatchEvent(new Event('scroll'))
    expect(handle.element.style.top).toBe('')

    handle.setTarget(b)
    expect(handle.element.style.top).toBe('296px')
    bRect = { top: 400, left: 0, width: 50, height: 20 }
    window.dispatchEvent(new Event('scroll'))
    expect(handle.element.style.top).toBe('396px')
    handle.destroy()
  })

  it('destroy removes the element + uninstalls the scroll listener', () => {
    const handle = createTargetHighlightOverlay({ doc: document })
    handle.destroy()
    expect(document.getElementById('wire-target-highlight')).toBeNull()
    // After destroy, setTarget is a no-op (does not re-add the element).
    expect(() => handle.setTarget(document.createElement('div'))).not.toThrow()
    expect(document.getElementById('wire-target-highlight')).toBeNull()
  })

  it('destroy is idempotent', () => {
    const handle = createTargetHighlightOverlay({ doc: document })
    handle.destroy()
    expect(() => handle.destroy()).not.toThrow()
  })
})
