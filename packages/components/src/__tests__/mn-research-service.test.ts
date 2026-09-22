/**
 * REAL component tests for the Shrubbery-native SRS research pieces.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../mn-research-source-chip.js'
import '../mn-research-source-card.js'
import '../mn-research-run-trace.js'
import '../mn-research-workspace.js'
import type {
  MnResearchSourceChip,
  MnResearchSourceChipDetail,
} from '../mn-research-source-chip.js'
import type {
  MnResearchSource,
  MnResearchSourceCard,
  MnResearchSourceCardDetail,
} from '../mn-research-source-card.js'
import type {
  MnResearchRunStepDetail,
  MnResearchRunTrace,
} from '../mn-research-run-trace.js'
import type {
  MnResearchWorkspace,
  MnResearchWorkspaceModeDetail,
} from '../mn-research-workspace.js'

function sr(el: HTMLElement): ShadowRoot {
  return el.shadowRoot!
}

async function mount<T extends HTMLElement & { updateComplete: Promise<unknown> }>(
  tag: keyof HTMLElementTagNameMap,
  setup?: (el: T) => void,
): Promise<T> {
  const el = document.createElement(tag) as T
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

const source: MnResearchSource = {
  id: 'paper-wrapper-survey',
  title: 'Paper Adapter Survey for Agent Research Workflows',
  kind: 'preprint',
  status: 'ready',
  adapter: 'papers.search',
  authors: ['SRS stub'],
  year: '2026',
  venue: 'Research note',
  abstract: 'A host-owned source record standing in for a paper adapter.',
  tags: ['papers', 'adapter'],
  score: 0.9,
  citationCount: 12,
  url: 'https://example.test/paper',
}

describe('mn-research-* SRS components', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('registers the atom, molecules, and organism tags', () => {
    expect(customElements.get('mn-research-source-chip')).toBeDefined()
    expect(customElements.get('mn-research-source-card')).toBeDefined()
    expect(customElements.get('mn-research-run-trace')).toBeDefined()
    expect(customElements.get('mn-research-workspace')).toBeDefined()
  })

  it('mn-research-source-chip renders source status and emits select intent', async () => {
    const el = await mount<MnResearchSourceChip>('mn-research-source-chip', (node) => {
      node.sourceId = 'paper-a'
      node.label = 'arXiv'
      node.kind = 'preprint'
      node.status = 'selected'
      node.score = 0.82
      node.interactive = true
    })
    const seen: MnResearchSourceChipDetail[] = []
    el.addEventListener('mn-research-source-chip-select', (event) => {
      seen.push((event as CustomEvent<MnResearchSourceChipDetail>).detail)
    })

    expect(sr(el).querySelector('.label')?.textContent).toBe('arXiv')
    expect(sr(el).querySelector('.score')?.textContent).toBe('82%')
    ;(sr(el).querySelector('button') as HTMLButtonElement).click()

    expect(seen).toEqual([
      { id: 'paper-a', label: 'arXiv', kind: 'preprint', status: 'selected' },
    ])
  })

  it('mn-research-source-card renders a resolved paper record and emits actions', async () => {
    const el = await mount<MnResearchSourceCard>('mn-research-source-card', (node) => {
      node.source = source
      node.selected = true
    })
    const seen: string[] = []
    el.addEventListener('mn-research-source-select', (event) => {
      seen.push(`select:${(event as CustomEvent<MnResearchSourceCardDetail>).detail.sourceId}`)
    })
    el.addEventListener('mn-research-source-open', (event) => {
      seen.push(`open:${(event as CustomEvent<MnResearchSourceCardDetail>).detail.sourceId}`)
    })
    el.addEventListener('mn-research-source-promote', (event) => {
      seen.push(`promote:${(event as CustomEvent<MnResearchSourceCardDetail>).detail.sourceId}`)
    })

    expect(sr(el).querySelector('h3')?.textContent).toBe(source.title)
    expect(sr(el).querySelectorAll('mn-chip').length).toBe(2)

    ;(sr(el).querySelector('[aria-label="Select source"]') as HTMLButtonElement).click()
    ;(sr(el).querySelector('[aria-label="Open source"]') as HTMLButtonElement).click()
    ;(sr(el).querySelector('[aria-label="Promote to brief"]') as HTMLButtonElement).click()

    expect(seen).toEqual([
      'select:paper-wrapper-survey',
      'open:paper-wrapper-survey',
      'promote:paper-wrapper-survey',
    ])
  })

  it('mn-research-run-trace renders tool steps and emits step focus intent', async () => {
    const el = await mount<MnResearchRunTrace>('mn-research-run-trace', (node) => {
      node.activeId = 'search'
      node.steps = [
        { id: 'scope', label: 'Scope', status: 'completed', tool: 'research.plan' },
        { id: 'search', label: 'Search', status: 'running', tool: 'papers.search', meta: '3 candidates' },
      ]
    })
    const seen: MnResearchRunStepDetail[] = []
    el.addEventListener('mn-research-step-open', (event) => {
      seen.push((event as CustomEvent<MnResearchRunStepDetail>).detail)
    })

    expect(sr(el).querySelectorAll('li').length).toBe(2)
    ;(sr(el).querySelector('[data-step-id="search"]') as HTMLButtonElement).click()

    expect(seen[0].stepId).toBe('search')
    expect(seen[0].step.tool).toBe('papers.search')
  })

  it('mn-research-workspace composes slotted panes and emits mode changes', async () => {
    const el = await mount<MnResearchWorkspace>('mn-research-workspace', (node) => {
      node.subtitle = 'Paper trail'
    })
    const sourcePane = document.createElement('div')
    sourcePane.slot = 'source'
    sourcePane.textContent = 'source pane'
    const workflowPane = document.createElement('div')
    workflowPane.slot = 'workflow'
    workflowPane.textContent = 'workflow pane'
    el.append(sourcePane, workflowPane)
    await el.updateComplete

    const seen: MnResearchWorkspaceModeDetail[] = []
    el.addEventListener('mn-research-workspace-mode-change', (event) => {
      seen.push((event as CustomEvent<MnResearchWorkspaceModeDetail>).detail)
    })

    const buttons = Array.from(sr(el).querySelectorAll('.mode-button')) as HTMLButtonElement[]
    buttons[1].click()
    await el.updateComplete

    expect(el.mode).toBe('workflow')
    expect(seen).toEqual([{ mode: 'workflow' }])
    expect(sr(el).querySelectorAll('.detail-main')[0].classList.contains('hidden')).toBe(true)
    expect(sr(el).querySelectorAll('.detail-main')[1].classList.contains('hidden')).toBe(false)
  })
})
