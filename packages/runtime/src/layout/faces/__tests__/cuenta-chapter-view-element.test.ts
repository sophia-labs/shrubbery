/**
 * cuenta-chapter-view-element.test.ts — the real `<sh-cuenta-chapter-view>`
 * mounted directly (el Despacho W1). Proves the chapter's kinds are stamped
 * from the DisplayKind register and the stage carries the `dispatch`
 * stance; that the ONE affordance exists only for an open gate; that the
 * act refuses an empty utterance client-side; that a word is emitted as a
 * typed intent with the utterance verbatim; and that a refusal is shown
 * with the refusing party's words.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import '../cuenta-chapter-view-element.js'
import type { ShCuentaChapterView, CuentaWordDetail } from '../cuenta-chapter-view-element.js'
import type { CuentaReading } from '../../../despacho/cuenta-reading.js'

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('div')
  document.body.appendChild(root)
})

afterEach(() => {
  root.remove()
})

const G = 'urn:mnemosyne:local:graph:sophia-cluster:projection:cuentas'
const GATE = `${G}:cuenta:sirin-g-slice-accepted`

function reading(overrides: Partial<CuentaReading> = {}): CuentaReading {
  return {
    subject: GATE,
    found: true,
    localId: 'sirin-g-slice-accepted',
    props: {},
    title: "Vera's word — she reaches sophia-cluster inside Sirin; the slice is accepted",
    beadKind: 'gate',
    status: 'open',
    owner: 'vera',
    venue: 'human',
    priority: 0,
    note: null,
    createdAt: null,
    evidence: [],
    edges: [
      { edge: 'partOf', target: `${G}:cuenta:sirin-w1`, title: 'W1 — The Slice', status: 'open' },
      { edge: 'needs', target: `${G}:cuenta:sirin-g-repoint`, title: "Vera's word — repoint clients", status: 'open' },
    ],
    rendiciones: [],
    ready: false,
    ...overrides,
  }
}

async function mount(r: CuentaReading, canAct = true): Promise<ShCuentaChapterView> {
  const view = document.createElement('sh-cuenta-chapter-view') as ShCuentaChapterView
  view.status = 'ready'
  view.subjectIri = r.subject
  view.reading = r
  view.canAct = canAct
  view.witness = 'e9e949fe-0091-7015-0ab8-10bf259084ab'
  view.focusHref = (iri) => `/?graph=sophia-cluster&focus=${encodeURIComponent(iri)}`
  root.appendChild(view)
  await view.updateComplete
  return view
}

describe('sh-cuenta-chapter-view — a chapter with one act', () => {
  it('stamps the dispatch stance and the DisplayKind register on every kinded part', async () => {
    const view = await mount(reading())
    const shadow = view.shadowRoot!
    expect(shadow.querySelector('.stage')!.getAttribute('data-stance')).toBe('dispatch')
    const kinds = new Set(Array.from(shadow.querySelectorAll('[data-kind]'), (el) => el.getAttribute('data-kind')))
    expect(kinds).toEqual(new Set(['identity', 'state', 'reference', 'affordance']))
    expect(shadow.querySelector('h1.title')!.textContent).toContain('the slice is accepted')
  })

  it('edges are real hyperlinks that move the focus', async () => {
    const view = await mount(reading())
    const links = Array.from(view.shadowRoot!.querySelectorAll<HTMLAnchorElement>('dl.edges a'))
    expect(links).toHaveLength(2)
    expect(links[1].getAttribute('href')).toBe(`/?graph=sophia-cluster&focus=${encodeURIComponent(`${G}:cuenta:sirin-g-repoint`)}`)
    expect(links[1].dataset.edge).toBe('needs')
    expect(links[1].textContent).toContain('repoint clients')
  })

  it('shows the affordance ONLY for an open gate', async () => {
    expect((await mount(reading())).shadowRoot!.querySelector('[data-kind="affordance"]')).not.toBeNull()
    expect((await mount(reading({ status: 'done' }))).shadowRoot!.querySelector('[data-kind="affordance"]')).toBeNull()
    expect((await mount(reading({ beadKind: 'task' }))).shadowRoot!.querySelector('[data-kind="affordance"]')).toBeNull()
    const entry = await mount(reading())
    entry.mode = 'entry'
    await entry.updateComplete
    expect(entry.shadowRoot!.querySelector('[data-kind="affordance"]')).toBeNull()
    expect(entry.shadowRoot!.querySelector('h1.title a')!.getAttribute('href')).toContain('focus=')
  })

  it('refuses an empty utterance before anything leaves the element, then emits the word with the utterance verbatim', async () => {
    const view = await mount(reading())
    const shadow = view.shadowRoot!
    const events: CuentaWordDetail[] = []
    view.addEventListener('cuenta-word', (event) => events.push((event as CustomEvent<CuentaWordDetail>).detail))
    const button = shadow.querySelector<HTMLButtonElement>('button.give')!
    expect(button.disabled).toBe(true)
    button.click()
    expect(events).toHaveLength(0)

    const textarea = shadow.querySelector<HTMLTextAreaElement>('textarea')!
    textarea.value = '  Yes — I reach it from my own machine.  \nAccepted. '
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    const amend = shadow.querySelector<HTMLInputElement>('input[value="amend"]')!
    amend.checked = true
    amend.dispatchEvent(new Event('change', { bubbles: true }))
    await view.updateComplete
    expect(button.disabled).toBe(false)
    button.click()
    expect(events).toEqual([{ word: 'amend', utterance: 'Yes — I reach it from my own machine.  \nAccepted.' }])
  })

  it('says when the session cannot carry a word, and shows a refusal with the refusing party’s words', async () => {
    const view = await mount(reading(), false)
    const shadow = view.shadowRoot!
    expect(shadow.querySelector('.act-row .witness')!.textContent).toContain('cannot carry a word')
    expect(shadow.querySelector<HTMLButtonElement>('button.give')!.disabled).toBe(true)

    view.canAct = true
    view.verbState = { phase: 'refused', at: 'apply', message: "Gateway MCP error for emporium_write: unknown embedded vocabulary 'cuentas'" }
    await view.updateComplete
    const line = shadow.querySelector('[data-verb-phase="refused"]')!
    expect(line.textContent).toContain('Refused at apply')
    expect(line.textContent).toContain("unknown embedded vocabulary 'cuentas'")
  })

  it('renders an account as testimony with the utterance as a pull-quote', async () => {
    const view = await mount(
      reading({
        status: 'done',
        rendiciones: [
          { iri: `${G}:rendicion:sirin-g-slice-accepted-r1`, verdict: 'done', witness: 'vera, in chat', summary: 'Word given from el Despacho: yes.', renderedAt: '2026-09-15T20:00:00Z', word: 'yes', utterance: 'Yes. It is on Sirin.', evidence: ['receipt-1'] },
        ],
      }),
    )
    const account = view.shadowRoot!.querySelector('[data-kind="testimony"]')!
    expect(account.querySelector('blockquote.utterance')!.textContent).toBe('Yes. It is on Sirin.')
    expect(account.querySelector('.verdict')!.textContent).toBe('Yes')
    expect(account.textContent).toContain('vera, in chat')
    expect(account.textContent).toContain('receipt-1')
  })
})
