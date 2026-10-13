/**
 * What a turn changed, read off the turn's own tool calls (pure; no DOM).
 *
 * The workspace chat writes through the cell's tools (the empowered-chat design §2). A turn's
 * "Changed in this turn" strip is the honest list of what those calls touched: which documents,
 * artifacts, folders and wires, how, whether each change is recoverable from History, and
 * which calls were refused. Ids come from three places, most trusted first: the host's own
 * id-only receipt (`metadata.targets`, what a durable session record keeps), the call's
 * arguments (what was asked of the workspace, once the call succeeded), and the call's result.
 */
import { describe, expect, it } from 'vitest'
import { isWriteTool, turnChangesOf } from '../turn-changes.js'
import type { ToolCall } from '../types.js'

let seq = 0
function call(tool: string, input: Record<string, unknown> | null, extra: Partial<ToolCall> = {}): ToolCall {
  seq += 1
  return { id: `${tool}#${seq}`, tool, status: 'completed', input, output: null, metadata: null, ...extra }
}

describe('isWriteTool', () => {
  it('knows the writer families and nothing else', () => {
    for (const tool of [
      'create_document', 'write_document', 'insert_blocks', 'update_blocks', 'edit_block_text', 'delete_blocks',
      'edit_comment', 'create_folder', 'move_documents', 'move_folder', 'rename', 'create_wires', 'value',
      'create_artifact_text', 'write_artifact_text', 'restore_artifact_revision', 'delete_document', 'delete',
    ]) expect(isWriteTool(tool), tool).toBe(true)
    for (const tool of ['read_document', 'search_documents', 'surface', 'custom_css', 'get_wires', 'list_artifact_revisions', 'bash']) {
      expect(isWriteTool(tool), tool).toBe(false)
    }
  })

  it('reads a prefixed tool name the way a host may spell it', () => {
    expect(isWriteTool('mnemosyne_write_document')).toBe(true)
    expect(isWriteTool('mnemosyne__create_artifact_text')).toBe(true)
    expect(isWriteTool('garden.delete_blocks')).toBe(true)
    expect(isWriteTool('mnemosyne_read_document')).toBe(false)
  })
})

describe('turnChangesOf', () => {
  it('is empty for a turn that only read', () => {
    const changes = turnChangesOf([call('search_documents', { query: 'x' }), call('read_document', { documentId: 'a' })])
    expect(changes.changes).toEqual([])
    expect(changes.refused).toBe(0)
  })

  it('names each document once, with every way the turn changed it, in order', () => {
    const changes = turnChangesOf([
      call('read_document', { documentId: 'plan' }),
      call('write_document', { documentId: 'plan', content: 'x', title: 'The plan' }),
      call('edit_block_text', { documentId: 'plan', blockId: 'b2', operations: [] }),
      call('insert_blocks', { documentId: 'notes', content: 'y' }),
    ])
    expect(changes.changes.map(change => [change.subject, change.id, change.verbs])).toEqual([
      ['document', 'plan', ['edited']],
      ['document', 'notes', ['edited']],
    ])
    expect(changes.changes[0].title).toBe('The plan')
    expect(changes.changes[0].blockId).toBe('b2')
    expect(changes.changes[0].removal).toBeNull()
  })

  it('takes a new document\'s id from the result when the call did not name one', () => {
    const changes = turnChangesOf([
      call('create_document', { graphId: 'g', title: 'Fresh' }, { output: JSON.stringify({ documentId: 'fresh-1', title: 'Fresh' }) }),
    ])
    expect(changes.changes).toHaveLength(1)
    expect(changes.changes[0]).toMatchObject({ subject: 'document', id: 'fresh-1', title: 'Fresh', verbs: ['created'] })
  })

  it('shows a whole-document delete as gone for good, distinct from text removed (which History keeps)', () => {
    const changes = turnChangesOf([
      call('delete_blocks', { documentId: 'kept', blockIds: ['b1', 'b2'] }),
      call('delete_document', { documentId: 'gone' }),
      call('delete', { type: 'documents', documentIds: ['also-gone'] }),
    ])
    const byId = Object.fromEntries(changes.changes.map(change => [change.id, change]))
    expect(byId.kept).toMatchObject({ verbs: ['text-removed'], removal: 'text', blockId: 'b1' })
    expect(byId.gone).toMatchObject({ verbs: ['deleted'], removal: 'document' })
    expect(byId['also-gone']).toMatchObject({ verbs: ['deleted'], removal: 'document' })
  })

  it('a document edited and then deleted in one turn is shown deleted', () => {
    const changes = turnChangesOf([
      call('write_document', { documentId: 'doomed', content: 'x' }),
      call('delete_document', { documentId: 'doomed' }),
    ])
    expect(changes.changes).toHaveLength(1)
    expect(changes.changes[0]).toMatchObject({ id: 'doomed', removal: 'document', verbs: ['edited', 'deleted'] })
  })

  it('reads every kind the generic delete takes', () => {
    const changes = turnChangesOf([
      call('delete', { type: 'blocks', documentId: 'd1', blockIds: ['x'] }),
      call('delete', { type: 'folder', folderId: 'f1' }),
      call('delete', { type: 'wires', wireIds: ['w1', 'w2'] }),
    ])
    expect(changes.changes.map(change => [change.subject, change.id, change.removal])).toEqual([
      ['document', 'd1', 'text'],
      ['folder', 'f1', 'folder'],
      ['wire', 'w1', 'wire'],
      ['wire', 'w2', 'wire'],
    ])
  })

  it('reads comments, folders, moves, renames, wires and values', () => {
    const changes = turnChangesOf([
      call('edit_comment', { action: 'set', document_id: 'c1', comment_id: 'k', text: 'hi' }),
      call('edit_comment', { action: 'delete', document_id: 'c2', comment_id: 'k' }),
      call('create_folder', { graphId: 'g', name: 'Archive', folderId: 'archive' }),
      call('move_documents', { graphId: 'g', documentIds: ['m1', 'm2'], parentId: 'archive' }),
      call('move_folder', { graph_id: 'g', folder_id: 'archive', new_parent_id: null }),
      call('rename', { graph_id: 'g', entity_type: 'document', entity_id: 'r1', new_name: 'Renamed' }),
      call('rename', { graph_id: 'g', entity_type: 'graph', new_name: 'Never' }),
      call('create_wires', { wires: [{ sourceDocumentId: 'w-src', targetDocumentId: 'w-dst', predicate: 'cites' }] }),
      call('value', { documentId: 'v1', blockId: 'vb', importance: 3 }),
    ])
    const rows = changes.changes.map(change => [change.subject, change.id, change.verbs.join('+'), change.removal])
    expect(rows).toEqual([
      ['document', 'c1', 'commented', null],
      ['document', 'c2', 'comment-removed', 'comment'],
      ['folder', 'archive', 'created+moved', null],
      ['document', 'm1', 'moved', null],
      ['document', 'm2', 'moved', null],
      ['document', 'r1', 'renamed', null],
      ['document', 'w-src', 'linked', null],
      ['document', 'v1', 'valued', null],
    ])
    expect(changes.changes.find(change => change.id === 'r1')?.title).toBe('Renamed')
    expect(changes.changes.find(change => change.id === 'archive')?.title).toBe('Archive')
  })

  it('names an HTML artifact with its media type, from create to write to restore', () => {
    const changes = turnChangesOf([
      call('create_artifact_text', {
        graph_id: 'g', graph_incarnation: 'i', artifact_id: 'board', operation_id: 'op1',
        filename: 'board.html', mime_type: 'text/html', text: '<p>x</p>',
      }),
      call('write_artifact_text', { artifact_id: 'board', operation_id: 'op2', expected_content_sha256: 'a', text: 'y' }),
      call('restore_artifact_revision', { artifactId: 'board', revisionId: 'r1' }),
    ])
    expect(changes.changes).toHaveLength(1)
    expect(changes.changes[0]).toMatchObject({
      subject: 'artifact', id: 'board', title: 'board.html', mediaType: 'text/html', verbs: ['created', 'edited', 'restored'],
    })
  })

  it('trusts the host\'s id-only receipt when the durable record kept no arguments', () => {
    const changes = turnChangesOf([
      call('write_document', {}, { metadata: { targets: [{ kind: 'document', id: 'from-receipt' }] } }),
      call('create_artifact_text', {}, { metadata: { targets: [{ kind: 'artifact', id: 'art', mediaType: 'text/html' }] } }),
      call('delete', {}, { metadata: { targets: [{ kind: 'block', id: 'blk', documentId: 'holder' }] } }),
      call('delete', {}, { metadata: { targets: [{ kind: 'wire', id: 'w9' }] } }),
      call('delete', {}, { metadata: { targets: [{ kind: 'document', id: 'dead' }] } }),
    ])
    expect(changes.changes.map(change => [change.subject, change.id, change.verbs.join('+'), change.removal, change.mediaType])).toEqual([
      ['document', 'from-receipt', 'edited', null, null],
      ['artifact', 'art', 'created', null, 'text/html'],
      ['document', 'holder', 'text-removed', 'text', null],
      ['wire', 'w9', 'deleted', 'wire', null],
      ['document', 'dead', 'deleted', 'document', null],
    ])
    expect(changes.changes[2].blockId).toBe('blk')
  })

  it('refuses a receipt that is not id-shaped, and says plainly when the backend named nothing', () => {
    const changes = turnChangesOf([
      call('write_document', {}, { metadata: { targets: [{ kind: 'document', id: '<script>' }, { kind: 'planet', id: 'x' }] } }),
      call('write_document', {}),
      call('create_artifact_text', null),
    ])
    expect(changes.changes.map(change => [change.subject, change.id, change.verbs])).toEqual([
      ['document', null, ['edited']],
      ['artifact', null, ['created']],
    ])
  })

  it('counts refused writes apart and keeps a running write as pending', () => {
    const changes = turnChangesOf([
      call('write_document', { documentId: 'denied' }, { status: 'error', output: 'permission denied' }),
      call('insert_blocks', { documentId: 'busy' }, { status: 'running' }),
    ])
    expect(changes.refused).toBe(1)
    expect(changes.changes.map(change => [change.id, change.pending])).toEqual([['busy', true]])
  })
})
