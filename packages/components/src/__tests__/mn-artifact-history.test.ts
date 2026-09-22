/**
 * REAL component test - mn-artifact-history controlled artifact revision rail.
 *
 * Revision loading, thumbnail URL lifetime, and restore side effects are
 * host-owned. The element renders controlled state and emits composed intents.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import '../mn-artifact-history.js'
import type {
  MnArtifactHistory,
  MnArtifactHistoryIntentDetail,
  MnArtifactHistoryRevisionDetail,
  MnArtifactRevision,
} from '../mn-artifact-history.js'

async function mount(setup?: (el: MnArtifactHistory) => void): Promise<MnArtifactHistory> {
  const el = document.createElement('mn-artifact-history') as MnArtifactHistory
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

const sr = (el: MnArtifactHistory) => el.shadowRoot!

const revisions: MnArtifactRevision[] = [
  {
    revisionId: 'rev-current',
    createdAt: Date.now() - 10_000,
    trigger: 'manual',
    label: 'Edited image',
    filename: 'diagram.png',
    mimeType: 'image/png',
    sizeBytes: 1536,
    thumbnailUrl: 'blob:current',
  },
  {
    revisionId: 'rev-old',
    createdAt: Date.now() - 86_400_000,
    trigger: 'checkpoint',
    filename: 'diagram.png',
    sizeBytes: 2048,
    thumbnailUrl: 'blob:old',
  },
]

describe('mn-artifact-history - real custom element', () => {
  beforeAll(() => {
    expect(customElements.get('mn-artifact-history')).toBeDefined()
  })

  it('renders loading, error, empty, and revision states from controlled props', async () => {
    const el = await mount((node) => {
      node.status = 'loading'
    })
    expect(sr(el).querySelector('mn-loading')).not.toBeNull()

    el.status = 'error'
    el.error = 'history failed'
    await el.updateComplete
    expect(sr(el).querySelector('mn-empty-state')?.getAttribute('title')).toBe('Could not load history')
    expect(sr(el).querySelector('mn-empty-state')?.getAttribute('description')).toBe('history failed')

    el.status = 'ready'
    el.error = ''
    await el.updateComplete
    expect(sr(el).querySelector('mn-empty-state')?.getAttribute('title')).toBe('No versions yet')

    el.revisions = revisions
    await el.updateComplete
    const cards = Array.from(sr(el).querySelectorAll('.card'))
    expect(cards).toHaveLength(2)
    expect(cards[0].getAttribute('data-current')).toBe('true')
    expect(cards[0].textContent).toContain('Edited image')
    expect(cards[0].textContent).toContain('current')
    expect((cards[0].querySelector('img') as HTMLImageElement | null)?.getAttribute('src')).toBe('blob:current')
    expect(cards[1].textContent).toContain('Snapshot')
  })

  it('emits close, refresh, and restore intents without doing host work', async () => {
    const el = await mount((node) => {
      node.graphId = 'graph-a'
      node.artifactId = 'artifact-a'
      node.revisions = revisions
    })
    const closes: MnArtifactHistoryIntentDetail[] = []
    const refreshes: MnArtifactHistoryIntentDetail[] = []
    const restores: MnArtifactHistoryRevisionDetail[] = []
    el.addEventListener('mn-artifact-history-close', (event) => {
      closes.push((event as CustomEvent<MnArtifactHistoryIntentDetail>).detail)
    })
    el.addEventListener('mn-artifact-history-refresh', (event) => {
      refreshes.push((event as CustomEvent<MnArtifactHistoryIntentDetail>).detail)
    })
    el.addEventListener('mn-artifact-history-restore', (event) => {
      restores.push((event as CustomEvent<MnArtifactHistoryRevisionDetail>).detail)
    })

    ;(sr(el).querySelector('[aria-label="Refresh history"]') as HTMLButtonElement).click()
    ;(sr(el).querySelector('[aria-label="Close history"]') as HTMLButtonElement).click()
    ;(sr(el).querySelector('[aria-label="Restore Snapshot"]') as HTMLButtonElement).click()

    expect(refreshes).toEqual([{ graphId: 'graph-a', artifactId: 'artifact-a' }])
    expect(closes).toEqual([{ graphId: 'graph-a', artifactId: 'artifact-a' }])
    expect(restores).toEqual([{ graphId: 'graph-a', artifactId: 'artifact-a', revisionId: 'rev-old' }])
  })

  it('disables restore buttons while a restore is in progress', async () => {
    const el = await mount((node) => {
      node.revisions = revisions
      node.restoringRevisionId = 'rev-old'
    })
    const restore = sr(el).querySelector('[aria-label="Restore Snapshot"]') as HTMLButtonElement
    expect(restore.disabled).toBe(true)
    expect(restore.textContent).toContain('Restoring')
  })
})
