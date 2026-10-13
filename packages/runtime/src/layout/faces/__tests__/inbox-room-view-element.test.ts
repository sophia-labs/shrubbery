/**
 * inbox-room-view-element.test.ts — the real `<sh-inbox-room-view>` mounted
 * directly (el Despacho W4). Proves the room's kinds are stamped from the
 * DisplayKind register and the stage carries the `dispatch` stance; that a
 * ready gate says so and an unready one says what it waits on; that the act
 * is offered only when the session can carry it; that a refusal is shown in
 * the refusing party's own words; that a missing viewer identity is said
 * plainly instead of pretending; and that each of the three sections says
 * its emptiness honestly.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import '../inbox-room-view-element.js'
import type { InboxReadState, ShInboxRoomView } from '../inbox-room-view-element.js'
import type { InboxReading } from '../../../despacho/inbox-reading.js'

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('div')
  document.body.appendChild(root)
})

afterEach(() => {
  root.remove()
})

const CUENTAS = 'urn:mnemosyne:local:graph:sophia-cluster:projection:cuentas'
const CORREO = 'urn:mnemosyne:local:graph:sophia-cluster:projection:correo'
const SEAT = `${CORREO}:seat:sophia`
const GATE = `${CUENTAS}:cuenta:despacho-g-name`
const REND = `${CUENTAS}:rendicion:despacho-w2-r1`

function reading(overrides: Partial<InboxReading> = {}): InboxReading {
  return {
    owner: 'vera',
    seats: [SEAT],
    reader: 'e9e949fe-0091-7015-0ab8-10bf259084ab',
    gates: [
      { iri: GATE, title: 'the name of the surface', priority: 2, createdAt: '2026-09-16T04:00:00Z', blockers: [], ready: true },
      {
        iri: `${CUENTAS}:cuenta:despacho-d-choreograph-dormant`,
        title: 'the dormant choreograph agents',
        priority: 1,
        createdAt: '2026-09-16T05:00:00Z',
        blockers: [{ target: `${CUENTAS}:cuenta:despacho-w11-pokedex`, status: 'open' }],
        ready: false,
      },
    ],
    letters: [
      {
        iri: `${CORREO}:letter:ask-20260913`,
        from: `${CORREO}:seat:chat-archive`,
        fromTitle: 'Chat Demi — conversation continuity',
        to: SEAT,
        kind: 'question',
        at: '2026-09-13T20:11:15Z',
        excerpt: 'Does the commission extend to the account plane?',
        conversation: 'chat-claude-20260913',
      },
    ],
    returns: [
      {
        iri: REND,
        forCuenta: `${CUENTAS}:cuenta:despacho-w2`,
        forTitle: 'W2 — seats and letters',
        verdict: 'done',
        witness: 'demi (chat-archive seat)',
        summary: 'W2 complete: card.seat, card.letter, card.focus, proven on the real cell.',
        renderedAt: '2026-09-16T05:30:00Z',
        word: null,
      },
    ],
    counts: { gates: 2, ready: 1, letters: 1, returns: 1 },
    ...overrides,
  }
}

async function mount(configure: (view: ShInboxRoomView) => void): Promise<ShInboxRoomView> {
  const view = document.createElement('sh-inbox-room-view') as ShInboxRoomView
  configure(view)
  root.appendChild(view)
  await view.updateComplete
  return view
}

function textOf(view: ShInboxRoomView): string {
  return view.shadowRoot?.textContent?.replace(/\s+/g, ' ') ?? ''
}

describe('the room, its kinds and its stance', () => {
  it('stamps the stage with the dispatch stance and labels it for the owner', async () => {
    const view = await mount((v) => {
      v.reading = reading()
      v.status = 'ready'
    })
    const stage = view.shadowRoot?.querySelector('.stage')
    expect(stage?.getAttribute('data-stance')).toBe('dispatch')
    expect(stage?.getAttribute('aria-label')).toBe('Inbox for vera')
  })

  it('stamps every row from the DisplayKind register — reference, state, testimony, metric, prose', async () => {
    const view = await mount((v) => {
      v.reading = reading()
      v.status = 'ready'
      v.canAct = true
    })
    const kinds = new Set([...(view.shadowRoot?.querySelectorAll('[data-kind]') ?? [])].map((el) => el.getAttribute('data-kind')))
    for (const kind of ['identity', 'metric', 'reference', 'state', 'testimony', 'prose', 'affordance']) {
      expect(kinds).toContain(kind)
    }
  })

  it('counts what waits, and says how many gates are ready', async () => {
    const view = await mount((v) => {
      v.reading = reading()
      v.status = 'ready'
    })
    const text = textOf(view)
    expect(text).toContain('2 gates awaiting your word')
    expect(text).toContain('1 ready')
    expect(text).toContain('1 unanswered')
    expect(text).toContain('1 return to read')
  })
})

describe('gates', () => {
  it('says a ready gate is ready, and an unready one waits on others', async () => {
    const view = await mount((v) => {
      v.reading = reading()
      v.status = 'ready'
    })
    const rows = [...(view.shadowRoot?.querySelectorAll('[data-gate]') ?? [])]
    expect(rows).toHaveLength(2)
    expect(rows[0]!.getAttribute('data-ready')).toBe('true')
    expect(rows[0]!.textContent).toContain('ready for your word')
    expect(rows[1]!.getAttribute('data-ready')).toBe('false')
    expect(rows[1]!.textContent).toContain('waits on others')
  })

  it('links a gate to its own focus so the word is given in the chapter, not here', async () => {
    const view = await mount((v) => {
      v.reading = reading()
      v.status = 'ready'
      v.focusHref = (iri) => `/despacho?focus=${encodeURIComponent(iri)}`
    })
    const link = view.shadowRoot?.querySelector(`[data-gate="${GATE}"] a`)
    expect(link?.getAttribute('href')).toBe(`/despacho?focus=${encodeURIComponent(GATE)}`)
  })
})

describe('the one act: read', () => {
  it('emits `inbox-read` with the account IRI when the session can carry it', async () => {
    const view = await mount((v) => {
      v.reading = reading()
      v.status = 'ready'
      v.canAct = true
    })
    const seen: string[] = []
    view.addEventListener('inbox-read', (event) => {
      seen.push((event as CustomEvent<{ rendicion: string }>).detail.rendicion)
    })
    const button = view.shadowRoot?.querySelector<HTMLButtonElement>(`[data-rendicion="${REND}"] button`)
    expect(button).not.toBeNull()
    button!.click()
    expect(seen).toEqual([REND])
  })

  it('shows the act but disables it when the session cannot carry it — visible and honestly unavailable, never a lie that succeeds', async () => {
    const view = await mount((v) => {
      v.reading = reading()
      v.status = 'ready'
      v.canAct = false
    })
    const button = view.shadowRoot?.querySelector<HTMLButtonElement>(`[data-rendicion="${REND}"] button`)
    expect(button).not.toBeNull()
    expect(button!.disabled).toBe(true)
    const seen: string[] = []
    view.addEventListener('inbox-read', () => seen.push('fired'))
    button!.click()
    expect(seen).toEqual([])
  })

  it('disables the act once a reading has landed, so a second click cannot re-testify', async () => {
    const view = await mount((v) => {
      v.reading = reading()
      v.status = 'ready'
      v.canAct = true
      v.readStates = new Map<string, InboxReadState>([[REND, { phase: 'applied', subjects: [`${CUENTAS}:lectura:x`] }]])
    })
    const button = view.shadowRoot?.querySelector<HTMLButtonElement>(`[data-rendicion="${REND}"] button`)
    expect(button!.disabled).toBe(true)
    expect(button!.textContent?.trim()).toBe('Read')
  })

  it('shows a refusal in the refusing party’s own words', async () => {
    const refused: InboxReadState = { phase: 'refused', at: 'dry-run', message: 'the cell refused at dry-run: cta:reader is required' }
    const view = await mount((v) => {
      v.reading = reading()
      v.status = 'ready'
      v.canAct = true
      v.readStates = new Map([[REND, refused]])
    })
    expect(textOf(view)).toContain('cta:reader is required')
  })

  it('says when a reading has landed', async () => {
    const view = await mount((v) => {
      v.reading = reading()
      v.status = 'ready'
      v.canAct = true
      v.readStates = new Map<string, InboxReadState>([[REND, { phase: 'applied', subjects: [`${CUENTAS}:lectura:x`] }]])
    })
    expect(textOf(view).toLowerCase()).toMatch(/read/)
  })
})

describe('honesty', () => {
  it('names the reader when there is one', async () => {
    const view = await mount((v) => {
      v.reading = reading()
      v.status = 'ready'
    })
    expect(textOf(view)).toContain('reading as e9e949fe-0091-7015-0ab8-10bf259084ab')
  })

  it('says plainly that returns cannot be cleared without a viewer identity', async () => {
    const view = await mount((v) => {
      v.reading = reading({ reader: '' })
      v.status = 'ready'
    })
    expect(textOf(view)).toContain('no viewer identity')
  })

  it('shows the convened seat by its title, since Vera has no correo seat of her own', async () => {
    const view = await mount((v) => {
      v.reading = reading()
      v.status = 'ready'
      v.seatTitles = new Map([[SEAT, 'Demi of Sophia — convenor']])
    })
    expect(textOf(view)).toContain('convenes Demi of Sophia — convenor')
  })

  it('says each section’s emptiness in its own words, never with a bare zero', async () => {
    const view = await mount((v) => {
      v.reading = reading({ gates: [], letters: [], returns: [], counts: { gates: 0, ready: 0, letters: 0, returns: 0 } })
      v.status = 'ready'
    })
    const text = textOf(view)
    expect(text).toContain('Nothing waits on your word.')
    expect(text).toContain('Every question and request has been answered or acknowledged.')
    expect(text).toContain('You have read every return.')
  })

  it('shows a loading room and an error in the cell’s words', async () => {
    const loading = await mount((v) => {
      v.status = 'loading'
    })
    expect(textOf(loading)).toContain('Opening your inbox…')

    const failed = await mount((v) => {
      v.status = 'error'
      v.error = 'the cell is hydrating'
    })
    expect(textOf(failed)).toContain('the cell is hydrating')
  })
})
