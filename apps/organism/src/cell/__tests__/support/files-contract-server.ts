/**
 * An in-process HTTP server that speaks CONTRACT-files v1 (kept outside this repository):
 * capabilities, the navigation listing, the no-parse multipart upload with the 50 MiB cap, download, PATCH rename/move,
 * the trash (DELETE, list, restore), file-views read, and the MCP tools the Files pane uses (create_folder, rename,
 * move_folder, delete, source_push).
 *
 * It exists because no gardend with the Files contract can run on this laptop (no local cargo builds). It is not a
 * mock of the shell: the shell's real client speaks real HTTP to it, and every rule it enforces is a rule of the
 * contract, quoted where it matters. Where the real cell and this server could differ, the Playwright witness against
 * a real cell is the judge (apps/organism/scripts/files-rudiments-witness.mts, "verification at integration").
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'

/** The cell's built-in wire predicates (garden src-tauri/src/wire_predicates.rs). */
const BUILTIN_PREDICATES: readonly (readonly [string, string, string])[] = [
  ['isWiredTo', 'is wired to', ''], ['partOf', 'is part of', 'Quantity'], ['contains', 'contains', 'Quantity'], ['exemplifies', 'is an example of', 'Quantity'],
  ['supports', 'supports', 'Quality'], ['contradicts', 'contradicts', 'Quality'], ['qualifies', 'qualifies', 'Quality'], ['causeOf', 'causes', 'Relation'],
  ['consequenceOf', 'is consequence of', 'Relation'], ['relatedTo', 'is related to', 'Relation'], ['requires', 'requires', 'Modality'],
  ['enables', 'enables', 'Modality'], ['precedes', 'precedes', 'Modality'],
]
function humanizePredicate(name: string): string {
  return BUILTIN_PREDICATES.find(b => b[0] === name)?.[1] ?? name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').toLowerCase()
}

export const CONTRACT_MAX_UPLOAD_BYTES = 52_428_800

export interface ServedDocument { id: string; title: string; parentId: string | null; order: number }
export interface ServedFolder { id: string; name: string; parentId: string | null; section: 'documents' | 'artifacts'; order: number }
export interface ServedArtifact {
  entityType: 'artifact'; id: string; graphId: string; label: string; parentId: string | null; order: number; fileType: string
  status: 'ready'; errorMessage: null; storageKey: string; originalFilename: string; mimeType: string; sizeBytes: number
  ingestedDocId: null; createdAt: string; updatedAt: string
}
interface Stored { value: ServedArtifact; bytes: Uint8Array; sha256: string }
interface Face {
  objectKey: string; vocab: string; class: string; objectId: string; sourceVersion: string; record: Record<string, unknown>
  reconciliationStrategy: 'contested'; operationId: string; conflictId?: string
}

/**
 * A datasheet the reader has read, as the importer's light records state it (plans/2026-10-08-datasheets-in-sophia.md §2). The server
 * answers the shell's batched `sparql_query` for these artifacts with the rows of that query's shape: this is a fixture of the
 * records, not a SPARQL engine.
 */
export interface ServedDatasheet {
  part: string; maker: string; rev?: string; productType: string; rowCount: number; toCheck?: number; scan?: boolean; textOnly?: boolean
  state?: 'queued' | 'reading' | 'read' | 'failed'; page?: number; pages?: number; error?: string
  /** The import record's tool profile: 'datasheet-parser (NomDeTom)', 'ee680a6...', '2.135.0'; and the register count. */
  reader?: { tool: string; commit?: string; docling?: string }; registerCount?: number
  params: { pred: string; lo?: number; hi?: number; typ?: number; nom?: number; unit?: string; text?: string
    conf?: 'high' | 'medium' | 'low' | 'contested'; diag?: string; checked?: boolean; order?: number }[]
}
const XSD = 'http://www.w3.org/2001/XMLSchema#'
const DSP = 'https://sophia-labs.ai/ontology/datasheet-parser#'
const EP = 'https://sophia-labs.ai/ontology/engineering-parameters#'
const lit = (v: string) => JSON.stringify(v)
const dec = (n: number) => `"${n}"^^<${XSD}decimal>`

export interface FilesContractServerOptions {
  /** Advertise `files` in /api/capabilities (false: a cell older than the contract, like 987ac57). */
  readonly advertise?: boolean
  readonly maxUploadBytes?: number
  readonly graphId?: string
  readonly graphIncarnation?: string
  readonly token?: string
  /** Answer the file-views read with a 500 (a cell whose preference projection is broken). */
  readonly failFileViews?: boolean
  /** Accept preference writes without saying their outcome yet (status `accepted`); the faces are readable at once. */
  readonly deferWrites?: boolean
  /** The one-tree additions (plans/2026-10-08-one-tree.md). A cell without them keeps the section fence and has no document trash. */
  readonly anyFolder?: boolean
  readonly documentTrash?: boolean
  /** The cell does not list a purge route (Delete forever absent). */
  readonly withoutPurge?: boolean
  /** The preferences record is full (CONTRACT §7.1): source_push fails with JSON-RPC error data.code `source_bundle_too_large`. */
  readonly recordFull?: boolean
}

export interface FilesContractServer {
  readonly base: string
  readonly graphId: string
  readonly graphIncarnation: string
  readonly token: string
  readonly folders: Map<string, ServedFolder>
  readonly artifacts: Map<string, Stored>
  readonly documents: Map<string, ServedDocument>
  readonly documentTrash: Map<string, ServedDocument & { trashedAt: string }>
  readonly trash: Map<string, Stored & { trashedAt: string }>
  readonly faces: Map<string, Face>
  /** Datasheets the reader has read, by artifact id: the records the shell's batched evidence query finds. */
  readonly datasheets: Map<string, ServedDatasheet>
  /** `datasheet_facts` answers by artifact id: verbatim captures from production (the tool's JSON), served as they came. */
  readonly datasheetFacts: Map<string, unknown>
  /** What the Show info panel reads beyond the listing: an artifact's revision count, a document's words and last edit, who made an item. */
  readonly revisionCounts: Map<string, number>
  readonly documentFacts: Map<string, { words: number; updatedAt: string; createdAt: string }>
  readonly createdBy: Map<string, string>
  /** Raw rows of the evidence query by artifact id (N-Triples terms, kind-prefixed variables): for a kind that is not a datasheet. */
  readonly evidenceRows: Map<string, Record<string, string>[]>
  readonly wires: Map<string, { id: string; sourceDocumentId: string; targetDocumentId: string; targetGraphId: string; predicate: string; bidirectional: boolean }>
  /** Every request the server saw: method, path (with query), and for /mcp the tool name. */
  readonly requests: { method: string; path: string; tool?: string; bytes?: number }[]
  revision: number
  /** Live switches of the options of the same names. */
  failFileViews: boolean
  deferWrites: boolean
  recordFull: boolean
  close(): Promise<void>
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text), ...headers })
  res.end(text)
}
function fail(res: ServerResponse, status: number, code: string, error: string, extra: Record<string, unknown> = {}): void {
  send(res, status, { ok: false, error, code, ...extra })
}
async function body(req: IncomingMessage, limit = Infinity): Promise<Buffer | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) return null
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}
const fileTypeOf = (name: string) => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : 'unknown' }
const ID = /^[A-Za-z0-9_-]+$/

export async function startFilesContractServer(options: FilesContractServerOptions = {}): Promise<FilesContractServer> {
  const graphId = options.graphId ?? 'files-graph'
  const graphIncarnation = options.graphIncarnation ?? 'inc-0001'
  const token = options.token ?? 'test-bearer'
  const max = options.maxUploadBytes ?? CONTRACT_MAX_UPLOAD_BYTES
  const folders = new Map<string, ServedFolder>()
  const artifacts = new Map<string, Stored>()
  const trash = new Map<string, Stored & { trashedAt: string }>()
  const documents = new Map<string, ServedDocument>()
  const documentTrash = new Map<string, ServedDocument & { trashedAt: string }>()
  const faces = new Map<string, Face>()
  const datasheets = new Map<string, ServedDatasheet>()
  const datasheetFacts = new Map<string, unknown>()
  const revisionCounts = new Map<string, number>()
  const documentFacts = new Map<string, { words: number; updatedAt: string; createdAt: string }>()
  const createdBy = new Map<string, string>()
  const evidenceRows = new Map<string, Record<string, string>[]>()
  // The graph's wires, as the cell's tools answer them (get_wires / create_wires / list_wire_predicates / delete type 'wires').
  const wires = new Map<string, { id: string; sourceDocumentId: string; targetDocumentId: string; targetGraphId: string; predicate: string; bidirectional: boolean }>()
  const requests: FilesContractServer['requests'] = []
  let order = 1
  const state = { revision: 0, failFileViews: options.failFileViews === true, deferWrites: options.deferWrites === true,
    recordFull: options.recordFull === true }

  // The section fence: until the cell lifts it (`anyFolder`), a file lives only in a folder born among files.
  const isFilesFolder = (id: string | null) => id === null || (options.anyFolder === true ? folders.has(id) : folders.get(id)?.section === 'artifacts')

  async function mcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = await body(req)
    const rpc = JSON.parse(raw!.toString('utf8')) as { id: unknown; params: { name: string; arguments: Record<string, unknown> } }
    const { name, arguments: args } = rpc.params
    requests[requests.length - 1]!.tool = name
    const reply = (value: unknown) => send(res, 200, { jsonrpc: '2.0', id: rpc.id, result: { content: [{ type: 'text', text: JSON.stringify(value) }] } })
    const error = (message: string) => send(res, 200, { jsonrpc: '2.0', id: rpc.id, result: { isError: true, content: [{ type: 'text', text: message }] } })
    if (args.graphId !== graphId) return error(`unknown graph ${String(args.graphId)}`)
    switch (name) {
      case 'sparql_query': {
        const query = String(args.query ?? '')
        const wanted = /VALUES\s+\?artifact\s*\{([^}]*)\}/.exec(query)?.[1]
        const ids = wanted ? [...wanted.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m => JSON.parse(`"${m[1]}"`) as string) : []
        const rows: Record<string, string>[] = []
        for (const id of ids) {
          const d = datasheets.get(id)
          if (!d) continue
          const k = (n: string) => `datasheet_${n}`
          const head: Record<string, string> = { artifact: lit(id), kind: lit('datasheet'), [k('title')]: lit(`${d.part} datasheet`), [k('part')]: lit(d.part), [k('maker')]: lit(d.maker),
            [k('productType')]: lit(d.productType), [k('rowCount')]: `"${d.rowCount}"^^<${XSD}integer>`, [k('toCheck')]: `"${d.toCheck ?? 0}"^^<${XSD}integer>`,
            ...(d.rev ? { [k('rev')]: lit(d.rev) } : {}),
            ...(d.reader ? { [k('readerTool')]: lit(d.reader.tool), ...(d.reader.commit ? { [k('readerCommit')]: lit(d.reader.commit) } : {}),
              ...(d.reader.docling ? { [k('doclingVersion')]: lit(d.reader.docling) } : {}) } : {}),
            ...(d.registerCount ? { [k('registerCount')]: `"${d.registerCount}"^^<${XSD}integer>` } : {}), ...(d.scan ? { [k('scan')]: `"true"^^<${XSD}boolean>` } : {}),
            ...(d.textOnly ? { [k('textOnly')]: `"true"^^<${XSD}boolean>` } : {}), ...(d.state ? { [k('state')]: lit(d.state) } : {}),
            ...(d.page ? { [k('page')]: `"${d.page}"^^<${XSD}integer>` } : {}), ...(d.pages ? { [k('pages')]: `"${d.pages}"^^<${XSD}integer>` } : {}),
            ...(d.error ? { [k('error')]: lit(d.error) } : {}) }
          if (!d.params.length) rows.push(head)
          d.params.forEach((p, i) => rows.push({ ...head, [k('pred')]: `<${EP}${p.pred}>`, [k('it')]: `<urn:item:${id}:${i}>`, [k('order')]: `"${p.order ?? i}"^^<${XSD}integer>`,
            ...(p.lo !== undefined ? { [k('lo')]: dec(p.lo) } : {}), ...(p.hi !== undefined ? { [k('hi')]: dec(p.hi) } : {}), ...(p.typ !== undefined ? { [k('typ')]: dec(p.typ) } : {}),
            ...(p.nom !== undefined ? { [k('nom')]: dec(p.nom) } : {}), ...(p.unit ? { [k('unitLex')]: lit(p.unit) } : {}), ...(p.text ? { [k('text')]: lit(p.text) } : {}),
            ...(p.conf ? { [k('conf')]: `<${DSP}${p.conf}>` } : {}), ...(p.diag ? { [k('diag')]: lit(p.diag) } : {}), ...(p.checked ? { [k('checked')]: `"true"^^<${XSD}boolean>` } : {}) }))
        }
        for (const id of ids) rows.push(...(evidenceRows.get(id) ?? []))
        return reply({ resultType: 'solutions', variables: [], rows, boolean: null, graph: null, quadCount: rows.length })
      }
      case 'datasheet_facts': {
        const id = String(args.artifact ?? args.artifactId ?? '')
        const facts = datasheetFacts.get(id)
        // A cell answers an artifact it has no reading of with no editions.
        return reply(facts ?? { graphId, query: { part: null, artifact: id, parameter: null }, matched: 0, editions: [] })
      }
      case 'list_artifact_revisions': {
        const id = String(args.artifactId ?? args.artifact_id)
        if (!artifacts.has(id)) return error('artifact not found')
        return reply({ revisions: Array.from({ length: revisionCounts.get(id) ?? 1 }, (_, i) => ({ id: `rev-${i + 1}` })) })
      }
      case 'document_digest': {
        const id = String(args.documentId)
        const facts = documentFacts.get(id)
        if (!documents.has(id)) return error('document not found')
        return reply({ size: { wordCount: facts?.words ?? 0, word_count: facts?.words ?? 0 }, freshness: { createdAt: facts?.createdAt ?? null, updatedAt: facts?.updatedAt ?? null } })
      }
      case 'create_folder': {
        const id = String(args.folderId)
        if (!ID.test(id)) return error('invalid folder id')
        const parentId = (args.parentId as string | null) ?? null
        if (parentId !== null && !folders.has(parentId)) return error('parent folder not found')
        folders.set(id, { id, name: String(args.name), parentId, section: args.section === 'artifacts' ? 'artifacts' : 'documents', order: order++ })
        return reply({ id, folderId: id })
      }
      case 'rename': {
        if (args.entityType === 'document') {
          const doc = documents.get(String(args.entityId))
          if (!doc) return error('document not found')
          doc.title = String(args.newName)
          return reply({ id: doc.id })
        }
        if (args.entityType !== 'folder') return error('only folders and documents here')
        const folder = folders.get(String(args.entityId))
        if (!folder) return error('folder not found')
        folder.name = String(args.newName)
        return reply({ id: folder.id })
      }
      case 'move_documents': {
        const ids = (args.documentIds as string[]) ?? []
        const parentId = (args.parentId as string | null) ?? null
        // The documents plane has its own fence: a document lives in a folder born among documents.
        if (parentId !== null && (!folders.has(parentId) || (options.anyFolder !== true && folders.get(parentId)!.section !== 'documents'))) return error('folder not found')
        const moved: string[] = [], missing: string[] = []
        for (const id of ids) { const doc = documents.get(id); if (doc) { doc.parentId = parentId; moved.push(id) } else missing.push(id) }
        return reply({ moved, missing, parentId })
      }
      case 'move_folder': {
        const folder = folders.get(String(args.folderId))
        const parentId = (args.newParentId as string | null) ?? null
        if (!folder || (parentId !== null && !folders.has(parentId))) return error('folder not found')
        folder.parentId = parentId
        return reply({ id: folder.id })
      }
      case 'create_wires': {
        const inputs = Array.isArray(args.wires) ? args.wires as Record<string, unknown>[] : [args]
        const made = inputs.map(w => {
          if (!w.sourceDocumentId || !w.targetDocumentId) return null
          const id = String(w.wireId ?? `w-${randomUUID().slice(0, 8)}`)
          const wire = { id, sourceDocumentId: String(w.sourceDocumentId), targetDocumentId: String(w.targetDocumentId),
            targetGraphId: String(w.targetGraphId ?? graphId), predicate: String(w.predicate ?? 'isWiredTo'), bidirectional: w.bidirectional === true }
          wires.set(id, wire)
          return wire
        })
        if (made.some(w => w === null)) return error('source_document_id is required')
        return reply({ success: true, graphId, wires: made, count: made.length })
      }
      case 'get_wires': {
        const doc = String(args.documentId ?? '')
        const direction = String(args.direction ?? 'both')
        const rows = [...wires.values()].filter(w => (direction !== 'incoming' && w.sourceDocumentId === doc) || (direction !== 'outgoing' && w.targetDocumentId === doc))
        return reply({ graph_id: graphId, document_id: doc, direction, count: rows.length,
          wires: rows.map(w => ({ ...w, sourceGraphId: graphId, predicateUri: `http://mnemosyne.ai/vocab#${w.predicate}`, predicateLabel: humanizePredicate(w.predicate) })) })
      }
      case 'list_wire_predicates': {
        const builtin = BUILTIN_PREDICATES.map(([name, label, category]) => ({ name, label, category: category || null }))
        const custom = [...new Set([...wires.values()].map(w => w.predicate))].filter(p => !BUILTIN_PREDICATES.some(b => b[0] === p))
          .map(name => ({ name, label: humanizePredicate(name), category: 'Custom' }))
        return reply({ graph_id: graphId, predicates: [...builtin, ...custom], count: builtin.length + custom.length })
      }
      case 'delete': {
        if (args.type === 'wires') return wires.delete(String(args.wireId)) ? reply({ deleted: String(args.wireId) }) : error('wire not found')
        const id = String(args.folderId)
        if (args.type !== 'folder' || !folders.has(id)) return error('folder not found')
        const occupied = [...folders.values()].some(f => f.parentId === id) || [...artifacts.values()].some(a => a.value.parentId === id)
        if (occupied && args.cascade !== true) return error('folder is not empty')
        folders.delete(id)
        return reply({ deleted: id })
      }
      case 'source_push': {
        if (args.graphIncarnation !== graphIncarnation) return error('stale_graph_incarnation')
        if (state.recordFull) {
          // As the cell's dispatcher answers a classified AppError: JSON-RPC -32000, the message verbatim, the code in `data`.
          return send(res, 200, { jsonrpc: '2.0', id: rpc.id, error: { code: -32000,
            message: "this graph's folder-view preferences have reached their 16777216-byte bound; the stored preferences are unchanged and this change was not stored",
            data: { code: 'source_bundle_too_large' } } })
        }
        state.revision += 1
        const receipts = (args.operations as Record<string, unknown>[]).map(op => {
          const objectId = String(op.objectId)
          const face = faces.get(objectId)
          const base = String(op.baseVersion)
          const sourceVersion = `sv-${state.revision}-${objectId.slice(0, 8)}`
          const operationId = String(op.operationId)
          if (face && face.operationId === operationId && JSON.stringify(face.record) === JSON.stringify(op.record)) {
            return { operationId, status: 'applied', acceptedRevision: state.revision, digest: 'd', outcome: { outcome: 'applied', sourceVersion: face.sourceVersion }, duplicate: true }
          }
          if ((face && face.sourceVersion !== base) || (!face && base !== 'root')) {
            const conflictId = `conflict-${objectId.slice(0, 8)}`
            if (face) face.conflictId = conflictId
            return { operationId, status: 'conflict', acceptedRevision: state.revision, digest: 'd', outcome: { outcome: 'conflict', conflictId }, duplicate: false }
          }
          faces.set(objectId, { objectKey: `${op.vocab}/${op.class}/${objectId}`, vocab: String(op.vocab), class: String(op.class), objectId,
            sourceVersion, record: op.record as Record<string, unknown>, reconciliationStrategy: 'contested', operationId })
          if (state.deferWrites) return { operationId, status: 'accepted', acceptedRevision: state.revision, digest: 'd', outcome: { outcome: 'accepted' }, duplicate: false }
          return { operationId, status: 'applied', acceptedRevision: state.revision, digest: 'd', outcome: { outcome: 'applied', sourceVersion }, duplicate: false }
        })
        return reply({ ok: true, graphId, graphIncarnation, revision: state.revision, receipts })
      }
      default: return error(`unknown tool ${name}`)
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://local')
    requests.push({ method: req.method ?? 'GET', path: url.pathname + url.search })
    if (req.headers.authorization !== `Bearer ${token}`) return fail(res, 401, 'unauthorized', 'Missing bearer')
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    const method = req.method ?? 'GET'
    if (method === 'GET' && url.pathname === '/api/capabilities') {
      return send(res, 200, { ok: true, version: 'test', ...(options.advertise === false ? {} : { files: {
        version: 1, maxUploadBytes: max, parsing: false,
        upload: 'POST /artifacts/{graph_id}/files', download: 'GET /artifacts/{graph_id}/{artifact_id}/download',
        update: 'PATCH /navigation/{graph_id}/artifacts/{artifact_id}', trash: 'DELETE /navigation/{graph_id}/artifacts/{artifact_id}',
        trashList: 'GET /navigation/{graph_id}/trash', restore: 'POST /navigation/{graph_id}/trash/{artifact_id}/restore',
        ...(options.withoutPurge ? {} : { purge: 'DELETE /navigation/{graph_id}/trash/{artifact_id}' }),
        ...(options.anyFolder ? { anyFolder: true } : {}), ...(options.documentTrash ? { documentTrash: true } : {}),
        folderViews: { vocab: 'garden-file-views', version: '1.0.0', read: 'GET /navigation/{graph_id}/file-views', write: 'mcp:source_push' },
      } }) })
    }
    if (method === 'POST' && url.pathname === '/mcp') return mcp(req, res)
    if (parts[1] !== undefined && parts[1] !== graphId && (parts[0] === 'navigation' || parts[0] === 'artifacts')) {
      return fail(res, 404, 'graph_not_found', 'No such graph')
    }
    // GET /navigation/{g}
    if (method === 'GET' && parts[0] === 'navigation' && parts.length === 2) {
      return send(res, 200, { graphId, documents: [...documents.values()].map(d => ({ entityType: 'document', id: d.id, label: d.title, title: d.title, parentId: d.parentId, order: d.order })),
        folders: [...folders.values()].map(f => ({ entityType: 'folder', id: f.id, label: f.name, name: f.name, parentId: f.parentId, section: f.section, order: f.order })),
        artifacts: [...artifacts.values()].map(a => ({ ...a.value, ...(createdBy.has(a.value.id) ? { createdByName: createdBy.get(a.value.id) } : {}) })) })
    }
    // POST /artifacts/{g}/files
    if (method === 'POST' && parts[0] === 'artifacts' && parts[2] === 'files' && parts.length === 3) {
      const raw = await body(req, max + 64 * 1024)
      if (raw === null) return fail(res, 413, 'file_too_large', 'File too large. Maximum size: 50MB', { maxBytes: max })
      const form = await new Request('http://local', { method: 'POST', headers: { 'content-type': String(req.headers['content-type']) }, body: new Uint8Array(raw) }).formData()
      const file = form.get('file')
      if (!(file instanceof Blob)) return fail(res, 400, 'missing_file', 'No file part')
      const bytes = new Uint8Array(await file.arrayBuffer())
      requests[requests.length - 1]!.bytes = bytes.byteLength
      if (bytes.byteLength > max) return fail(res, 413, 'file_too_large', 'File too large. Maximum size: 50MB', { maxBytes: max })
      if (bytes.byteLength === 0) return fail(res, 400, 'empty_file', 'The file is empty')
      const parentId = (form.get('parentId') as string | null) || null
      if (!isFilesFolder(parentId)) return fail(res, 404, 'folder_not_found', 'No such folder')
      const id = (form.get('artifactId') as string | null) || `file-${randomUUID().replace(/-/g, '')}`
      if (!ID.test(id)) return fail(res, 400, 'invalid_artifact_id', 'Invalid id')
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const existing = artifacts.get(id)
      if (existing) {
        if (existing.sha256 === sha256 && existing.bytes.byteLength === bytes.byteLength) return send(res, 200, { ...existing.value, sha256, replayed: true })
        return fail(res, 409, 'artifact_exists', 'That id names other bytes')
      }
      if (trash.has(id)) return fail(res, 409, 'artifact_exists', 'That id is in the trash')
      const filename = (file as File).name || 'file'
      const now = new Date().toISOString()
      const value: ServedArtifact = { entityType: 'artifact', id, graphId, label: (form.get('label') as string | null) || filename, parentId,
        order: order++, fileType: fileTypeOf(filename), status: 'ready', errorMessage: null, storageKey: `local://artifacts/${id}/original/${filename}`,
        originalFilename: filename, mimeType: file.type || 'application/octet-stream', sizeBytes: bytes.byteLength, ingestedDocId: null, createdAt: now, updatedAt: now }
      artifacts.set(id, { value, bytes, sha256 })
      return send(res, 201, { ...value, sha256, replayed: false })
    }
    // GET /artifacts/{g}/{id}/download
    if (method === 'GET' && parts[0] === 'artifacts' && parts[3] === 'download' && parts.length === 4) {
      const stored = artifacts.get(parts[2]!) ?? trash.get(parts[2]!)
      if (!stored) return fail(res, 404, 'artifact_not_found', 'No such file')
      const v = stored.value
      const inline = url.searchParams.get('inline') === '1' && (v.mimeType === 'application/pdf' || (v.mimeType.startsWith('image/') && v.mimeType !== 'image/svg+xml'))
      res.writeHead(200, { 'Content-Type': v.mimeType, 'Content-Length': stored.bytes.byteLength,
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${v.originalFilename}"`, 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': 'sandbox', 'Cache-Control': 'private, no-cache' })
      res.end(Buffer.from(stored.bytes))
      return
    }
    // DELETE /navigation/{g}/documents/{id}: a document to the Trash (only a cell with document trash has this route)
    if (method === 'DELETE' && parts[0] === 'navigation' && parts[2] === 'documents' && parts.length === 4) {
      if (options.documentTrash !== true) return fail(res, 404, 'not_found', `No route ${method} ${url.pathname}`)
      const doc = documents.get(parts[3]!)
      if (!doc) return fail(res, 404, 'document_not_found', 'No such document')
      documents.delete(doc.id)
      const trashedAt = new Date().toISOString()
      documentTrash.set(doc.id, { ...doc, trashedAt })
      return send(res, 200, { id: doc.id, documentId: doc.id, graphId, trashed: true, trashedAt })
    }
    // DELETE /navigation/{g}/trash/{id}?kind=: delete forever
    if (method === 'DELETE' && parts[0] === 'navigation' && parts[2] === 'trash' && parts.length === 4) {
      if (options.withoutPurge) return fail(res, 404, 'not_found', `No route ${method} ${url.pathname}`)
      const id = parts[3]!
      if (url.searchParams.get('kind') === 'document') {
        if (!documentTrash.delete(id)) return fail(res, 404, 'not_in_trash', 'Not in the trash')
      } else if (!trash.delete(id)) return fail(res, 404, 'not_in_trash', 'Not in the trash')
      return send(res, 200, { id, purged: true })
    }
    // PATCH / DELETE /navigation/{g}/artifacts/{id}
    if (parts[0] === 'navigation' && parts[2] === 'artifacts' && parts.length === 4) {
      const id = parts[3]!
      if (method === 'PATCH') {
        const stored = artifacts.get(id)
        if (!stored) return fail(res, 404, 'artifact_not_found', 'No such file')
        const patch = JSON.parse((await body(req))!.toString('utf8')) as Record<string, unknown>
        const known = ['label', 'parentId', 'order'].filter(k => k in patch)
        if (!known.length) return fail(res, 400, 'invalid_patch', 'Nothing to change')
        if ('label' in patch && (typeof patch.label !== 'string' || !patch.label.trim() || patch.label.trim().length > 512)) return fail(res, 400, 'invalid_patch', 'Bad label')
        if ('parentId' in patch && !isFilesFolder((patch.parentId as string | null) ?? null)) return fail(res, 404, 'folder_not_found', 'No such folder')
        stored.value = { ...stored.value, ...('label' in patch ? { label: String(patch.label).trim() } : {}),
          ...('parentId' in patch ? { parentId: (patch.parentId as string | null) ?? null } : {}),
          ...('order' in patch ? { order: Number(patch.order) } : {}), updatedAt: new Date().toISOString() }
        return send(res, 200, stored.value)
      }
      if (method === 'DELETE') {
        const stored = artifacts.get(id)
        const trashed = trash.get(id)
        if (trashed) return send(res, 200, { id, artifactId: id, graphId, status: 'trashed', trashed: true, trashedAt: trashed.trashedAt, alreadyTrashed: true })
        if (!stored) return fail(res, 404, 'artifact_not_found', 'No such file')
        artifacts.delete(id)
        const trashedAt = new Date().toISOString()
        trash.set(id, { ...stored, trashedAt })
        return send(res, 200, { id, artifactId: id, graphId, status: 'trashed', trashed: true, trashedAt })
      }
    }
    // GET /navigation/{g}/trash
    if (method === 'GET' && parts[0] === 'navigation' && parts[2] === 'trash' && parts.length === 3) {
      const items = [...trash.values()].reverse().map(t => ({ artifactId: t.value.id, label: t.value.label, originalFilename: t.value.originalFilename,
        mimeType: t.value.mimeType, sizeBytes: t.value.sizeBytes, fileType: t.value.fileType, parentId: t.value.parentId, trashedAt: t.trashedAt,
        kind: 'artifact' }))
      for (const d of documentTrash.values()) items.push({ artifactId: d.id, documentId: d.id, kind: 'document', label: d.title, title: d.title, originalFilename: d.title,
        mimeType: '', sizeBytes: null as never, fileType: 'document', parentId: d.parentId, trashedAt: d.trashedAt } as never)
      return send(res, 200, { graphId, items, count: items.length })
    }
    // POST /navigation/{g}/trash/{id}/restore
    if (method === 'POST' && parts[0] === 'navigation' && parts[2] === 'trash' && parts[4] === 'restore' && parts.length === 5) {
      if (url.searchParams.get('kind') === 'document') {
        const d = documentTrash.get(parts[3]!)
        if (!d) return fail(res, 404, 'not_in_trash', 'Not in the trash')
        documentTrash.delete(d.id)
        const parentId = d.parentId !== null && folders.has(d.parentId) ? d.parentId : null
        documents.set(d.id, { id: d.id, title: d.title, parentId, order: d.order })
        return send(res, 200, { id: d.id, restoredToParentId: parentId })
      }
      const t = trash.get(parts[3]!)
      if (!t) return fail(res, 404, 'not_in_trash', 'Not in the trash')
      trash.delete(t.value.id)
      // "If its folder still exists it goes back there, otherwise to the root."
      const parentId = t.value.parentId !== null && folders.has(t.value.parentId) ? t.value.parentId : null
      const value = { ...t.value, parentId, updatedAt: new Date().toISOString() }
      artifacts.set(value.id, { value, bytes: t.bytes, sha256: t.sha256 })
      return send(res, 200, { ...value, restoredToParentId: parentId })
    }
    // GET /navigation/{g}/file-views
    if (method === 'GET' && parts[0] === 'navigation' && parts[2] === 'file-views' && parts.length === 3) {
      if (state.failFileViews) return fail(res, 500, 'internal', 'The folder views could not be read')
      const folderKey = url.searchParams.get('folderKey')
      const currentState = [...faces.values()].filter(f => folderKey === null || f.record.folderKey === folderKey)
      return send(res, 200, { graphId, graphIncarnation, revision: state.revision, available: true,
        sourceRegistry: ['FilePlacement', 'FolderView'].map(c => ({ vocab: 'garden-file-views', class: c, sourceKind: 'current-state',
          storeTarget: 'projection:file-views', reconciliationStrategy: 'contested' })),
        currentState, conflicts: currentState.filter(f => f.conflictId) })
    }
    return fail(res, 404, 'not_found', `No route ${method} ${url.pathname}`)
  }

  const server = createServer((req, res) => { void handle(req, res).catch(error => fail(res, 500, 'internal', String(error))) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    base: `http://127.0.0.1:${port}`, graphId, graphIncarnation, token, folders, artifacts, documents, documentTrash, trash, faces, datasheets, datasheetFacts, revisionCounts, documentFacts, createdBy, evidenceRows, wires, requests,
    get revision() { return state.revision }, set revision(v: number) { state.revision = v },
    get failFileViews() { return state.failFileViews }, set failFileViews(v: boolean) { state.failFileViews = v },
    get deferWrites() { return state.deferWrites }, set deferWrites(v: boolean) { state.deferWrites = v },
    get recordFull() { return state.recordFull }, set recordFull(v: boolean) { state.recordFull = v },
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}

/** The shell's contract, as far as the Files client needs it: a bearer and the graph's base URL. */
export function contractFor(server: FilesContractServer) {
  return {
    auth: { token: () => server.token, userId: () => 'user-1', isAuthenticated: () => true, whenReady: async () => {}, onChange: () => () => {} },
    runtime: { mode: () => 'hosted' as const, isGateway: () => true, graphBaseUrl: () => server.base },
  }
}

/** An MCP client over the server's /mcp: JSON-RPC tools/call, as the shell's contract.mcp does it. */
export function mcpFor(server: FilesContractServer) {
  let id = 0
  return {
    async toolsCall(name: string, args: Record<string, unknown>): Promise<unknown> {
      const response = await fetch(`${server.base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${server.token}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }) })
      const json = await response.json() as { result?: { isError?: boolean; content: { text: string }[] }
        error?: { code: number; message: string; data?: unknown } }
      // A JSON-RPC error keeps its `data` (the cell's taxonomy code), as the shell's MCP clients (McpError, GatewayMcpError) do.
      if (json.error) throw Object.assign(new Error(json.error.message), { code: json.error.code, data: json.error.data })
      if (json.result!.isError) throw new Error(json.result!.content.map(c => c.text).join(''))
      return json.result
    },
  }
}
