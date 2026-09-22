import { describe, expect, it } from 'vitest'
import '../mn-home-view.js'
import type { MnHomeView } from '../mn-home-view.js'

async function mount(setup: (element: MnHomeView) => void): Promise<MnHomeView> {
  const element = document.createElement('mn-home-view') as MnHomeView
  setup(element)
  document.body.append(element)
  await element.updateComplete
  return element
}

describe('mn-home-view', () => {
  it('renders only honest controlled projections and forwards user intents', async () => {
    const opened: string[] = []
    const pins: Array<[string, boolean]> = []
    let created = 0
    const element = await mount(home => {
      home.graphId = 'graph-a'
      home.graphTitle = 'Graph A'
      home.todayKey = '2026-07-10'
      home.resume = { graphId: 'graph-a', documentId: 'resume', title: 'Resume Me' }
      home.pinned = [{ graphId: 'graph-a', documentId: 'pinned', title: 'Pinned Note' }]
      home.newlyCreated = [{ graphId: 'graph-a', documentId: 'new', title: 'New Note', timestamp: Date.now() }]
      home.recent = [{ graphId: 'graph-a', documentId: 'recent', title: 'Recent Note', timestamp: Date.now() - 60_000 }]
    })
    element.addEventListener('mn-home-new-document', () => { created += 1 })
    element.addEventListener('mn-home-open-document', event => opened.push((event as CustomEvent).detail.document.documentId))
    element.addEventListener('mn-home-pin-document', event => {
      const detail = (event as CustomEvent).detail
      pins.push([detail.document.documentId, detail.pinned])
    })

    const root = element.shadowRoot!
    expect(element.resume?.title).toBe('Resume Me')
    expect(root.textContent).toContain('Graph A')
    expect(root.querySelector('.workspace')?.textContent).toBe('Graph A')
    expect(root.querySelector('.resume-kicker')?.textContent).toBe('Continue writing')
    expect(root.querySelector('.resume-title')?.textContent).toBe('Resume Me')
    expect(root.querySelector('.resume')?.getAttribute('aria-label')).toBe('Resume Resume Me')
    expect(root.textContent).toContain('Pinned Note')
    expect(root.textContent).toContain('New Note')
    expect(root.textContent).toContain('Recent Note')
    expect(root.textContent).not.toContain('Dream Journal')
    ;(root.querySelector('.new-document') as HTMLButtonElement).click()
    ;(root.querySelector('.resume') as HTMLButtonElement).click()
    ;(root.querySelector('[aria-label="Pin New Note"]') as HTMLButtonElement).click()
    ;(root.querySelector('[aria-label="Unpin Pinned Note"]') as HTMLButtonElement).click()
    expect(created).toBe(1)
    expect(opened).toEqual(['resume'])
    expect(pins).toEqual([['new', true], ['pinned', false]])
  })

  it('groups recurring writing practices without inventing application state', async () => {
    const element = await mount(home => {
      home.graphId = 'graph-a'
      home.todayKey = '2026-07-10'
      home.dreamJournal = {
        graphId: 'graph-a',
        documentId: 'graph-a-dream-journal',
        title: 'Dream Journal',
      }
    })

    const root = element.shadowRoot!
    expect(root.querySelector('section.practice')?.getAttribute('aria-label')).toBe('Daily practice')
    expect(root.querySelector('section.practice mn-daily-note-row')).not.toBeNull()
    expect(root.querySelector('section.practice button.dream')).not.toBeNull()
    expect(root.querySelector('.empty')?.textContent).toBe('Your first pages will gather here.')

    element.todayKey = ''
    element.dreamJournal = null
    await element.updateComplete
    expect(root.querySelector('section.practice')).toBeNull()
  })

  it('shows Dream Journal only when supplied and exposes loading/error states', async () => {
    const element = await mount(home => {
      home.graphId = 'graph-a'
      home.dreamJournal = { graphId: 'graph-a', documentId: 'graph-a-dream-journal', title: 'Dream Journal' }
    })
    expect(element.shadowRoot!.textContent).toContain('Dream Journal')
    element.status = 'loading'
    await element.updateComplete
    expect(element.shadowRoot!.querySelector('[aria-busy="true"]')).not.toBeNull()
    element.status = 'error'
    element.error = 'projection failed'
    await element.updateComplete
    expect(element.shadowRoot!.querySelector('[role="alert"]')?.textContent).toContain('projection failed')
  })
})
