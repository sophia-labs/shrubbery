/**
 * agent-entry-view-element.test.ts — the real `<sh-agent-entry-view>`
 * mounted directly (el Despacho W11). Proves the entry's kinds are stamped
 * from the DisplayKind register and the stage carries the `dispatch` stance
 * and the dormancy; that the dex band says the status WITH its basis; that
 * the stat block counts runs by state and says why no bead is held; that
 * moves, rules and lineage render when present and are said absent when not;
 * and that a tile is one focus link with its chips.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import '../agent-entry-view-element.js'
import { entrySlug, type ShAgentEntryView } from '../agent-entry-view-element.js'
import type { AgentEntry } from '../../../despacho/agent-reading.js'
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
const DEPLOY_CANARY = `${G}:seat:deploy-canary`
const NOW = new Date('2026-09-16T06:00:00.000Z')

function seat(overrides: Partial<SeatReading> = {}): SeatReading {
  return {
    subject: DEPLOY_CANARY,
    found: true,
    isSeat: true,
    props: {},
    seatId: 'deploy-canary',
    title: 'demi:keeper:deploy-canary',
    seatKind: 'keeper',
    scope: 'canary rollout',
    parent: null,
    handoff: null,
    evidence: [],
    attestation: 'swarm-graph',
    lettersIn: 0,
    lettersOut: 0,
    unacknowledged: 0,
    recentRuns: [],
    heldBeads: [],
    correspondents: [],
    seatStatus: 'confident',
    agentUri: null,
    model: null,
    trigger: null,
    mandate: 'roll the canary without a lie in the record',
    card: 'The keeper of deploy-canary rolls images by receipt.',
    jail: 'never a bare helm upgrade without the render check',
    seals: ['kubectl get secret pn-gateway-tokens (read-only, single namespace)', 'deploy-gateway-canary.sh only'],
    confidence: '0.7',
    lastRunAt: null,
    definitions: [],
    foldedFrom: ['urn:sophia:swarm:keeper:deploy-canary'],
    supersedes: null,
    capabilities: [
      { iri: 'urn:sophia:swarm:capability:roll-canary', name: 'roll-canary', definition: 'roll the canary gateway', contract: 'saved plan first', confidence: '0.8', mergeVerdict: 'merged', attestation: 'swarm-graph' },
    ],
    ...overrides,
  }
}

function entry(overrides: Partial<AgentEntry> = {}, seatOverrides: Partial<SeatReading> = {}): AgentEntry {
  return {
    seat: seat(seatOverrides),
    runStats: { completed: 0, failed: 0, open: 0, total: 0, firstAt: null, lastAt: null },
    lineage: { ancestor: null, heirs: [] },
    habitat: 'the swarm graph — a facility, folded into correo',
    dormancy: 'unknown',
    dormancyBasis: 'no run recorded and no status claimed',
    ...overrides,
  }
}

function mount(e: AgentEntry, mode: 'chapter' | 'tile' = 'chapter'): ShAgentEntryView {
  const view = document.createElement('sh-agent-entry-view') as ShAgentEntryView
  view.mode = mode
  view.subjectIri = e.seat.subject
  view.now = () => NOW
  view.entry = e
  view.status = 'ready'
  root.appendChild(view)
  return view
}

async function settled(view: ShAgentEntryView): Promise<ShadowRoot> {
  await view.updateComplete
  return view.shadowRoot!
}

describe('<sh-agent-entry-view> as a chapter', () => {
  it('stamps the stance, the dormancy and the kinds; the band says the status with its basis and the habitat', async () => {
    const view = mount(entry({ dormancy: 'dormant', dormancyBasis: 'its source says dormant; last run claimed 2026-08-11T17:49:41Z' }))
    const sr = await settled(view)
    const stage = sr.querySelector('.stage') as HTMLElement
    expect(stage.dataset.stance).toBe('dispatch')
    expect(stage.dataset.dormancy).toBe('dormant')
    const kinds = new Set([...sr.querySelectorAll('.mn-kind')].map((el) => (el as HTMLElement).dataset.kind))
    for (const kind of ['identity', 'state', 'metric', 'prose', 'reference', 'testimony']) expect(kinds.has(kind)).toBe(true)
    const pill = sr.querySelector('.band .pill') as HTMLElement
    expect(pill.dataset.dormancy).toBe('dormant')
    expect(pill.textContent).toBe('dormant')
    expect(sr.querySelector('.band .basis')?.textContent).toContain('its source says dormant')
    expect(sr.querySelector('[data-habitat]')?.textContent).toContain('swarm graph')
  })

  it('counts runs by state in the stat block and says why no bead is held', async () => {
    const view = mount(entry({ runStats: { completed: 7, failed: 4, open: 5, total: 16, firstAt: '2026-08-10T00:00:00Z', lastAt: '2026-08-11T17:49:41Z' } }))
    const sr = await settled(view)
    expect(sr.querySelector('[data-stat="runs"] .n')?.textContent).toBe('16')
    expect(sr.querySelector('[data-stat="runs"] .detail')?.textContent).toBe('7 completed · 4 failed · 5 open')
    expect(sr.querySelector('[data-stat="last-run"] .n')?.textContent).toBe('last month')
    expect(sr.querySelector('[data-stat="beads"] .n')?.textContent).toBe('0')
    expect(sr.querySelector('[data-stat="beads"] .detail')?.textContent).toContain('by office, not by seat')
    expect(sr.querySelector('[data-stat="moves"] .n')?.textContent).toBe('1')
  })

  it('renders the card verbatim, the moves with contract and confidence, the rules, and the lineage links', async () => {
    const view = mount(
      entry({
        lineage: { ancestor: { iri: `${G}:seat:old`, title: 'old keeper', status: 'retired' }, heirs: [{ iri: `${G}:seat:new`, title: null, status: null }] },
      }),
    )
    const sr = await settled(view)
    expect(sr.querySelector('.verbatim')?.textContent).toBe('The keeper of deploy-canary rolls images by receipt.')
    const move = sr.querySelector('[data-capability]') as HTMLElement
    expect(move.textContent).toContain('roll-canary')
    expect(move.textContent).toContain('confidence 0.8')
    expect(move.textContent).toContain('Contract: saved plan first')
    expect(sr.querySelector('[data-jail]')?.textContent).toContain('never a bare helm upgrade')
    expect(sr.querySelectorAll('[data-seal]')).toHaveLength(2)
    const ancestor = sr.querySelector('[data-ancestor] a') as HTMLAnchorElement
    expect(ancestor.getAttribute('href')).toBe(`?focus=${encodeURIComponent(`${G}:seat:old`)}`)
    expect(ancestor.textContent).toBe('old keeper')
    expect(sr.querySelector('[data-heir] a')?.textContent).toBe('new')
    expect(sr.querySelector('[data-folded-from]')?.textContent).toContain('urn:sophia:swarm:keeper:deploy-canary')
    expect(sr.querySelector('.attestation')?.textContent).toContain('Folded from the swarm graph')
  })

  it('says absent moves and absent lineage plainly on a plain roster seat', async () => {
    const view = mount(
      entry({ habitat: 'the Demi network — bodies run as codex subagents and Claude watches' }, {
        subject: `${G}:seat:chat-archive`,
        seatId: 'chat-archive',
        title: 'Chat Demi — conversation continuity',
        seatKind: 'cross-repo',
        attestation: 'operator-attested-local',
        seatStatus: null,
        mandate: null,
        card: null,
        jail: null,
        seals: [],
        confidence: null,
        foldedFrom: [],
        capabilities: [],
      }),
    )
    const sr = await settled(view)
    expect(sr.querySelector('[data-moves="none"]')).not.toBeNull()
    expect(sr.querySelector('[data-lineage="none"]')).not.toBeNull()
    expect(sr.querySelector('.verbatim')).toBeNull()
    expect(sr.querySelector('.attestation')?.textContent).toContain('Operator testimony from the Demi register')
  })

  it('says a stranger and a missing subject rather than painting a blank', async () => {
    const view = mount(entry({}, { found: false }))
    const sr = await settled(view)
    expect(sr.querySelector('.state')?.textContent).toContain('No record in this graph')
    view.entry = entry({}, { isSeat: false, seatId: null })
    await view.updateComplete
    expect(view.shadowRoot!.querySelector('.state')?.textContent).toContain('is not a seat of the correo canon')
  })
})

describe('<sh-agent-entry-view> as a tile', () => {
  it('is one focus link with a type chip, a status chip, the scope, the moves and the last run in plain words', async () => {
    const view = mount(entry({ dormancy: 'silent', dormancyBasis: 'no run in 40 days' }, { lastRunAt: '2026-08-07T00:00:00Z', lettersIn: 3, lettersOut: 1 }), 'tile')
    const sr = await settled(view)
    const link = sr.querySelector('a.name') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe(`?focus=${encodeURIComponent(DEPLOY_CANARY)}`)
    expect(link.dataset.entry).toBe(DEPLOY_CANARY)
    expect(sr.querySelector('.chips .type')?.textContent).toBe('keeper')
    expect((sr.querySelector('.chips .pill') as HTMLElement).dataset.dormancy).toBe('silent')
    expect(sr.querySelector('.tile .scope')?.textContent).toBe('roll the canary without a lie in the record')
    expect(sr.querySelector('.foot')?.textContent).toContain('1 moves')
    expect(sr.querySelector('.foot')?.textContent).toContain('3 in · 1 out')
    expect(sr.querySelector('.foot')?.textContent).toContain('ran last month (claimed)')
    expect(sr.querySelector('.stage')?.querySelector('.entry')).toBeNull()
  })

  it('derives the entry slug from the seat IRI', () => {
    expect(entrySlug(DEPLOY_CANARY)).toBe('deploy-canary')
    expect(entrySlug('urn:sophia:agent:agent-8dc95d85e3b09eb7')).toBe('agent-8dc95d85e3b09eb7')
  })
})
