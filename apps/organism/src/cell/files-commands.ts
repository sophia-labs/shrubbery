/**
 * The Files pane's mediated shell commands. The canvas and the list only ask (intents); these do, through the cell's
 * contract, and nothing else writes: rename and move a file with PATCH, remove a file to the trash, folders through the
 * MCP folder tools in the artifacts section, uploads through the no-parse multipart route (CONTRACT-files §3–§6).
 *
 * Every change is announced once and can be undone from the announcement (design §5, the intent journal): the journal is
 * session-local, records the inverse of each applied change, and says so honestly when an inverse would be wrong now
 * ("Can't undo: …"). It is never a Yjs UndoManager, which would undo other people's work.
 *
 * Removing is always recoverable: a file goes to the trash; a folder is removed by trashing every file in it and deleting
 * the emptied folders, children first, never with a cascade (a cascade delete is not undoable, §6). Undo rebuilds the
 * folders with their own ids and restores the files into them.
 */
import type { FilePaneNode, FilePaneSection } from '@shrubbery/nucleus'
import { FilesContractError, type FilesArtifact, type FilesClient } from './files-contract.js'
import { formatFileSize, planUploads } from './files-policy.js'
import { randomUUID } from '@shrubbery/nucleus/web-crypto'

export type FilesEntryKind = 'folder' | 'artifact' | 'document'

export interface FilesTreeEntry {
  readonly kind: FilesEntryKind
  readonly id: string
  readonly label: string
  readonly parentId: string | null
  readonly mimeType?: string | null
  readonly fileType?: string | null
  /** A folder's born section; informational (only an older cell's fence makes it matter). */
  readonly section?: 'documents' | 'artifacts'
}

/** What the cell has said it can do in the one tree (the advert's flags), read when a command runs. */
export interface PlaceSupport {
  readonly anyFolder: boolean
  readonly documentTrash: boolean
}

/** The Files tree as the commands read it: the artifacts section's folders and files. */
export interface FilesTreeView {
  get(kind: FilesEntryKind, id: string): FilesTreeEntry | null
  children(folderId: string | null): readonly FilesTreeEntry[]
}

function treeOf(entries: readonly FilesTreeEntry[]): FilesTreeView {
  const folders = new Set(entries.filter(e => e.kind === 'folder').map(e => e.id))
  // An entry whose folder is not a Files folder sits at the root, as the workspace tree places it (CONTRACT-files §2).
  const placed = entries.map(entry => entry.parentId !== null && folders.has(entry.parentId) && entry.parentId !== entry.id
    ? entry : { ...entry, parentId: null })
  const byKey = new Map(placed.map(e => [`${e.kind}:${e.id}`, e]))
  const byParent = new Map<string | null, FilesTreeEntry[]>()
  for (const entry of placed) {
    const list = byParent.get(entry.parentId) ?? []
    list.push(entry)
    byParent.set(entry.parentId, list)
  }
  // Folders first, otherwise in the listing's order (stable sort).
  for (const list of byParent.values()) list.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'folder' ? -1 : 1))
  return {
    get: (kind, id) => byKey.get(`${kind}:${id}`) ?? null,
    children: folderId => byParent.get(folderId) ?? [],
  }
}

function rec(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** From the contract's listing (`GET /navigation/{g}`): artifacts-section folders and the files. */
export function filesTreeFromListing(folders: readonly unknown[], artifacts: readonly unknown[]): FilesTreeView {
  const entries: FilesTreeEntry[] = []
  const sorted = (rows: readonly unknown[]) => rows.map(rec).filter((r): r is Record<string, unknown> => !!r && typeof r.id === 'string')
    .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
  for (const f of sorted(folders)) {
    if (f.section !== 'artifacts') continue
    entries.push({ kind: 'folder', id: String(f.id), label: String(f.label ?? f.name ?? f.id), parentId: typeof f.parentId === 'string' ? f.parentId : null })
  }
  for (const a of sorted(artifacts)) {
    if (typeof a.ingestedDocId === 'string' && a.ingestedDocId) continue
    entries.push({ kind: 'artifact', id: String(a.id), label: String(a.label ?? a.id), parentId: typeof a.parentId === 'string' ? a.parentId : null,
      mimeType: typeof a.mimeType === 'string' ? a.mimeType : null, fileType: typeof a.fileType === 'string' ? a.fileType : null })
  }
  return treeOf(entries)
}

/** From the shell's sidebar sections: the one tree (and the two legacy sections, when a host still builds them). */
export function filesTreeFromSections(sections: readonly FilePaneSection[]): FilesTreeView {
  const entries: FilesTreeEntry[] = []
  const visit = (nodes: readonly FilePaneNode[], parentId: string | null) => {
    for (const node of nodes) {
      if (node.kind === 'folder') {
        entries.push({ kind: 'folder', id: node.id, label: node.label, parentId, section: node.section === 'artifacts' ? 'artifacts' : 'documents' })
        visit(node.children ?? [], node.id)
      } else if (node.kind === 'artifact') {
        entries.push({ kind: 'artifact', id: node.id, label: node.label, parentId,
          mimeType: (node as { mimeType?: string | null }).mimeType ?? null, fileType: (node as { fileType?: string | null }).fileType ?? null })
      } else if (node.kind === 'document' || node.kind === undefined) {
        entries.push({ kind: 'document', id: node.id, label: node.label, parentId })
      }
    }
  }
  for (const section of sections) if (section.id === 'tree' || section.id === 'documents' || section.id === 'artifacts') visit(section.nodes ?? [], null)
  return treeOf(entries)
}

export interface FilesCommandResult {
  readonly ok: boolean
  /** One sentence for the status line; empty when nothing happened worth saying. */
  readonly message: string
  /** The label of the Undo the announcement carries, or null when this change cannot be undone. */
  readonly undo: string | null
}

interface JournalEntry {
  readonly message: string
  /** Applies the inverse; resolves to a refusal sentence when the inverse would be wrong now, else null. */
  readonly undo: () => Promise<string | null>
  readonly redo: () => Promise<string | null>
}

export interface FilesCommandsDeps {
  readonly client: FilesClient
  readonly graphId: string
  /** The tree as the shell currently sees it. */
  readonly tree: () => FilesTreeView
  /** Re-read the listing; resolves once `tree()` reflects the cell. */
  readonly refresh: () => Promise<void>
  readonly maxUploadBytes: number
  /** What the cell can do in the one tree; read at the moment a command runs (the advert may arrive late). */
  readonly support?: () => PlaceSupport
  readonly newId?: (kind: 'folder' | 'file') => string
  readonly onProgress?: (message: string) => void
}

const quote = (label: string) => `“${label}”`
const reason = (error: unknown) => error instanceof Error ? error.message : String(error)
const items = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`

function defaultId(kind: 'folder' | 'file'): string {
  return `${kind}-${randomUUID().replace(/-/g, '')}`
}

export class FilesCommands {
  private readonly done: JournalEntry[] = []
  private readonly undone: JournalEntry[] = []
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly deps: FilesCommandsDeps) {}

  get canUndo(): boolean { return this.done.length > 0 }
  get canRedo(): boolean { return this.undone.length > 0 }

  private get g(): string { return this.deps.graphId }
  private get client(): FilesClient { return this.deps.client }
  private tree(): FilesTreeView { return this.deps.tree() }
  private id(kind: 'folder' | 'file'): string { return (this.deps.newId ?? defaultId)(kind) }

  /** Commands run one at a time, in the order they were asked for. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work)
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }

  private record(entry: JournalEntry): FilesCommandResult {
    this.done.push(entry)
    this.undone.length = 0
    return { ok: true, message: entry.message, undo: 'Undo' }
  }

  private async refreshQuietly(): Promise<void> {
    try { await this.deps.refresh() } catch { /* the next read shows the truth */ }
  }

  private support(): PlaceSupport { return this.deps.support?.() ?? { anyFolder: false, documentTrash: false } }

  /**
   * The one tree needs the cell to let a file live in any folder. Until it says so (`anyFolder`), a file may not go into a folder born
   * among documents, nor a document into one born among files: said in a sentence, before anything is sent.
   */
  private moveRefusal(entry: FilesTreeEntry, folderId: string | null): string | null {
    if (folderId === null || this.support().anyFolder || entry.kind === 'folder') return null
    const dest = this.tree().get('folder', folderId)
    if (!dest) return null
    if (entry.kind === 'artifact' && dest.section === 'documents') {
      return `${quote(entry.label)} can't go into ${quote(dest.label)} yet: this workspace's cell still keeps files and documents in separate folders. It will work once the cell is updated.`
    }
    if (entry.kind === 'document' && dest.section === 'artifacts') {
      return `${quote(entry.label)} can't go into ${quote(dest.label)} yet: this workspace's cell still keeps documents and files in separate folders. It will work once the cell is updated.`
    }
    return null
  }

  /** The sentence a move is refused with before anything is sent, or null. */
  refusalForMove(kind: FilesEntryKind, id: string, folderId: string | null): string | null {
    const entry = this.tree().get(kind, id)
    return entry ? this.moveRefusal(entry, folderId) : null
  }

  private trashRefusal(entries: readonly FilesTreeEntry[]): string | null {
    if (this.support().documentTrash) return null
    const doc = entries.find(e => e.kind === 'document')
    return doc ? `${quote(doc.label)} can't go to the trash yet: this workspace's cell deletes documents for good, so nothing was removed. It will work once the cell is updated.` : null
  }

  private folderLabel(folderId: string | null): string {
    return folderId === null ? 'Files' : quote(this.tree().get('folder', folderId)?.label ?? 'the folder')
  }

  /** Selected entries without those already inside another selected folder. */
  private roots(targets: readonly { kind: FilesEntryKind; id: string }[]): FilesTreeEntry[] {
    const tree = this.tree()
    const entries = targets.map(t => tree.get(t.kind, t.id)).filter((e): e is FilesTreeEntry => e !== null)
    const selectedFolders = new Set(entries.filter(e => e.kind === 'folder').map(e => e.id))
    const seen = new Set<string>()
    return entries.filter(entry => {
      const key = `${entry.kind}:${entry.id}`
      if (seen.has(key)) return false
      seen.add(key)
      let parent = entry.parentId
      while (parent !== null) {
        if (selectedFolders.has(parent)) return false
        parent = tree.get('folder', parent)?.parentId ?? null
      }
      return true
    })
  }

  // --- rename ---------------------------------------------------------------------------------------------------------

  rename(target: { kind: FilesEntryKind; id: string }, name: string): Promise<FilesCommandResult> {
    return this.serial(async () => {
      const next = name.trim()
      if (!next) return { ok: false, message: 'A name cannot be empty.', undo: null }
      const entry = this.tree().get(target.kind, target.id)
      if (!entry) return { ok: false, message: 'That file is no longer here.', undo: null }
      if (entry.label === next) return { ok: true, message: '', undo: null }
      const apply = async (label: string) => {
        if (entry.kind === 'artifact') await this.client.update(this.g, entry.id, { label })
        else if (entry.kind === 'document') await this.client.renameDocument(this.g, entry.id, label)
        else await this.client.renameFolder(this.g, entry.id, label)
        await this.refreshQuietly()
      }
      try { await apply(next) } catch (error) {
        await this.refreshQuietly()
        return { ok: false, message: `Couldn't rename ${quote(entry.label)}: ${reason(error)}`, undo: null }
      }
      const guard = (label: string) => this.tree().get(entry.kind, entry.id) ? null : `Can't undo: ${quote(label)} is no longer here.`
      return this.record({
        message: `Renamed ${quote(entry.label)} to ${quote(next)}.`,
        undo: async () => guard(next) ?? (await apply(entry.label), null),
        redo: async () => guard(entry.label) ?? (await apply(next), null),
      })
    })
  }

  // --- move -----------------------------------------------------------------------------------------------------------

  move(targets: readonly { kind: FilesEntryKind; id: string }[], folderId: string | null): Promise<FilesCommandResult> {
    return this.serial(async () => {
      const tree = this.tree()
      if (targets.some(t => !tree.get(t.kind, t.id))) return { ok: false, message: 'The selection has changed. Select the files again.', undo: null }
      if (folderId !== null && !tree.get('folder', folderId)) return { ok: false, message: 'That folder is no longer available.', undo: null }
      const roots = this.roots(targets)
      for (const entry of roots) {
        if (entry.kind !== 'folder') continue
        let at: string | null = folderId
        while (at !== null) {
          if (at === entry.id) return { ok: false, message: 'A folder cannot be moved inside itself.', undo: null }
          at = tree.get('folder', at)?.parentId ?? null
        }
      }
      const moving = roots.filter(entry => entry.parentId !== folderId)
      if (!moving.length) return { ok: true, message: '', undo: null }
      for (const entry of moving) {
        const refusal = this.moveRefusal(entry, folderId)
        if (refusal) return { ok: false, message: refusal, undo: null }
      }
      const destination = this.folderLabel(folderId)
      const place = async (entry: FilesTreeEntry, parentId: string | null) => {
        if (entry.kind === 'artifact') await this.client.update(this.g, entry.id, { parentId })
        else if (entry.kind === 'document') await this.client.moveDocument(this.g, entry.id, parentId)
        else await this.client.moveFolder(this.g, entry.id, parentId)
      }
      const moved: FilesTreeEntry[] = []
      try {
        for (const entry of moving) { await place(entry, folderId); moved.push(entry) }
      } catch (error) {
        await this.refreshQuietly()
        return { ok: false, message: `Couldn't move ${moved.length ? `everything (${items(moved.length)} moved)` : quote(moving[0]!.label)}: ${reason(error)}`,
          undo: null }
      }
      await this.refreshQuietly()
      const message = moved.length === 1 ? `Moved ${quote(moved[0]!.label)} to ${destination}.` : `Moved ${items(moved.length)} to ${destination}.`
      const restore = async (to: (entry: FilesTreeEntry) => string | null): Promise<string | null> => {
        const now = this.tree()
        for (const entry of moved) {
          if (!now.get(entry.kind, entry.id)) return `Can't undo: ${quote(entry.label)} is no longer here.`
          const parent = to(entry)
          if (parent !== null && !now.get('folder', parent)) return `Can't undo: the folder ${quote(entry.label)} came from is no longer here.`
        }
        for (const entry of moved) await place(entry, to(entry))
        await this.refreshQuietly()
        return null
      }
      return this.record({ message, undo: () => restore(entry => entry.parentId), redo: () => restore(() => folderId) })
    })
  }

  // --- remove (recoverable) -----------------------------------------------------------------------------------------

  remove(targets: readonly { kind: FilesEntryKind; id: string }[]): Promise<FilesCommandResult> {
    return this.serial(async () => {
      const roots = this.roots(targets)
      if (!roots.length) return { ok: false, message: 'The selection has changed. Select the files again.', undo: null }
      {
        // Everything that would go (a folder takes what it holds) must be able to go to the trash, or nothing goes.
        const tree = this.tree()
        const all: FilesTreeEntry[] = []
        const walk = (entry: FilesTreeEntry) => { all.push(entry); if (entry.kind === 'folder') for (const child of tree.children(entry.id)) walk(child) }
        roots.forEach(walk)
        const refusal = this.trashRefusal(all)
        if (refusal) return { ok: false, message: refusal, undo: null }
      }
      let removed: Removal = { folders: [], files: [] }
      try { await this.removeNow(roots, removed) } catch (error) {
        await this.refreshQuietly()
        const refusal = `Couldn't move everything to the trash: ${reason(error).replace(/[.\s]+$/, '')}.`
        if (!removed.files.length && !removed.folders.length) return { ok: false, message: refusal, undo: null }
        // What already happened stays recoverable: it is said, and the announcement carries its Undo.
        const kept = removed.files.length === 1 ? `${quote(removed.files[0]!.label)} was moved to the trash; Undo brings it back.`
          : removed.files.length ? `${removed.files.length} files were moved to the trash; Undo brings them back.`
          : 'The empty folders inside it were removed; Undo brings them back.'
        const partial = removed
        this.done.push({
          message: `Moved part of the selection to the trash.`,
          undo: async () => { await this.restoreNow(partial); await this.refreshQuietly(); return null },
          redo: async () => {
            const again: Removal = { folders: [], files: [] }
            try { await this.removeNow(partial.files, again) } finally { await this.refreshQuietly() }
            return null
          },
        })
        this.undone.length = 0
        return { ok: false, message: `${refusal} ${kept}`, undo: 'Undo' }
      }
      await this.refreshQuietly()
      const one = roots.length === 1 ? roots[0]! : null
      const files = removed.files.length
      const message = !one ? `Moved ${items(roots.length)} to the trash.`
        : one.kind !== 'folder' ? `Moved ${quote(one.label)} to the trash.`
        : files === 0 ? `Moved ${quote(one.label)} to the trash.`
        : `Moved ${quote(one.label)} and the ${files === 1 ? 'file' : `${files} files`} in it to the trash.`
      const ids = roots.map(r => ({ kind: r.kind, id: r.id }))
      return this.record({
        message,
        undo: async () => { await this.restoreNow(removed); await this.refreshQuietly(); return null },
        redo: async () => {
          const again = this.roots(ids)
          if (!again.length) return `Can't redo: ${quote(roots[0]!.label)} is no longer here.`
          removed = { folders: [], files: [] }
          try { await this.removeNow(again, removed) } finally { await this.refreshQuietly() }
          return null
        },
      })
    })
  }

  /** Trashes files and deletes the emptied folders, recording each step in `removal` as it lands (so a refusal midway
   *  still knows what to restore). */
  private async removeNow(roots: readonly FilesTreeEntry[], removal: Removal): Promise<void> {
    const tree = this.tree()
    const folders: FilesTreeEntry[] = []
    const files: FilesTreeEntry[] = []
    const walk = (folder: FilesTreeEntry) => {
      folders.push(folder)
      for (const child of tree.children(folder.id)) {
        if (child.kind === 'folder') walk(child)
        else files.push(child)
      }
    }
    for (const root of roots) {
      if (root.kind === 'folder') walk(root)
      else files.push(root)
    }
    for (const file of files) {
      if (file.kind === 'document') await this.client.trashDocument(this.g, file.id)
      else await this.client.trash(this.g, file.id)
      removal.files.push(file)
    }
    // Children before their parents, so every delete meets an empty folder: never a cascade.
    for (const folder of [...folders].reverse()) { await this.client.deleteFolder(this.g, folder.id); removal.folders.unshift(folder) }
  }

  private async restoreNow(removal: Removal): Promise<void> {
    // Parents before children, with their own ids, so each restored file finds the folder it left.
    // Tolerant of what someone else already did: a folder that is back is not created twice, and a file no longer in
    // the trash (restored elsewhere) is left where it is; the refreshed tree shows the truth.
    const known = new Set<string>()
    for (const folder of removal.folders) {
      if (this.tree().get('folder', folder.id)) { known.add(folder.id); continue }
      const parent = folder.parentId !== null && (known.has(folder.parentId) || this.tree().get('folder', folder.parentId)) ? folder.parentId : null
      await this.client.createFolder(this.g, { folderId: folder.id, name: folder.label, parentId: parent })
      known.add(folder.id)
    }
    for (const file of removal.files) {
      try { if (file.kind === 'document') await this.client.restoreDocument(this.g, file.id); else await this.client.restore(this.g, file.id) } catch (error) {
        if (error instanceof FilesContractError && error.code === 'not_in_trash') continue
        throw error
      }
    }
  }

  // --- create folder ----------------------------------------------------------------------------------------------

  createFolder(name: string, parentId: string | null): Promise<FilesCommandResult & { readonly folderId?: string }> {
    return this.serial(async () => {
      const label = name.trim()
      if (!label) return { ok: false, message: 'A name cannot be empty.', undo: null }
      if (parentId !== null && !this.tree().get('folder', parentId)) return { ok: false, message: 'That folder is no longer available.', undo: null }
      const folderId = this.id('folder')
      // A folder made inside another is born in the same section: the fence of an older cell is about sections, not about this shell.
      const section = parentId !== null ? this.tree().get('folder', parentId)?.section : undefined
      try { await this.client.createFolder(this.g, { folderId, name: label, parentId, ...(section ? { section } : {}) }) } catch (error) {
        return { ok: false, message: `Couldn't create ${quote(label)}: ${reason(error)}`, undo: null }
      }
      await this.refreshQuietly()
      return { ...this.record({
        message: `Created ${quote(label)}.`,
        undo: async () => {
          const now = this.tree()
          if (!now.get('folder', folderId)) return null
          if (now.children(folderId).length) return `Can't undo: ${quote(label)} is no longer empty.`
          await this.client.deleteFolder(this.g, folderId)
          await this.refreshQuietly()
          return null
        },
        redo: async () => {
          await this.client.createFolder(this.g, { folderId, name: label, parentId: parentId !== null && this.tree().get('folder', parentId) ? parentId : null })
          await this.refreshQuietly()
          return null
        },
      }), folderId }
    })
  }

  // --- upload -----------------------------------------------------------------------------------------------------

  upload(files: ArrayLike<File>, folderId: string | null): Promise<FilesCommandResult & { readonly uploaded: readonly FilesArtifact[] }> {
    return this.serial(async () => {
      const plan = planUploads(files, this.deps.maxUploadBytes)
      const refusals = plan.refused.map(r => r.message)
      if (folderId !== null && !this.tree().get('folder', folderId) && plan.accepted.length) {
        return { ok: false, message: 'That folder is no longer available.', undo: null, uploaded: [] }
      }
      const uploaded: FilesArtifact[] = []
      for (const [index, file] of plan.accepted.entries()) {
        if (plan.accepted.length > 1) this.deps.onProgress?.(`Uploading ${index + 1} of ${plan.accepted.length}: ${quote(file.name)}…`)
        else this.deps.onProgress?.(`Uploading ${quote(file.name)}…`)
        try {
          uploaded.push(await this.client.upload(this.g, file, { parentId: folderId, artifactId: this.id('file') }))
        } catch (error) {
          refusals.push(error instanceof FilesContractError && error.code === 'file_too_large'
            ? `${quote(file.name)} is ${formatFileSize(file.size)}, over the cell's limit for one file. It was not uploaded.`
            : `${quote(file.name)} could not be uploaded: ${reason(error)}`)
        }
      }
      if (uploaded.length) await this.refreshQuietly()
      const said = uploaded.length === 1 ? `Uploaded ${quote(uploaded[0]!.label)}.` : uploaded.length ? `Uploaded ${uploaded.length} files.` : ''
      const message = [said, ...refusals].filter(Boolean).join(' ')
      if (!uploaded.length) return { ok: false, message, undo: null, uploaded }
      const result = this.record({
        message: said,
        undo: async () => {
          for (const file of uploaded) if (this.tree().get('artifact', file.id)) await this.client.trash(this.g, file.id)
          await this.refreshQuietly()
          return null
        },
        redo: async () => {
          for (const file of uploaded) await this.client.restore(this.g, file.id)
          await this.refreshQuietly()
          return null
        },
      })
      return { ...result, message, uploaded }
    })
  }

  // --- undo / redo --------------------------------------------------------------------------------------------------

  undo(): Promise<FilesCommandResult> {
    return this.serial(async () => {
      const entry = this.done.pop()
      if (!entry) return { ok: false, message: 'Nothing to undo.', undo: null }
      try {
        const refused = await entry.undo()
        if (refused) { this.done.push(entry); return { ok: false, message: refused, undo: null } }
      } catch (error) {
        this.done.push(entry)
        await this.refreshQuietly()
        return { ok: false, message: `Can't undo: ${reason(error)}`, undo: null }
      }
      this.undone.push(entry)
      return { ok: true, message: `Undid: ${entry.message}`, undo: null }
    })
  }

  redo(): Promise<FilesCommandResult> {
    return this.serial(async () => {
      const entry = this.undone.pop()
      if (!entry) return { ok: false, message: 'Nothing to redo.', undo: null }
      try {
        const refused = await entry.redo()
        if (refused) { this.undone.push(entry); return { ok: false, message: refused, undo: null } }
      } catch (error) {
        this.undone.push(entry)
        await this.refreshQuietly()
        return { ok: false, message: `Can't redo: ${reason(error)}`, undo: null }
      }
      this.done.push(entry)
      return { ok: true, message: `Redid: ${entry.message}`, undo: 'Undo' }
    })
  }
}

interface Removal {
  /** Parents before children. */
  folders: FilesTreeEntry[]
  files: FilesTreeEntry[]
}
