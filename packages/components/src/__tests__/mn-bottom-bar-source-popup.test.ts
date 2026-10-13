import { beforeEach, describe, expect, it } from 'vitest'
import '../mn-bottom-bar.js'
import type { MnBottomBar, ChromeSourceStatus } from '../mn-bottom-bar.js'

const unknown: ChromeSourceStatus = { scopeKey: 'graph-A:epoch-1', badges: [{ kind: 'unknown', glyph: '—', label: 'local copy unknown', accessibleName: 'This device has no verified copy of this graph yet.', hint: 'No complete local copy has been verified.' }] }
const trigger = (bar: MnBottomBar) => bar.shadowRoot!.querySelector<HTMLButtonElement>('[data-source-indicator]')!
const popup = (bar: MnBottomBar) => bar.shadowRoot!.querySelector<HTMLElement>('[data-source-details]')!
async function mount() {
  const bar = document.createElement('mn-bottom-bar')
  bar.sourceStatus = unknown
  document.body.append(bar); await bar.updateComplete
  return bar
}
async function open(bar: MnBottomBar) { trigger(bar).click(); await bar.updateComplete; await Promise.resolve() }

describe('situated local-copy status explanation', () => {
  beforeEach(() => { document.body.replaceChildren() })
  it('is compact and neutral when unknown; explains on click without an action', async () => {
    const bar = await mount(), actions: unknown[] = []
    bar.addEventListener('mn-source-badge-activate', event => actions.push(event))
    expect(trigger(bar).textContent?.trim()).toBe('?Local copy')
    expect(trigger(bar).getAttribute('data-state')).toBe('unknown')
    expect(trigger(bar).getAttribute('aria-expanded')).toBe('false')
    expect(popup(bar).hasAttribute('popover-open')).toBe(false)
    await open(bar)
    expect(popup(bar).hasAttribute('popover-open')).toBe(true)
    expect(popup(bar).getAttribute('role')).toBe('dialog')
    expect(popup(bar).textContent).toContain('no verified copy')
    expect(popup(bar).textContent).toContain('separate from connection and cloud-save status')
    expect(actions).toEqual([])
  })
  it('closes on Escape and returns focus to the specific indicator', async () => {
    const bar = await mount(); await open(bar)
    expect(bar.shadowRoot!.activeElement).toBe(bar.shadowRoot!.querySelector('[data-source-close]'))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await bar.updateComplete
    expect(popup(bar).hasAttribute('popover-open')).toBe(false)
    expect(trigger(bar).getAttribute('aria-expanded')).toBe('false')
    expect(bar.shadowRoot!.activeElement).toBe(trigger(bar))
  })
  it('dismisses outside without stealing focus from another control', async () => {
    const bar = await mount(); await open(bar)
    const outside = document.createElement('button'); document.body.append(outside); outside.focus()
    outside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }))
    await bar.updateComplete
    expect(popup(bar).hasAttribute('popover-open')).toBe(false)
    expect(document.activeElement).toBe(outside)
  })
  it('does not consume Escape after keyboard focus moves to another overlay or control', async () => {
    const bar = await mount(); await open(bar)
    const outside = document.createElement('button'); document.body.append(outside); outside.focus()
    let delivered = false
    outside.addEventListener('keydown', () => { delivered = true })
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true, cancelable: true })
    outside.dispatchEvent(escape)
    await bar.updateComplete
    expect(delivered).toBe(true)
    expect(escape.defaultPrevented).toBe(false)
    expect(popup(bar).hasAttribute('popover-open')).toBe(true)
    expect(document.activeElement).toBe(outside)
  })
  it('drops open detail on scope change and on disconnect/reconnect', async () => {
    const bar = await mount(); await open(bar)
    bar.sourceStatus = { ...unknown, scopeKey: 'graph-B:epoch-1' }; await bar.updateComplete
    expect(popup(bar).hasAttribute('popover-open')).toBe(false)
    await open(bar); bar.remove(); document.body.append(bar); await bar.updateComplete
    expect(trigger(bar).getAttribute('aria-expanded')).toBe('false')
    expect(popup(bar).hasAttribute('popover-open')).toBe(false)
  })
  it('retains the explicit contested destination inside details, never on open', async () => {
    const bar = await mount(), actions: unknown[] = []
    bar.sourceStatus = { scopeKey: unknown.scopeKey, badges: [{kind:'contested',glyph:'◆',label:'3 contested',accessibleName:'3 objects are contested.',hint:'Inspect before choosing.'}] }
    await bar.updateComplete
    bar.addEventListener('mn-source-badge-activate', event => actions.push((event as CustomEvent).detail))
    await open(bar); expect(actions).toEqual([])
    const badge = popup(bar).querySelector('mn-badge')!; await badge.updateComplete
    badge.shadowRoot!.querySelector<HTMLButtonElement>('button')!.click(); await bar.updateComplete
    expect(actions).toEqual([{ kind: 'contested' }])
    expect(popup(bar).hasAttribute('popover-open')).toBe(false)
  })
  it('anchors above its indicator and clamps to the viewport (geometry model, not browser proof)', async () => {
    const bar = await mount()
    trigger(bar).getBoundingClientRect = () => ({left:100,top:700,right:190,bottom:724,width:90,height:24}) as DOMRect
    popup(bar).getBoundingClientRect = () => ({width:300,height:240}) as DOMRect
    await open(bar)
    expect(popup(bar).style.left).toBe('8px')
    expect(popup(bar).style.top).toBe('454px')
  })
})
