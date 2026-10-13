import { describe, expect, it } from 'vitest'
import {
  NO_FILE_CANVAS_CAPABILITIES, fileKey, folderViewKey, filePlacementKey, resolveCapabilities,
  type FileCanvasCapabilities, type FileCanvasInput, type FileCanvasIntent, type FileCanvasSession, type FilePlacementRecord, type FolderViewScope, type WorkspaceFileRef,
} from './folder-view-contract.js'

const scope: FolderViewScope = { ownerId: 'owner', graphId: 'library', graphIncarnation: 'first', folderId: null, viewId: 'default', audience: { kind: 'shared' } }
const placement: FilePlacementRecord = { schemaVersion: 1, scope, file: { ownerId: 'owner', graphId: 'library', graphIncarnation: 'first', id: 'one', kind: 'artifact' }, coordinateSpace: 'folder-canvas', x: 20, y: 40 }

describe('folder view identity and coordinate boundaries', () => {
  it('separates owner, graph lifetime, root, folder and personal scopes', () => {
    const variants: FolderViewScope[] = [scope, { ...scope, ownerId: 'another' }, { ...scope, graphIncarnation: 'second' },
      { ...scope, folderId: 'root' }, { ...scope, audience: { kind: 'personal', userId: 'vera' } },
      { ...scope, audience: { kind: 'personal', userId: 'another' } }]
    expect(new Set(variants.map(folderViewKey)).size).toBe(variants.length)
  })
  it('separates artifact/document ids and rejects cross-lifetime or nonfinite placements', () => {
    expect(filePlacementKey(placement)).not.toBe(filePlacementKey({ ...placement, file: { ...placement.file, kind: 'document' } }))
    expect(() => filePlacementKey({ ...placement, file: { ...placement.file, graphIncarnation: 'retired' } })).toThrow('incarnation')
    expect(() => filePlacementKey({ ...placement, x: NaN })).toThrow('placement')
  })
})

describe('canvas contract, version 2: additive', () => {
  const file: WorkspaceFileRef = { ownerId: 'owner', graphId: 'library', graphIncarnation: 'first', id: 'one', kind: 'artifact' }

  it('keys a file by the JSON of its qualified identity, so kinds and incarnations never collide', () => {
    expect(fileKey(file)).toBe(JSON.stringify(['owner', 'library', 'first', 'artifact', 'one']))
    const others = [{ ...file, kind: 'document' as const }, { ...file, graphIncarnation: 'second' }, { ...file, graphId: 'other' }, { ...file, ownerId: 'x' }, { ...file, id: 'two' }]
    expect(new Set([file, ...others].map(fileKey)).size).toBe(6)
  })

  it('lets capabilities win, and reads the deprecated canEdit as the verbs version 1 knew', () => {
    const all: FileCanvasCapabilities = { place: true, move: true, rename: true, create: true, add: true, remove: true, connect: true, openBeside: true }
    expect(resolveCapabilities({ capabilities: all, canEdit: false })).toBe(all)
    expect(resolveCapabilities({ canEdit: true })).toEqual({ ...NO_FILE_CANVAS_CAPABILITIES, place: true, move: true, rename: true })
    expect(resolveCapabilities({ canEdit: false })).toEqual(NO_FILE_CANVAS_CAPABILITIES)
    expect(resolveCapabilities({})).toEqual(NO_FILE_CANVAS_CAPABILITIES)
    expect(Object.values(NO_FILE_CANVAS_CAPABILITIES).some(Boolean)).toBe(false)
    expect(Object.isFrozen(NO_FILE_CANVAS_CAPABILITIES)).toBe(true)
  })

  it('still accepts a version 1 input and session, field for field', () => {
    // The shape the fixture shell and the production controller build today: no capabilities, canEdit, wires, a four-field session.
    const session: FileCanvasSession = { selected: [], camera: { x: 0, y: 0, zoom: 1 }, editingName: null }
    const v1: FileCanvasInput = {
      scope, nodes: [{ file, label: 'One.pdf' }], placements: [], session, canEdit: true, authorityVersion: '[]',
      wires: [{ id: 'w', source: file, target: file, label: 'describes' }],
    }
    expect(v1.canEdit).toBe(true)
    expect(v1.capabilities).toBeUndefined()
  })

  it('adds intent kinds without changing the ones shells already handle', () => {
    // A version 1 shell handles these six and ignores the rest: an if-chain with no exhaustive default must keep compiling.
    const handledByV1 = (intent: FileCanvasIntent): string | null => {
      if (intent.kind === 'select') return `select ${intent.files.length}`
      if (intent.kind === 'open') return `open ${intent.file.id}`
      if (intent.kind === 'menu') return `menu ${intent.clientX},${intent.clientY}`
      if (intent.kind === 'rename') return `rename ${intent.name}`
      if (intent.kind === 'place') return `place ${intent.placements.length}`
      if (intent.kind === 'move') return `move ${intent.files.length}`
      return null
    }
    const v2: FileCanvasIntent[] = [
      { kind: 'open', file, beside: true }, { kind: 'menu', files: [], clientX: 1, clientY: 2, at: { x: 3, y: 4 } },
      { kind: 'name-cancel' }, { kind: 'new-folder', placement: { x: 0, y: 0 } },
      { kind: 'create', objectKind: 'folder', parent: null, name: 'Datasheets', placement: { x: 0, y: 0 }, draftId: 'd' },
      { kind: 'add', files: [], folder: null }, { kind: 'remove', files: [file] },
      { kind: 'connect', source: file, target: file, relation: 'rel:explains' }, { kind: 'disconnect', connectionId: 'c' },
      { kind: 'choose-placement', file, candidateId: 'x' }, { kind: 'undo' }, { kind: 'redo' },
    ]
    expect(v2.map(handledByV1)).toEqual(['open one', 'menu 1,2', ...Array(10).fill(null)])
  })

  it('covers every intent kind exhaustively, so a new kind cannot be forgotten by a shell that opts in', () => {
    const name = (intent: FileCanvasIntent): string => {
      switch (intent.kind) {
        case 'select': case 'open': case 'menu': case 'rename': case 'name-cancel': case 'place': case 'move': case 'new-folder':
        case 'create': case 'add': case 'remove': case 'connect': case 'disconnect': case 'choose-placement': case 'undo': case 'redo':
          return intent.kind
        default: { const never: never = intent; return never }
      }
    }
    expect(name({ kind: 'undo' })).toBe('undo')
  })
})
