/**
 * seat-character-view-element.test.ts — the real `<sh-seat-character-view>`
 * mounted directly (el Despacho W2). Proves the character's kinds are
 * stamped from the DisplayKind register and the stage carries the `dispatch`
 * stance; that the heartbeat reads the newest run in plain words; that
 * correspondents and the parent are hyperlinks that move the focus; that an
 * empty held-beads list is said honestly, with the seat id the join uses;
 * and that the attestation is said plainly.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import '../seat-character-view-element.js'
import { formatAgo, type ShSeatCharacterView } from '../seat-character-view-element.js'
import type { SeatReading } from '../../../despacho/seat-reading.js'

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('div')
  document.body.appendChild(root)
})

afterEach(() => {
  root.remove()
})

const G = 'urn:mnemosyne:local:graph:sophia-cluster:projection:correo'
const SOPHIA = `${G}:seat:sophia`
const NOW = new Date('2026-09-15T12:00:00.000Z')

function reading(overrides: Partial<SeatReading> = {}): SeatReading {
  return {
    subject: SOPHIA,
    found: true,
    isSeat: true,
    props: {},
    seatId: 'sophia',
    title: 'Demi of Sophia — convenor',
    seatKind: 'system',
    scope: 'The human conversation, network integration, uncovered responsibilities and continuity',
    parent: null,
    handoff: 'NOW.md',
    evidence: ['CASEBOOK.md'],
    attestation: 'operator-attested-local',
    lettersIn: 477,
    lettersOut: 515,
    unacknowledged: 12,
    recentRuns: [
      { iri: `${G}:run:r-2`, state: 'completed', runtime: 'codex-subagent', at: '2026-09-15T09:00:00.000Z', bodyIdentity: '/root/cold_reader' },
      { iri: `${G}:run:r-1`, state: 'failed', runtime: 'codex', at: '2026-09-14T09:00:00.000Z', bodyIdentity: null },
    ],
    heldBeads: [],
    correspondents: [{ iri: `${G}:seat:cloud3`, title: 'Cloud-3 — the move', letters: 208 }],
    // correo v0.2.0 — absent on a plain roster seat.
    seatStatus: null,
    agentUri: null,
    model: null,
    trigger: null,
    mandate: null,
    card: null,
    jail: null,
    seals: [],
    confidence: null,
    lastRunAt: null,
    definitions: [],
    foldedFrom: [],
    supersedes: null,
    capabilities: [],
    ...overrides,
  }
}

async function mount(r: SeatReading, mode: 'chapter' | 'entry' = 'chapter'): Promise<ShSeatCharacterView> {
  const view = document.createElement('sh-seat-character-view') as ShSeatCharacterView
  view.mode = mode
  view.subjectIri = r.subject
  view.now = () => NOW
  view.focusHref = (iri) => `/?focus=${encodeURIComponent(iri)}`
  view.reading = r
  view.status = 'ready'
  root.appendChild(view)
  await view.updateComplete
  return view
}

describe('<sh-seat-character-view> as a chapter', () => {
  it('stamps the dispatch stance and the DisplayKinds, and reads the heartbeat in plain words', async () => {
    const view = await mount(reading())
    const stage = view.shadowRoot!.querySelector('.stage')!
    expect(stage.getAttribute('data-stance')).toBe('dispatch')
    const kinds = new Set([...view.shadowRoot!.querySelectorAll('.mn-kind')].map((el) => el.getAttribute('data-kind')))
    expect(kinds).toEqual(new Set(['identity', 'state', 'metric', 'prose', 'reference', 'testimony']))
    const heartbeat = view.shadowRoot!.querySelector('.heartbeat')!
    expect(heartbeat.getAttribute('data-last-run')).toBe(`${G}:run:r-2`)
    expect(heartbeat.querySelector('.pulse')!.getAttribute('data-state')).toBe('completed')
    expect(heartbeat.textContent).toContain('completed 3 hours ago')
    expect(view.shadowRoot!.querySelector('.counts')!.textContent).toContain('12')
    expect(view.shadowRoot!.querySelector('.counts .waiting')!.textContent).toContain('awaiting its acknowledgement')
  })

  it('links correspondents and the parent to the focus, and says honestly why no bead is held', async () => {
    const view = await mount(reading({ parent: { seatId: 'cloud3', iri: `${G}:seat:cloud3` } }))
    const peer = view.shadowRoot!.querySelector('a[data-peer]') as HTMLAnchorElement
    expect(peer.getAttribute('href')).toBe(`/?focus=${encodeURIComponent(`${G}:seat:cloud3`)}`)
    expect(peer.textContent).toBe('Cloud-3 — the move')
    expect(view.shadowRoot!.querySelector('a[data-parent]')!.textContent).toBe('cloud3')
    const none = view.shadowRoot!.querySelector('[data-held-beads="none"]')!
    expect(none.textContent).toContain('No bead names this seat')
    expect(none.querySelector('code')!.textContent).toBe('sophia')
    expect(view.shadowRoot!.querySelector('.attestation')!.textContent).toContain('Operator testimony')
  })

  it('lists held beads as focus links when a bead names the seat, and says so when no run exists', async () => {
    const view = await mount(reading({ recentRuns: [], heldBeads: [{ iri: 'urn:b:1', title: 'A bead', status: 'in_progress', beadKind: 'task' }] }))
    expect(view.shadowRoot!.querySelector('.heartbeat')!.textContent).toContain('no run recorded')
    const bead = view.shadowRoot!.querySelector('a[data-bead]')!
    expect(bead.getAttribute('href')).toBe('/?focus=urn%3Ab%3A1')
    expect(view.shadowRoot!.querySelector('.beads .pill')!.textContent).toBe('in progress')
  })

  it('refuses to paint a stranger as a seat', async () => {
    const view = await mount(reading({ isSeat: false, seatId: null }))
    expect(view.shadowRoot!.querySelector('.state[data-tone="danger"]')!.textContent).toContain('is not a seat')
  })
})

describe('<sh-seat-character-view> with correo v0.2.0 — a folded keeper', () => {
  const keeper = (): SeatReading =>
    reading({
      subject: `${G}:seat:workflow-books`,
      seatId: 'workflow-books',
      title: 'Keeper of Workflow Books',
      seatKind: 'keeper',
      seatStatus: 'dormant',
      model: 'sonnet',
      mandate: 'Let workflows be read as pages, choices and reports.',
      card: 'I am the Keeper of Workflow Books — demi:keeper:workflow-books.\nI don’t store workflows; I let you read them.',
      jail: 'Never executes a chosen workflow.',
      seals: ['Scoped strictly to workflow RDF (wf: namespace).', 'Reports, never mutates.'],
      confidence: '0.72',
      recentRuns: [],
      lastRunAt: '2026-09-12T09:00:00.000Z',
      definitions: ['keeper-workflow-books-charter'],
      foldedFrom: ['urn:sophia:swarm:keeper:workflow-books'],
      capabilities: [
        { iri: `${G}:capability:open-workflow-book`, name: 'open-workflow-book', definition: 'Open a workflow as a book.', contract: 'Promises a page per step.', confidence: '0.8', mergeVerdict: 'settled', attestation: 'swarm-graph' },
        { iri: `${G}:capability:report-choice`, name: 'report-choice', definition: null, contract: null, confidence: null, mergeVerdict: null, attestation: null },
      ],
    })

  it('stamps seatKind and status honestly, and shows the last run its source claimed as a claim', async () => {
    const view = await mount(keeper())
    const eyebrow = view.shadowRoot!.querySelector('.eyebrow')!
    expect(eyebrow.querySelector('.kind')!.textContent).toBe('keeper')
    expect(eyebrow.querySelector('[data-seat-status]')!.getAttribute('data-seat-status')).toBe('dormant')
    const heartbeat = view.shadowRoot!.querySelector('.heartbeat')!
    expect(heartbeat.getAttribute('data-last-run-claim')).toBe('2026-09-12T09:00:00.000Z')
    expect(heartbeat.querySelector('.pulse')!.getAttribute('data-state')).toBe('claimed')
    expect(heartbeat.textContent).toContain('as its source claimed at fold time')
  })

  it('renders the moves with contract and confidence, the rules, and the card verbatim', async () => {
    const view = await mount(keeper())
    const moves = view.shadowRoot!.querySelectorAll('li[data-capability]')
    expect(moves).toHaveLength(2)
    expect(moves[0]!.textContent).toContain('open-workflow-book')
    expect(moves[0]!.textContent).toContain('confidence 0.8')
    expect(moves[0]!.textContent).toContain('Contract: Promises a page per step.')
    expect(moves[1]!.textContent).toContain('report-choice')
    expect(view.shadowRoot!.querySelector('[data-jail]')!.textContent).toContain('Never executes a chosen workflow.')
    expect(view.shadowRoot!.querySelectorAll('li[data-seal]')).toHaveLength(2)
    expect(view.shadowRoot!.querySelector('.verbatim')!.textContent).toBe('I am the Keeper of Workflow Books — demi:keeper:workflow-books.\nI don’t store workflows; I let you read them.')
    expect(view.shadowRoot!.querySelector('[data-mandate]')!.textContent).toContain('Let workflows be read')
    expect(view.shadowRoot!.querySelector('.refs')!.textContent).toContain('folded from: urn:sophia:swarm:keeper:workflow-books')
  })

  it('renders none of it for a plain roster seat', async () => {
    const view = await mount(reading())
    expect(view.shadowRoot!.querySelector('li[data-capability]')).toBeNull()
    expect(view.shadowRoot!.querySelector('.rules')).toBeNull()
    expect(view.shadowRoot!.querySelector('.card')).toBeNull()
    expect(view.shadowRoot!.querySelector('[data-seat-status]')).toBeNull()
    expect(view.shadowRoot!.querySelector('.eyebrow .kind')!.textContent).toBe('system')
  })
})

describe('<sh-seat-character-view> as an entry', () => {
  it('renders the title as a focus link with the heartbeat in one line', async () => {
    const view = await mount(reading(), 'entry')
    const link = view.shadowRoot!.querySelector('.title a') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe(`/?focus=${encodeURIComponent(SOPHIA)}`)
    expect(view.shadowRoot!.querySelector('.heartbeat')!.textContent).toContain('completed 3 hours ago')
    expect(view.shadowRoot!.querySelector('.pill')!.textContent).toBe('12 awaiting')
  })
})

describe('formatAgo', () => {
  it('speaks in the nearest unit and never invents calendar math', () => {
    expect(formatAgo('2026-09-15T11:59:30.000Z', NOW)).toBe('30 seconds ago')
    expect(formatAgo('2026-09-15T09:00:00.000Z', NOW)).toBe('3 hours ago')
    expect(formatAgo('2026-09-01T12:00:00.000Z', NOW)).toBe('14 days ago')
    expect(formatAgo('not a date', NOW)).toBe('not a date')
    expect(formatAgo(null, NOW)).toBe('')
  })
})
