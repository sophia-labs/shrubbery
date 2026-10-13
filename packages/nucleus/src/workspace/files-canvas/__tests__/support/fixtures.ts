import {
  fileKey, type FileCanvasCapabilities, type FileCanvasConnection, type FileCanvasInput, type FileCanvasSession, type FilePlacementRecord,
  type FolderViewScope, type WorkspaceFileRef,
} from '../../../folder-view-contract.js'
import { buildScene, type BuildSceneOptions } from '../../scene.js'
import type { SceneSnapshot } from '../../engine-port.js'
import type { Rect } from '../../geometry.js'

export const scope: FolderViewScope = {
  ownerId: 'owner', graphId: 'files', graphIncarnation: 'inc-1', folderId: null, viewId: 'files-default', audience: { kind: 'shared' },
}

export const file = (id: string, kind: WorkspaceFileRef['kind'] = 'document'): WorkspaceFileRef =>
  ({ ownerId: 'owner', graphId: 'files', graphIncarnation: 'inc-1', kind, id })
export const folder = (id: string): WorkspaceFileRef => file(id, 'folder')
export const keyOf = fileKey

export const ALL_CAPS: FileCanvasCapabilities = {
  place: true, move: true, rename: true, create: true, add: true, remove: true, connect: true, openBeside: true,
}
export const NO_CAPS: FileCanvasCapabilities = {
  place: false, move: false, rename: false, create: false, add: false, remove: false, connect: false, openBeside: false,
}
export const capsExcept = (...verbs: (keyof FileCanvasCapabilities)[]): FileCanvasCapabilities =>
  ({ ...ALL_CAPS, ...Object.fromEntries(verbs.map((v) => [v, false])) })

export const emptySession: FileCanvasSession = { selected: [], camera: { x: 0, y: 0, zoom: 1 }, editingName: null }

export function placement(f: WorkspaceFileRef, x: number, y: number, s: FolderViewScope = scope): FilePlacementRecord {
  return { schemaVersion: 1, scope: s, file: f, coordinateSpace: 'folder-canvas', x, y }
}

export function connection(id: string, source: WorkspaceFileRef, target: WorkspaceFileRef, label = 'explains'): FileCanvasConnection {
  return { id, source, target, relation: `rel:${label}`, label, state: 'proposed', attribution: null }
}

export interface Spec {
  readonly id: string
  readonly x?: number
  readonly y?: number
  readonly folder?: boolean
  readonly label?: string
}

/** A canvas input from terse card specs: no `x`/`y` means "no placement record" (auto-slotted). */
export function inputOf(specs: readonly Spec[], over: Partial<FileCanvasInput> = {}): FileCanvasInput {
  const nodes = specs.map((s) => ({ file: s.folder ? folder(s.id) : file(s.id), label: s.label ?? `${s.id}.pdf` }))
  const placements = specs.flatMap((s, i) => (s.x === undefined || s.y === undefined ? [] : [placement(nodes[i]!.file, s.x, s.y)]))
  return { scope, nodes, placements, session: emptySession, capabilities: ALL_CAPS, ...over }
}

export function sceneOf(specs: readonly Spec[], over: Partial<FileCanvasInput> = {}, options?: BuildSceneOptions): SceneSnapshot {
  return buildScene(inputOf(specs, over), options).scene
}

export const rectOf = (scene: SceneSnapshot, id: string, kind: WorkspaceFileRef['kind'] = 'document'): Rect => {
  const card = scene.byKey.get(keyOf(file(id, kind)))
  if (!card) throw new Error(`no card ${id}`)
  return card.rect
}
