import { beforeEach, describe, expect, it } from 'vitest'
import '../mn-snapshot-diff.js'
import '../mn-timeline-rail.js'
import '../mn-restore-overlay.js'
import {
  diffSnapshotLines,
  type MnSnapshotDiff,
} from '../mn-snapshot-diff.js'
import {
  type MnTimelineCursorDetail,
  type MnTimelineRail,
  type MnTimelineSnapshot,
  type MnTimelineSnapshotDetail,
} from '../mn-timeline-rail.js'
import type { MnRestoreOverlay } from '../mn-restore-overlay.js'

function sr(el: HTMLElement): ShadowRoot {
  return el.shadowRoot!
}

const snapshots: MnTimelineSnapshot[] = [
  {
    snapshot_id: 'snap-auto',
    created_at: new Date(Date.now() - 20 * 60_000).toISOString(),
    is_manual: false,
    tier: '20min',
    snapshot_count: 3,
  },
  {
    snapshot_id: 'snap-manual',
    created_at: new Date(Date.now() - 25 * 60 * 60_000).toISOString(),
    is_manual: true,
    tier: 'daily',
    snapshot_count: 1,
    label: 'Before import',
  },
]

describe('mn-snapshot-diff', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('computes deterministic line diffs without loading a renderer or store', () => {
    expect(diffSnapshotLines('a\nb', 'a\nc\nd')).toEqual([
      { index: 1, older: 'a', newer: 'a', kind: 'same' },
      { index: 2, older: 'b', newer: 'c', kind: 'changed' },
      { index: 3, older: undefined, newer: 'd', kind: 'added' },
    ])
  })

  it('renders split, unified, empty, and annotations from controlled props', async () => {
    const el = document.createElement('mn-snapshot-diff') as MnSnapshotDiff
    el.olderText = 'one\ntwo'
    el.newerText = 'one\nthree'
    el.oldName = 'older.md'
    el.newName = 'newer.md'
    el.annotations = [{ line: 2, side: 'newer', author: 'Ada', text: 'Review this line' }]
    document.body.appendChild(el)
    await el.updateComplete

    expect(sr(el).querySelector('.file-name')?.textContent).toBe('older.md')
    expect(sr(el).querySelector('.line[data-kind="changed"]')).not.toBeNull()
    expect(sr(el).querySelector('.annotation')?.textContent).toContain('Review this line')

    el.diffStyle = 'unified'
    await el.updateComplete
    expect(sr(el).querySelector('.unified')).not.toBeNull()
    expect(sr(el).querySelectorAll('.line[data-kind="added"]')).toHaveLength(1)

    el.newerText = el.olderText
    await el.updateComplete
    expect(sr(el).querySelector('.status')?.textContent).toContain('No changes')
  })
})

describe('mn-timeline-rail', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  async function mountRail(): Promise<MnTimelineRail> {
    const el = document.createElement('mn-timeline-rail') as MnTimelineRail
    el.snapshots = snapshots
    el.olderId = 'snap-auto'
    el.newerId = 'live'
    document.body.appendChild(el)
    await el.updateComplete
    return el
  }

  it('renders live plus snapshots with cursor state', async () => {
    const el = await mountRail()
    const rows = Array.from(sr(el).querySelectorAll('.rail-row'))
    expect(rows).toHaveLength(3)
    expect(rows[0].textContent).toContain('Live (now)')
    expect(rows[1].getAttribute('data-cursor')).toContain('older')
    expect(sr(el).querySelector('.count-chip')?.textContent).toBe('3x')
  })

  it('emits cursor, save, bookmark, and delete intents', async () => {
    const el = await mountRail()
    const cursors: MnTimelineCursorDetail[] = []
    const bookmarks: MnTimelineSnapshotDetail[] = []
    const deletes: MnTimelineSnapshotDetail[] = []
    let saves = 0
    el.addEventListener('cursor-change', (event) => cursors.push((event as CustomEvent<MnTimelineCursorDetail>).detail))
    el.addEventListener('snapshot-bookmark', (event) => bookmarks.push((event as CustomEvent<MnTimelineSnapshotDetail>).detail))
    el.addEventListener('snapshot-delete', (event) => deletes.push((event as CustomEvent<MnTimelineSnapshotDetail>).detail))
    el.addEventListener('save-current', () => saves++)

    ;(sr(el).querySelectorAll<HTMLElement>('.rail-row')[2]).click()
    ;(sr(el).querySelector('[aria-label="Save this version"]') as HTMLButtonElement).click()
    ;(sr(el).querySelector('[aria-label="Delete this saved version"]') as HTMLButtonElement).click()
    ;(Array.from(sr(el).querySelectorAll<HTMLButtonElement>('.action-button')).at(-1)!).click()

    expect(cursors[0]).toEqual({ olderId: 'snap-manual', newerId: 'live', focusedSide: 'older' })
    expect(bookmarks).toEqual([{ snapshotId: 'snap-auto' }])
    expect(deletes).toEqual([{ snapshotId: 'snap-manual' }])
    expect(saves).toBe(1)
  })

  it('supports keyboard cursor movement and focus toggling', async () => {
    const el = await mountRail()
    const cursors: MnTimelineCursorDetail[] = []
    el.addEventListener('cursor-change', (event) => cursors.push((event as CustomEvent<MnTimelineCursorDetail>).detail))

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))

    expect(cursors[0]).toEqual({ olderId: 'snap-manual', newerId: 'live', focusedSide: 'older' })
    expect(cursors[1]).toEqual({ olderId: 'snap-auto', newerId: 'live', focusedSide: 'newer' })
  })
})

describe('mn-restore-overlay', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('renders in-progress, success, and failure states from props', async () => {
    const el = document.createElement('mn-restore-overlay') as MnRestoreOverlay
    el.active = true
    el.operationState = 'restoring'
    el.progress = 42
    el.message = 'Restoring documents'
    document.body.appendChild(el)
    await el.updateComplete

    expect(el.hasAttribute('active')).toBe(true)
    expect(sr(el).querySelector('.title')?.textContent).toBe('Restoring Workspace')
    expect(sr(el).querySelector<HTMLElement>('.progress-fill')?.style.width).toBe('42%')

    el.operationState = 'succeeded'
    await el.updateComplete
    expect(sr(el).querySelector('.title')?.textContent).toBe('Restore Complete')

    el.operationState = 'failed'
    el.error = 'checksum mismatch'
    await el.updateComplete
    expect(sr(el).querySelector('.error-detail')?.textContent).toBe('checksum mismatch')
  })

  it('emits host-owned reload and dismiss intents', async () => {
    const el = document.createElement('mn-restore-overlay') as MnRestoreOverlay
    el.active = true
    el.operationState = 'succeeded'
    document.body.appendChild(el)
    await el.updateComplete

    let reloads = 0
    let dismisses = 0
    el.addEventListener('mn-restore-overlay-reload', () => reloads++)
    el.addEventListener('mn-restore-overlay-dismiss', () => dismisses++)

    sr(el).querySelector<HTMLButtonElement>('.dismiss-button')!.click()
    expect(reloads).toBe(1)

    el.operationState = 'rolled_back'
    await el.updateComplete
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(dismisses).toBe(1)
  })
})
