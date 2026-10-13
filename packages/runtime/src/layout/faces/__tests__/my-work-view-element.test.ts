/**
 * my-work-view-element.test.ts — the real `<sh-my-work-view>` mounted
 * directly (el Despacho W4). Proves the groups keep the ontology's status
 * order with their own counts, that every bead is a link that moves the
 * focus, that gated-on work names the gate it waits on, and that an office
 * holding nothing says so in words.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import '../my-work-view-element.js'
import type { ShMyWorkView } from '../my-work-view-element.js'
import type { MyWorkReading } from '../../../despacho/mywork-reading.js'

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('div')
  document.body.appendChild(root)
})

afterEach(() => {
  root.remove()
})

const CUENTAS = 'urn:mnemosyne:local:graph:sophia-cluster:projection:cuentas'
const bead = (local: string) => `${CUENTAS}:cuenta:${local}`

function reading(overrides: Partial<MyWorkReading> = {}): MyWorkReading {
  return {
    owner: 'demi',
    groups: [
      {
        status: 'open',
        beads: [
          { iri: bead('despacho-w5-board'), title: 'W5 Board stance', kind: 'task', status: 'open', priority: 1, createdAt: '2026-09-16T05:00:00Z', partOf: bead('despacho'), partTitle: 'El Despacho' },
        ],
      },
      {
        status: 'in_progress',
        beads: [
          { iri: bead('despacho-w11-pokedex'), title: 'W11 Roster pokédex', kind: 'wave', status: 'in_progress', priority: 0, createdAt: '2026-09-16T05:30:00Z', partOf: null, partTitle: null },
        ],
      },
      {
        status: 'done',
        beads: [{ iri: bead('despacho-w2'), title: 'W2 — seats and letters', kind: 'wave', status: 'done', priority: 0, createdAt: '2026-09-15T20:00:00Z', partOf: null, partTitle: null }],
      },
    ],
    gatedOn: [
      { iri: bead('despacho-w1-proof'), title: 'the proof of W1', kind: 'task', status: 'open', gate: bead('despacho-g-name'), gateTitle: 'the name of the surface' },
    ],
    counts: { held: 3, open: 1, inProgress: 1, gatedOn: 1 },
    ...overrides,
  }
}

async function mount(configure: (view: ShMyWorkView) => void): Promise<ShMyWorkView> {
  const view = document.createElement('sh-my-work-view') as ShMyWorkView
  configure(view)
  root.appendChild(view)
  await view.updateComplete
  return view
}

function textOf(view: ShMyWorkView): string {
  return view.shadowRoot?.textContent?.replace(/\s+/g, ' ') ?? ''
}

describe('the room and its stance', () => {
  it('stamps the dispatch stance and names whose work it is', async () => {
    const view = await mount((v) => {
      v.reading = reading()
      v.status = 'ready'
    })
    const stage = view.shadowRoot?.querySelector('.stage')
    expect(stage?.getAttribute('data-stance')).toBe('dispatch')
    expect(stage?.getAttribute('aria-label')).toBe('Work held by demi')
    expect(textOf(view)).toContain('Held by demi')
  })

  it('keeps the groups in the order the reading gave them, each with its own count', async () => {
    const view = await mount((v) => {
      v.reading = reading()
      v.status = 'ready'
    })
    const headings = [...(view.shadowRoot?.querySelectorAll('h2') ?? [])].map((h) => h.textContent?.replace(/\s+/g, ' ').trim())
    expect(headings[0]).toContain('(1)')
    expect(headings.join(' | ').toLowerCase()).toContain('progress')
    // the gated-on section is last
    expect(headings[headings.length - 1]).toContain('Gated on demi')
  })

  it('stamps each bead row with its status so a board can style by state', async () => {
    const view = await mount((v) => {
      v.reading = reading()
      v.status = 'ready'
    })
    const statuses = [...(view.shadowRoot?.querySelectorAll('[data-bead][data-status]') ?? [])].map((el) => el.getAttribute('data-status'))
    expect(statuses).toEqual(['open', 'in_progress', 'done'])
  })
})

describe('links and gated work', () => {
  it('makes every bead a link that moves the focus', async () => {
    const view = await mount((v) => {
      v.reading = reading()
      v.status = 'ready'
      v.focusHref = (iri) => `/despacho?focus=${encodeURIComponent(iri)}`
    })
    const link = view.shadowRoot?.querySelector(`[data-bead="${bead('despacho-w5-board')}"] a`)
    expect(link?.getAttribute('href')).toBe(`/despacho?focus=${encodeURIComponent(bead('despacho-w5-board'))}`)
  })

  it('names the gate that gated-on work waits for', async () => {
    const view = await mount((v) => {
      v.reading = reading()
      v.status = 'ready'
    })
    const row = view.shadowRoot?.querySelector(`[data-gate="${bead('despacho-g-name')}"]`)
    expect(row).not.toBeNull()
    expect(row!.textContent).toContain('the name of the surface')
  })
})

describe('honesty', () => {
  it('says an office holds nothing in words, and that nothing waits on it', async () => {
    const view = await mount((v) => {
      v.reading = reading({ groups: [], gatedOn: [], counts: { held: 0, open: 0, inProgress: 0, gatedOn: 0 } })
      v.status = 'ready'
    })
    const text = textOf(view)
    expect(text).toContain('holds no beads in this graph')
    expect(text).toContain('Nothing waits on a word from')
  })

  it('shows a loading room, and an error in the cell’s own words', async () => {
    const loading = await mount((v) => {
      v.status = 'loading'
    })
    expect(textOf(loading).length).toBeGreaterThan(0)

    const failed = await mount((v) => {
      v.status = 'error'
      v.error = 'the cell is hydrating'
    })
    expect(textOf(failed)).toContain('the cell is hydrating')
  })
})
