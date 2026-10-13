/**
 * The Files pane as the shell composes it: the left file tree is the sidebar's Files (artifacts) section, the center is
 * the folder canvas or the list, the right panel is the ordinary inspector. This module turns the cell's advert, the
 * sidebar sections and the folder's layout into the pane's options, and the canvas's intents into mediated commands.
 *
 * - Capability: no `files` advert (CONTRACT-files §1), no pane. Nothing is probed.
 * - Every edit is a command through the cell's contract (`FilesCommands`), announced once with Undo; nothing writes a
 *   store directly. A placement or a view choice is a `source_push` through `FilesLayoutController`.
 * - Opening a file: always a page, never a download (`FilesPreviewController`): a PDF in the original-page viewer, an image
 *   previewed, text, Markdown, code, JSON, tables, HTML and Word rendered by Hoja, media played, anything else its file page.
 * - Connections (`connect`, `disconnect`) are the graph's own wires between artifacts (`FilesWires`: create_wires, get_wires,
 *   delete type 'wires'), so they are durable and shared; a contested placement is settled by `choose-placement`, which the
 *   layout controller writes.
 */
import {
  type FileCanvasCapabilities, type FileCanvasConnection, type FileCanvasDraft, type FileCanvasIntent, type FileCanvasNaming, type FilePaneNode,
  type FilePaneSection, type FilePlacementRecord, type FolderViewScope, type WorkspaceFileRef,
} from '@shrubbery/nucleus'
import { needsLook, readDoneSentence, type FileEvidence } from '@shrubbery/nucleus'
import { FILE_KINDS, kindsMatching, type FileKind } from './files-kinds/index.js'
import { loadDefaultEngine, menuVerbs, type Camera, type CanvasEngine, type LoadedEngine, type Verb } from '@shrubbery/nucleus/files-canvas'
import type {
  FilesCanvasCommand, FilesCanvasHostInput, FilesPanePreview, FilesPaneRow, FilesPaneTrash, FilesPaneTrashItem, WorkspaceFilesOptions,
  WorkspaceFileInfoModel, WorkspaceInspectorModel,
} from '@shrubbery/runtime'
import { type FilesAdvert, type FilesClient, type FilesTrashItem } from './files-contract.js'
import { FilesCommands, filesTreeFromSections, type FilesCommandResult, type FilesEntryKind, type FilesTreeEntry } from './files-commands.js'
import { FALLBACK_RELATIONS, FilesWires, customPredicate, humanize, type FileWire } from './files-connections.js'
import { FilesLayoutController, FolderViewHttpPort, defaultFolderView, type FilesLayoutSnapshot } from './files-layout.js'
import { FilesPreviewController, type FilesPreviewDeps, type FilesPreviewState } from './files-preview.js'
import { formatFileSize, typeCaption } from './files-policy.js'
import { buildInfoModel, readInfoDetail, type InfoDetail, type InfoItem, type InfoWire } from './files-info.js'
import { FilesEvidence, type FilesEvidenceDeps } from './files-evidence.js'
import { FilesAssertions } from './files-assertions.js'
import { projectFileWorkspace, type FileWorkspaceProjection } from './file-workspace.js'
import { randomUUID } from '@shrubbery/nucleus/web-crypto'

export const FILES_VIEW_ID = 'files-default'

/** Display-only stand-in while the graph's incarnation is not known yet: keys work, nothing is written with it. */
const UNREAD_INCARNATION = 'incarnation-unread'
const UNREAD_LAYOUT_MESSAGE = 'The folder layout could not be read yet; it is asked again shortly.'

export interface FilesShellBinding {
  readonly graphId: string
  /** The routed graph's owner (the gateway's directory owner). */
  readonly ownerId: string
  readonly graphIncarnation: string
  /** Owner or editor of the graph, and the cell reachable for writes. */
  readonly writable: boolean
  /** The cell's Files advert; null hides the pane. */
  readonly advert: FilesAdvert | null
  /** The sidebar's sections: the Files tree is its `artifacts` section. */
  readonly sections: readonly FilePaneSection[]
  /** At the shell's phone breakpoint (`PHONE_BREAKPOINT_QUERY`): Files is hidden on phones in this release (Vera, 10-06). */
  readonly phone?: boolean
}

export interface FilesMenuItem {
  readonly id: string
  readonly label: string
  readonly icon?: string
  readonly shortcut?: string
}

export interface FilesShellDeps {
  readonly client: FilesClient
  /** Re-read the sidebar sections and bind them again (the shell's refresh after a mutation). */
  readonly refresh: () => Promise<void>
  /** Re-render. */
  readonly onChange: () => void
  /** Show a context menu; `onSelect` receives an item id. */
  readonly menu: (request: { readonly items: readonly FilesMenuItem[]; readonly x: number; readonly y: number
    readonly onSelect: (id: string) => void }) => void
  /** Ask the canvas host for one of its own commands (New folder where you look, Tidy up). */
  readonly canvasCommand?: (command: FilesCanvasCommand) => void
  /** Which engine the canvas runs on; the default loads Excalidraw (house fallback). Tests and measurements override it. */
  readonly loadEngine?: () => Promise<LoadedEngine>
  /** The file picker, for the menu's "Upload files…". */
  readonly pickFiles?: () => Promise<readonly File[] | null>
  readonly preview?: Omit<FilesPreviewDeps, 'client' | 'onChange'>
  readonly newId?: (kind: 'folder' | 'file' | 'draft' | 'conn') => string
  /** Show info opened (true) or closed (false): the host makes the right pane room for it, and gives the pane back. */
  readonly onInfo?: (open: boolean) => void
  /** The selection changed: the shell's inspector shows it. */
  readonly onSelection?: (entries: readonly FilesTreeEntry[]) => void
  /**
   * A document opened from the place opens in the editor (the same route as from the tree). `place` is where it was opened from, so
   * the host can offer the way back; the shell keeps the place's face, camera and selection meanwhile.
   */
  readonly openDocument?: (documentId: string, place: { readonly folderId: string | null; readonly label: string }) => void
  /** "Trashed 2 min ago". */
  readonly now?: () => number
  /** Datasheets: the reading's own progress (slice 5's status route) and the retry it offers; absent until the read job exists. */
  readonly readStatus?: FilesEvidenceDeps['readStatus']
  readonly retryRead?: (artifactId: string) => Promise<void>
  /** How often the place's evidence is asked again: while something reads, and when idle. */
  /** An assertion of the open PDF was selected in the reader (a claim id; null: cleared): other surfaces follow it. */
  readonly onAssertionSelect?: (id: string | null, page: number | null) => void
  /** The file kinds Files recognizes; the registered ones by default. */
  readonly kinds?: readonly FileKind[]
  readonly evidenceTiming?: { readonly activeMs?: number; readonly idleMs?: number }
}

interface Status {
  readonly message: string
  readonly tone: 'info' | 'error'
  readonly undo: boolean
  /** One verb the message offers: Open after a read, Retry after a failure. */
  readonly action?: { readonly label: string; readonly run: () => void }
}

/** Finder's Get Info key, in the words of the platform. */
export const INFO_SHORTCUT = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '') ? '⌘I' : 'Ctrl+I'

const NONE: FileCanvasCapabilities = Object.freeze({ place: false, move: false, rename: false, create: false, add: false, remove: false,
  connect: false, openBeside: false })
const IDENTITY: Camera = Object.freeze({ x: 0, y: 0, zoom: 1 })

/** "1 item", "2 items". */
function countOf(n: number, one: string, many = `${one}s`): string { return `${n} ${n === 1 ? one : many}` }

/** What a selection is, in words: "2 files", "3 folders", or "4 items" when it is both. */
function selectionNoun(entries: readonly FilesTreeEntry[]): string {
  const folders = entries.filter(e => e.kind === 'folder').length
  const documents = entries.filter(e => e.kind === 'document').length
  const files = entries.length - folders - documents
  if (folders === entries.length) return countOf(entries.length, 'folder')
  if (documents === entries.length) return countOf(entries.length, 'document')
  if (files === entries.length) return countOf(entries.length, 'file')
  return countOf(entries.length, 'item')
}

/** "just now", "5 min ago", "3 h ago", "2 d ago": the Trash says when, not a timestamp. */
function agoOf(iso: string, now: number): string {
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return ''
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

function entryKey(kind: FilesEntryKind, id: string): string { return `${kind}:${id}` }
function parseKey(key: string): { kind: FilesEntryKind; id: string } | null {
  const at = key.indexOf(':')
  const kind = key.slice(0, at)
  return at > 0 && (kind === 'folder' || kind === 'artifact' || kind === 'document') ? { kind, id: key.slice(at + 1) } : null
}

function defaultNewId(kind: string): string {
  return `${kind}-${randomUUID().replace(/-/g, '')}`
}

export class FilesShell {
  private binding: FilesShellBinding | null = null
  private active = false
  private folderKey: string | null = null
  private selected: string[] = []
  private focused: WorkspaceFileRef | null = null
  private naming: FileCanvasNaming | null = null
  private drafts: FileCanvasDraft[] = []
  private cut: WorkspaceFileRef[] = []
  private cameras = new Map<string, Camera>()
  /** Undo order across both kinds of edit: placements (journaled here) and file commands (journaled by the command layer). */
  private undoOrder: ('place' | 'cmd' | 'conn')[] = []
  private redoOrder: ('place' | 'cmd' | 'conn')[] = []
  private wires: FilesWires | null = null
  /** The wires leaving the artifacts of the folder shown, and the key (graph, folder, artifacts) they were read for. */
  private wireRows: FileWire[] = []
  private wireKey = ''
  private relations: { graphId: string; list: readonly { uri: string; label: string }[] } | null = null
  private connUndo: { undo: () => Promise<void>; redo: () => Promise<void> }[] = []
  private connRedo: { undo: () => Promise<void>; redo: () => Promise<void> }[] = []
  private placeUndo: { previous: FilePlacementRecord[]; placements: FilePlacementRecord[] }[] = []
  private placeRedo: { previous: FilePlacementRecord[]; placements: FilePlacementRecord[] }[] = []
  private status: Status = { message: '', tone: 'info', undo: false }
  private commands: FilesCommands | null = null
  private commandsGraph = ''
  private layout: FilesLayoutController | null = null
  private layoutOwner = ''
  private readonly preview: FilesPreviewController
  private disposed = false
  /** The Trash view: open, what it read, and the item asking to be deleted forever. */
  private trashView: { items: readonly FilesTrashItem[]; status: 'loading' | 'ready' | 'error'; error: string; confirm: string | null } | null = null
  /** The canvas engine: Excalidraw by default, loaded on the first open of the pane (the house engine stands in until then and on failure). */
  private engine: LoadedEngine | null = null
  private engineLoading = false
  /** What the reader found in the datasheets of the place shown: one batched query per place. */
  private readonly evidence: FilesEvidence
  /** What the open PDF's kind read from it, for the reader's overlay and list; and a deep link waiting for its file. */
  private readonly assertions: FilesAssertions
  private pendingEvidence: { readonly artifactId: string | null; readonly id: string } | null = null
  /** The Needs a look filter of the list face. */
  private needsLookOn = false
  /** Show info: the items it is pinned to (tree keys), and what was read for them. It closes when the selection moves elsewhere. */
  private info: { keys: readonly string[]; generation: number; detail: InfoDetail | null; status: 'loading' | 'ready' | 'error'; wires: InfoWire[] | null
    sizes: ReadonlyMap<string, number> | null } | null = null
  private infoGeneration = 0
  private retargeting = false
  private readonly onInfoKey = (event: KeyboardEvent): void => this.infoKey(event)

  private ensureEngine(): CanvasEngine | undefined {
    if (!this.engine && !this.engineLoading && !this.disposed) {
      this.engineLoading = true
      void (this.deps.loadEngine ?? loadDefaultEngine)().then(loaded => {
        if (this.disposed) { loaded.engine.dispose?.(); return }
        this.engine = loaded
        // Debuggable, never user-facing.
        if (loaded.reason) console.warn(`[files-canvas] Excalidraw engine unavailable, using the house engine: ${loaded.reason}`)
        this.changed()
      })
    }
    return this.engine?.engine
  }

  constructor(private readonly deps: FilesShellDeps) {
    this.preview = new FilesPreviewController({ client: deps.client, onChange: () => this.changed(), ...(deps.preview ?? {}) })
    this.evidence = new FilesEvidence({
      tool: (name, args) => deps.client.tool(name, args), ...(deps.kinds ? { kinds: deps.kinds } : {}), ...(deps.readStatus ? { readStatus: deps.readStatus } : {}),
      onChange: () => this.changed(), onTransition: (id, now, was) => this.readFinished(id, now, was), ...(deps.evidenceTiming ?? {}),
    })
    this.assertions = new FilesAssertions({ tool: (name, args) => deps.client.tool(name, args), ...(deps.kinds ? { kinds: deps.kinds } : {}), onChange: () => this.changed() })
    if (typeof document !== 'undefined') document.addEventListener('keydown', this.onInfoKey)
  }

  /** A read this session watched has ended: said once on the status line, with the verb that follows. */
  private readFinished(artifactId: string, now: FileEvidence, _was: string): void {
    const entry = this.tree().get('artifact', artifactId)
    const ref = this.ref(entryKey('artifact', artifactId))
    if (!entry || !ref) return
    if (now.state === 'read') {
      this.status = { message: readDoneSentence(entry.label, now), tone: 'info', undo: false,
        action: { label: 'Open', run: () => { void this.intent({ kind: 'open', file: ref }) } } }
    } else {
      const retry = this.deps.retryRead
      this.status = { message: `Couldn’t read ${entry.label}${now.error ? `: ${now.error}` : ''}`, tone: 'error', undo: false,
        ...(retry ? { action: { label: 'Retry', run: () => { void retry(artifactId).then(() => this.evidence.refresh()) } } } : {}) }
    }
    this.changed()
  }

  private changed(): void { if (!this.disposed) this.deps.onChange() }
  private id(kind: 'folder' | 'file' | 'draft' | 'conn'): string { return (this.deps.newId ?? defaultNewId)(kind) }

  // --- binding and route --------------------------------------------------------------------------------------------

  bind(binding: FilesShellBinding): void {
    // A new graph, or a new life of it. An incarnation learned late ('' then known) is not a new life: the pane stays.
    const before = this.binding
    const graphChanged = before?.graphId !== binding.graphId
      || (!!before?.graphIncarnation && !!binding.graphIncarnation && before.graphIncarnation !== binding.graphIncarnation)
    this.binding = binding
    if (graphChanged) {
      this.active = this.active && binding.advert !== null
      this.folderKey = null
      this.selected = []
      this.focused = null
      this.naming = null
      this.drafts = []
      this.cut = []
      this.cameras.clear()
      this.status = { message: '', tone: 'info', undo: false }
      this.preview.close()
    }
    if (!binding.advert) return
    const commandsKey = `${binding.graphId}|${binding.advert.maxUploadBytes}`
    if (!this.commands || graphChanged || this.commandsGraph !== commandsKey) {
      this.commandsGraph = commandsKey
      this.commands = new FilesCommands({
        client: this.deps.client, graphId: binding.graphId, tree: () => filesTreeFromSections(this.binding?.sections ?? []),
        refresh: () => this.deps.refresh(), maxUploadBytes: binding.advert.maxUploadBytes,
        support: () => ({ anyFolder: this.binding?.advert?.anyFolder === true, documentTrash: this.binding?.advert?.documentTrash === true }),
        newId: kind => this.id(kind),
        onProgress: message => { this.status = { message, tone: 'info', undo: false }; this.changed() },
      })
    }
    if (!this.layout || this.layoutOwner !== binding.ownerId) {
      this.layoutOwner = binding.ownerId
      this.layout = new FilesLayoutController(new FolderViewHttpPort(this.deps.client, binding.ownerId), () => this.changed())
    }
    // On a phone Files does not exist: an open pane closes (the shell's ordinary center shows) and stays closed.
    if (binding.phone) { this.leave(); return }
    if (this.pendingEvidence) this.resolveEvidence()
    // While the pane is open, a changed binding (an incarnation learned late, a new owner) starts its layout read now.
    if (this.isOpen) this.layoutFor(this.view())
  }

  /** The cell lets a folder hold anything (its advert says so). */
  anyFolder(): boolean { return this.binding?.advert?.anyFolder === true }

  /** Whether Files is offered: the cell serves it and this is not a phone. The pane and every way in hide otherwise. */
  visible(): boolean { return this.binding?.advert != null && this.binding.phone !== true }

  get isOpen(): boolean { return this.active && this.visible() }

  /** Enter the Files pane at a folder of the Files tree (`null`: the top). */
  openFolder(folderId: string | null): void {
    if (!this.visible()) return
    this.active = true
    this.navigate(folderId === null ? null : entryKey('folder', folderId))
  }

  /**
   * Open a file from the left tree: the pane shows its folder with the file selected, and the file opens by its type
   * (its viewer, or its file page; never a download). A file the tree no longer has
   * opens the top of Files and says so.
   */
  openFile(artifactId: string): void {
    const b = this.binding
    if (!b || !this.visible()) return
    this.active = true
    const entry = this.tree().get('artifact', artifactId)
    if (!entry) {
      this.navigate(null)
      this.status = { message: 'That file is no longer here.', tone: 'error', undo: false }
      this.changed()
      return
    }
    this.navigate(entry.parentId === null ? null : entryKey('folder', entry.parentId))
    const key = entryKey('artifact', entry.id)
    this.selected = [key]
    this.focused = this.ref(key)
    this.publishSelection()
    this.changed()
    void this.preview.open(b.graphId, { id: entry.id, label: entry.label, mimeType: entry.mimeType, fileType: entry.fileType,
      originalFilename: entry.label })
  }

  /**
   * Open an assertion of a file (the deep link `/files/<artifact>#evidence=<claim id>`): the file opens in the reader, the overlay turns
   * on, and the reader goes to the assertion and selects it. `artifactId` may be null when only the claim id is known: the kinds say
   * which file an evidence id belongs to. It waits for the tree to hold the file (the workspace may still be loading).
   */
  openEvidence(artifactId: string | null, evidenceId: string): void {
    this.pendingEvidence = { artifactId: artifactId ?? this.assertions.anyArtifactOf(evidenceId), id: evidenceId }
    this.resolveEvidence()
  }

  private resolveEvidence(): void {
    const want = this.pendingEvidence
    if (!want?.artifactId || !this.visible() || !this.binding) return
    if (!this.tree().get('artifact', want.artifactId)) return
    this.pendingEvidence = null
    this.openFile(want.artifactId)
    this.assertions.requestReveal(want.artifactId, want.id)
  }

  /** Leave the Files pane (another center route took over). */
  leave(): void {
    if (!this.active) return
    this.active = false
    this.naming = null
    this.drafts = []
    this.trashView = null
    this.preview.close()
    this.evidence.sync(this.binding?.graphId ?? '', [])
  }

  dispose(): void {
    this.disposed = true
    if (typeof document !== 'undefined') document.removeEventListener('keydown', this.onInfoKey)
    this.evidence.dispose()
    this.assertions.dispose()
    this.engine?.engine.dispose?.()
    this.preview.close()
  }

  private navigate(key: string | null): void {
    if (this.folderKey !== key) {
      this.folderKey = key
      this.needsLookOn = false
      this.selected = []
      this.focused = null
      this.naming = null
      this.drafts = []
    }
    this.preview.close()
    this.trashView = null
    // Read the folder's layout now, so its preferences are known before anything asks to change them.
    if (this.binding?.advert && this.layout) this.layoutFor(this.view())
    this.publishSelection()
    this.changed()
  }

  /** A document opens in the editor; the place stays as it is (face, camera, selection) for the way back. */
  private openDocument(entry: FilesTreeEntry): void {
    const open = this.deps.openDocument
    if (!open) return
    const view = this.view()
    const folder = view.folderId ? this.tree().get('folder', parseKey(view.folderId)!.id) : null
    open(entry.id, { folderId: folder?.id ?? null, label: folder?.label ?? 'Files' })
  }

  /** A move asked from outside the pane (a drag in the tree): through the same command, so it is journaled, announced and refused in words. */
  async moveInto(targets: readonly { readonly kind: FilesEntryKind; readonly id: string }[], folderId: string | null): Promise<FilesCommandResult> {
    if (!this.commands) return { ok: false, message: 'Files is not ready yet.', undo: null }
    const outcome = await this.run(this.commands.move(targets, folderId))
    return outcome
  }

  /** The sentence a move cannot be done with yet, or null when it can be asked. */
  explainMove(kind: FilesEntryKind, id: string, folderId: string | null): string | null {
    return this.commands?.refusalForMove(kind, id, folderId) ?? null
  }

  /** The last thing said (status line), for a host that wants to say it too. */
  lastMessage(): { readonly message: string; readonly tone: 'info' | 'error' } { return { message: this.status.message, tone: this.status.tone } }

  // --- the one Trash ------------------------------------------------------------------------------------------------

  async openTrash(): Promise<void> {
    const b = this.binding
    if (!b || !this.isOpen) return
    this.trashView = { items: [], status: 'loading', error: '', confirm: null }
    this.changed()
    await this.readTrash()
  }

  private async readTrash(): Promise<void> {
    const b = this.binding
    if (!b || !this.trashView) return
    try {
      const items = await this.deps.client.listTrash(b.graphId)
      if (this.trashView) this.trashView = { ...this.trashView, items, status: 'ready', error: '' }
    } catch (error) {
      if (this.trashView) this.trashView = { ...this.trashView, status: 'error', error: `The trash could not be read: ${error instanceof Error ? error.message : String(error)}` }
    }
    this.changed()
  }

  private trashKey(item: FilesTrashItem): string { return entryKey(item.kind, item.artifactId) }

  private trashPane(): FilesPaneTrash | null {
    const view = this.trashView
    const b = this.binding
    if (!view || !b) return null
    const now = (this.deps.now ?? Date.now)()
    const items: FilesPaneTrashItem[] = view.items.map(item => {
      const key = this.trashKey(item)
      return { key, kind: item.kind === 'document' ? 'document' : 'file', label: item.label,
        type: item.kind === 'document' ? 'Document' : typeCaption(item) || 'File', when: item.trashedAt ? `Trashed ${agoOf(item.trashedAt, now)}` : 'Trashed',
        confirm: view.confirm === key
          ? item.kind === 'document' ? 'Deleted with its history: it cannot be brought back.' : 'Deleted for good: it cannot be brought back.' : null }
    })
    const advert = b.advert
    const canPurge = advert?.purge === true && b.writable
    return { status: view.status, error: view.error, items, canPurge,
      note: !b.writable ? 'You can view the trash. Only editors can restore or delete from it.'
        : advert?.purge !== true ? 'Deleting forever needs a newer cell. Restoring works.' : null,
      onBack: () => { this.trashView = null; this.changed() },
      onRestore: key => { void this.restoreFromTrash(key) },
      onPurge: key => { if (this.trashView) { this.trashView = { ...this.trashView, confirm: key }; this.changed() } },
      onConfirmPurge: key => { void this.purgeFromTrash(key) },
      onCancelPurge: () => { if (this.trashView) { this.trashView = { ...this.trashView, confirm: null }; this.changed() } } }
  }

  private async restoreFromTrash(key: string): Promise<void> {
    const b = this.binding
    const item = this.trashView?.items.find(i => this.trashKey(i) === key)
    if (!b || !item || !b.writable) return
    try {
      if (item.kind === 'document') await this.deps.client.restoreDocument(b.graphId, item.artifactId)
      else await this.deps.client.restore(b.graphId, item.artifactId)
      this.status = { message: `Restored “${item.label}”.`, tone: 'info', undo: false }
      await this.deps.refresh()
    } catch (error) {
      this.status = { message: `Couldn't restore “${item.label}”: ${error instanceof Error ? error.message : String(error)}`, tone: 'error', undo: false }
    }
    await this.readTrash()
  }

  private async purgeFromTrash(key: string): Promise<void> {
    const b = this.binding
    const item = this.trashView?.items.find(i => this.trashKey(i) === key)
    if (!b || !item || !b.writable) return
    if (this.trashView) this.trashView = { ...this.trashView, confirm: null }
    if (b.advert?.purge !== true) {
      this.status = { message: 'Deleting forever needs a newer cell. Nothing was deleted.', tone: 'error', undo: false }
      this.changed()
      return
    }
    try {
      await this.deps.client.purge(b.graphId, item.kind, item.artifactId)
      this.status = { message: `Deleted “${item.label}” forever.`, tone: 'info', undo: false }
    } catch (error) {
      this.status = { message: `Couldn't delete “${item.label}”: ${error instanceof Error ? error.message : String(error)}`, tone: 'error', undo: false }
    }
    await this.readTrash()
  }

  // --- projection ---------------------------------------------------------------------------------------------------

  private filesSections(): FilePaneSection[] {
    return (this.binding?.sections ?? []).filter(section => section.id === 'tree' || section.id === 'documents' || section.id === 'artifacts')
  }

  private view(): FileWorkspaceProjection {
    const view = projectFileWorkspace(this.filesSections(), this.folderKey, this.selected)
    if (view.folderId !== this.folderKey) this.folderKey = view.folderId     // the folder went away: back to the top
    return view
  }

  private incarnation(): string { return this.binding?.graphIncarnation || UNREAD_INCARNATION }

  private scope(view: FileWorkspaceProjection): FolderViewScope {
    const b = this.binding!
    return { ownerId: b.ownerId, graphId: b.graphId, graphIncarnation: this.incarnation(),
      folderId: view.folderId ? parseKey(view.folderId)!.id : null, viewId: FILES_VIEW_ID, audience: { kind: 'shared' } }
  }

  private ref(key: string): WorkspaceFileRef | null {
    const b = this.binding
    const parsed = parseKey(key)
    return b && parsed ? { ownerId: b.ownerId, graphId: b.graphId, graphIncarnation: this.incarnation(), kind: parsed.kind, id: parsed.id } : null
  }

  private tree() { return filesTreeFromSections(this.binding?.sections ?? []) }

  private entryOf(file: WorkspaceFileRef): FilesTreeEntry | null {
    return this.tree().get(file.kind, file.id)
  }

  private capabilities(layout: FilesLayoutSnapshot): FileCanvasCapabilities {
    if (!this.binding?.writable) return NONE
    return { place: layout.ready && layout.available, move: true, rename: true, create: true, add: true, remove: true, connect: true, openBeside: false }
  }

  private layoutFor(view: FileWorkspaceProjection): FilesLayoutSnapshot {
    const b = this.binding!
    if (!b.graphIncarnation) {
      // Not known yet (the discovery asks again): the defaults, said as a transient condition, and nothing written.
      return { ready: true, available: false, view: defaultFolderView(this.scope(view)), placements: [], placementStates: {},
        message: UNREAD_LAYOUT_MESSAGE, contests: [] }
    }
    return this.layout!.bind(this.scope(view), b.graphIncarnation, b.writable)
  }

  // --- the pane -----------------------------------------------------------------------------------------------------

  options(): WorkspaceFilesOptions | null {
    if (!this.isOpen || !this.binding || !this.layout || !this.commands) return null
    const b = this.binding
    const advert = b.advert!
    const view = this.view()
    const layout = this.layoutFor(view)
    const caps = this.capabilities(layout)
    const folderKey = view.folderId
    const cameraKey = folderKey ?? 'root'
    // The datasheets of this place: one batched query for the PDFs shown; a file without records keeps today's card and row.
    this.evidence.sync(b.graphId, view.nodes.flatMap(node => {
      const parsed = parseKey(node.id)
      return parsed?.kind === 'artifact' && kindsMatching(this.deps.kinds ?? FILE_KINDS, typeCaption(nodeFacts(node))).length ? [parsed.id] : []
    }))
    const evidenceOf = (key: string): FileEvidence | undefined => {
      const parsed = parseKey(key)
      return parsed?.kind === 'artifact' ? this.evidence.get(parsed.id) : undefined
    }
    const nodes = view.nodes.flatMap(node => {
      const file = this.ref(node.id)
      const evidence = file?.kind === 'artifact' ? evidenceOf(node.id) : undefined
      return file ? [{ file, label: node.label, type: file.kind === 'artifact' ? typeCaption(nodeFacts(node)) : '', ...(evidence ? { evidence } : {}) }] : []
    })
    const visible = new Set(view.nodes.map(node => node.id))
    const selectedRefs = view.selection.flatMap(key => { const r = this.ref(key); return r ? [r] : [] })
    const scope = this.scope(view)
    const engine = this.ensureEngine()
    const canvas: FilesCanvasHostInput = {
      ...(engine ? { engine } : {}),
      scope,
      nodes,
      placements: layout.placements,
      session: {
        selected: selectedRefs,
        camera: this.cameras.get(cameraKey) ?? IDENTITY,
        editingName: null,
        focused: this.focused && visible.has(entryKey(this.focused.kind as FilesEntryKind, this.focused.id)) ? this.focused : null,
        naming: this.naming,
        cut: this.cut,
      },
      capabilities: caps,
      view: { iconSize: layout.view.iconSize, snapToGrid: layout.view.snapToGrid },
      placementStates: layout.placementStates,
      contests: layout.contests,
      connections: this.connectionsOf(visible),
      relations: this.relationsOf(b.graphId),
      drafts: this.drafts,
      authorityVersion: `${b.graphIncarnation}`,
      onIntent: intent => { void this.intent(intent) },
      externalFolder: nodeId => {
        if (nodeId === '@root') return { folder: null, label: 'Files' }
        const folder = this.ref(entryKey('folder', nodeId))
        const entry = folder ? this.entryOf(folder) : null
        return folder && entry ? { folder, label: entry.label } : null
      },
      onSessionChange: patch => {
        if (patch.camera) this.cameras.set(cameraKey, patch.camera)
        if (patch.focused !== undefined) this.focused = patch.focused
        if (patch.cut) { this.cut = [...patch.cut]; this.changed() }
      },
    }
    const naming = this.naming && !('draftId' in this.naming.target) ? this.naming : null
    const namingKey = naming && !('draftId' in naming.target) ? entryKey(naming.target.kind as FilesEntryKind, naming.target.id) : null
    const lookCount = view.nodes.filter(node => needsLook(evidenceOf(node.id))).length
    const holdsSheets = view.nodes.some(node => evidenceOf(node.id))
    const filtering = this.needsLookOn && holdsSheets
    const rows: FilesPaneRow[] = view.nodes.filter(node => !filtering || needsLook(evidenceOf(node.id))).map(node => {
      const parsed = parseKey(node.id)
      const caption = parsed?.kind === 'artifact' ? typeCaption(nodeFacts(node)) : ''
      const evidence = evidenceOf(node.id)
      return { key: node.id, ...(evidence ? { evidence } : {}), label: node.label, kind: parsed?.kind === 'folder' ? 'folder' : parsed?.kind === 'document' ? 'document' : 'file',
        type: parsed?.kind === 'folder' ? 'Folder' : parsed?.kind === 'document' ? 'Document' : caption || 'File', selected: view.selection.includes(node.id),
        ...(node.id === namingKey && naming ? { naming: { initial: naming.initial, error: naming.error ?? null } } : {}) }
    })
    const items = view.nodes.length
    const status = this.status
    // The reading, said in the steady text ("12 items · 2 reading") and, when nothing else is being said, in words.
    const sheets = view.nodes.flatMap(node => { const e = evidenceOf(node.id); return e ? [{ node, e }] : [] })
    const reading = sheets.filter(x => x.e.state === 'reading')
    const queued = sheets.filter(x => x.e.state === 'queued')
    const progressing = reading.find(x => x.e.progress)
    const progress = progressing ? `Reading ${progressing.node.label}, page ${progressing.e.progress!.page} of ${progressing.e.progress!.pages}` : ''
    const steady = `${countOf(items, 'item')}${view.selection.length ? ` · ${view.selection.length} selected` : ''}${
      reading.length ? ` · ${reading.length} reading` : ''}${queued.length ? ` · ${queued.length} queued` : ''}`
    const banner = !b.writable ? 'You can view these files. Only editors can change them.'
      : layout.ready && !layout.available ? layout.message : null
    const folderId = scope.folderId
    const opened = this.preview.snapshot()
    const openedEvidence = opened.kind === 'pdf' ? this.evidence.get(opened.artifactId) : undefined
    this.assertions.sync(b.graphId, opened.kind === 'pdf' ? opened.artifactId : null, openedEvidence?.kind ?? null, openedEvidence?.state ?? '')
    return {
      graphId: b.graphId,
      breadcrumbs: view.breadcrumbs.map(crumb => ({ id: crumb.id, label: crumb.label })),
      face: layout.view.presentation,
      iconSize: layout.view.iconSize,
      snapToGrid: layout.view.snapToGrid,
      canvas: layout.view.presentation === 'canvas' ? canvas : null,
      rows,
      preview: paneOf(this.preview.snapshot(), id => this.assertions.forPane(id)),
      trash: this.trashPane(),
      onOpenTrash: () => { void this.openTrash() },
      canUpload: caps.add,
      canCreate: caps.create,
      canChangeView: b.writable && layout.ready && layout.available,
      maxUploadLabel: formatFileSize(advert.maxUploadBytes),
      needsLook: holdsSheets ? { on: filtering, count: lookCount, onToggle: on => { this.needsLookOn = on; this.changed() } } : null,
      status: { text: steady, busy: reading.length + queued.length > 0, action: status.action ? { label: status.action.label, onAction: status.action.run } : null,
        message: status.message || progress || (layout.message && b.writable && layout.available ? layout.message : ''),
        undoLabel: status.undo && (this.commands.canUndo || this.placeUndo.length || this.connUndo.length) ? 'Undo' : null, tone: status.tone },
      banner,
      onNavigate: key => this.navigate(key),
      onUpload: files => { void this.upload(files, folderId) },
      onNewFolder: () => {
        if (layout.view.presentation === 'canvas' && this.deps.canvasCommand) this.deps.canvasCommand('new-folder')
        else void this.intent({ kind: 'new-folder', placement: { x: 16, y: 16 } })
      },
      onFace: face => { void this.layout?.setView({ presentation: face }) },
      onIconSize: size => { void this.layout?.setView({ iconSize: size }) },
      onSnapToGrid: on => { void this.layout?.setView({ snapToGrid: on }) },
      onUndo: () => { void this.undo() },
      onClosePreview: () => this.preview.close(),
      onPdfPage: (page, count) => this.preview.reportPage(page, count),
      onAssertionSelect: (id, page) => { this.assertions.select(id); this.deps.onAssertionSelect?.(id, page) },
      onOverlay: on => this.assertions.setOverlay(on),
      onDownload: () => { void this.preview.download(b.graphId) },
      onPreviewSource: on => { void this.preview.setSource(on) },
      onPreviewShowAll: () => { void this.preview.showAll() },
      onReloadPreview: () => {
        const opened = this.preview.snapshot()
        const entry = opened.kind === 'none' ? null : this.tree().get('artifact', opened.artifactId)
        if (entry) void this.preview.open(b.graphId, { id: entry.id, label: entry.label, mimeType: entry.mimeType, fileType: entry.fileType,
          originalFilename: entry.label })
      },
      onRowSelect: (keys, mode) => this.selectRows(view, keys, mode),
      onRowOpen: key => { const r = this.ref(key); if (r) void this.intent({ kind: 'open', file: r }) },
      onRowMenu: (keys, x, y) => this.showMenu(keys.flatMap(k => { const r = this.ref(k); return r ? [r] : [] }), x, y, null, view),
      onRowKey: (key, keys) => {
        const refs = keys.flatMap(k => { const r = this.ref(k); return r ? [r] : [] })
        if (key === 'Delete' && caps.remove) void this.intent({ kind: 'remove', files: refs })
        if (key === 'F2' && caps.rename && refs.length === 1) this.startRename(refs[0]!)
      },
      onRowRename: (key, name) => { const r = this.ref(key); if (r) void this.intent({ kind: 'rename', file: r, name }) },
      onRowRenameCancel: () => { void this.intent({ kind: 'name-cancel' }) },
    }
  }

  /** The inspector for the Files pane's selection (or the folder it shows). */
  inspector(): WorkspaceInspectorModel | null {
    if (!this.isOpen) return null
    const view = this.view()
    const tree = this.tree()
    const selected = view.selection.map(key => parseKey(key)).flatMap(p => p ? [tree.get(p.kind, p.id)].filter(Boolean) as FilesTreeEntry[] : [])
    const folder = view.folderId ? tree.get('folder', parseKey(view.folderId)!.id) : null
    const path = (entry: FilesTreeEntry | null): string => {
      const parts: string[] = []
      let at = entry?.parentId ?? null
      while (at !== null) { const f = tree.get('folder', at); if (!f) break; parts.unshift(f.label); at = f.parentId }
      return ['Files', ...parts].join(' / ')
    }
    if (selected.length === 1) {
      const entry = selected[0]!
      const caption = entry.kind === 'artifact' ? typeCaption(entry) : ''
      return { identity: { kind: entry.kind, icon: entry.kind === 'folder' ? 'folder' : 'file-text', title: entry.label,
        typeLabel: entry.kind === 'folder' ? 'Folder' : entry.kind === 'document' ? 'Document' : caption ? `${caption} file` : 'File',
        chips: [{ label: 'Location', value: path(entry) },
          ...(entry.kind === 'folder' ? [{ label: 'Contains', value: countOf(tree.children(entry.id).length, 'item') }]
            : entry.kind === 'document' ? [] : [{ label: 'Type', value: entry.mimeType || 'Unknown' }])] }, relations: { scope: 'none', groups: [] } }
    }
    if (selected.length > 1) {
      return { identity: { kind: 'files', icon: 'folder', title: `${selectionNoun(selected)} selected`, typeLabel: 'Selection',
        chips: [{ label: 'Location', value: folder ? `${path(folder)} / ${folder.label}` : 'Files' }] }, relations: { scope: 'none', groups: [] } }
    }
    return { identity: { kind: 'folder', icon: 'folder', title: folder?.label ?? 'Files', typeLabel: 'Folder',
      chips: [{ label: 'Location', value: folder ? path(folder) : 'Files' }, { label: 'Contains', value: countOf(view.nodes.length, 'item') }] },
      relations: { scope: 'none', groups: [] } }
  }


  // --- Show info ----------------------------------------------------------------------------------------------------

  /** Whether the Show info panel is open. */
  get infoOpen(): boolean { return this.info !== null }

  /** Open Show info for these tree keys (the selection by default; with none, the folder shown). */
  showInfo(keys?: readonly string[]): void {
    const b = this.binding
    if (!b) return
    const view = this.view()
    const wanted = (keys ?? (this.selected.length ? this.selected : view.folderId ? [view.folderId] : [])).filter(k => view.entries.has(k))
    if (!wanted.length) return
    const was = this.info !== null
    const generation = ++this.infoGeneration
    this.info = { keys: wanted, generation, detail: null, status: wanted.length === 1 ? 'loading' : 'ready', wires: null, sizes: null }
    if (!was) this.deps.onInfo?.(true)
    this.changed()
    if (wanted.length === 1) void this.loadInfo(generation, wanted[0]!)
    // Several items, or a folder: totals need the sizes, which the tree does not carry; one read of the listing.
    if (wanted.length > 1 || parseKey(wanted[0]!)?.kind === 'folder') {
      void this.deps.client.listingSizes(this.binding!.graphId).then(sizes => {
        if (this.info?.generation === generation) { this.info = { ...this.info, sizes }; this.changed() }
      }).catch(() => {})
    }
  }

  closeInfo(): void {
    if (!this.info) return
    this.info = null
    this.infoGeneration++
    this.deps.onInfo?.(false)
    this.changed()
  }

  private async loadInfo(generation: number, key: string): Promise<void> {
    const b = this.binding
    const parsed = parseKey(key)
    if (!b || !parsed) return
    const entry = this.view().entries.get(key)
    const item = { kind: parsed.kind, id: parsed.id, sizeBytes: entry?.node.sourceFile?.sizeBytes ?? null }
    const live = () => this.info?.generation === generation
    const detail = readInfoDetail(this.deps.client, b.graphId, item).then(d => {
      if (live()) { this.info = { ...this.info!, detail: d, status: 'ready' }; this.changed() }
    }).catch(() => { if (live()) { this.info = { ...this.info!, status: 'error' }; this.changed() } })
    const wires = parsed.kind === 'folder' ? Promise.resolve() : this.wiresClient().around(b.graphId, parsed.id).then(rows => {
      if (!live()) return
      const tree = this.tree()
      const nameOf = (id: string) => (tree.get('artifact', id) ?? tree.get('document', id))?.label ?? id
      const keyOf = (id: string) => (tree.get('artifact', id) ? entryKey('artifact', id) : entryKey('document', id))
      const out = rows.map((w): InfoWire => w.source === parsed.id
        ? { id: w.id, direction: 'out', label: w.label, otherKey: keyOf(w.target), otherName: nameOf(w.target) }
        : { id: w.id, direction: 'in', label: w.label, otherKey: keyOf(w.source), otherName: nameOf(w.source) })
      this.info = { ...this.info!, wires: out }
      this.changed()
    }).catch(() => { if (live()) { this.info = { ...this.info!, wires: [] }; this.changed() } })
    await Promise.all([detail, wires])
  }

  /** The panel model for the right pane, or null when Show info is closed (an item that went away closes it). */
  infoModel(): WorkspaceFileInfoModel | null {
    const info = this.info
    if (!info) return null
    const view = this.view()
    const items: InfoItem[] = info.keys.flatMap(key => {
      const entry = view.entries.get(key)
      const parsed = parseKey(key)
      if (!entry || !parsed) return []
      const node = entry.node
      return [{ key, kind: parsed.kind, id: parsed.id, label: node.label, mimeType: nodeFacts(node).mimeType ?? null,
        caption: parsed.kind === 'artifact' ? typeCaption(nodeFacts(node)) : '', sizeBytes: node.sourceFile?.sizeBytes ?? null }]
    })
    if (!items.length) { queueMicrotask(() => this.closeInfo()); return null }
    const filesUnder = (key: string): { files: number; bytes: number; unknown: number } => {
      const total = { files: 0, bytes: 0, unknown: 0 }
      const seen = new Set<string>()
      const walk = (k: string) => {
        if (seen.has(k)) return
        seen.add(k)
        const e = view.entries.get(k)
        if (!e) return
        if (e.node.kind === 'folder') { for (const c of view.entries.values()) if (c.parentKey === k) walk(c.key) }
        else {
          total.files++
          const n = e.node.sourceFile?.sizeBytes ?? info.sizes?.get(parseKey(e.key)?.id ?? '')
          if (typeof n === 'number') total.bytes += n; else total.unknown++
        }
      }
      walk(key)
      return total
    }
    const first = items[0]!
    const evidence = items.length === 1 && first.kind === 'artifact' ? this.evidence.get(first.id) : undefined
    return buildInfoModel({
      items, writable: !!this.binding?.writable, detail: info.detail, detailStatus: info.status, wires: info.wires, evidence,
      location: item => {
        const parentKey = view.entries.get(item.key)?.parentKey ?? null
        const parts: string[] = []
        for (let at = parentKey; at; at = view.entries.get(at)?.parentKey ?? null) parts.unshift(view.entries.get(at)?.node.label ?? '')
        return { text: ['Files', ...parts].join(' / '), action: `location:${parentKey ?? ''}` }
      },
      contents: folderId => {
        const key = entryKey('folder', folderId)
        const t = filesUnder(key)
        return { direct: [...view.entries.values()].filter(e => e.parentKey === key).length, ...t }
      },
      scope: () => items.reduce((acc, i) => {
        const t = filesUnder(i.key)
        return { files: acc.files + t.files, bytes: acc.bytes + t.bytes, unknown: acc.unknown + t.unknown }
      }, { files: 0, bytes: 0, unknown: 0 }),
    })
  }

  /** A row of the panel was pressed. */
  async infoAction(action: string): Promise<void> {
    const info = this.info
    if (!info) return
    const [verb, ...rest] = action.split(':')
    const value = rest.join(':')
    if (verb === 'location') {
      // Go to the folder the item is in and select the item there: the panel stays on it.
      this.navigateKeepingInfo(value || null, info.keys.length === 1 ? info.keys[0]! : null)
    } else if (verb === 'goto') {
      const parsed = parseKey(value)
      const entry = parsed ? this.tree().get(parsed.kind, parsed.id) : null
      if (entry) this.navigateKeepingInfo(entry.parentId === null ? null : entryKey('folder', entry.parentId), value)
    } else if (verb === 'kind' && value === 'open') {
      const ref = info.keys.length === 1 ? this.ref(info.keys[0]!) : null
      if (ref) await this.intent({ kind: 'open', file: ref })
    }
  }

  /** Go to a folder (and select an item in it), and show info for what was selected: a folder alone when no item is named. */
  private navigateKeepingInfo(folderKey: string | null, itemKey: string | null): void {
    if (!this.visible()) return
    this.active = true
    this.retargeting = true
    try {
      this.navigate(folderKey)
      if (itemKey) { this.selected = [itemKey]; this.focused = this.ref(itemKey); this.publishSelection() }
    } finally { this.retargeting = false }
    const shown = itemKey ?? (folderKey ?? null)
    if (shown) this.showInfo([shown]); else this.closeInfo()
  }

  /** Rename from the panel: the same command as the menu's Rename. */
  async infoRename(name: string): Promise<void> {
    const key = this.info?.keys.length === 1 ? this.info.keys[0]! : null
    const ref = key ? this.ref(key) : null
    const entry = ref ? this.entryOf(ref) : null
    if (!entry || !this.commands) return
    await this.run(this.commands.rename(entry, name))
  }

  private infoKey(event: KeyboardEvent): void {
    if (this.disposed || !this.isOpen || event.defaultPrevented || event.shiftKey || event.altKey || !(event.metaKey || event.ctrlKey)) return
    if (event.key.toLowerCase() !== 'i') return
    const target = event.target as HTMLElement | null
    if (target && (/^(input|textarea|select)$/i.test(target.localName) || target.isContentEditable)) return
    event.preventDefault()
    if (this.info) this.closeInfo(); else this.showInfo()
  }

  // --- intents ------------------------------------------------------------------------------------------------------

  private async run<T extends FilesCommandResult>(result: Promise<T>, journal = true): Promise<T> {
    const outcome = await result
    if (journal && outcome.ok && outcome.undo !== null) { this.undoOrder.push('cmd'); this.redoOrder = []; this.placeRedo = [] }
    if (outcome.message || !outcome.ok) this.status = { message: outcome.message, tone: outcome.ok ? 'info' : 'error', undo: outcome.undo !== null }
    this.changed()
    return outcome
  }

  private wiresClient(): FilesWires { return (this.wires ??= new FilesWires(this.deps.client)) }

  /** The vocabulary of the graph's wires, read once per graph (the built-in names meanwhile). */
  private relationsOf(graphId: string): readonly { uri: string; label: string }[] {
    if (this.relations?.graphId === graphId) return this.relations.list
    this.relations = { graphId, list: FALLBACK_RELATIONS }
    void this.wiresClient().relations(graphId).then(list => {
      if (this.relations?.graphId === graphId) { this.relations = { graphId, list }; this.changed() }
    })
    return FALLBACK_RELATIONS
  }

  /** Read the wires of the folder shown, when what was read is not for this folder's artifacts. */
  private readWires(visible: ReadonlySet<string>): void {
    const b = this.binding
    if (!b) return
    const ids = [...visible].flatMap(key => { const p = parseKey(key); return p && p.kind !== 'folder' ? [p.id] : [] })
    const key = `${b.graphId}|${ids.join(',')}`
    if (key === this.wireKey) return
    this.wireKey = key
    void this.wiresClient().list(b.graphId, ids).then(rows => {
      if (this.wireKey !== key) return
      this.wireRows = rows
      this.changed()
    })
  }

  /** Read again after the wires changed (the next `options()`). */
  private wiresChanged(): void { this.wireKey = '' }

  /** The wires whose two ends are both artifacts of the folder shown. */
  private connectionsOf(visible: ReadonlySet<string>): FileCanvasConnection[] {
    this.readWires(visible)
    return this.wireRows.flatMap(w => {
      // A wire's ends are ids; the card is whichever kind of thing that id is in this place.
      const keyOf = (id: string) => [entryKey('artifact', id), entryKey('document', id)].find(k => visible.has(k)) ?? null
      const sk = keyOf(w.source), tk = keyOf(w.target)
      const source = sk ? this.ref(sk) : null, target = tk ? this.ref(tk) : null
      return source && target
        ? [{ id: w.id, source, target, relation: w.predicate, label: w.label, state: w.predicate === 'contradicts' ? 'disputed' as const : 'endorsed' as const,
          attribution: null }] : []
    })
  }

  private nameOf(id: string): string { return this.tree().get('artifact', id)?.label || this.tree().get('document', id)?.label || 'item' }

  private async connect(intent: Extract<FileCanvasIntent, { kind: 'connect' }>): Promise<void> {
    const b = this.binding
    if (!b || !b.writable) return
    if (intent.source.kind === 'folder' || intent.target.kind === 'folder') {
      this.status = { message: 'Only documents and files can be connected; a folder has nothing a wire can attach to.', tone: 'info', undo: false }
      this.changed()
      return
    }
    const custom = intent.relation === 'urn:shrubbery:files:relation:custom'
    const predicate = custom ? customPredicate(intent.label ?? '') : intent.relation
    if (!predicate || intent.source.id === intent.target.id) return
    const label = custom ? (intent.label ?? '').trim() : (this.relationsOf(b.graphId).find(r => r.uri === predicate)?.label ?? humanize(predicate))
    const wire: FileWire = { id: this.id('conn'), source: intent.source.id, target: intent.target.id, predicate, label }
    if (this.wireRows.some(w => w.source === wire.source && w.target === wire.target && w.predicate === predicate)) {
      this.status = { message: 'Those two are already connected that way.', tone: 'info', undo: false }
      this.changed()
      return
    }
    const graphId = b.graphId, incarnation = this.incarnation()
    try { await this.wiresClient().create(graphId, incarnation, wire) } catch {
      this.status = { message: 'That connection could not be saved.', tone: 'error', undo: false }
      this.changed()
      return
    }
    this.wireRows = [...this.wireRows, wire]
    this.pushConn({
      undo: async () => { await this.wiresClient().delete(graphId, wire.id); this.wireRows = this.wireRows.filter(w => w.id !== wire.id) },
      redo: async () => { await this.wiresClient().create(graphId, incarnation, wire); this.wireRows = [...this.wireRows, wire] },
    })
    this.status = { message: `Connected “${this.nameOf(wire.source)}” to “${this.nameOf(wire.target)}”: ${label}.`, tone: 'info', undo: true }
    this.wiresChanged()
    this.changed()
  }

  private async disconnect(connectionId: string): Promise<void> {
    const b = this.binding
    const wire = this.wireRows.find(w => w.id === connectionId)
    if (!b || !b.writable || !wire) return
    const graphId = b.graphId, incarnation = this.incarnation()
    try { await this.wiresClient().delete(graphId, wire.id) } catch {
      this.status = { message: 'That connection could not be removed.', tone: 'error', undo: false }
      this.changed()
      return
    }
    this.wireRows = this.wireRows.filter(w => w.id !== wire.id)
    this.pushConn({
      undo: async () => { await this.wiresClient().create(graphId, incarnation, wire); this.wireRows = [...this.wireRows, wire] },
      redo: async () => { await this.wiresClient().delete(graphId, wire.id); this.wireRows = this.wireRows.filter(w => w.id !== wire.id) },
    })
    this.status = { message: `Removed the connection “${wire.label}”.`, tone: 'info', undo: true }
    this.wiresChanged()
    this.changed()
  }

  private pushConn(entry: { undo: () => Promise<void>; redo: () => Promise<void> }): void {
    this.connUndo.push(entry); this.undoOrder.push('conn'); this.redoOrder = []; this.placeRedo = []; this.connRedo = []
  }

  /** Seed wires between artifacts by id (a harness or a first-run helper). */
  async seedConnections(rows: readonly { source: string; target: string; predicate: string }[]): Promise<void> {
    const b = this.binding
    if (!b) return
    for (const row of rows) await this.wiresClient().create(b.graphId, this.incarnation(), { id: this.id('conn'), ...row })
    this.wiresChanged()
    this.changed()
  }

  /** Undo the latest edit of either kind: a placement (put back where it stood) or a file command. */
  private async undo(): Promise<void> {
    const commands = this.commands
    if (!commands) return
    if (this.undoOrder[this.undoOrder.length - 1] === 'conn' && this.connUndo.length) {
      this.undoOrder.pop()
      const entry = this.connUndo.pop()!
      this.connRedo.push(entry); this.redoOrder.push('conn')
      try { await entry.undo() } catch { this.status = { message: 'That could not be undone.', tone: 'error', undo: false }; this.changed(); return }
      this.status = { message: 'Connections put back.', tone: 'info', undo: this.undoOrder.length > 0 }
      this.wiresChanged()
      this.changed()
      return
    }
    if (this.undoOrder[this.undoOrder.length - 1] === 'place' && this.placeUndo.length) {
      this.undoOrder.pop()
      const entry = this.placeUndo.pop()!
      this.placeRedo.push(entry); this.redoOrder.push('place')
      try { await this.layout?.place(entry.previous) } catch { this.status = { message: 'That arrangement is in another folder; open it to undo it.', tone: 'error', undo: false }; this.changed(); return }
      this.status = { message: 'Put back.', tone: 'info', undo: this.undoOrder.length > 0 }
      this.changed()
      return
    }
    this.undoOrder.pop()
    const outcome = await this.run(commands.undo(), false)
    if (outcome.ok) this.redoOrder.push('cmd')
  }

  private async redo(): Promise<void> {
    const commands = this.commands
    if (!commands) return
    if (this.redoOrder[this.redoOrder.length - 1] === 'conn' && this.connRedo.length) {
      this.redoOrder.pop()
      const entry = this.connRedo.pop()!
      this.connUndo.push(entry); this.undoOrder.push('conn')
      try { await entry.redo() } catch { this.status = { message: 'That could not be done again.', tone: 'error', undo: false }; this.changed(); return }
      this.status = { message: 'Done again.', tone: 'info', undo: true }
      this.wiresChanged()
      this.changed()
      return
    }
    if (this.redoOrder[this.redoOrder.length - 1] === 'place' && this.placeRedo.length) {
      this.redoOrder.pop()
      const entry = this.placeRedo.pop()!
      this.placeUndo.push(entry); this.undoOrder.push('place')
      try { await this.layout?.place(entry.placements) } catch { this.status = { message: 'That arrangement is in another folder; open it to redo it.', tone: 'error', undo: false }; this.changed(); return }
      this.status = { message: 'Done again.', tone: 'info', undo: true }
      this.changed()
      return
    }
    this.redoOrder.pop()
    const outcome = await this.run(commands.redo(), false)
    if (outcome.ok) this.undoOrder.push('cmd')
  }

  private refs(files: readonly WorkspaceFileRef[]): { kind: FilesEntryKind; id: string }[] {
    return files.map(f => ({ kind: f.kind as FilesEntryKind, id: f.id }))
  }

  private async upload(files: readonly File[], folderId: string | null): Promise<void> {
    if (!this.commands || !files.length) return
    await this.run(this.commands.upload(files, folderId))
  }

  private publishSelection(): void {
    // Show info is pinned to its items: a selection that is not those items closes it.
    if (this.info && !this.retargeting) {
      const pinned = new Set(this.info.keys)
      if (this.selected.length !== pinned.size || this.selected.some(k => !pinned.has(k))) this.closeInfo()
    }
    const tree = this.tree()
    this.deps.onSelection?.(this.selected.flatMap(key => { const p = parseKey(key); const e = p ? tree.get(p.kind, p.id) : null; return e ? [e] : [] }))
  }

  private selectRows(view: FileWorkspaceProjection, keys: readonly string[], mode: 'replace' | 'toggle' | 'range'): void {
    const order = view.nodes.map(n => n.id)
    let next: string[]
    if (mode === 'toggle') next = keys.reduce((acc, k) => acc.includes(k) ? acc.filter(x => x !== k) : [...acc, k], [...view.selection])
    else if (mode === 'range' && view.selection.length) {
      const anchor = order.indexOf(view.selection[0]!), to = order.indexOf(keys[0]!)
      next = order.slice(Math.min(anchor, to), Math.max(anchor, to) + 1)
    } else next = [...keys]
    this.selected = next
    this.publishSelection()
    this.changed()
  }

  private startRename(file: WorkspaceFileRef): void {
    const entry = this.entryOf(file)
    if (!entry) return
    this.naming = { target: file, initial: entry.label, error: null }
    this.changed()
  }

  private async intent(intent: FileCanvasIntent): Promise<void> {
    const b = this.binding
    const commands = this.commands
    if (!b || !commands || !this.isOpen) return
    switch (intent.kind) {
      case 'select':
        this.selected = intent.files.map(f => entryKey(f.kind, f.id))
        this.publishSelection()
        this.changed()
        return
      case 'open': {
        if (intent.file.kind === 'folder') { this.navigate(entryKey('folder', intent.file.id)); return }
        const entry = this.entryOf(intent.file)
        if (!entry) return
        if (entry.kind === 'document') { this.openDocument(entry); return }
        await this.preview.open(b.graphId, { id: entry.id, label: entry.label, mimeType: entry.mimeType, fileType: entry.fileType, originalFilename: entry.label })
        return
      }
      case 'menu': this.showMenu(intent.files, intent.clientX, intent.clientY, intent.at ?? null, this.view()); return
      case 'rename': {
        const entry = this.entryOf(intent.file)
        if (!entry) return
        const result = await this.run(commands.rename(entry, intent.name))
        if (this.naming && !('draftId' in this.naming.target) && this.naming.target.id === intent.file.id) {
          this.naming = result.ok ? null : { ...this.naming, error: result.message }
          this.changed()
        }
        return
      }
      case 'name-cancel':
        if (this.naming && 'draftId' in this.naming.target) {
          const draftId = this.naming.target.draftId
          this.drafts = this.drafts.filter(d => d.draftId !== draftId)
        }
        this.naming = null
        this.changed()
        return
      case 'place': {
        await this.layout?.place(intent.placements)
        if (intent.previous && intent.previous.length === intent.placements.length) {
          this.placeUndo.push({ previous: [...intent.previous], placements: [...intent.placements] })
          this.undoOrder.push('place'); this.redoOrder = []; this.placeRedo = []
          const n = intent.placements.length
          this.status = { message: n === 1 ? 'Moved 1 item.' : `Moved ${n} items.`, tone: 'info', undo: true }
          this.changed()
        }
        return
      }
      case 'move': {
        await this.run(commands.move(this.refs(intent.files), intent.folder?.id ?? null))
        this.selected = []
        this.publishSelection()
        return
      }
      case 'new-folder': {
        if (!b.writable) return
        const draftId = this.id('draft')
        this.drafts = [{ draftId, kind: 'folder', label: 'Untitled folder', placement: intent.placement }]
        this.naming = { target: { draftId }, initial: 'Untitled folder', error: null }
        this.changed()
        return
      }
      case 'create': {
        const view = this.view()
        const parent = intent.parent?.id ?? (view.folderId ? parseKey(view.folderId)!.id : null)
        const result = await this.run(commands.createFolder(intent.name, parent))
        if (!result.ok || !result.folderId) {
          if (this.naming && 'draftId' in this.naming.target && this.naming.target.draftId === intent.draftId) {
            this.naming = { ...this.naming, error: result.message }
            this.changed()
          }
          return
        }
        this.drafts = this.drafts.filter(d => d.draftId !== intent.draftId)
        if (this.naming && 'draftId' in this.naming.target && this.naming.target.draftId === intent.draftId) this.naming = null
        const folder = this.ref(entryKey('folder', result.folderId))!
        const placement: FilePlacementRecord = { schemaVersion: 1, scope: this.scope(this.view()), file: folder, coordinateSpace: 'folder-canvas',
          x: intent.placement.x, y: intent.placement.y }
        this.changed()
        await this.layout?.place([placement])
        return
      }
      case 'add': {
        const view = this.view()
        const folderId = intent.folder?.id ?? (view.folderId ? parseKey(view.folderId)!.id : null)
        await this.upload(Array.from(intent.files), folderId)
        return
      }
      case 'remove':
        await this.run(commands.remove(this.refs(intent.files)))
        this.selected = []
        this.publishSelection()
        return
      case 'undo': await this.undo(); return
      case 'redo': await this.redo(); return
      case 'connect': await this.connect(intent); return
      case 'disconnect': await this.disconnect(intent.connectionId); return
      case 'choose-placement': {
        // Settling a contest is nobody's undo: it chose between two positions that were each somebody's decision.
        await this.layout?.choose(intent.file, intent.candidateId)
        this.status = { message: 'Position settled. This choice can\'t be undone.', tone: 'info', undo: false }
        this.changed()
        return
      }
      default: return
    }
  }

  // --- menus --------------------------------------------------------------------------------------------------------

  private showMenu(files: readonly WorkspaceFileRef[], x: number, y: number, at: { x: number; y: number } | null, view: FileWorkspaceProjection): void {
    const b = this.binding
    if (!b) return
    const caps = this.capabilities(this.layoutFor(view))
    const items: FilesMenuItem[] = []
    const label: Partial<Record<Verb, string>> = { add: 'Upload files…', remove: 'Move to trash', view: 'View as list' }
    if (files.length) {
      const single = files.length === 1 ? files[0]! : null
      for (const v of menuVerbs(caps, { kind: 'item', folder: single?.kind === 'folder' })) {
        if (v.verb === 'open' && !single) continue
        if ((v.verb === 'rename') && !single) continue
        if (v.verb === 'connect' && (!single || this.layoutFor(view).view.presentation !== 'canvas')) continue
        items.push({ id: v.verb, label: label[v.verb] ?? v.label })
        if (v.verb === 'open' && single?.kind === 'artifact') items.push({ id: 'download', label: 'Download' })
      }
    } else {
      for (const v of menuVerbs(caps, { kind: 'background', pasteable: this.cut.length > 0 })) {
        if (v.verb === 'view') { items.push({ id: 'view', label: this.layoutFor(view).view.presentation === 'canvas' ? 'View as list' : 'View as canvas' }); continue }
        if (v.verb === 'tidy' && this.layoutFor(view).view.presentation !== 'canvas') continue
        items.push({ id: v.verb, label: label[v.verb] ?? v.label })
      }
    }
    if (files.length) {
      const after = Math.max(items.findIndex(i => i.id === 'download'), items.findIndex(i => i.id === 'open'))
      items.splice(after + 1, 0, { id: 'info', label: 'Show info', icon: 'info', shortcut: INFO_SHORTCUT })
    }
    if (!items.length) return
    this.deps.menu({ items, x, y, onSelect: id => { void this.menuChoice(id, files, at, view, { x, y }) } })
  }

  private async menuChoice(id: string, files: readonly WorkspaceFileRef[], at: { x: number; y: number } | null, view: FileWorkspaceProjection,
    origin: { readonly x: number; readonly y: number }): Promise<void> {
    const b = this.binding
    if (!b) return
    const single = files.length === 1 ? files[0]! : null
    switch (id) {
      case 'open': if (single) await this.intent({ kind: 'open', file: single }); return
      case 'connect': this.deps.canvasCommand?.('connect'); return
      case 'info': this.showInfo(files.map(f => entryKey(f.kind, f.id))); return
      case 'download': {
        const entry = single ? this.entryOf(single) : null
        if (!entry) return
        try {
          await this.preview.save(b.graphId, { id: entry.id, name: entry.label })
          this.status = { message: `Downloaded “${entry.label}”.`, tone: 'info', undo: false }
        } catch (error) {
          this.status = { message: `“${entry.label}” could not be downloaded: ${error instanceof Error ? error.message : String(error)}`, tone: 'error', undo: false }
        }
        this.changed()
        return
      }
      case 'rename': if (single) this.startRename(single); return
      case 'move-to': this.showMoveMenu(files, view, origin); return
      case 'remove': await this.intent({ kind: 'remove', files }); return
      case 'new-folder-inside':
        if (single?.kind === 'folder') {
          const result = await this.run(this.commands!.createFolder('Untitled folder', single.id))
          if (result.ok) this.navigate(entryKey('folder', single.id))
        }
        return
      case 'add': {
        const picked = await this.deps.pickFiles?.()
        if (picked?.length) await this.upload(picked, view.folderId ? parseKey(view.folderId)!.id : null)
        return
      }
      case 'new-folder': await this.intent({ kind: 'new-folder', placement: at ?? { x: 16, y: 16 } }); return
      case 'paste': {
        const files = this.cut
        this.cut = []
        await this.intent({ kind: 'move', files, folder: view.folderId ? this.ref(view.folderId) : null })
        return
      }
      case 'tidy': this.deps.canvasCommand?.('tidy'); return
      case 'view': {
        const face = this.layoutFor(view).view.presentation === 'canvas' ? 'list' : 'canvas'
        await this.layout?.setView({ presentation: face })
        return
      }
      default: return
    }
  }

  /** "Move to…": the Files folders a selection can go to (not into itself or its own descendants). */
  private showMoveMenu(files: readonly WorkspaceFileRef[], view: FileWorkspaceProjection, origin: { readonly x: number; readonly y: number }): void {
    const tree = this.tree()
    const moving = new Set(files.filter(f => f.kind === 'folder').map(f => f.id))
    const inside = (id: string | null): boolean => {
      let at = id
      while (at !== null) { if (moving.has(at)) return true; at = tree.get('folder', at)?.parentId ?? null }
      return false
    }
    const here = view.folderId ? parseKey(view.folderId)!.id : null
    const folders: FilesMenuItem[] = []
    const walk = (parent: string | null, depth: number) => {
      for (const entry of tree.children(parent)) {
        if (entry.kind !== 'folder' || inside(entry.id)) continue
        if (entry.id !== here) folders.push({ id: `folder:${entry.id}`, label: `${'  '.repeat(depth)}${entry.label}`, icon: 'folder' })
        walk(entry.id, depth + 1)
      }
    }
    const items: FilesMenuItem[] = here !== null ? [{ id: 'root', label: 'Files (the top)', icon: 'folder' }] : []
    walk(null, 0)
    items.push(...folders)
    if (!items.length) { this.status = { message: 'There is no other folder to move to.', tone: 'info', undo: false }; this.changed(); return }
    this.deps.menu({ items, x: origin.x, y: origin.y, onSelect: id => {
      void this.intent({ kind: 'move', files, folder: id === 'root' ? null : this.ref(id) })
    } })
  }
}

function nodeFacts(node: FilePaneNode): { mimeType?: string | null; fileType?: string | null; originalFilename?: string | null } {
  const n = node as FilePaneNode & { fileType?: string | null }
  return { mimeType: n.mimeType ?? n.sourceFile?.mimeType ?? null, fileType: n.fileType ?? n.sourceFile?.fileType ?? null,
    originalFilename: n.sourceFile?.originalFilename ?? node.label }
}

function paneOf(state: FilesPreviewState, assertionsOf: (artifactId: string) => ReturnType<FilesAssertions['forPane']>): FilesPanePreview | null {
  switch (state.kind) {
    case 'none': return null
    case 'pdf': {
      const read = assertionsOf(state.artifactId)
      return { kind: 'pdf', name: state.name, status: state.status, error: state.error, data: state.data, loaded: state.loaded, total: state.total,
        fileKey: state.artifactId, pageCount: state.pageCount, pageNumber: state.pageNumber,
        ...(read ? { assertions: read.assertions, assertionsInfo: read.info, overlay: read.overlay, selected: read.selected, reveal: read.reveal } : {}) }
    }
    case 'image': return { kind: 'image', name: state.name, status: state.status, error: state.error, url: state.url }
    case 'reader': return { kind: 'reader', name: state.name, status: state.status, error: state.error, label: state.label, view: state.view,
      truncated: state.truncated, source: state.source, note: state.note }
    case 'media': return { kind: 'media', name: state.name, status: state.status, error: state.error, media: state.media, url: state.url, mimeType: state.mimeType,
      caption: typeCaption({ originalFilename: state.name }) }
    case 'file': return { kind: 'file', name: state.name, status: state.status, error: state.error, typeLabel: state.typeLabel, caption: state.caption,
      size: state.sizeBytes === null ? null : formatFileSize(state.sizeBytes), modified: state.modified }
  }
}
