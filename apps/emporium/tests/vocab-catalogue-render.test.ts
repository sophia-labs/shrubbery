/**
 * vocab-catalogue-render.test.ts — pins the parse → render path WITHOUT infra.
 *
 * Drives the REAL read-model map (`mapPack`, @shrubbery/source/emporium) over the
 * VERBATIM captured golden contract (tests/fixtures/emporium-snapshot — a real
 * cell capture, not a mock), then stamps the result through the REAL pure views
 * (renderVocabCatalogue / renderVocabPack) into a REAL happy-dom DOM. It asserts
 * the anatomy the live shell would show — pack name, class cards, the resolved
 * class→class relationship, the stats — is derived from the contract, never faked.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render as litRender } from 'lit'
import type { VocabSummary } from '@shrubbery/render'

import { mapPack } from '@shrubbery/source/emporium'
import { renderVocabCatalogue, renderVocabPack } from '../src/vocab-views.js'

const SNAP = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/emporium-snapshot')
const readJson = <T>(file: string): T => JSON.parse(readFileSync(join(SNAP, file), 'utf8')) as T

/** The catalogue rows (verbatim GET /emporium/vocabs). */
const catalogue = readJson<{ vocabularies: VocabSummary[] }>('vocabs.json').vocabularies
const workflowSummary = catalogue.find((v) => v.name === 'workflow')!
// The raw golden contract, typed as mapPack's own raw-body param (not re-exported).
const rawWorkflow = readJson<Parameters<typeof mapPack>[1]>('vocab.workflow.1.0.0.json')

/** A detached mount inside the shared happy-dom document. */
function mount(): HTMLElement {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

describe('mapPack — the real read-model derived from the captured contract', () => {
  const pack = mapPack('workflow', rawWorkflow, workflowSummary)

  it('carries the summary identity + a class per contract class, sorted', () => {
    expect(pack.name).toBe('workflow')
    expect(pack.title).toBe('Mnemosyne Workflow Vocabulary')
    expect(pack.sha).toBe(workflowSummary.sha)
    // The contract declares 9 classes; the view expects them name-sorted.
    const names = pack.classes.map((c) => c.name)
    expect(names).toContain('AgentNode')
    expect(names).toContain('Workflow')
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
  })

  it('resolves the AgentNode →wf:partOfWorkflow→ Workflow object-property relationship', () => {
    const agentNode = pack.classes.find((c) => c.name === 'AgentNode')!
    const rel = agentNode.predicates.find((p) => p.name === 'wf:partOfWorkflow')!
    // datatype:'uri' + source "workflow doc URI" resolves the range to a pack class.
    expect(rel.relatesTo).toBe('Workflow')
    const edge = pack.relationships!.find(
      (r) => r.from === 'AgentNode' && r.predicate === 'wf:partOfWorkflow',
    )!
    expect(edge).toMatchObject({ to: 'Workflow', kind: 'predicate' })
    // The CRDT wire rules from the contract surface as `wire` edges too.
    expect(pack.relationships!.some((r) => r.kind === 'wire' && r.predicate === 'flowsInto')).toBe(true)
  })

  it('derives the stats (predicate / relationship counts) from the contract, not a constant', () => {
    const predByHand = pack.classes.reduce((n, c) => n + c.predicates.length, 0)
    expect(pack.predicateCount).toBe(predByHand)
    expect(pack.relationshipCount).toBe(pack.relationships!.length)
    expect(pack.relationshipCount).toBeGreaterThan(0)
  })
})

describe('renderVocabPack — the pack-detail anatomy stamped to REAL DOM', () => {
  const pack = mapPack('workflow', rawWorkflow, workflowSummary)
  const el = mount()
  litRender(renderVocabPack(pack), el)

  it('headers the pack by its real name/title and marks the vocab root', () => {
    const root = el.querySelector('.vocab-pack')!
    expect(root.getAttribute('data-vocab')).toBe('workflow')
    expect(el.querySelector('.vocab-pack__name')!.textContent).toContain('workflow')
    expect(el.querySelector('.vocab-pack__subtitle')!.textContent).toContain(
      'Mnemosyne Workflow Vocabulary',
    )
  })

  it('renders one class card per contract class (a real class is present by name)', () => {
    const cards = el.querySelectorAll('mn-card.vocab-class[data-class]')
    expect(cards.length).toBe(pack.classes.length)
    expect(el.querySelector('mn-card.vocab-class[data-class="AgentNode"]')).not.toBeNull()
    expect(el.querySelector('mn-card.vocab-class[data-class="Workflow"]')).not.toBeNull()
    // The AgentNode card lists its real predicate row (never a placeholder).
    const agentCard = el.querySelector('mn-card.vocab-class[data-class="AgentNode"]')!
    expect(agentCard.querySelector('tr[data-pred="wf:partOfWorkflow"]')).not.toBeNull()
  })

  it('renders the relationships section defaulting to the LIST face (edge list)', () => {
    const section = el.querySelector('mn-card[data-section="relationships"]')!
    expect(section).not.toBeNull()
    expect(section.getAttribute('data-rel-view')).toBe('list')
    expect(section.querySelector('[data-rel-kind="predicate"] mn-relations')).not.toBeNull()
    // Both toggle affordances exist for the shell to own the LIST|GRAPH state.
    expect(section.querySelector('[data-rel-view-btn="list"]')).not.toBeNull()
    expect(section.querySelector('[data-rel-view-btn="graph"]')).not.toBeNull()
  })
})

describe('renderVocabCatalogue — the catalogue grid stamped to REAL DOM', () => {
  it('renders one card per captured pack + an honest count intro', () => {
    const el = mount()
    litRender(renderVocabCatalogue(catalogue), el)
    const cards = el.querySelectorAll('mn-card.vocab-card[data-vocab]')
    expect(cards.length).toBe(catalogue.length)
    expect(el.querySelector('mn-card.vocab-card[data-vocab="workflow"]')).not.toBeNull()
    expect(el.querySelector('mn-card.vocab-card[data-vocab="sophia-memory-core"]')).not.toBeNull()
    expect(el.querySelector('.vocab-catalogue__intro')!.textContent).toContain(String(catalogue.length))
  })

  it('shows an honest empty state (never a faked row) for an empty registry', () => {
    const el = mount()
    litRender(renderVocabCatalogue([]), el)
    const empty = el.querySelector('.vocab-catalogue[data-empty="true"]')
    expect(empty).not.toBeNull()
    expect(el.querySelector('mn-card.vocab-card')).toBeNull()
    expect(el.querySelector('.vocab-empty')!.textContent).toContain('No vocabularies')
  })
})
