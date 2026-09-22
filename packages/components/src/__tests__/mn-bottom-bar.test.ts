/**
 * REAL component test — mn-bottom-bar chrome shell.
 *
 * NO MOCKS: instantiates the REAL @customElement, mounts it in the (happy-dom)
 * document, and asserts its REAL shadow DOM + behaviour.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import '../mn-bottom-bar.js'
import type { MnBottomBar, ChromeSourceStatus } from '../mn-bottom-bar.js'
import type { MnBadge } from '../mn-badge.js'

async function mount(setup?: (el: MnBottomBar) => void): Promise<MnBottomBar> {
  const el = document.createElement('mn-bottom-bar') as MnBottomBar
  if (setup) setup(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

const sr = (el: MnBottomBar) => el.shadowRoot!

describe('mn-bottom-bar — real custom element', () => {
  beforeAll(() => {
    expect(customElements.get('mn-bottom-bar')).toBeDefined()
  })

  it('upgrades the tag and builds a shadow root', async () => {
    const el = await mount()
    expect(el.shadowRoot).not.toBeNull()
    expect(el.tagName.toLowerCase()).toBe('mn-bottom-bar')
  })

  it('renders the 3-section grid (left / center / right)', async () => {
    const el = await mount()
    expect(sr(el).querySelector('.left-section')).not.toBeNull()
    expect(sr(el).querySelector('.center-section')).not.toBeNull()
    expect(sr(el).querySelector('.right-section')).not.toBeNull()
  })

  it('LEFT panel-mode toggles render; files active by default', async () => {
    const el = await mount()
    const toggles = Array.from(
      sr(el).querySelector('.left-section')!.querySelectorAll('.toggle-btn'),
    ) as HTMLButtonElement[]
    // The caption lives in a .toggle-label span (the sibling .toggle-icon glyph
    // is hidden in Garden and shown icon-only in Emporium); the label text stays
    // in the DOM for a11y regardless of skin.
    expect(
      toggles.map(t => t.querySelector('.toggle-label')!.textContent!.trim()),
    ).toEqual(['Files', 'Graph', 'Outline'])
    expect(toggles[0].classList.contains('active')).toBe(true)
    expect(toggles[0].getAttribute('aria-pressed')).toBe('true')
    expect(toggles[1].getAttribute('aria-pressed')).toBe('false')
    expect(toggles[2].getAttribute('aria-pressed')).toBe('false')
  })

  it('leftPanelMode prop drives the active left toggle (controlled, no store)', async () => {
    const el = await mount(e => { e.leftPanelMode = 'graph' })
    const toggles = Array.from(
      sr(el).querySelector('.left-section')!.querySelectorAll('.toggle-btn'),
    ) as HTMLButtonElement[]
    expect(toggles[0].getAttribute('aria-pressed')).toBe('false')
    expect(toggles[1].getAttribute('aria-pressed')).toBe('true')
    expect(toggles[1].classList.contains('active')).toBe(true)
    expect(toggles[2].getAttribute('aria-pressed')).toBe('false')
  })

  it('leftPanelMode="outline" drives the active left toggle', async () => {
    const el = await mount(e => { e.leftPanelMode = 'outline' })
    const toggles = Array.from(
      sr(el).querySelector('.left-section')!.querySelectorAll('.toggle-btn'),
    ) as HTMLButtonElement[]
    expect(toggles[2].getAttribute('aria-pressed')).toBe('true')
    expect(toggles[2].classList.contains('active')).toBe(true)
  })

  it('clicking a left mode emits mn-left-mode-change (does NOT self-mutate)', async () => {
    const el = await mount()
    let detail: { mode: string } | null = null
    el.addEventListener('mn-left-mode-change', e => { detail = (e as CustomEvent).detail })
    const graph = sr(el).querySelector('.left-section')!.querySelectorAll('.toggle-btn')[1] as HTMLButtonElement
    graph.click()
    expect(detail).toEqual({ mode: 'graph' })
    expect(el.leftPanelMode).toBe('files') // controlled: shell owns the state
  })

  it('clicking the outline toggle emits mn-left-mode-change with mode "outline"', async () => {
    const el = await mount()
    let detail: { mode: string } | null = null
    el.addEventListener('mn-left-mode-change', e => { detail = (e as CustomEvent).detail })
    const outline = sr(el).querySelector('.left-section')!.querySelectorAll('.toggle-btn')[2] as HTMLButtonElement
    outline.click()
    expect(detail).toEqual({ mode: 'outline' })
  })

  it('RIGHT panel toggles render; chat (Sophia) active by default', async () => {
    const el = await mount()
    const toggles = Array.from(
      sr(el).querySelector('.right-section')!.querySelectorAll('.toggle-btn'),
    ) as HTMLButtonElement[]
    expect(
      toggles.map(t => t.querySelector('.toggle-label')!.textContent!.trim()),
    ).toEqual(['Sophia', 'Comments', 'Wires', 'Graph'])
    expect(toggles[0].classList.contains('active')).toBe(true) // 'chat' in default panels
    expect(toggles[1].classList.contains('active')).toBe(false)
    expect(toggles[3].classList.contains('active')).toBe(false)
  })

  it('the compatibility panels prop projects to one active right toggle', async () => {
    const el = await mount(e => { e.panels = ['comments', 'wires'] })
    const toggles = Array.from(
      sr(el).querySelector('.right-section')!.querySelectorAll('.toggle-btn'),
    ) as HTMLButtonElement[]
    expect(toggles[0].getAttribute('aria-pressed')).toBe('false') // chat closed
    expect(toggles[1].getAttribute('aria-pressed')).toBe('false') // comments replaced
    expect(toggles[2].getAttribute('aria-pressed')).toBe('true')  // most recent selection
    expect(toggles[3].getAttribute('aria-pressed')).toBe('false')
    expect(toggles.filter(toggle => toggle.getAttribute('aria-pressed') === 'true')).toHaveLength(1)
  })

  it('the scalar panel prop controls the selected right toggle', async () => {
    const el = await mount(e => { e.panel = 'comments' })
    const toggles = Array.from(
      sr(el).querySelector('.right-section')!.querySelectorAll('.toggle-btn'),
    ) as HTMLButtonElement[]
    expect(toggles[0].getAttribute('aria-pressed')).toBe('false')
    expect(toggles[1].getAttribute('aria-pressed')).toBe('true')
    expect(toggles[2].getAttribute('aria-pressed')).toBe('false')
    expect(toggles[3].getAttribute('aria-pressed')).toBe('false')
  })

  it('clicking a right panel toggle emits mn-panel-toggle with the panel id', async () => {
    const el = await mount()
    const seen: string[] = []
    el.addEventListener('mn-panel-toggle', e => { seen.push((e as CustomEvent).detail.panel) })
    const toggles = sr(el).querySelector('.right-section')!.querySelectorAll('.toggle-btn')
    ;(toggles[1] as HTMLButtonElement).click() // comments
    ;(toggles[2] as HTMLButtonElement).click() // wires
    expect(seen).toEqual(['comments', 'wires'])
  })

  it('the three data areas are INERT slots — empty, no faked counts/stats/presence', async () => {
    const el = await mount()
    const left = sr(el).querySelector('.left-section')!.querySelector('slot[name="left-status"]')
    const center = sr(el).querySelector('.center-section')!.querySelector('slot[name="center-status"]')
    const right = sr(el).querySelector('.right-section')!.querySelector('slot[name="right-status"]')
    expect(left).not.toBeNull()
    expect(center).not.toBeNull()
    expect(right).not.toBeNull()
    // No faked "0 items" / "0 words" / presence avatars / sync dot.
    expect(sr(el).querySelector('.center-section')!.textContent?.trim()).toBe('')
    expect(left!.getAttribute('data-inert-slot')).toBe('left-status')
    expect(center!.getAttribute('data-inert-slot')).toBe('center-status')
    expect(right!.getAttribute('data-inert-slot')).toBe('right-status')
  })

  it('projects live item, document, presence, sync, and runtime state', async () => {
    const el = await mount(e => {
      e.itemCount = 12
      e.documentStats = { words: 42, characters: 271, selectedCharacters: 8, blockType: 'Paragraph' }
      e.presence = [
        { id: 'vera', name: 'Vera', color: '#2563eb' },
        { id: 'eschaton', name: 'Eschaton', color: '#16a34a' },
      ]
      e.syncState = 'synced'
      e.runtimeMode = 'hosted'
    })
    expect(sr(el).querySelector('[data-item-count]')?.textContent).toContain('12 items')
    expect(sr(el).querySelector('[data-document-stats]')?.textContent).toContain('42 words')
    expect(sr(el).querySelector('[data-document-stats]')?.textContent).toContain('8 selected')
    expect(sr(el).querySelectorAll('[data-presence-id]')).toHaveLength(2)
    expect(sr(el).querySelector('.sync-state')?.getAttribute('data-state')).toBe('synced')
    expect(sr(el).querySelector('.sync-state')?.textContent).toContain('Connected')
    expect(sr(el).querySelector('[data-live-status]')?.textContent).toContain('hosted')
    expect(sr(el).querySelector('slot[name="right-status"]')).toBeNull()
  })

  it('shows reading time from documentStats.readingTimeMinutes and an export button when available', async () => {
    const el = await mount(e => {
      e.documentStats = { words: 420, characters: 2100, readingTimeMinutes: 3 }
      e.documentExportAvailable = true
    })
    const stats = sr(el).querySelector('[data-document-stats]')
    expect(stats?.textContent).toContain('3 min read')
    const exportBtn = sr(el).querySelector('.export-btn') as HTMLButtonElement
    expect(exportBtn).not.toBeNull()

    const seen: string[] = []
    el.addEventListener('mn-document-export', () => seen.push('export'))
    exportBtn.click()
    expect(seen).toEqual(['export'])
  })

  it('shows sub-minute reading time as "<1 min read" and hides export when unavailable', async () => {
    const el = await mount(e => {
      e.documentStats = { words: 5, characters: 20, readingTimeMinutes: 0 }
      e.documentExportAvailable = false
    })
    expect(sr(el).querySelector('[data-document-stats]')?.textContent).toContain('<1 min read')
    expect(sr(el).querySelector('.export-btn')).toBeNull()
  })

  it('distinguishes connecting, reconnecting, and intentional disconnect without save claims', async () => {
    const el = await mount(e => { e.runtimeMode = 'hosted' })
    const states = [
      ['connecting', 'Connecting'],
      ['reconnecting', 'Reconnecting'],
      ['disconnected', 'Disconnected'],
      ['synced', 'Connected'],
    ] as const
    for (const [state, label] of states) {
      el.syncState = state
      await el.updateComplete
      expect(sr(el).querySelector('.sync-state')?.textContent?.trim()).toBe(label)
    }
    expect(sr(el).querySelector('.sync-state')?.textContent).not.toMatch(/saved|up to date/i)
  })

  it('explains grouped same-human tabs and emits a controlled presence-open intent', async () => {
    const person = {
      id: 'human:vera',
      name: 'Vera',
      color: '#2563eb',
      sessionCount: 2,
      deviceCount: 1,
      isSelf: true,
    }
    const el = await mount(e => { e.presence = [person] })
    const opened: unknown[] = []
    el.addEventListener('mn-presence-open', event => {
      opened.push((event as CustomEvent).detail)
    })
    const avatar = sr(el).querySelector('[data-presence-id="human:vera"]') as HTMLButtonElement
    expect(avatar.title).toBe('Vera (you) · 2 tabs')
    expect(avatar.getAttribute('data-session-count')).toBe('2')
    expect(avatar.querySelector('.presence-count')?.textContent).toBe('2')
    avatar.click()
    expect(opened).toEqual([{ person }])
  })

  it('renders a controlled same-human inspector and exposes only real self profile intents', async () => {
    const person = {
      id: 'human:vera',
      name: 'Vera',
      color: '#2563eb',
      type: 'human' as const,
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
      e.presence = [person]
      e.openPresenceId = person.id
      e.selfPresenceEditable = true
      e.presenceColors = ['#2563eb', '#16a34a']
    })
    expect(el.openPresenceId).toBe(person.id)
    expect(el.presence).toEqual([person])
    // The REAL, separately-tagged <mn-presence-inspector> (this file's own
    // header) — its content lives in ITS OWN shadow root, one boundary past
    // mn-bottom-bar's. `mn-presence-inspector.test.ts` owns the exhaustive
    // content assertions for that element; this test only proves
    // mn-bottom-bar mounts the REAL element with the right properties and
    // that its real events cross back out (composed: true).
    const inspectorHost = sr(el).querySelector('mn-presence-inspector') as (HTMLElement & { updateComplete: Promise<boolean> }) | null
    expect(inspectorHost).not.toBeNull()
    await inspectorHost!.updateComplete
    const inspector = inspectorHost!.shadowRoot!.querySelector('[data-presence-inspector="human:vera"]')
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
    expect(el.openPresenceId).toBe(person.id)
    expect(el.presence[0].name).toBe('Vera')
  })

  it('states agent truth and emits follow for one exact cursor-bearing session', async () => {
    const person = {
      id: 'agent:sophia',
      name: 'Sophia',
      color: '#7c3aed',
      type: 'agent' as const,
      sessionCount: 1,
      deviceCount: 1,
      isSelf: false,
      clientIds: ['agent-run-1'],
      sessions: [{ clientId: 'agent-run-1', deviceId: 'choreograph', hasCursor: true }],
    }
    const el = await mount(e => {
      e.presence = [person]
      e.openPresenceId = person.id
      e.selfPresenceEditable = true
    })
    expect(el.openPresenceId).toBe(person.id)
    const inspectorHost = sr(el).querySelector('mn-presence-inspector') as (HTMLElement & { updateComplete: Promise<boolean> }) | null
    expect(inspectorHost).not.toBeNull()
    await inspectorHost!.updateComplete
    const inspector = inspectorHost!.shadowRoot!.querySelector('[data-presence-inspector="agent:sophia"]')!
    expect(inspector.querySelector('[data-presence-actor-type]')?.textContent).toBe('Agent')
    expect(inspector.querySelector('[data-presence-self-controls]')).toBeNull()
    const followed: unknown[] = []
    el.addEventListener('mn-presence-follow', event => {
      followed.push((event as CustomEvent).detail)
    })
    ;(inspector.querySelector('.presence-follow') as HTMLButtonElement).click()
    expect(followed).toEqual([{
      person,
      session: person.sessions[0],
      following: true,
    }])
    expect(el.followedPresenceClientId).toBeNull()
  })

  it('keeps bounded avatars but exposes every additional actor through controlled overflow', async () => {
    const people = Array.from({ length: 6 }, (_, index) => ({
      id: `human:user-${index}`,
      name: `User ${index}`,
      color: '#2563eb',
      type: 'human' as const,
    }))
    const el = await mount(e => { e.presence = people })
    expect(sr(el).querySelectorAll('.presence-avatar')).toHaveLength(4)
    const toggles: unknown[] = []
    el.addEventListener('mn-presence-overflow-toggle', event => {
      toggles.push((event as CustomEvent).detail)
    })
    ;(sr(el).querySelector('[data-presence-overflow]') as HTMLButtonElement).click()
    expect(toggles).toEqual([{ open: true }])
    expect(el.presenceOverflowOpen).toBe(false)

    el.presenceOverflowOpen = true
    await el.updateComplete
    expect(el.presenceOverflowOpen).toBe(true)
    expect(sr(el).querySelectorAll('[data-overflow-presence-id]')).toHaveLength(2)
    const opened: unknown[] = []
    el.addEventListener('mn-presence-open', event => opened.push((event as CustomEvent).detail))
    ;(sr(el).querySelector('[data-overflow-presence-id="human:user-4"]') as HTMLButtonElement).click()
    expect(opened).toEqual([{ person: people[4] }])
  })

  it('collapse props reflect to host attributes (drives the grid CSS)', async () => {
    const el = await mount(e => { e.leftCollapsed = true; e.rightCollapsed = true })
    expect(el.hasAttribute('left-collapsed')).toBe(true)
    expect(el.hasAttribute('right-collapsed')).toBe(true)
  })

  // ── mirror badges (master §3 Slice 4, copy deck §7.2) ────────────────────

  const THREE_BADGES: ChromeSourceStatus = {
    badges: [
      {
        kind: 'contested',
        glyph: '◆',
        label: '3 contested',
        accessibleName: '3 objects are contested. Open the contested list.',
        hint: 'Two writers proposed different values from the same starting point.',
      },
      {
        kind: 'pending',
        glyph: '↑',
        label: '2 pending',
        accessibleName: '2 changes are saved here and have not reached the cell yet.',
        hint: 'Saved on this device. Not yet acknowledged.',
      },
      {
        kind: 'parked',
        glyph: '⏸',
        label: '1 parked',
        accessibleName: '1 piece of work is parked from a previous life of this graph.',
        hint: 'Kept safe. Nothing was merged.',
      },
    ],
  }

  it('sourceStatus null keeps the legacy inert right-status slot (never bound)', async () => {
    const el = await mount()
    expect(sr(el).querySelector('slot[name="right-status"]')).not.toBeNull()
    expect(sr(el).querySelector('[data-mirror-status]')).toBeNull()
  })

  it('renders one real <mn-badge> per mirror badge, inside an announced role="status" group', async () => {
    const el = await mount(e => { e.sourceStatus = THREE_BADGES })
    const group = sr(el).querySelector('[data-mirror-status]')!
    expect(group.getAttribute('role')).toBe('status')
    expect(group.getAttribute('aria-live')).toBe('polite')
    expect(group.getAttribute('aria-atomic')).toBe('true')
    expect(group.getAttribute('aria-label')).toBe('Local source state')
    const badges = Array.from(group.querySelectorAll('mn-badge')) as MnBadge[]
    expect(badges).toHaveLength(3)
    expect(badges.map(b => b.dataset.sourceBadge)).toEqual(['contested', 'pending', 'parked'])
    expect(badges.map(b => b.glyph)).toEqual(['◆', '↑', '⏸'])
    expect(badges.map(b => b.label)).toEqual(['3 contested', '2 pending', '1 parked'])
    expect(badges.map(b => b.getAttribute('aria-label'))).toEqual([
      '3 objects are contested. Open the contested list.',
      '2 changes are saved here and have not reached the cell yet.',
      '1 piece of work is parked from a previous life of this graph.',
    ])
    // The slot is gone the moment a mirror truth is bound.
    expect(sr(el).querySelector('slot[name="right-status"]')).toBeNull()
  })

  it('the LIVE group is aria-live="off" — presence/sync flap and must never be announced', async () => {
    const el = await mount(e => {
      e.sourceStatus = THREE_BADGES
      e.syncState = 'synced'
    })
    const live = sr(el).querySelector('[data-live-status]')!
    expect(live.getAttribute('aria-live')).toBe('off')
    expect(live.getAttribute('aria-label')).toBe('Live session')
  })

  it('sourceStatus bound with EMPTY badges (all-clear) renders the group with zero badges, never the inert slot', async () => {
    const el = await mount(e => { e.sourceStatus = { badges: [] } })
    expect(sr(el).querySelector('slot[name="right-status"]')).toBeNull()
    const group = sr(el).querySelector('[data-mirror-status]')
    expect(group).not.toBeNull()
    expect(group!.querySelectorAll('mn-badge')).toHaveLength(0)
  })

  it('the contested badge alone carries the stance-token part hook, standard badges get a Garden-core state', async () => {
    const el = await mount(e => { e.sourceStatus = THREE_BADGES })
    const badges = Array.from(sr(el).querySelectorAll('mn-badge')) as MnBadge[]
    const [contested, pending, parked] = badges
    expect(contested.getAttribute('data-source-badge')).toBe('contested')
    expect(pending.state).toBe('active')
    expect(parked.state).toBe('warning')
  })

  it('right-collapsed renders badges GLYPH-ONLY (label cleared) — count stays reachable via aria-label', async () => {
    const el = await mount(e => { e.sourceStatus = THREE_BADGES; e.rightCollapsed = true })
    const badges = Array.from(sr(el).querySelectorAll('mn-badge')) as MnBadge[]
    expect(badges.map(b => b.label)).toEqual(['', '', ''])
    expect(badges.map(b => b.glyph)).toEqual(['◆', '↑', '⏸'])
    expect(badges.map(b => b.getAttribute('aria-label'))).toEqual([
      '3 objects are contested. Open the contested list.',
      '2 changes are saved here and have not reached the cell yet.',
      '1 piece of work is parked from a previous life of this graph.',
    ])
  })

  // ── badge click-through (build bundle review finding 4, 2026-07-31) ──────
  // The contested/parked counts promise a destination surface (copy deck
  // §7.2, "Open the contested list") but the badge rendered as an inert
  // `<mn-badge>` with no action event — clicking it did nothing. Controlled:
  // props in (`sourceStatus`), event out (`mn-source-badge-activate`); this
  // component itself never navigates or mutates any store.

  it('the contested badge is a REAL interactive button, and clicking it emits mn-source-badge-activate with kind "contested"', async () => {
    const el = await mount(e => { e.sourceStatus = THREE_BADGES })
    const seen: Array<{ kind: string }> = []
    el.addEventListener('mn-source-badge-activate', event => { seen.push((event as CustomEvent).detail) })
    const [contested] = Array.from(sr(el).querySelectorAll('mn-badge')) as MnBadge[]
    expect(contested.interactive).toBe(true)
    contested.shadowRoot!.querySelector('button')!.click()
    expect(seen).toEqual([{ kind: 'contested' }])
  })

  it('the parked badge is a REAL interactive button, and clicking it emits mn-source-badge-activate with kind "parked"', async () => {
    const el = await mount(e => { e.sourceStatus = THREE_BADGES })
    const seen: Array<{ kind: string }> = []
    el.addEventListener('mn-source-badge-activate', event => { seen.push((event as CustomEvent).detail) })
    const [, , parked] = Array.from(sr(el).querySelectorAll('mn-badge')) as MnBadge[]
    expect(parked.interactive).toBe(true)
    parked.shadowRoot!.querySelector('button')!.click()
    expect(seen).toEqual([{ kind: 'parked' }])
  })

  it('the pending badge has no destination — stays a plain, non-interactive span, never emits mn-source-badge-activate', async () => {
    const el = await mount(e => { e.sourceStatus = THREE_BADGES })
    const seen: unknown[] = []
    el.addEventListener('mn-source-badge-activate', event => { seen.push((event as CustomEvent).detail) })
    const [, pending] = Array.from(sr(el).querySelectorAll('mn-badge')) as MnBadge[]
    expect(pending.interactive).toBe(false)
    expect(pending.shadowRoot!.querySelector('button')).toBeNull()
    pending.shadowRoot!.querySelector('.badge')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, composed: true }),
    )
    expect(seen).toEqual([])
  })

  it('right-collapsed (glyph-only) leaves the contested badge just as clickable — the destination is not lost under the icon-only rendering', async () => {
    const el = await mount(e => { e.sourceStatus = THREE_BADGES; e.rightCollapsed = true })
    const seen: Array<{ kind: string }> = []
    el.addEventListener('mn-source-badge-activate', event => { seen.push((event as CustomEvent).detail) })
    const [contested] = Array.from(sr(el).querySelectorAll('mn-badge')) as MnBadge[]
    contested.shadowRoot!.querySelector('button')!.click()
    expect(seen).toEqual([{ kind: 'contested' }])
  })
})
