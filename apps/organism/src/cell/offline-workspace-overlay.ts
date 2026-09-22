/**
 * Read-your-writes projection for source intents that have not yet appeared
 * in a pulled authority epoch.
 *
 * The durable outbox remains the source of truth. This module replays its
 * mediated workspace commands over a clone of the mirrored workspace Y.Doc,
 * then replaces only the affected RDF subjects in the disposable local
 * Oxigraph store. A later source pull retires the whole store and therefore
 * cannot retain optimistic state past its authority epoch.
 */

import { Store, literal, namedNode, quad } from 'oxigraph'
import * as Y from 'yjs'
import type {
  SourceBundle,
  SourceOutboxRecord,
} from '@shrubbery/source'
import { workspaceProjectionGraphIri } from '@shrubbery/runtime'

type Entity = Record<string, unknown>
type EntityKind = 'documents' | 'folders' | 'artifacts' | 'wires'

export interface OfflineWorkspaceOverlay {
  readonly documents: ReadonlyMap<string, Entity>
  readonly folders: ReadonlyMap<string, Entity>
  readonly artifacts: ReadonlyMap<string, Entity>
  readonly wires: ReadonlyMap<string, Entity>
  readonly touched: Readonly<Record<EntityKind, ReadonlySet<string>>>
  readonly key: string
}

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const DOC = 'http://mnemosyne.dev/doc#'
const DCTERMS = 'http://purl.org/dc/terms/'
const NFO = 'http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#'
const NIE = 'http://www.semanticdesktop.org/ontologies/2007/01/19/nie#'
const WIRE = 'http://mnemosyne.ai/vocab#'

function decodeBase64(value: string): Uint8Array {
  const binary = globalThis.atob(value)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

function record(value: unknown): Entity {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Entity) }
    : {}
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function number(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function entities(doc: Y.Doc, name: EntityKind): Map<string, Entity> {
  const json = doc.getMap(name).toJSON()
  return new Map(Object.entries(json).map(([id, value]) => [
    id,
    { id, ...record(value) },
  ]))
}

function visibleOutbox(bundle: SourceBundle, outbox: readonly SourceOutboxRecord[]): SourceOutboxRecord[] {
  const witnessed = new Set(bundle.receipts.map(receipt => receipt.operationId))
  return [...outbox]
    .filter(item => !witnessed.has(item.operation.operationId))
    .filter(item => item.status === 'pending' || item.status === 'accepted' || item.status === 'applied')
    .sort((left, right) => left.createdAt - right.createdAt || left.key.localeCompare(right.key))
}

function setEntity(
  map: Map<string, Entity>,
  touched: Set<string>,
  id: string,
  patch: Entity,
  defaults: Entity = {},
): void {
  map.set(id, { id, ...defaults, ...(map.get(id) ?? {}), ...patch })
  touched.add(id)
}

function removeEntity(map: Map<string, Entity>, touched: Set<string>, id: string): void {
  map.delete(id)
  touched.add(id)
}

export function offlineWorkspaceOverlay(
  bundle: SourceBundle,
  outbox: readonly SourceOutboxRecord[],
): OfflineWorkspaceOverlay {
  const ydoc = new Y.Doc()
  Y.applyUpdate(ydoc, decodeBase64(bundle.workspace.updateBase64))
  const documents = entities(ydoc, 'documents')
  const folders = entities(ydoc, 'folders')
  const artifacts = entities(ydoc, 'artifacts')
  const wires = entities(ydoc, 'wires')
  const touched = {
    documents: new Set<string>(),
    folders: new Set<string>(),
    artifacts: new Set<string>(),
    wires: new Set<string>(),
  }
  const replay = visibleOutbox(bundle, outbox)

  for (const item of replay) {
    const operation = item.operation
    const at = item.createdAt
    if (operation.kind === 'documentLifecycle') {
      const id = text(operation.documentId)
      if (!id) continue
      if (operation.action === 'delete') {
        removeEntity(documents, touched.documents, id)
      } else if (operation.action === 'create' || operation.action === 'recreate') {
        setEntity(documents, touched.documents, id, {
          title: text(operation.title) ?? 'Untitled',
          parentId: null,
          section: 'documents',
          order: at,
          createdAt: at,
          updatedAt: at,
          readOnly: false,
        })
      }
      continue
    }
    if (operation.kind !== 'crdtCommand') continue
    const payload = record(operation.payload)
    const command = text(operation.commandKind)
    const documentId = text(operation.documentId) ?? text(payload.documentId)
    const folderId = text(payload.folderId) ?? text(operation.documentId)
    switch (command) {
      case 'workspace.createDocument':
        if (documentId) {
          setEntity(documents, touched.documents, documentId, {
            ...payload,
            title: text(payload.title) ?? 'Untitled',
            parentId: text(payload.parentId) ?? null,
            section: 'documents',
            order: number(payload.order, at),
            createdAt: number(payload.createdAt, at),
            updatedAt: number(payload.updatedAt, at),
            readOnly: payload.readOnly === true,
          })
        }
        break
      case 'workspace.updateDocument':
        if (documentId) {
          const patch: Entity = { ...payload, updatedAt: number(payload.updatedAt, at) }
          if (Object.hasOwn(payload, 'parentId')) patch.parentId = text(payload.parentId) ?? null
          if (Object.hasOwn(payload, 'order') && payload.order == null) delete patch.order
          setEntity(documents, touched.documents, documentId, patch)
        }
        break
      case 'workspace.deleteDocument':
        if (documentId) removeEntity(documents, touched.documents, documentId)
        break
      case 'workspace.createFolder':
        if (folderId) {
          setEntity(folders, touched.folders, folderId, {
            ...payload,
            name: text(payload.name) ?? 'Untitled Folder',
            parentId: text(payload.parentId) ?? null,
            section: payload.section === 'artifacts' ? 'artifacts' : 'documents',
            order: number(payload.order, at),
          })
        }
        break
      case 'workspace.updateFolder':
      case 'workspace.moveFolder':
        if (folderId) {
          const patch: Entity = { ...payload, updatedAt: number(payload.updatedAt, at) }
          if (Object.hasOwn(payload, 'newParentId') || Object.hasOwn(payload, 'parentId')) {
            patch.parentId = text(payload.newParentId) ?? text(payload.parentId) ?? null
          }
          const movedOrder = payload.newOrder ?? payload.order
          if (movedOrder != null) patch.order = number(movedOrder, at)
          setEntity(folders, touched.folders, folderId, patch)
        }
        break
      case 'workspace.deleteFolder':
        if (folderId) {
          const cascade = payload.cascade === true
          if (cascade) {
            const deleting = new Set([folderId])
            let changed = true
            while (changed) {
              changed = false
              for (const [id, value] of folders) {
                if (deleting.has(id) || !deleting.has(text(value.parentId) ?? '')) continue
                deleting.add(id)
                changed = true
              }
            }
            for (const id of deleting) removeEntity(folders, touched.folders, id)
            for (const [id, value] of documents) {
              if (deleting.has(text(value.parentId) ?? '')) removeEntity(documents, touched.documents, id)
            }
            for (const [id, value] of artifacts) {
              if (deleting.has(text(value.parentId) ?? '')) removeEntity(artifacts, touched.artifacts, id)
            }
          } else {
            removeEntity(folders, touched.folders, folderId)
          }
        }
        break
      case 'workspace.moveDocuments': {
        const ids = Array.isArray(payload.documentIds)
          ? payload.documentIds.filter((value): value is string => typeof value === 'string')
          : []
        const parentId = text(payload.parentId) ?? null
        const baseOrder = number(payload.order, at)
        ids.forEach((id, index) => setEntity(documents, touched.documents, id, {
          parentId,
          order: baseOrder + index,
          updatedAt: at,
        }))
        break
      }
      case 'workspace.putArtifact': {
        const artifactId = text(payload.artifactId) ?? text(operation.documentId)
        if (artifactId) {
          setEntity(artifacts, touched.artifacts, artifactId, {
            ...payload,
            name: text(payload.name) ?? text(payload.label) ?? artifactId,
            parentId: text(payload.parentId) ?? null,
            order: number(payload.order, at),
            updatedAt: at,
          })
        }
        break
      }
      case 'workspace.deleteArtifact': {
        const artifactId = text(payload.artifactId) ?? text(operation.documentId)
        if (artifactId) removeEntity(artifacts, touched.artifacts, artifactId)
        break
      }
      case 'workspace.createWire': {
        const wireId = text(payload.wireId)
        if (wireId) setEntity(wires, touched.wires, wireId, {
          ...payload,
          updatedAt: at,
          createdAt: payload.createdAt ?? at,
        })
        break
      }
      case 'workspace.deleteWire': {
        const wireId = text(payload.wireId)
        if (wireId) removeEntity(wires, touched.wires, wireId)
        break
      }
    }
  }

  return {
    documents,
    folders,
    artifacts,
    wires,
    touched,
    key: replay.map(item => `${item.operation.operationId}:${item.status}:${item.updatedAt}`).join('|'),
  }
}

function documentIri(id: string): string {
  return id.startsWith('urn:mnemosyne:')
    ? id
    : `urn:mnemosyne:local:document:${id}`
}

function entityIri(graphId: string, kind: 'folder' | 'artifact' | 'wire', id: string): string {
  return id.startsWith('urn:mnemosyne:')
    ? id
    : `urn:mnemosyne:local:graph:${graphId}:${kind}:${id}`
}

function blockIri(documentId: string, blockId: string): string {
  return blockId.startsWith('urn:mnemosyne:') && blockId.includes('#block-')
    ? blockId
    : `${documentIri(documentId)}#block-${blockId}`
}

function addText(
  store: Store,
  subject: string,
  predicate: string,
  value: unknown,
  graph: ReturnType<typeof namedNode>,
): void {
  if (typeof value === 'string') store.add(quad(namedNode(subject), namedNode(predicate), literal(value), graph))
  else if (typeof value === 'number' && Number.isFinite(value)) {
    store.add(quad(namedNode(subject), namedNode(predicate), literal(String(value)), graph))
  } else if (typeof value === 'boolean') {
    store.add(quad(namedNode(subject), namedNode(predicate), literal(String(value)), graph))
  }
}

function addNode(
  store: Store,
  subject: string,
  predicate: string,
  value: string,
  graph: ReturnType<typeof namedNode>,
): void {
  store.add(quad(namedNode(subject), namedNode(predicate), namedNode(value), graph))
}

function clearSubject(store: Store, graph: ReturnType<typeof namedNode>, subject: string): void {
  for (const existing of [...store.match(namedNode(subject), null, null, graph)]) store.delete(existing)
}

function clearPredicates(
  store: Store,
  graph: ReturnType<typeof namedNode>,
  subject: string,
  predicates: readonly string[],
): void {
  for (const predicate of predicates) {
    for (const existing of [...store.match(namedNode(subject), namedNode(predicate), null, graph)]) {
      store.delete(existing)
    }
  }
}

export function applyOfflineWorkspaceOverlay(
  store: Store,
  graphId: string,
  overlay: OfflineWorkspaceOverlay,
): void {
  const graph = namedNode(workspaceProjectionGraphIri(graphId))
  const documentPredicates = [
    RDF_TYPE,
    `${DCTERMS}title`,
    `${DOC}title`,
    `${NFO}belongsToContainer`,
    `${DOC}order`,
    `${DOC}section`,
    `${DOC}readOnly`,
    `${DOC}createdAt`,
    `${DOC}updatedAt`,
    `${DOC}sourceStorageKey`,
    `${DOC}sourceOriginalFilename`,
    `${DOC}sourceMimeType`,
    `${DOC}sourceContentSize`,
    `${DOC}sourceFileType`,
  ]
  for (const id of overlay.touched.documents) {
    const subject = documentIri(id)
    clearPredicates(store, graph, subject, documentPredicates)
    const value = overlay.documents.get(id)
    if (!value) continue
    addNode(store, subject, RDF_TYPE, `${DOC}TipTapDocument`, graph)
    addText(store, subject, `${DCTERMS}title`, text(value.title) ?? 'Untitled', graph)
    const parentId = text(value.parentId)
    if (parentId) addNode(store, subject, `${NFO}belongsToContainer`, entityIri(graphId, 'folder', parentId), graph)
    addText(store, subject, `${DOC}order`, value.order ?? 0, graph)
    addText(store, subject, `${DOC}section`, 'documents', graph)
    addText(store, subject, `${DOC}readOnly`, value.readOnly === true, graph)
    addText(store, subject, `${DOC}createdAt`, value.createdAt, graph)
    addText(store, subject, `${DOC}updatedAt`, value.updatedAt, graph)
    for (const [field, predicate] of [
      ['sf_storageKey', `${DOC}sourceStorageKey`],
      ['sf_originalFilename', `${DOC}sourceOriginalFilename`],
      ['sf_mimeType', `${DOC}sourceMimeType`],
      ['sf_sizeBytes', `${DOC}sourceContentSize`],
      ['sf_fileType', `${DOC}sourceFileType`],
    ] as const) addText(store, subject, predicate, value[field], graph)
  }
  for (const id of overlay.touched.folders) {
    const subject = entityIri(graphId, 'folder', id)
    clearSubject(store, graph, subject)
    const value = overlay.folders.get(id)
    if (!value) continue
    addNode(store, subject, RDF_TYPE, `${DOC}Folder`, graph)
    addText(store, subject, `${NFO}fileName`, text(value.name) ?? 'Untitled Folder', graph)
    const parentId = text(value.parentId)
    if (parentId) addNode(store, subject, `${NFO}belongsToContainer`, entityIri(graphId, 'folder', parentId), graph)
    addText(store, subject, `${DOC}order`, value.order ?? 0, graph)
    addText(store, subject, `${DOC}section`, value.section === 'artifacts' ? 'artifacts' : 'documents', graph)
  }
  for (const id of overlay.touched.artifacts) {
    const subject = entityIri(graphId, 'artifact', id)
    clearSubject(store, graph, subject)
    const value = overlay.artifacts.get(id)
    if (!value) continue
    addNode(store, subject, RDF_TYPE, `${DOC}Artifact`, graph)
    addText(store, subject, `${NFO}fileName`, text(value.name) ?? text(value.label) ?? id, graph)
    const parentId = text(value.parentId)
    if (parentId) addNode(store, subject, `${NFO}belongsToContainer`, entityIri(graphId, 'folder', parentId), graph)
    addText(store, subject, `${DOC}order`, value.order ?? 0, graph)
    addText(store, subject, `${NIE}mimeType`, value.mimeType ?? 'application/octet-stream', graph)
    addText(store, subject, `${DOC}status`, value.status ?? 'ready', graph)
    addText(store, subject, `${DOC}fileType`, value.fileType, graph)
    const ingested = text(value.ingestedDocId)
    if (ingested) addNode(store, subject, `${DOC}ingestedDocId`, documentIri(ingested), graph)
  }
  for (const id of overlay.touched.wires) {
    const subject = entityIri(graphId, 'wire', id)
    clearSubject(store, graph, subject)
    const value = overlay.wires.get(id)
    if (!value) continue
    const sourceDocumentId = text(value.sourceDocumentId)
    const targetDocumentId = text(value.targetDocumentId)
    if (!sourceDocumentId || !targetDocumentId) continue
    addNode(store, subject, RDF_TYPE, `${WIRE}Wire`, graph)
    addNode(store, subject, `${WIRE}sourceDocument`, documentIri(sourceDocumentId), graph)
    addNode(store, subject, `${WIRE}targetDocument`, documentIri(targetDocumentId), graph)
    const sourceBlockId = text(value.sourceBlockId)
    const targetBlockId = text(value.targetBlockId)
    if (sourceBlockId) addNode(store, subject, `${WIRE}sourceBlock`, blockIri(sourceDocumentId, sourceBlockId), graph)
    if (targetBlockId) addNode(store, subject, `${WIRE}targetBlock`, blockIri(targetDocumentId, targetBlockId), graph)
    addText(store, subject, `${WIRE}targetGraph`, text(value.targetGraphId) ?? graphId, graph)
    const predicate = text(value.predicate) ?? 'isWiredTo'
    addNode(
      store,
      subject,
      `${WIRE}predicate`,
      /^(?:https?:|urn:)/.test(predicate) ? predicate : `${WIRE}${predicate}`,
      graph,
    )
    addText(store, subject, `${WIRE}bidirectional`, value.bidirectional === true, graph)
    for (const field of ['sourceTitle', 'sourceSnippet', 'targetTitle', 'targetSnippet'] as const) {
      addText(store, subject, `${WIRE}${field}`, value[field], graph)
    }
    addText(store, subject, `${DOC}createdAt`, value.createdAt, graph)
  }
}
