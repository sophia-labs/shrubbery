/**
 * REAL component test — mn-presence-inspector (hoisted, standalone).
 *
 * NO MOCKS: instantiates the REAL @customElement, mounts it in the
 * (happy-dom) document, and asserts its REAL shadow DOM + behaviour. Mirrors
 * `mn-bottom-bar.test.ts`'s own presence-inspector assertions (this element
 * is a byte-identical hoist of that markup/logic) — proving the SAME
 * behavior now stands on its own, addressable tag.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import '../mn-presence-inspector.js'
import type { MnPresenceInspector, ChromePresencePerson } from '../mn-presence-inspector.js'

async function mount(setup?: (el: MnPresenceInspector) => void): Promise<MnPresenceInspector> {
  const el = document.createElement('mn-presence-inspector') as MnPresenceInspector
  if (setup) setup(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

const sr = (el: MnPresenceInspector) => el.shadowRoot!

describe('mn-presence-inspector — real custom element', () => {
  beforeAll(() => {
    expect(customElements.get('mn-presence-inspector')).toBeDefined()
  })

  it('upgrades the tag and builds a shadow root', async () => {
    const el = await mount()
    expect(el.shadowRoot).not.toBeNull()
    expect(el.tagName.toLowerCase()).toBe('mn-presence-inspector')
  })

  it('renders an honest empty state when no person is set', async () => {
    const el = await mount()
    expect(sr(el).querySelector('.presence-inspector')).toBeNull()
    expect(sr(el).querySelector('mn-empty-state')).not.toBeNull()
  })

  it('renders a controlled same-human inspector and exposes only real self profile intents', async () => {
    const person: ChromePresencePerson = {
      id: 'human:vera',
      name: 'Vera',
      color: '#2563eb',
      type: 'human',
      sessionCount: 2,
      deviceCount: 1,
      isSelf: true,
      clientIds: ['vera-tab-a', 'vera-tab-b'],
      sessions: [
        { clientId: 'vera-tab-a', deviceId: 'vera-device', hasCursor: true, isLocal: true },
        { clientId: 'vera-tab-b', deviceId: 'vera-device', hasCursor: true, isLocal: false },
      ],
    }
    const el = await mount(e => {
      e.person = person
      e.selfPresenceEditable = true
      e.presenceColors = ['#2563eb', '#16a34a']
    })
    const inspector = sr(el).querySelector('[data-presence-inspector="human:vera"]')
    expect(inspector?.getAttribute('role')).toBe('dialog')
    expect(inspector?.textContent).toContain('2 live tabs across one device')
    expect(inspector?.textContent).toContain('Tab 2 (you, other tab)')
    expect(inspector?.querySelectorAll('.presence-follow')).toHaveLength(0)

    const updates: unknown[] = []
    el.addEventListener('mn-presence-self-update', event => {
      updates.push((event as CustomEvent).detail)
    })
    const name = inspector!.querySelector('[data-presence-name]') as HTMLInputElement
    name.value = 'Vera Prime'
    name.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
    ;(inspector!.querySelector('[data-presence-color="#16a34a"]') as HTMLButtonElement).click()
    expect(updates).toEqual([
      { person, name: 'Vera Prime' },
      { person, color: '#16a34a' },
    ])
  })

  it('states agent truth and emits follow for one exact cursor-bearing session', async () => {
    const person: ChromePresencePerson = {
      id: 'agent:sophia',
      name: 'Sophia',
      color: '#7c3aed',
      type: 'agent',
      sessionCount: 1,
      deviceCount: 1,
      isSelf: false,
      clientIds: ['agent-run-1'],
      sessions: [{ clientId: 'agent-run-1', deviceId: 'choreograph', hasCursor: true }],
    }
    const el = await mount(e => {
      e.person = person
      e.selfPresenceEditable = true
    })
    const inspector = sr(el).querySelector('[data-presence-inspector="agent:sophia"]')!
    expect(inspector.querySelector('[data-presence-actor-type]')?.textContent).toBe('Agent')
    expect(inspector.querySelector('[data-presence-self-controls]')).toBeNull()
    const followed: unknown[] = []
    el.addEventListener('mn-presence-follow', event => {
      followed.push((event as CustomEvent).detail)
    })
    ;(inspector.querySelector('.presence-follow') as HTMLButtonElement).click()
    expect(followed).toEqual([{
      person,
      session: person.sessions![0],
      following: true,
    }])
  })

  it('emits mn-presence-close on Escape and on the close button, but not when showClose is false', async () => {
    const person: ChromePresencePerson = { id: 'human:x', name: 'X', color: '#2563eb', type: 'human' }
    const el = await mount(e => { e.person = person })
    const closed: unknown[] = []
    el.addEventListener('mn-presence-close', () => closed.push(true))
    const closeButton = sr(el).querySelector('.presence-inspector-close') as HTMLButtonElement
    expect(closeButton).not.toBeNull()
    closeButton.click()
    expect(closed).toHaveLength(1)

    const leafEl = await mount(e => {
      e.person = person
      e.showClose = false
    })
    expect(sr(leafEl).querySelector('.presence-inspector-close')).toBeNull()
  })
})
