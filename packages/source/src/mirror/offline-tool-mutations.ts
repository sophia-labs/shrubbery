import type { SourceBundle, SourceOperation } from './source-mirror.js'

export type SourceOperationIdFactory = (toolName: string, index: number) => string

export interface OfflineToolMutationContext {
  readonly bundle?: SourceBundle
  readonly existingOperations?: readonly SourceOperation[]
  readonly now?: number
}

function stringAt(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return undefined
}

function valueAt(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): unknown {
  for (const key of keys) {
    if (Object.hasOwn(value, key)) return value[key]
  }
  return undefined
}

function withoutGraph(arguments_: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const payload = { ...arguments_ }
  delete payload.graphId
  delete payload.graph_id
  delete payload.operationId
  delete payload.operation_id
  return payload
}

function numberAt(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): number | undefined {
  const candidate = valueAt(value, keys)
  return typeof candidate === 'number' && Number.isFinite(candidate)
    ? candidate
    : undefined
}

function recordsAt(value: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) return undefined
  const records = value.filter(
    (candidate): candidate is Record<string, unknown> =>
      candidate != null && typeof candidate === 'object' && !Array.isArray(candidate),
  )
  return records.length === value.length ? records : undefined
}

function priorOperation(
  context: OfflineToolMutationContext,
  operationId: string,
): SourceOperation | undefined {
  return context.existingOperations?.find(
    operation => operation.operationId === operationId,
  )
}

function sourceRegistryKind(
  bundle: SourceBundle | undefined,
  vocab: string,
  className: string,
): string | undefined {
  const descriptor = bundle?.sourceRegistry.find(value =>
    value.vocab === vocab && value.class === className)
  return typeof descriptor?.sourceKind === 'string'
    ? descriptor.sourceKind
    : undefined
}

function currentBaseVersion(
  bundle: SourceBundle | undefined,
  vocab: string,
  className: string,
  objectId: string,
): string {
  const key = `${vocab}\u001f${className}\u001f${objectId}`
  const current = bundle?.currentState.find(value => value.objectKey === key)
  return typeof current?.sourceVersion === 'string' && current.sourceVersion
    ? current.sourceVersion
    : 'root'
}

function normalizeMemoryRecord(
  input: Readonly<Record<string, unknown>>,
  topObserver?: string,
): Record<string, unknown> | undefined {
  const content = stringAt(input, ['content'])
  const explicitRefs = recordsAt(valueAt(input, ['sourceRefs', 'source_refs'])) ?? []
  const blockIds = valueAt(input, ['blockIds', 'block_ids'])
  const documentId = stringAt(input, ['documentId', 'document_id'])
  const blockRefs = Array.isArray(blockIds)
    ? blockIds
      .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
      .map(blockId => ({
        sourceKind: 'DocumentBlock',
        blockId,
        ...(documentId ? { documentId } : {}),
      }))
    : []
  if (!content || explicitRefs.length + blockRefs.length === 0) return undefined
  const observer = stringAt(input, ['observerAgentId', 'observer_agent_id', 'observer'])
    ?? topObserver
  return {
    ...(stringAt(input, ['clientRef', 'client_ref'])
      ? { clientRef: stringAt(input, ['clientRef', 'client_ref']) }
      : {}),
    scope: stringAt(input, ['scope']) ?? 'agent',
    kind: stringAt(input, ['kind']) ?? 'ClaimMemory',
    contentOrientation: stringAt(input, ['contentOrientation', 'content_orientation'])
      ?? 'knowledge',
    visibility: stringAt(input, ['visibility']) ?? 'private',
    status: stringAt(input, ['status']) ?? 'active',
    content,
    sourceRefs: [...explicitRefs, ...blockRefs],
    evidence: Array.isArray(input.evidence) ? input.evidence : [],
    ...(numberAt(input, ['observedAt', 'observed_at']) !== undefined
      ? { observedAt: numberAt(input, ['observedAt', 'observed_at']) }
      : {}),
    ...(numberAt(input, ['validFrom', 'valid_from']) !== undefined
      ? { validFrom: numberAt(input, ['validFrom', 'valid_from']) }
      : {}),
    ...(typeof input.isCurrent === 'boolean' ? { isCurrent: input.isCurrent } : {}),
    ...(numberAt(input, ['confidence']) !== undefined
      ? { confidence: numberAt(input, ['confidence']) }
      : {}),
    ...(numberAt(input, ['valence']) !== undefined
      ? { valence: numberAt(input, ['valence']) }
      : {}),
    ...(stringAt(input, ['agentId', 'agent_id'])
      ? { agentId: stringAt(input, ['agentId', 'agent_id']) }
      : {}),
    ...(observer ? { observerAgentId: observer } : {}),
    tags: Array.isArray(input.tags)
      ? input.tags.filter((value): value is string => typeof value === 'string')
      : [],
    ...(stringAt(input, ['supersedesRef', 'supersedes_ref', 'supersedes'])
      ? { supersedesRef: stringAt(input, ['supersedesRef', 'supersedes_ref', 'supersedes']) }
      : {}),
    ...(stringAt(input, ['contradictsRef', 'contradicts_ref', 'contradicts'])
      ? { contradictsRef: stringAt(input, ['contradictsRef', 'contradicts_ref', 'contradicts']) }
      : {}),
  }
}

function command(
  toolName: string,
  commandKind: string,
  documentId: string | undefined,
  payload: Record<string, unknown>,
  index: number,
  operationId: SourceOperationIdFactory,
): SourceOperation {
  return {
    kind: 'crdtCommand',
    operationId: operationId(toolName, index),
    commandKind,
    ...(documentId ? { documentId } : {}),
    payload,
  }
}

/**
 * Map the product's mediated MCP mutations onto the stable source outbox.
 * Undefined means the tool has no offline contract and must retain its normal
 * live transport/error behavior.
 */
export function sourceOperationsForToolMutation(
  toolName: string,
  arguments_: Readonly<Record<string, unknown>>,
  operationId: SourceOperationIdFactory,
  context: OfflineToolMutationContext = {},
): readonly SourceOperation[] | undefined {
  const documentId = stringAt(arguments_, ['documentId', 'document_id', 'entityId', 'entity_id'])
  const folderId = stringAt(arguments_, ['folderId', 'folder_id', 'entityId', 'entity_id', 'id'])
  switch (toolName) {
    case 'create_document': {
      const createdDocumentId = stringAt(arguments_, ['documentId', 'document_id'])
      const newDocumentIncarnation = stringAt(
        arguments_,
        ['documentIncarnation', 'document_incarnation', 'newDocumentIncarnation', 'new_document_incarnation'],
      )
      if (!createdDocumentId || !newDocumentIncarnation) return undefined
      return [
        {
          kind: 'documentLifecycle',
          operationId: operationId(toolName, 0),
          action: 'create',
          documentId: createdDocumentId,
          title: stringAt(arguments_, ['title']) ?? 'Untitled',
          newDocumentIncarnation,
        },
        command(toolName, 'workspace.updateDocument', createdDocumentId, {
          documentId: createdDocumentId,
          parentId: valueAt(arguments_, ['parentId', 'parent_id']) ?? null,
          order: valueAt(arguments_, ['order']) ?? null,
        }, 1, operationId),
      ]
    }
    case 'delete_document':
      if (!documentId) return undefined
      {
        const expectedDocumentIncarnation = stringAt(
          arguments_,
          ['expectedDocumentIncarnation', 'expected_document_incarnation', 'documentIncarnation', 'document_incarnation'],
        )
        if (!expectedDocumentIncarnation) return undefined
        return [{
          kind: 'documentLifecycle',
          operationId: operationId(toolName, 0),
          action: 'delete',
          documentId,
          expectedDocumentIncarnation,
        }]
      }
    case 'create_folder':
      return [command(toolName, 'workspace.createFolder', undefined, {
        folderId: valueAt(arguments_, ['folderId', 'folder_id']) ?? null,
        name: valueAt(arguments_, ['name']) ?? 'Untitled Folder',
        parentId: valueAt(arguments_, ['parentId', 'parent_id']) ?? null,
        section: valueAt(arguments_, ['section']) ?? 'documents',
        order: valueAt(arguments_, ['order']) ?? null,
      }, 0, operationId)]
    case 'move_documents':
      return [command(toolName, 'workspace.moveDocuments', undefined, {
        documentIds: valueAt(arguments_, ['documentIds', 'document_ids']) ?? [],
        parentId: valueAt(arguments_, ['parentId', 'parent_id']) ?? null,
        order: valueAt(arguments_, ['order']) ?? null,
      }, 0, operationId)]
    case 'move_folder':
      if (!folderId) return undefined
      return [command(toolName, 'workspace.moveFolder', undefined, {
        folderId,
        newParentId: valueAt(arguments_, ['newParentId', 'new_parent_id', 'parentId', 'parent_id']) ?? null,
        newOrder: valueAt(arguments_, ['newOrder', 'new_order', 'order']) ?? null,
      }, 0, operationId)]
    case 'make_document_editable':
      if (!documentId) return undefined
      return [command(toolName, 'workspace.updateDocument', documentId, {
        documentId,
        readOnly: false,
      }, 0, operationId)]
    case 'rename': {
      const type = stringAt(arguments_, ['entityType', 'entity_type', 'type'])?.toLowerCase()
      const name = stringAt(arguments_, ['newName', 'new_name', 'name', 'title'])
      if (!name) return undefined
      if (type === 'document' && documentId) {
        return [command(toolName, 'workspace.updateDocument', documentId, {
          documentId,
          title: name,
        }, 0, operationId)]
      }
      if (type === 'folder' && folderId) {
        return [command(toolName, 'workspace.updateFolder', folderId, {
          folderId,
          name,
        }, 0, operationId)]
      }
      if (type === 'graph') {
        return [{
          kind: 'graphMetadata',
          operationId: operationId(toolName, 0),
          title: name,
        }]
      }
      return undefined
    }
    case 'create_wires': {
      const wires = Array.isArray(arguments_.wires)
        ? arguments_.wires.filter(
            (value): value is Record<string, unknown> =>
              Boolean(value) && typeof value === 'object' && !Array.isArray(value),
          )
        : [arguments_]
      const operations: SourceOperation[] = []
      for (const [index, wire] of wires.entries()) {
        const sourceDocumentId =
          stringAt(wire, ['sourceDocumentId', 'source_document_id', 'documentId', 'document_id'])
          ?? stringAt(arguments_, ['sourceDocumentId', 'source_document_id', 'documentId', 'document_id'])
        const targetDocumentId =
          stringAt(wire, ['targetDocumentId', 'target_document_id'])
          ?? stringAt(arguments_, ['targetDocumentId', 'target_document_id'])
        if (!sourceDocumentId || !targetDocumentId) return undefined
        operations.push(command(toolName, 'workspace.createWire', sourceDocumentId, {
          wireId: stringAt(wire, ['wireId', 'wire_id', 'id'])
            ?? stringAt(arguments_, ['wireId', 'wire_id', 'id'])
            ?? null,
          sourceDocumentId,
          sourceBlockId: stringAt(wire, ['sourceBlockId', 'source_block_id'])
            ?? stringAt(arguments_, ['sourceBlockId', 'source_block_id'])
            ?? null,
          sourceMarkId: stringAt(wire, ['sourceMarkId', 'source_mark_id'])
            ?? stringAt(arguments_, ['sourceMarkId', 'source_mark_id'])
            ?? null,
          targetGraphId: stringAt(wire, ['targetGraphId', 'target_graph_id'])
            ?? stringAt(arguments_, ['targetGraphId', 'target_graph_id', 'graphId', 'graph_id'])
            ?? null,
          targetDocumentId,
          targetBlockId: stringAt(wire, ['targetBlockId', 'target_block_id'])
            ?? stringAt(arguments_, ['targetBlockId', 'target_block_id'])
            ?? null,
          targetMarkId: stringAt(wire, ['targetMarkId', 'target_mark_id'])
            ?? stringAt(arguments_, ['targetMarkId', 'target_mark_id'])
            ?? null,
          predicate: stringAt(wire, ['predicate'])
            ?? stringAt(arguments_, ['predicate'])
            ?? 'isWiredTo',
          bidirectional: valueAt(wire, ['bidirectional'])
            ?? valueAt(arguments_, ['bidirectional'])
            ?? false,
        }, index, operationId))
      }
      return operations
    }
    case 'edit_comment':
      if (!documentId) return undefined
      return [command(toolName, 'document.editComment', documentId, withoutGraph(arguments_), 0, operationId)]
    case 'write_document':
      if (!documentId) return undefined
      return [command(toolName, 'document.write', documentId, withoutGraph(arguments_), 0, operationId)]
    case 'insert_blocks':
      if (!documentId) return undefined
      return [command(toolName, 'block.insert', documentId, withoutGraph(arguments_), 0, operationId)]
    case 'update_blocks':
      if (!documentId) return undefined
      return [command(toolName, 'block.update', documentId, withoutGraph(arguments_), 0, operationId)]
    case 'edit_block_text':
      if (!documentId) return undefined
      return [command(toolName, 'block.editText', documentId, withoutGraph(arguments_), 0, operationId)]
    case 'delete_blocks':
      if (!documentId) return undefined
      return [command(toolName, 'block.delete', documentId, withoutGraph(arguments_), 0, operationId)]
    case 'delete': {
      const type = stringAt(arguments_, ['type'])?.toLowerCase()
      if ((type === 'document' || type === 'documents') && documentId) {
        const expectedDocumentIncarnation = stringAt(
          arguments_,
          ['expectedDocumentIncarnation', 'expected_document_incarnation', 'documentIncarnation', 'document_incarnation'],
        )
        if (!expectedDocumentIncarnation) return undefined
        return [{
          kind: 'documentLifecycle',
          operationId: operationId(toolName, 0),
          action: 'delete',
          documentId,
          expectedDocumentIncarnation,
        }]
      }
      if ((type === 'folder' || type === 'folders') && folderId) {
        return [command(toolName, 'workspace.deleteFolder', folderId, {
          folderId,
          cascade: valueAt(arguments_, ['cascade']) ?? false,
          hard: valueAt(arguments_, ['hard']) ?? true,
        }, 0, operationId)]
      }
      if (type === 'wire' || type === 'wires') {
        const wireId = stringAt(arguments_, ['wireId', 'wire_id'])
        if (!wireId) return undefined
        return [command(toolName, 'workspace.deleteWire', undefined, { wireId }, 0, operationId)]
      }
      return undefined
    }
    case 'crdt_operation': {
      const kind = stringAt(arguments_, ['kind'])
      if (!kind) return undefined
      const payload = valueAt(arguments_, ['payload'])
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
      return [command(toolName, kind, documentId, payload as Record<string, unknown>, 0, operationId)]
    }
    case 'value': {
      const entries = recordsAt(arguments_.valuations) ?? [arguments_]
      const operations: SourceOperation[] = []
      for (const [index, entry] of entries.entries()) {
        const id = operationId(toolName, index)
        const document = stringAt(entry, ['documentId', 'document_id'])
          ?? stringAt(arguments_, ['documentId', 'document_id'])
        const block = stringAt(entry, ['blockId', 'block_id'])
          ?? stringAt(arguments_, ['blockId', 'block_id'])
        const importance = numberAt(entry, ['importance'])
        const valence = numberAt(entry, ['valence'])
        const tagsValue = valueAt(entry, ['tags']) ?? valueAt(arguments_, ['tags'])
        const tags = Array.isArray(tagsValue)
          ? tagsValue.filter((value): value is string => typeof value === 'string')
          : []
        if (!document || !block
          || (importance !== undefined
            && (!Number.isInteger(importance) || importance < 0 || importance > 5))
          || (valence !== undefined
            && (!Number.isInteger(valence) || valence < -5 || valence > 5))
          || (importance === undefined && valence === undefined && tags.length === 0)) {
          return undefined
        }
        const prior = priorOperation(context, id)
        operations.push({
          kind: 'valuation',
          operationId: id,
          valuationEventId: stringAt(entry, ['valuationEventId', 'valuation_event_id'])
            ?? (typeof prior?.valuationEventId === 'string' ? prior.valuationEventId : id),
          observer: stringAt(entry, ['observerAgentId', 'observer_agent_id'])
            ?? stringAt(arguments_, ['observerAgentId', 'observer_agent_id'])
            ?? '',
          documentId: document,
          blockId: block,
          ...(importance !== undefined ? { importance } : {}),
          ...(valence !== undefined ? { valence } : {}),
          tags,
          atMs: numberAt(entry, ['atMs', 'at_ms'])
            ?? numberAt(arguments_, ['atMs', 'at_ms'])
            ?? (typeof prior?.atMs === 'number' ? prior.atMs : context.now ?? Date.now()),
        })
      }
      return operations
    }
    case 'emporium_retract': {
      const id = operationId(toolName, 0)
      const subject = stringAt(arguments_, ['subject'])
      const rationale = stringAt(arguments_, ['rationale'])
      if (!subject || !rationale) return undefined
      const prior = priorOperation(context, id)
      return [{
        kind: 'retraction',
        operationId: id,
        retractionEventId: stringAt(
          arguments_,
          ['retractionEventId', 'retraction_event_id'],
        ) ?? (typeof prior?.retractionEventId === 'string'
          ? prior.retractionEventId
          : id),
        subject,
        rationale,
        retractionKind: stringAt(arguments_, ['kind']) ?? 'retract',
        ...(stringAt(arguments_, ['observer'])
          ? { observer: stringAt(arguments_, ['observer']) }
          : {}),
        atMs: numberAt(arguments_, ['atMs', 'at_ms'])
          ?? (typeof prior?.atMs === 'number' ? prior.atMs : context.now ?? Date.now()),
      }]
    }
    case 'remember':
    case 'remember_batch': {
      const raw = toolName === 'remember'
        ? [arguments_]
        : recordsAt(arguments_.records)
      if (!raw || raw.length === 0) return undefined
      const normalized = raw.map(value => normalizeMemoryRecord(
        value,
        stringAt(arguments_, ['observer', 'observerAgentId', 'observer_agent_id']),
      ))
      if (normalized.some(value => !value)) return undefined
      const operations: SourceOperation[] = []
      for (const [index, memory] of normalized.entries()) {
        const id = operationId(toolName, index)
        const prior = priorOperation(context, id)
        const observer = stringAt(memory!, ['observerAgentId'])
          ?? stringAt(arguments_, ['observer', 'observerAgentId', 'observer_agent_id'])
          ?? ''
        operations.push({
          kind: 'memory',
          operationId: id,
          observer,
          publish: !observer,
          atMs: numberAt(arguments_, ['atMs', 'at_ms'])
            ?? (typeof prior?.atMs === 'number' ? prior.atMs : context.now ?? Date.now()),
          records: [memory!],
        })
      }
      return operations
    }
    case 'emporium_write': {
      if (arguments_.dryRun === true || arguments_.dry_run === true) return undefined
      const vocab = stringAt(arguments_, ['vocab'])
      const raw = recordsAt(arguments_.records)
      if (!vocab || !raw || raw.length === 0 || !context.bundle) return undefined
      if (vocab === 'sophia-memory-core') {
        const observer = stringAt(arguments_, ['observer'])
        const publish = arguments_.publish === true
        const normalized = raw.map(value => normalizeMemoryRecord(value, observer))
        if (normalized.some(value => !value)) return undefined
        if (!publish && normalized.some(value => !stringAt(value!, ['observerAgentId']))) {
          return undefined
        }
        return normalized.map((memory, index) => {
          const id = operationId(toolName, index)
          const prior = priorOperation(context, id)
          const effectiveObserver = publish
            ? ''
            : stringAt(memory!, ['observerAgentId']) ?? observer ?? ''
          return {
            kind: 'memory',
            operationId: id,
            observer: effectiveObserver,
            publish,
            atMs: numberAt(arguments_, ['atMs', 'at_ms'])
              ?? (typeof prior?.atMs === 'number' ? prior.atMs : context.now ?? Date.now()),
            records: [memory!],
          }
        })
      }
      const operations: SourceOperation[] = []
      for (const [index, rawRecord] of raw.entries()) {
        const className = stringAt(rawRecord, ['kind'])
        const objectId = stringAt(rawRecord, ['localId', 'clientRef', 'client_ref'])
        if (!className || !objectId) return undefined
        const record: Record<string, unknown> = {
          ...rawRecord,
          kind: className,
          localId: objectId,
        }
        delete record.clientRef
        delete record.client_ref
        const kind = sourceRegistryKind(context.bundle, vocab, className)
        const id = operationId(toolName, index)
        if (kind === 'current-state') {
          const prior = priorOperation(context, id)
          operations.push({
            kind: 'currentState',
            operationId: id,
            vocab,
            class: className,
            objectId,
            baseVersion: currentBaseVersion(context.bundle, vocab, className, objectId),
            record,
            causalOrder: numberAt(arguments_, ['atMs', 'at_ms'])
              ?? (typeof prior?.causalOrder === 'number'
                ? prior.causalOrder
                : context.now ?? Date.now()),
            clientId: stringAt(arguments_, ['observer'])
              ?? (typeof prior?.clientId === 'string' ? prior.clientId : 'offline-client'),
          })
        } else if (kind === 'event-log') {
          operations.push({
            kind: 'eventLog',
            operationId: id,
            eventId: objectId,
            vocab,
            class: className,
            record,
          })
        } else {
          return undefined
        }
      }
      return operations
    }
    default:
      return undefined
  }
}
