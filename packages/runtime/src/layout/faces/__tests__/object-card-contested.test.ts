/**
 * object-card-contested.test.ts — the card's CONTESTED POSTURE, a stance the
 * SAME `<sh-object-card-view>` wears, not a second display (WS1 §6.5, WS1 §9
 * "S4 — the contested stance", master spec §3 Slice 5).
 *
 * Real element, real DOM, no mocks — the same `mountReady` shape
 * `object-card-view-element.test.ts` already establishes.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import '../object-card-view-element.js'
import {
  OBJECT_INTENT_EVENT,
  ShObjectCardView,
  type ObjectCardIntent,
  type ObjectCardProposal,
  type ObjectIntentDetail,
} from '../object-card-view-element.js'

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('div')
  document.body.appendChild(root)
})

afterEach(() => {
  root.remove()
})

function mountReady(overrides: Partial<ShObjectCardView> = {}): ShObjectCardView {
  const view = document.createElement('sh-object-card-view') as ShObjectCardView
  view.status = 'ready'
  view.objectKey = 'lex-scotus-coreDoctrineHeadabc'
  view.vocab = 'lex-scotus-core'
  view.className_ = 'DoctrineHead'
  view.objectId = 'abc'
  view.title = 'Doctrine Head abc'
  view.provenance = 'mirror'
  view.epoch = 'inc-1:3:hash'
  view.reconciliationStrategy = 'contested'
  Object.assign(view, overrides)
  root.appendChild(view)
  return view
}

function proposal(overrides: Partial<ObjectCardProposal> = {}): ObjectCardProposal {
  return {
    operationId: 'op-a',
    sourceVersion: '0000aaaa11112222',
    baseVersion: 'root',
    record: { title: 'Claim A' },
    fields: [{ label: 'title', fullLabel: 'title', value: 'Claim A', kind: 'state' }],
    projected: false,
    ...overrides,
  }
}

const TWO_PROPOSALS: readonly ObjectCardProposal[] = [
  proposal({ operationId: 'op-a', sourceVersion: '0000aaaa11112222', projected: true, observer: 'device-a', causalOrder: 5 }),
  proposal({ operationId: 'op-b', sourceVersion: '1111bbbb33334444', projected: false }),
]

function contestedFixture(overrides: Partial<ShObjectCardView> = {}): ShObjectCardView {
  return mountReady({
    stance: 'contested',
    provisionalHead: true,
    conflictId: 'conflict-abc',
    contestReason: 'two writers proposed different values from the same starting point',
    proposals: TWO_PROPOSALS,
    unavailable: [],
    ...overrides,
  })
}

async function catchIntent(host: HTMLElement, act: () => void): Promise<ObjectCardIntent> {
  return new Promise<ObjectCardIntent>((resolve) => {
    host.addEventListener(
      OBJECT_INTENT_EVENT,
      (event) => resolve((event as CustomEvent<ObjectIntentDetail>).detail.intent),
      { once: true },
    )
    act()
  })
}

describe('sh-object-card-view — contested stance (WS1 §6.5)', () => {
  it('data-stance="contested" reflects on :host, driven by stance', async () => {
    const view = contestedFixture()
    await view.updateComplete
    expect(view.getAttribute('data-stance')).toBe('contested')
  })

  it('clearing stance to null removes the data-stance attribute', async () => {
    const view = contestedFixture()
    await view.updateComplete
    view.stance = null
    await view.updateComplete
    expect(view.hasAttribute('data-stance')).toBe(false)
  })

  it('the provisional marker renders, with its explaining title=', async () => {
    const view = contestedFixture()
    await view.updateComplete
    const marker = view.shadowRoot!.querySelector('.provisional')!
    expect(marker.textContent).toContain('Contested')
    expect(marker.textContent).toContain('Provisional head — hash order, not chosen')
    const titled = view.shadowRoot!.querySelector('.provisional [title]')!
    expect(titled.getAttribute('title')).toBe(
      'While this object is contested, the cell projects the proposal with the lowest version hash. That is a deterministic order, not a decision.',
    )
  })

  it('the order note renders: "Ordered by version hash, not by time."', async () => {
    const view = contestedFixture()
    await view.updateComplete
    const notes = [...view.shadowRoot!.querySelectorAll('section.proposals .order-note')].map((el) => el.textContent?.trim())
    expect(notes).toContain('Ordered by version hash, not by time.')
  })

  it('n>=2 proposals renders the plural count line', async () => {
    const view = contestedFixture()
    await view.updateComplete
    const notes = [...view.shadowRoot!.querySelectorAll('section.proposals .order-note')].map((el) => el.textContent?.trim())
    expect(notes).toContain('2 proposals share one observed base.')
  })

  it('the reason line renders the cell\'s own words verbatim', async () => {
    const view = contestedFixture()
    await view.updateComplete
    const reason = view.shadowRoot!.querySelector('.reason-line')!
    expect(reason.textContent).toBe('two writers proposed different values from the same starting point')
  })

  it('the projected proposal carries data-projected and the "Projected head" badge', async () => {
    const view = contestedFixture()
    await view.updateComplete
    const rows = [...view.shadowRoot!.querySelectorAll('li.proposal')]
    const projectedRow = rows.find((row) => row.hasAttribute('data-projected'))!
    expect(projectedRow).toBeTruthy()
    expect(projectedRow.textContent).toContain('Projected head')
    const otherRow = rows.find((row) => !row.hasAttribute('data-projected'))!
    expect(otherRow.textContent).not.toContain('Projected head')
  })

  it('the unconditional Law III ethic line always renders — regardless of hover', async () => {
    const view = contestedFixture()
    await view.updateComplete
    const ethic = view.shadowRoot!.querySelector('.ethic-line')!
    expect(ethic.textContent).toBe('Resolving selects — the unchosen proposal remains in the ledger\'s history.')
  })

  it('the ethic line also renders in the DEGRADED case', async () => {
    const view = contestedFixture({ proposals: [], unavailable: ['contest'] })
    await view.updateComplete
    const ethic = view.shadowRoot!.querySelector('.ethic-line')!
    expect(ethic).toBeTruthy()
  })

  it('the ethic line also renders when collapsed (showProposals=false)', async () => {
    const view = contestedFixture({ showProposals: false })
    await view.updateComplete
    const ethic = view.shadowRoot!.querySelector('.ethic-line')!
    expect(ethic).toBeTruthy()
  })

  describe('degraded contest (conflictId present, contest absent)', () => {
    it('stance on, provisional on, zero proposals, the proposals-unavailable copy', async () => {
      const view = contestedFixture({ proposals: [], unavailable: ['contest'] })
      await view.updateComplete
      expect(view.getAttribute('data-stance')).toBe('contested')
      expect(view.shadowRoot!.querySelector('.provisional')).toBeTruthy()
      expect(view.shadowRoot!.querySelectorAll('li.proposal').length).toBe(0)
      const note = view.shadowRoot!.querySelector('section.proposals .order-note')!
      expect(note.textContent).toBe('This object is contested, but the proposals did not arrive with this epoch.')
    })

    it('degraded takes no compose affordance (nothing to seed it from)', async () => {
      const view = contestedFixture({ proposals: [], unavailable: ['contest'] })
      await view.updateComplete
      expect(view.shadowRoot!.querySelector('.compose-action')).toBeNull()
    })
  })

  describe('collapsed (showProposals=false)', () => {
    it('renders header + count only, never the list', async () => {
      const view = contestedFixture({ showProposals: false })
      await view.updateComplete
      expect(view.shadowRoot!.querySelectorAll('li.proposal').length).toBe(0)
      const note = view.shadowRoot!.querySelector('section.proposals .order-note')!
      expect(note.textContent).toBe('2 proposals — hidden by this view\'s settings.')
    })
  })

  describe('missing-base (exactly one candidate)', () => {
    it('renders the SINGULAR missing-base copy, never the plural count line', async () => {
      const view = contestedFixture({
        proposals: [proposal({ operationId: 'op-solo', projected: true, causalOrder: undefined })],
      })
      await view.updateComplete
      const notes = [...view.shadowRoot!.querySelectorAll('section.proposals .order-note')].map((el) => el.textContent?.trim())
      expect(notes).toContain('One proposal references a base this cell no longer has.')
      expect(notes.some((text) => text?.includes('share one observed base'))).toBe(false)
    })

    it('exposes inspect but NOT keep — there is no sibling to prefer over', async () => {
      const view = contestedFixture({
        proposals: [proposal({ operationId: 'op-solo', projected: true })],
      })
      await view.updateComplete
      const row = view.shadowRoot!.querySelector('li.proposal')!
      const buttons = [...row.querySelectorAll('button')].map((button) => button.textContent?.trim())
      expect(buttons).toContain('Show full record')
      expect(buttons).not.toContain('Keep this one')
    })
  })

  describe('mixed attribution — checked PER PROPOSAL, in the same render', () => {
    it('one proposal with an observer renders the byline; its sibling without one renders the unattributed marker', async () => {
      const view = contestedFixture({
        proposals: [
          proposal({ operationId: 'op-a', observer: 'device-a', projected: true }),
          proposal({ operationId: 'op-b' }), // no `observer`
        ],
      })
      await view.updateComplete
      const rows = [...view.shadowRoot!.querySelectorAll('li.proposal')]
      expect(rows[0]!.textContent).toContain('device-a')
      expect(rows[1]!.textContent).toContain('Proposal not attributed — this cell does not record who wrote it.')
      expect(rows[1]!.textContent).not.toContain('device-a')
    })
  })

  describe('intent events — bubbles/composed, caught OUTSIDE the shadow root, no optimistic mutation', () => {
    it('"Keep this one" dispatches keep-candidate with the right operationId, element state unchanged', async () => {
      const view = contestedFixture()
      await view.updateComplete
      const before = { stance: view.stance, proposals: view.proposals }
      const button = [...view.shadowRoot!.querySelectorAll('li.proposal')][1]!.querySelector('button')! // op-b, not projected
      const intent = await catchIntent(root, () => (button as HTMLButtonElement).click())
      expect(intent).toEqual({
        kind: 'keep-candidate',
        objectKey: view.objectKey,
        conflictId: 'conflict-abc',
        chosenOperationId: 'op-b',
      })
      // No optimistic state: the element's own properties are byte-identical afterwards.
      expect(view.stance).toBe(before.stance)
      expect(view.proposals).toBe(before.proposals)
    })

    it('"Compose a merged value…" dispatches resolve with no seedOperationId and the full resident proposal set', async () => {
      const view = contestedFixture()
      await view.updateComplete
      const button = view.shadowRoot!.querySelector('.compose-action button')! as HTMLButtonElement
      const intent = await catchIntent(root, () => button.click())
      expect(intent.kind).toBe('resolve')
      if (intent.kind !== 'resolve') throw new Error('unreachable')
      expect(intent.objectKey).toBe(view.objectKey)
      expect(intent.conflictId).toBe('conflict-abc')
      expect(intent.seedOperationId).toBeUndefined()
      expect(intent.proposals).toHaveLength(2)
      expect(intent.proposals[0]).toEqual({
        operationId: 'op-a',
        sourceVersion: '0000aaaa11112222',
        observer: 'device-a',
        isProjectedHead: true,
        record: { title: 'Claim A' },
      })
    })

    it('"Show full record" toggles the card\'s OWN inline disclosure AND dispatches inspect-candidate', async () => {
      const view = contestedFixture()
      await view.updateComplete
      const row = [...view.shadowRoot!.querySelectorAll('li.proposal')][1]! // op-b
      const inspectButton = [...row.querySelectorAll('button')].find((b) => b.textContent?.includes('Show full record'))!
      expect(row.querySelector('.proposal-record')).toBeNull()
      const intent = await catchIntent(root, () => (inspectButton as HTMLButtonElement).click())
      await view.updateComplete
      expect(intent).toEqual({
        kind: 'inspect-candidate',
        objectKey: view.objectKey,
        conflictId: 'conflict-abc',
        operationId: 'op-b',
        expanded: true,
      })
      const rowAfter = [...view.shadowRoot!.querySelectorAll('li.proposal')][1]!
      expect(rowAfter.querySelector('.proposal-record')).not.toBeNull()
      expect(rowAfter.textContent).toContain('Hide full record')
    })
  })
})
