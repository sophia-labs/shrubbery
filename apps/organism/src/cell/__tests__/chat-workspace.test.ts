/**
 * The organism shell's half of the empowered workspace chat (NO MOCKS: real functions over real data,
 * the real ArtifactLivePreview).
 *
 *  - what the person has open, as the chat's `contextRefs`: the active document first ("this
 *    document"), its focused block as `doc#block`, then other open documents; an artifact when that is
 *    what is open; never anything that is not id-shaped;
 *  - the person's role on the workspace, from the gateway's graph list;
 *  - History "at the version before the turn": the newest snapshot taken before the turn began;
 *  - the chat's live HTML preview port over the shell's own artifact read and room watch.
 */
import { describe, expect, it } from 'vitest'
import type { ChatArtifactPreviewView } from '@shrubbery/runtime'
import { type ArtifactTextSnapshot, ArtifactTextReadError } from '../artifact-live-preview.js'
import { chatContextRefs, makeChatArtifactPreviewPort, snapshotBefore, workspaceRoleOf } from '../chat-workspace.js'

describe('chatContextRefs', () => {
  it('names the active document first, then its focused block, then the other open documents', () => {
    expect(chatContextRefs({
      activeDocumentId: 'plan',
      activeBlockId: 'b7',
      openDocumentIds: ['notes', 'plan', 'diary'],
    })).toEqual(['plan', 'plan#b7', 'notes', 'diary'])
  })

  it('names an open artifact when no document is open', () => {
    expect(chatContextRefs({ activeDocumentId: null, artifactId: 'board' })).toEqual(['board'])
  })

  it('sends nothing that is not id-shaped, and nothing at all when nothing is open', () => {
    expect(chatContextRefs({ activeDocumentId: null })).toEqual([])
    expect(chatContextRefs({ activeDocumentId: 'has space', activeBlockId: 'b', openDocumentIds: ['ok', 'zot:x'] })).toEqual(['ok'])
    expect(chatContextRefs({ activeDocumentId: 'plan', activeBlockId: 'not#ok' })).toEqual(['plan'])
  })
})

describe('workspaceRoleOf', () => {
  it('reads the person\'s role on the bound graph from the gateway\'s list, and nothing else', () => {
    const graphs = [
      { graphId: 'mine', role: 'owner' },
      { graphId: 'shared', role: 'editor' },
      { graphId: 'seen', role: 'viewer' },
      { graphId: 'odd', role: 'admin' },
    ] as const
    expect(workspaceRoleOf(graphs, 'mine')).toBe('owner')
    expect(workspaceRoleOf(graphs, 'shared')).toBe('editor')
    expect(workspaceRoleOf(graphs, 'seen')).toBe('viewer')
    expect(workspaceRoleOf(graphs, 'odd')).toBeNull()
    expect(workspaceRoleOf(graphs, 'absent')).toBeNull()
  })
})

describe('snapshotBefore', () => {
  const snapshots = [
    { id: 's3', createdAt: '2026-10-06T12:00:30.000Z' },
    { id: 's2', createdAt: Date.parse('2026-10-06T11:59:00.000Z') },
    { id: 's1', createdAt: new Date('2026-10-06T10:00:00.000Z') },
  ]

  it('stands at the newest version taken before the turn began', () => {
    expect(snapshotBefore(snapshots, Date.parse('2026-10-06T12:00:00.000Z'))).toBe('s2')
    expect(snapshotBefore(snapshots, Date.parse('2026-10-06T11:00:00.000Z'))).toBe('s1')
  })

  it('has nothing to stand at when every version came after, or no time was given', () => {
    expect(snapshotBefore(snapshots, Date.parse('2026-10-05T00:00:00.000Z'))).toBeNull()
    expect(snapshotBefore(snapshots, undefined)).toBeNull()
  })
})

describe('the chat\'s live HTML preview port', () => {
  function snapshot(text: string, hash: string): ArtifactTextSnapshot {
    return {
      graphId: 'g', graphIncarnation: 'inc-1', artifactId: 'board', filename: 'board.html', mimeType: 'text/html',
      text, sizeBytes: text.length, contentHashSha256: hash.repeat(64).slice(0, 64),
    }
  }

  async function settle(): Promise<void> {
    for (let index = 0; index < 5; index += 1) await new Promise(resolve => setTimeout(resolve, 0))
  }

  it('reads the artifact, then reads it again whenever the room says it changed, and lets go when closed', async () => {
    let current = snapshot('<p>v1</p>', 'a')
    let reads = 0
    let invalidate: () => void = () => undefined
    let watching = 0
    const port = makeChatArtifactPreviewPort({
      graphId: () => 'g',
      read: async () => { reads += 1; return current },
      watch: (_artifactId, onInvalidate) => {
        watching += 1
        invalidate = onInvalidate
        return () => { watching -= 1 }
      },
    })
    const views: ChatArtifactPreviewView[] = []
    const handle = port.open('board', view => views.push(view))
    await settle()
    expect(views.at(-1)).toMatchObject({ status: 'ready', html: '<p>v1</p>', mimeType: 'text/html', title: 'board.html', graphId: 'g' })
    const first = views.at(-1)!.identity

    current = snapshot('<p>v2</p>', 'b')
    invalidate()
    await settle()
    expect(views.at(-1)).toMatchObject({ status: 'ready', html: '<p>v2</p>' })
    expect(views.at(-1)!.identity).not.toBe(first)
    expect(reads).toBeGreaterThanOrEqual(2)

    handle.close()
    expect(watching).toBe(0)
  })

  it('says an artifact the shell knows is not HTML is not HTML, without reading it', async () => {
    let reads = 0
    const port = makeChatArtifactPreviewPort({
      graphId: () => 'g',
      knownMimeType: () => 'text/plain',
      read: async () => { reads += 1; throw new Error('never') },
      watch: () => () => undefined,
    })
    const views: ChatArtifactPreviewView[] = []
    port.open('notes', view => views.push(view))
    await settle()
    expect(views.at(-1)).toMatchObject({ status: 'ready', mimeType: 'text/plain', html: null })
    expect(reads).toBe(0)
  })

  it('says a read that failed, in words', async () => {
    const port = makeChatArtifactPreviewPort({
      graphId: () => 'g',
      read: async () => { throw new ArtifactTextReadError('Artifact read failed (HTTP 404).', true) },
      watch: () => () => undefined,
    })
    const views: ChatArtifactPreviewView[] = []
    port.open('gone', view => views.push(view))
    await settle()
    expect(views.at(-1)).toMatchObject({ status: 'error', error: 'Artifact read failed (HTTP 404).' })
  })

  it('hands a download to the shell', () => {
    const asked: string[] = []
    const port = makeChatArtifactPreviewPort({
      graphId: () => 'g',
      read: async () => { throw new Error('unused') },
      watch: () => () => undefined,
      download: artifactId => { asked.push(artifactId) },
    })
    port.download?.('board')
    expect(asked).toEqual(['board'])
  })
})
