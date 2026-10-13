/**
 * save-flow.test.ts — Save to Garden and Download as Markdown.
 *
 * NO MOCKS. The workspace port is a REAL object implementing the port interface
 * (it records what it is asked and can refuse); the conversations are real live
 * messages or a real imported conversation read through the real reader.
 */
import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@shrubbery/chat-kernel'
import { liveExportSource, importedExportSource, type MarkdownFile } from '../conversation-export.js'
import { createImportedReader } from '../imported-reader.js'
import {
  SAVE_TO_GARDEN_INTRO,
  createSaveFlow,
  saveToGardenCopy,
  type SaveTarget,
  type SaveToGardenPort,
} from '../save-flow.js'
import { MemoryArchive, RecordingPort, at, cid, importedItem, rid, sampleConversation } from './archive-fixtures.js'

const NOW = new Date(2026, 8, 28, 15, 0).getTime()

const FIELD: SaveTarget = { graphId: 'field-notes', title: 'Field notes' }
const HOME: SaveTarget = { graphId: 'home', title: 'Home' }

const liveMessages: ChatMessage[] = [
  { id: 'a', role: 'user', content: 'Hello', parts: [{ type: 'text', content: 'Hello' }], isStreaming: false, toolCalls: [], createdAt: new Date(2026, 8, 28, 9, 30).getTime() },
  { id: 'b', role: 'assistant', content: 'Hi there', parts: [{ type: 'text', content: 'Hi there' }], isStreaming: false, toolCalls: [], createdAt: new Date(2026, 8, 28, 9, 31).getTime() },
]

function liveFlow(port: SaveToGardenPort | null) {
  const downloads: MarkdownFile[] = []
  const flow = createSaveFlow({
    source: liveExportSource({ title: 'Deploy notes', messages: liveMessages }),
    port,
    download: file => { downloads.push(file) },
    now: () => NOW,
  })
  return { flow, downloads }
}

describe('the promise the person is shown', () => {
  it('reads exactly as the release ruled, with the workspace named', () => {
    expect(saveToGardenCopy('Field notes')).toBe('Copies this conversation into Field notes. Everyone with access there can read it.')
    expect(saveToGardenCopy('Home')).toBe('Copies this conversation into Home. Everyone with access there can read it.')
    expect(SAVE_TO_GARDEN_INTRO).toBe('Choose the workspace to copy this conversation into.')
  })
})

describe('choosing where a copy goes', () => {
  it('offers only what the port offers, and chooses nothing for the person when there are several', async () => {
    const port = new RecordingPort([FIELD, HOME])
    const { flow } = liveFlow(port)
    expect(flow.getState().targets).toBeNull()
    await flow.loadTargets()
    expect(flow.getState().targets).toEqual([FIELD, HOME])
    expect(flow.getState().selected).toBeNull()
    expect(flow.getState().phase).toBe('choosing')
    await flow.save()
    expect(port.saved).toEqual([])
    expect(flow.getState().error).toBe('Choose a workspace first.')
  })

  it('preselects the only workspace, and still waits for the person to press Save', async () => {
    const port = new RecordingPort([FIELD])
    const { flow } = liveFlow(port)
    await flow.loadTargets()
    expect(flow.getState().selected).toBe('field-notes')
    expect(port.saved).toEqual([])
  })

  it('says so when there is nowhere the person can write, and when the list cannot be read, and can ask again', async () => {
    const none = liveFlow(new RecordingPort([]))
    await none.flow.loadTargets()
    expect(none.flow.getState().targets).toEqual([])
    expect(none.flow.getState().selected).toBeNull()

    const port = new RecordingPort([HOME])
    port.failTargetsNext(new Error('workspace directory unavailable'))
    const { flow } = liveFlow(port)
    await flow.loadTargets()
    expect(flow.getState().targets).toBeNull()
    expect(flow.getState().targetsError).toBe('workspace directory unavailable')
    await flow.loadTargets()
    expect(flow.getState().targetsError).toBeNull()
    expect(flow.getState().targets).toEqual([HOME])
    expect(port.targetCalls).toBe(2)
  })

  it('accepts a choice only from the list it showed', async () => {
    const { flow } = liveFlow(new RecordingPort([FIELD, HOME]))
    await flow.loadTargets()
    flow.select('somewhere-else')
    expect(flow.getState().selected).toBeNull()
    flow.select('home')
    expect(flow.getState().selected).toBe('home')
  })
})

describe('saving a live conversation', () => {
  it('copies it, as Markdown, into the workspace the person chose, and ends saved', async () => {
    const port = new RecordingPort([FIELD, HOME])
    const { flow } = liveFlow(port)
    await flow.loadTargets()
    flow.select('home')
    await flow.save()
    expect(port.saved).toHaveLength(1)
    const request = port.saved[0]
    expect(request).toMatchObject({ workspaceId: 'home', workspaceTitle: 'Home', title: 'Deploy notes', kind: 'live' })
    expect(request.markdown).toContain('# Deploy notes')
    expect(request.markdown).toContain('## You\n\n*Sep 28, 2026, 9:30 AM*\n\nHello')
    expect(request.markdown).toContain('## Assistant\n\n*Sep 28, 2026, 9:31 AM*\n\nHi there')
    const state = flow.getState()
    expect(state.phase).toBe('saved')
    expect(state.result).toEqual({ workspaceId: 'home', workspaceTitle: 'Home', documentIds: ['doc-saved-1'] })
    expect(state.error).toBeNull()
  })

  it('says a refused save was refused, keeps the choice, and saves on the next try', async () => {
    const port = new RecordingPort([FIELD])
    const { flow } = liveFlow(port)
    await flow.loadTargets()
    port.refuseNext(new Error('You need Editor access to Field notes.'))
    await flow.save()
    expect(flow.getState().phase).toBe('error')
    expect(flow.getState().error).toBe('You need Editor access to Field notes.')
    expect(flow.getState().selected).toBe('field-notes')
    expect(flow.getState().result).toBeNull()
    await flow.save()
    expect(flow.getState().phase).toBe('saved')
    expect(port.saved).toHaveLength(2)
  })

  it('cannot save at all without a port, but still offers the download', async () => {
    const { flow, downloads } = liveFlow(null)
    await flow.loadTargets()
    expect(flow.getState().targets).toEqual([])
    await flow.save()
    expect(flow.getState().error).toBe('Saving to a workspace is not available here.')
    await flow.downloadMarkdown()
    expect(downloads).toHaveLength(1)
  })
})

describe('saving an imported conversation', () => {
  async function importedFlow(port: SaveToGardenPort) {
    const item = importedItem(7, {
      revision: { revisionId: rid(7), title: 'Kimi chat', messageCount: 3, partCount: 9 },
      firstOccurredAt: at(2026, 3, 3, 14, 5),
      lastOccurredAt: at(2026, 3, 3, 14, 7),
      models: [{ id: 'moonshotai/kimi-k2.5', provider: 'moonshotai' }],
      attributionBasis: 'account header',
    })
    const archive = new MemoryArchive({ items: [item], messages: { [cid(7)]: sampleConversation() }, messagePageSize: 2 })
    const reader = createImportedReader(archive, item)
    await reader.open()
    const downloads: MarkdownFile[] = []
    const flow = createSaveFlow({ source: importedExportSource(reader), port, download: file => { downloads.push(file) }, now: () => NOW })
    return { flow, reader, archive, downloads }
  }

  it('loads every page first, showing progress, then saves the whole conversation with its provenance and voice marks', async () => {
    const port = new RecordingPort([FIELD])
    const { flow, reader } = await importedFlow(port)
    expect(reader.getState().messages).toHaveLength(2)
    await flow.loadTargets()
    const phases: string[] = []
    flow.subscribe(() => phases.push(flow.getState().phase))
    await flow.save()
    expect(phases).toContain('preparing')
    expect(phases).toContain('saving')
    expect(flow.getState().phase).toBe('saved')
    expect(reader.getState().messages).toHaveLength(3)
    const request = port.saved[0]
    expect(request).toMatchObject({ workspaceId: 'field-notes', title: 'Kimi chat', kind: 'imported' })
    expect(request.markdown).toContain('Imported from the old garden · account header')
    expect(request.markdown).toContain('voice: Kimi K2.5 · source-recorded')
    expect(request.markdown).toContain('voice not recorded')
  })

  it('reports how far it has read while it reads', async () => {
    const port = new RecordingPort([FIELD])
    const { flow } = await importedFlow(port)
    await flow.loadTargets()
    const seen: Array<{ loaded: number; total: number } | null> = []
    flow.subscribe(() => seen.push(flow.getState().progress))
    await flow.save()
    expect(seen.some(progress => progress !== null && progress.total === 3)).toBe(true)
    expect(flow.getState().progress).toBeNull()
  })

  it('stops reading when the person cancels, and saves nothing', async () => {
    const port = new RecordingPort([FIELD])
    const { flow, archive } = await importedFlow(port)
    await flow.loadTargets()
    const release = archive.hold('messages')
    const saving = flow.save()
    flow.cancel()
    release()
    await saving
    expect(port.saved).toEqual([])
    expect(flow.getState().phase).toBe('choosing')
  })

  it('says the archive could not be read, and saves nothing, when a page fails', async () => {
    const port = new RecordingPort([FIELD])
    const { flow, archive } = await importedFlow(port)
    await flow.loadTargets()
    archive.failNext('messages')
    await flow.save()
    expect(port.saved).toEqual([])
    expect(flow.getState().phase).toBe('error')
    expect(flow.getState().error).toContain('could not be loaded')
  })
})

describe('downloading as Markdown', () => {
  it('hands the file to the host, names it after the title and the day, and saves nothing', async () => {
    const port = new RecordingPort([FIELD])
    const { flow, downloads } = liveFlow(port)
    await flow.downloadMarkdown()
    expect(downloads).toHaveLength(1)
    expect(downloads[0].filename).toBe('deploy-notes-2026-09-28.md')
    expect(downloads[0].mimeType).toBe('text/markdown;charset=utf-8')
    expect(downloads[0].text).toContain('# Deploy notes')
    expect(port.saved).toEqual([])
    expect(flow.getState().downloaded).toBe('deploy-notes-2026-09-28.md')
    expect(flow.getState().phase).toBe('choosing')
  })

  it('says it could not make the file when reading the conversation fails', async () => {
    const item = importedItem(7)
    const archive = new MemoryArchive({ items: [item], messages: { [cid(7)]: sampleConversation() }, messagePageSize: 1 })
    const reader = createImportedReader(archive, item)
    await reader.open()
    archive.failNext('messages')
    const downloads: MarkdownFile[] = []
    const flow = createSaveFlow({ source: importedExportSource(reader), port: null, download: file => { downloads.push(file) }, now: () => NOW })
    await flow.downloadMarkdown()
    expect(downloads).toEqual([])
    expect(flow.getState().phase).toBe('error')
  })

  it('tells subscribers about every change, and stops when they leave', async () => {
    const { flow } = liveFlow(new RecordingPort([FIELD]))
    let heard = 0
    const stop = flow.subscribe(() => { heard += 1 })
    await flow.loadTargets()
    expect(heard).toBeGreaterThan(0)
    const settled = heard
    stop()
    await flow.downloadMarkdown()
    expect(heard).toBe(settled)
  })
})
