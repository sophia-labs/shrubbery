import { describe, expect, it } from 'vitest'
import { HomeActivityStore } from './home-activity.js'

class MemoryStorage {
  readonly data = new Map<string, string>()
  getItem(key: string): string | null { return this.data.get(key) ?? null }
  setItem(key: string, value: string): void { this.data.set(key, value) }
}

const docs = [
  { id: 'one', title: 'One' },
  { id: 'two', title: 'Two' },
  { id: 'graph-a-dream-journal', title: 'Dream Journal' },
]

describe('HomeActivityStore', () => {
  it('projects only existing documents and keeps graph activity isolated', () => {
    const storage = new MemoryStorage()
    const activity = new HomeActivityStore(storage)
    activity.markOpened('graph-a', 'one', 10)
    activity.markCreated('graph-a', 'two', 20)
    activity.setPinned('graph-a', 'one', true)
    activity.markOpened('graph-b', 'other', 30)

    const a = activity.project('graph-a', docs)
    expect(a.resume?.documentId).toBe('two')
    expect(a.pinned?.map(item => item.documentId)).toEqual(['one'])
    expect(a.newlyCreated?.map(item => item.documentId)).toEqual(['two'])
    expect(a.recent).toEqual([])
    expect(a.dreamJournal).toBeNull()
    expect(activity.project('graph-b', docs).resume).toBeNull()
  })

  it('requires explicit real dreaming enablement and survives malformed storage', () => {
    const storage = new MemoryStorage()
    storage.setItem('shrubbery.organism.home-activity.v1', '{bad')
    const activity = new HomeActivityStore(storage)
    expect(activity.project('graph-a', docs).dreamJournal).toBeNull()
    expect(activity.project('graph-a', docs, { dreamingEnabled: true }).dreamJournal?.documentId)
      .toBe('graph-a-dream-journal')
  })

  it('shows authoritative preexisting documents as newly created in a fresh browser', () => {
    const activity = new HomeActivityStore(new MemoryStorage())
    const projection = activity.project('graph-a', [
      { id: 'older', title: 'Older', createdAt: 100 },
      { id: 'newer', title: 'Newer', createdAt: 200 },
    ])
    expect(projection.newlyCreated?.map(item => item.documentId)).toEqual(['newer', 'older'])
  })

  it('gives recent and pinned sections precedence and rejects future timestamps', () => {
    const activity = new HomeActivityStore(new MemoryStorage())
    activity.markOpened('graph-a', 'recent', 20)
    activity.setPinned('graph-a', 'pinned', true)
    const projection = activity.project('graph-a', [
      { id: 'recent', title: 'Recent', createdAt: 10 },
      { id: 'pinned', title: 'Pinned', createdAt: 11 },
      { id: 'future', title: 'Future', createdAt: Date.now() + 2 * 86_400_000 },
    ])
    expect(projection.recent?.map(item => item.documentId)).toEqual(['recent'])
    expect(projection.pinned?.map(item => item.documentId)).toEqual(['pinned'])
    expect(projection.newlyCreated).toEqual([])
  })
})
