/**
 * REAL INTEGRATION TEST — the Emporium vocab-CATALOGUE *DOM* view, end to end,
 * NO MOCKS (iteration 4b).
 *
 * Iter-4a's emporium test proved the three TEXT faces (markdown/Turtle/JSON-LD).
 * THIS test proves the fourth `dom` face: it spawns a REAL current-release
 * gardend cell (which serves /emporium; the debug build is stale), reads the LIVE
 * /emporium vocab catalogue through the shell-side EmporiumClient, renders that
 * REAL data through the DOM views (vocab-views.ts → mn-card/mn-chip/mn-badge
 * GENERALIZED components) into a REAL DOM (happy-dom), and ASSERTS the rendered
 * DOM carries the two real packs (workflow + sophia-memory-core) with real
 * versions / shas / class counts — then renders workflow/latest's PACK-DETAIL
 * view and asserts its real classes + predicates appear in the DOM.
 *
 * The cell is killed + its temp profile removed on teardown. There is no stubbed
 * HTTP and no fake /emporium payload anywhere on this path — "the pack IS the
 * catalog", read live.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync } from 'node:fs'
import { render as litRender } from 'lit'
import type { VocabPack, VocabSummary } from '@shrubbery/render'
// Registering the general primitives is a side effect of importing the views.
import { renderVocabCatalogue, renderVocabPack, shortSha } from '../src/cell/vocab-views.js'
import { spawnGardend, resolveGardendBin, type GardendCell } from '../src/cell/spawn-gardend.js'
import { EmporiumClient } from '../src/cell/emporium-client.js'
import { loadEmporiumFromCell, type EmporiumRead } from '../src/cell/emporium-store.js'

const GARDEN_BIN = resolveGardendBin()
const BIN_PRESENT = existsSync(GARDEN_BIN)

/** Mount a Lit template into a fresh detached real DOM container. */
function mount(tpl: ReturnType<typeof renderVocabCatalogue>): HTMLDivElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  litRender(tpl, host)
  return host
}

describe('REAL INTEGRATION — Emporium vocab-catalogue DOM view from a current cell', () => {
  let cell: GardendCell
  let client: EmporiumClient
  let read: EmporiumRead
  let vocabs: VocabSummary[]

  beforeAll(async () => {
    if (!BIN_PRESENT) {
      throw new Error(
        `gardend binary not found at ${GARDEN_BIN}. This test REQUIRES the real ` +
          `release binary (it serves /emporium; the debug build is stale). Set GARDEN_BIN.`,
      )
    }
    cell = await spawnGardend()
    client = new EmporiumClient({
      baseUrl: cell.apiUrl,
      token: cell.token,
      origin: 'http://127.0.0.1',
    })
    // The store's live read = catalogue rows + every pack's golden contract.
    read = await loadEmporiumFromCell(client)
    vocabs = [...read.vocabs]
  }, 40000)

  afterAll(async () => {
    if (cell) await cell.kill()
  })

  it('renders the LIVE catalogue to REAL DOM with both real packs (mn-card per vocab)', () => {
    // sanity: the live read really returned the two known packs.
    expect(vocabs.map((v) => v.name)).toEqual(
      expect.arrayContaining(['workflow', 'sophia-memory-core']),
    )

    const host = mount(
      renderVocabCatalogue(vocabs, { classCounts: read.classCounts }),
    )

    // One mn-card per real vocabulary, keyed by the real name.
    const cards = host.querySelectorAll('mn-card.vocab-card')
    expect(cards.length).toBe(vocabs.length)
    expect(cards.length).toBeGreaterThanOrEqual(2)

    const wf = host.querySelector('mn-card[data-vocab="workflow"]')
    const mem = host.querySelector('mn-card[data-vocab="sophia-memory-core"]')
    expect(wf, 'workflow card rendered').not.toBeNull()
    expect(mem, 'sophia-memory-core card rendered').not.toBeNull()

    // The card surfaces the real catalogue facts as general primitives.
    const wfSummary = vocabs.find((v) => v.name === 'workflow')!
    // version chip carries the live version.
    const versionChip = wf!.querySelector(`mn-chip[label="${wfSummary.version}"]`)
    expect(versionChip, 'workflow version chip').not.toBeNull()
    // class-count chip reflects the real (live-derived) count.
    const wfCount = read.classCounts['workflow']
    expect(wfCount).toBeGreaterThan(0)
    const countChip = wf!.querySelector(
      `mn-chip[label="${wfCount} ${wfCount === 1 ? 'class' : 'classes'}"]`,
    )
    expect(countChip, 'workflow class-count chip').not.toBeNull()
    // sha badge carries the short content hash; the full sha lives in its hint.
    const shaBadge = wf!.querySelector('mn-badge')
    expect(shaBadge?.getAttribute('label')).toBe(shortSha(wfSummary.sha))
    expect(shaBadge?.getAttribute('hint')).toContain(wfSummary.sha)

    host.remove()
  })

  it('fires onOpen with the real pack name when a card is activated', () => {
    const opened: string[] = []
    const host = mount(
      renderVocabCatalogue(vocabs, {
        classCounts: read.classCounts,
        onOpen: (name) => opened.push(name),
      }),
    )
    const wfCard = host.querySelector('mn-card[data-vocab="workflow"]') as HTMLElement
    wfCard.dispatchEvent(new CustomEvent('mn-card-activate', { bubbles: true, composed: true }))
    expect(opened).toEqual(['workflow'])
    host.remove()
  })

  it('renders the LIVE workflow/latest PACK-DETAIL view to REAL DOM (classes + predicates)', () => {
    const pack: VocabPack = read.packs['workflow']
    expect(pack, 'live workflow pack present').toBeDefined()
    expect(pack.namespace).toBe('http://mnemosyne.dev/workflow#')
    expect(pack.classes.length).toBeGreaterThan(0)

    let backCalled = false
    const host = mount(renderVocabPack(pack, { onBack: () => (backCalled = true) }))

    // The pack header shows the real name + namespace as chips.
    const headName = host.querySelector('.vocab-pack__name')?.textContent
    expect(headName).toBe('workflow')
    expect(host.querySelector(`mn-chip[label="${pack.namespace}"]`)).not.toBeNull()

    // One class card per real class, keyed by the real class name.
    const classCards = host.querySelectorAll('mn-card.vocab-class')
    expect(classCards.length).toBe(pack.classes.length)
    // AgentNode is a real workflow class verified live.
    const agentNode = host.querySelector('mn-card[data-class="AgentNode"]')
    expect(agentNode, 'AgentNode class card rendered').not.toBeNull()

    // At least one class renders its real predicates as chips in a table.
    const classWithPreds = pack.classes.find((c) => c.predicates.length > 0)!
    const predCard = host.querySelector(`mn-card[data-class="${classWithPreds.name}"]`)!
    const predChips = predCard.querySelectorAll('.vocab-class__preds mn-chip')
    expect(predChips.length).toBeGreaterThan(0)
    const firstPredName = classWithPreds.predicates[0].name
    const predChip = Array.from(predChips).find(
      (c) => c.getAttribute('label') === firstPredName,
    )
    expect(predChip, `predicate chip for ${firstPredName}`).toBeDefined()

    // The back affordance is wired to the real callback.
    const backBadge = host.querySelector('.vocab-pack__nav mn-badge') as HTMLElement
    expect(backBadge).not.toBeNull()
    backBadge.dispatchEvent(new CustomEvent('mn-badge-action', { bubbles: true, composed: true }))
    expect(backCalled).toBe(true)

    host.remove()
  })

  it('renders the sophia-memory-core PACK-DETAIL view to REAL DOM (real classes)', () => {
    const pack: VocabPack = read.packs['sophia-memory-core']
    expect(pack, 'live memory-core pack present').toBeDefined()
    expect(pack.namespace).toBe('http://mnemosyne.dev/memory#')
    const host = mount(renderVocabPack(pack))
    expect(host.querySelector('.vocab-pack__name')?.textContent).toBe('sophia-memory-core')
    const classCards = host.querySelectorAll('mn-card.vocab-class')
    expect(classCards.length).toBe(pack.classes.length)
    expect(classCards.length).toBeGreaterThan(0)
    host.remove()
  })

  it('the empty catalogue renders an HONEST empty state (never a faked row)', () => {
    const host = mount(renderVocabCatalogue([]))
    expect(host.querySelector('.vocab-catalogue[data-empty="true"]')).not.toBeNull()
    expect(host.querySelectorAll('mn-card.vocab-card').length).toBe(0)
    expect(host.querySelector('.vocab-empty')?.textContent).toContain('No vocabularies')
    host.remove()
  })
})
