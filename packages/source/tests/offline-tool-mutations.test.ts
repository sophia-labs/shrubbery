import { describe, expect, it } from 'vitest'
import {
  sourceOperationsForToolMutation,
  type SourceBundle,
} from '../src/index.js'

const ids = (tool: string, index: number): string => `op:${tool}:${index}`

describe('offline tool mutation routing', () => {
  it('routes sidebar rename and identity-fenced create through stable source operations', () => {
    expect(sourceOperationsForToolMutation('rename', {
      graphId: 'graph-a',
      entityType: 'document',
      entityId: 'doc-a',
      newName: 'Offline title',
    }, ids)).toEqual([{
      kind: 'crdtCommand',
      operationId: 'op:rename:0',
      commandKind: 'workspace.updateDocument',
      documentId: 'doc-a',
      payload: { documentId: 'doc-a', title: 'Offline title' },
    }])
    expect(sourceOperationsForToolMutation('create_folder', {
      graphId: 'graph-a',
      folderId: 'folder-a',
      name: 'Research',
    }, ids)?.[0]).toMatchObject({
      kind: 'crdtCommand',
      commandKind: 'workspace.createFolder',
      payload: { folderId: 'folder-a', name: 'Research' },
    })
    expect(sourceOperationsForToolMutation('create_document', {
      graphId: 'graph-a',
      documentId: 'doc-new',
      documentIncarnation: '11111111-1111-4111-8111-111111111111',
      title: 'Offline first',
    }, ids)).toEqual([
      {
        kind: 'documentLifecycle',
        operationId: 'op:create_document:0',
        action: 'create',
        documentId: 'doc-new',
        title: 'Offline first',
        newDocumentIncarnation: '11111111-1111-4111-8111-111111111111',
      },
      {
        kind: 'crdtCommand',
        operationId: 'op:create_document:1',
        commandKind: 'workspace.updateDocument',
        documentId: 'doc-new',
        payload: { documentId: 'doc-new', parentId: null, order: null },
      },
    ])
  })

  it('requires the observed document lifetime for offline deletion', () => {
    expect(sourceOperationsForToolMutation('delete_document', {
      graphId: 'graph-a',
      documentId: 'doc-a',
    }, ids)).toBeUndefined()
    expect(sourceOperationsForToolMutation('delete_document', {
      graphId: 'graph-a',
      documentId: 'doc-a',
      expectedDocumentIncarnation: 'inc-a',
    }, ids)).toEqual([{
      kind: 'documentLifecycle',
      operationId: 'op:delete_document:0',
      action: 'delete',
      documentId: 'doc-a',
      expectedDocumentIncarnation: 'inc-a',
    }])
  })

  it('expands a wire batch into independently replayable commands', () => {
    const operations = sourceOperationsForToolMutation('create_wires', {
      graphId: 'graph-a',
      wires: [
        { wireId: 'wire-a', sourceDocumentId: 'doc-a', targetDocumentId: 'doc-b' },
        { wireId: 'wire-b', sourceDocumentId: 'doc-b', targetDocumentId: 'doc-c' },
      ],
    }, ids)
    expect(operations).toHaveLength(2)
    expect(operations?.map(operation => operation.operationId)).toEqual([
      'op:create_wires:0',
      'op:create_wires:1',
    ])
    expect(operations?.map(operation => operation.commandKind)).toEqual([
      'workspace.createWire',
      'workspace.createWire',
    ])
  })

  it('leaves reads and raw RDF administration on the live path while routing graph metadata', () => {
    expect(sourceOperationsForToolMutation('sparql_query', {}, ids)).toBeUndefined()
    expect(sourceOperationsForToolMutation('sparql_update', {}, ids)).toBeUndefined()
    expect(sourceOperationsForToolMutation('rename', {
      graphId: 'graph-a',
      entityType: 'graph',
      entityId: 'graph-a',
      newName: 'New graph title',
    }, ids)).toEqual([{
      kind: 'graphMetadata',
      operationId: 'op:rename:0',
      title: 'New graph title',
    }])
  })

  it('routes valuation, memory, and retraction Meaningful Object events', () => {
    expect(sourceOperationsForToolMutation('value', {
      graphId: 'graph-a',
      documentId: 'doc-a',
      blockId: 'block-a',
      importance: 4,
      tags: ['offline'],
    }, ids, { now: 123 })).toEqual([{
      kind: 'valuation',
      operationId: 'op:value:0',
      valuationEventId: 'op:value:0',
      observer: '',
      documentId: 'doc-a',
      blockId: 'block-a',
      importance: 4,
      tags: ['offline'],
      atMs: 123,
    }])
    expect(sourceOperationsForToolMutation('remember', {
      graphId: 'graph-a',
      content: 'Offline testimony',
      blockIds: ['block-a'],
      documentId: 'doc-a',
      observerAgentId: 'agent-a',
    }, ids, { now: 124 })).toEqual([{
      kind: 'memory',
      operationId: 'op:remember:0',
      observer: 'agent-a',
      publish: false,
      atMs: 124,
      records: [expect.objectContaining({
        content: 'Offline testimony',
        observerAgentId: 'agent-a',
        sourceRefs: [{
          sourceKind: 'DocumentBlock',
          blockId: 'block-a',
          documentId: 'doc-a',
        }],
      })],
    }])
    expect(sourceOperationsForToolMutation('emporium_retract', {
      graphId: 'graph-a',
      subject: 'urn:object',
      rationale: 'Superseded',
      kind: 'archive',
    }, ids, { now: 125 })).toEqual([{
      kind: 'retraction',
      operationId: 'op:emporium_retract:0',
      retractionEventId: 'op:emporium_retract:0',
      subject: 'urn:object',
      rationale: 'Superseded',
      retractionKind: 'archive',
      atMs: 125,
    }])
  })

  it('uses the mirrored Meaningful Object registry and causal version for Emporium writes', () => {
    const bundle = {
      sourceRegistry: [
        { vocab: 'emporium-bookmark', class: 'Bookmark', sourceKind: 'current-state' },
        { vocab: 'workflow', class: 'CompositionEvent', sourceKind: 'event-log' },
      ],
      currentState: [{
        objectKey: 'emporium-bookmark\u001fBookmark\u001fbookmark-a',
        sourceVersion: 'version-a',
      }],
    } as unknown as SourceBundle
    expect(sourceOperationsForToolMutation('emporium_write', {
      graphId: 'graph-a',
      vocab: 'emporium-bookmark',
      observer: 'agent-a',
      records: [{
        kind: 'Bookmark',
        clientRef: 'bookmark-a',
        title: 'Offline bookmark',
        url: 'https://offline.test',
      }],
    }, ids, { bundle, now: 200 })).toEqual([{
      kind: 'currentState',
      operationId: 'op:emporium_write:0',
      vocab: 'emporium-bookmark',
      class: 'Bookmark',
      objectId: 'bookmark-a',
      baseVersion: 'version-a',
      record: {
        kind: 'Bookmark',
        localId: 'bookmark-a',
        title: 'Offline bookmark',
        url: 'https://offline.test',
      },
      causalOrder: 200,
      clientId: 'agent-a',
    }])
    expect(sourceOperationsForToolMutation('emporium_write', {
      graphId: 'graph-a',
      vocab: 'workflow',
      records: [{
        kind: 'CompositionEvent',
        localId: 'event-a',
        gestureKind: 'insert',
      }],
    }, ids, { bundle })).toEqual([{
      kind: 'eventLog',
      operationId: 'op:emporium_write:0',
      eventId: 'event-a',
      vocab: 'workflow',
      class: 'CompositionEvent',
      record: {
        kind: 'CompositionEvent',
        localId: 'event-a',
        gestureKind: 'insert',
      },
    }])
  })
})
