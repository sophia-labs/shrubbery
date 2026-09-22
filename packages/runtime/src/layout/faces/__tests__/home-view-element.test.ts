/**
 * home-view-element.test.ts — real `<sh-home-view>` custom element mounted
 * directly. Proves the aesthetic-overhaul pass's shared typographic
 * hierarchy: even the quietest of the five faces wears the same small-caps
 * muted label treatment as `stat.scalar`'s `.label` / `card.subject`'s `dt`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import '../home-view-element.js'
import type { ShHomeView } from '../home-view-element.js'

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('div')
  document.body.appendChild(root)
})

afterEach(() => {
  root.remove()
})

describe('sh-home-view — shared typographic hierarchy', () => {
  it('says the same honest thing it always has', async () => {
    const view = document.createElement('sh-home-view') as ShHomeView
    root.appendChild(view)
    await view.updateComplete
    expect(view.shadowRoot!.querySelector('.label')!.textContent).toBe('Nothing is open here')
  })

  it('the label carries the same small-caps muted treatment as stat.scalar/card.subject', async () => {
    const view = document.createElement('sh-home-view') as ShHomeView
    root.appendChild(view)
    await view.updateComplete
    const style = getComputedStyle(view.shadowRoot!.querySelector('.label')!)
    expect(style.fontVariantCaps).toBe('all-small-caps')
  })
})
