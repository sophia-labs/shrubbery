/**
 * letter-page-view-element.test.ts — the real `<sh-letter-page-view>` mounted
 * directly (el Despacho W2). Proves the page's kinds and stance are stamped;
 * that the parties, the parent and the replies are hyperlinks that move the
 * focus; that provenance names the body's path and digest and says the body
 * lives in the repository; that a missing acknowledgement is said honestly;
 * and that the attestation is said plainly.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import '../letter-page-view-element.js'
import type { ShLetterPageView } from '../letter-page-view-element.js'
import type { LetterReading } from '../../../despacho/letter-reading.js'

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('div')
  document.body.appendChild(root)
})

afterEach(() => {
  root.remove()
})

const G = 'urn:mnemosyne:local:graph:sophia-cluster:projection:correo'
const LETTER = `${G}:letter:chat-claude-first-return-20260913`
const PARENT = `${G}:letter:sophia-chat-claude-commission-20260913`
const SOPHIA = `${G}:seat:sophia`
const CHAT = `${G}:seat:chat-archive`

function reading(overrides: Partial<LetterReading> = {}): LetterReading {
  return {
    subject: LETTER,
    found: true,
    isLetter: true,
    props: {},
    messageId: 'chat-claude-first-return-20260913',
    kind: 'answer',
    conversation: 'chat-archive-20260913',
    at: '2026-09-13T23:46:50.295Z',
    from: { iri: CHAT, title: 'Chat Demi — conversation continuity' },
    to: { iri: SOPHIA, title: 'Demi of Sophia — convenor' },
    excerpt: '# Chat Demi — first return. Milestone 1 proven…',
    bodyPath: 'notes/2026-09-13-chat/RETURN.md',
    bodySha256: '4e8197b0c63fafbd50263f9be05ff7657131804397860e98aaaaaaaaaaaaaaaa',
    attestation: 'operator-attested-local',
    provenance: [],
    replyTo: { iri: PARENT, kind: 'request', at: '2026-09-13T20:00:00.000Z', from: { iri: SOPHIA, title: 'Demi of Sophia — convenor' }, excerpt: 'Commission: pilot the Eva…' },
    replies: [{ iri: `${G}:letter:sophia-ack-20260914`, kind: 'observation', at: '2026-09-14T01:00:00.000Z', from: { iri: SOPHIA, title: 'Demi of Sophia — convenor' }, excerpt: 'Received.' }],
    acks: [],
    ...overrides,
  }
}

async function mount(r: LetterReading, mode: 'chapter' | 'entry' = 'chapter'): Promise<ShLetterPageView> {
  const view = document.createElement('sh-letter-page-view') as ShLetterPageView
  view.mode = mode
  view.subjectIri = r.subject
  view.focusHref = (iri) => `/?focus=${encodeURIComponent(iri)}`
  view.reading = r
  view.status = 'ready'
  root.appendChild(view)
  await view.updateComplete
  return view
}

describe('<sh-letter-page-view> as a chapter', () => {
  it('stamps the dispatch stance and the DisplayKinds, and sets the excerpt as the page', async () => {
    const view = await mount(reading())
    expect(view.shadowRoot!.querySelector('.stage')!.getAttribute('data-stance')).toBe('dispatch')
    const kinds = new Set([...view.shadowRoot!.querySelectorAll('.mn-kind')].map((el) => el.getAttribute('data-kind')))
    expect(kinds).toEqual(new Set(['identity', 'reference', 'prose', 'state', 'testimony']))
    expect(view.shadowRoot!.querySelector('.excerpt')!.textContent).toBe('# Chat Demi — first return. Milestone 1 proven…')
    expect(view.shadowRoot!.querySelector('.eyebrow')!.textContent).toContain('an answer')
  })

  it('links the parties, the letter it answers and its replies to the focus', async () => {
    const view = await mount(reading())
    const from = view.shadowRoot!.querySelector('a[data-party="from"]')!
    expect(from.getAttribute('href')).toBe(`/?focus=${encodeURIComponent(CHAT)}`)
    expect(from.textContent).toBe('Chat Demi — conversation continuity')
    expect(view.shadowRoot!.querySelector('a[data-party="to"]')!.textContent).toBe('Demi of Sophia — convenor')
    const parent = view.shadowRoot!.querySelector('li[data-ref="parent"] a')!
    expect(parent.getAttribute('href')).toBe(`/?focus=${encodeURIComponent(PARENT)}`)
    expect(parent.textContent).toContain('a request from Demi of Sophia')
    expect(view.shadowRoot!.querySelectorAll('li[data-ref="reply"]')).toHaveLength(1)
  })

  it('says the body lives in the repository, names path and digest, and is honest about no acknowledgement', async () => {
    const view = await mount(reading())
    const prov = view.shadowRoot!.querySelector('.provenance')!
    expect(prov.textContent).toContain('The body lives in the sophia repository')
    expect(prov.querySelector('[data-body-path]')!.getAttribute('data-body-path')).toBe('notes/2026-09-13-chat/RETURN.md')
    expect(prov.textContent).toContain('sha256 4e8197b0')
    expect(view.shadowRoot!.querySelector('[data-acks="none"]')!.textContent).toContain('Not yet acknowledged')
    expect(view.shadowRoot!.querySelector('.attestation')!.textContent).toContain('not an authenticated receipt')
  })

  it('lists acknowledgements with the acknowledging seat as a focus link', async () => {
    const view = await mount(reading({ acks: [{ iri: `${G}:ack:x`, actor: { iri: SOPHIA, title: 'Demi of Sophia — convenor' }, at: '2026-09-14T00:05:00.000Z' }] }))
    const ack = view.shadowRoot!.querySelector('li[data-ack] a')!
    expect(ack.getAttribute('href')).toBe(`/?focus=${encodeURIComponent(SOPHIA)}`)
    expect(view.shadowRoot!.querySelector('[data-acks="none"]')).toBeNull()
  })

  it('refuses to paint a non-letter as a page', async () => {
    const view = await mount(reading({ isLetter: false, messageId: null }))
    expect(view.shadowRoot!.querySelector('.state[data-tone="danger"]')!.textContent).toContain('is not a letter')
  })
})

describe('<sh-letter-page-view> as an entry', () => {
  it('shows kind, time, parties and a clamped excerpt that links to the letter', async () => {
    const view = await mount(reading(), 'entry')
    expect(view.shadowRoot!.querySelector('.eyebrow')!.textContent).toContain('unacknowledged')
    const excerptLink = view.shadowRoot!.querySelector('.excerpt a')!
    expect(excerptLink.getAttribute('href')).toBe(`/?focus=${encodeURIComponent(LETTER)}`)
    expect(view.shadowRoot!.querySelector('a[data-party="from"]')).not.toBeNull()
  })
})
