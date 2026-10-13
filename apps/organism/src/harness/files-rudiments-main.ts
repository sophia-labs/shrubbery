/**
 * The Files rudiments in a real browser, composed the way the real shell composes them (main.ts's Files block):
 * FilesDiscovery for the capability and the incarnation, FilesShell for the pane, the sidebar's artifacts section as the
 * tree (called Files, with its Open Files action), the inspector, a dedicated mn-context-menu, and renderWorkspace on the
 * Surface path. The cell is a server that speaks CONTRACT-files v1 (the suites' contract server), reached same-origin
 * through the dev server's proxy at `?cell=/cell` (default). Driven by scripts/files-rudiments-browser.mts.
 */
import '@shrubbery/tokens/tokens.css'
import '@shrubbery/components'

import type { MnContextMenu } from '@shrubbery/components'
import { DEFAULT_FILE_PANE_GROUPING, GARDEN_DEFAULT, type FilePaneGrouping, type FilePaneSection, type ShrubberyContract } from '@shrubbery/nucleus'
import { renderWorkspace } from '@shrubbery/runtime'
import { FilesClient } from '../cell/files-contract.js'
import { houseEngine } from '@shrubbery/nucleus/files-canvas'
import { FilesShell, INFO_SHORTCUT } from '../cell/files-shell.js'
import { filesMenuPresenter } from '../cell/files-menu.js'
import { PHONE_BREAKPOINT_QUERY } from '../cell/phone-breakpoint.js'
import { FILES_SECTION_ACTION, FilesDiscovery, filesSidebarSections, parseEvidenceLink } from '../cell/files-route.js'
import { sidebarSectionsFromDocuments, type SidebarArtifact, type SidebarDocument, type SidebarFolder } from '../cell/sidebar-documents.js'
import { mountPlaceNotice } from '../cell/place-notice.js'

const params = new URLSearchParams(window.location.search)
const GRAPH = params.get('graph') ?? 'files-graph'
const TOKEN = params.get('token') ?? 'test-bearer'
const WRITABLE = params.get('writable') !== '0'
// Test-only: show the pane at phone width, to witness the reader's layout there (the shell hides Files on phones).
const FORCE_PANE = params.get('forcePane') === '1'
const base = `${window.location.origin}${params.get('cell') ?? '/cell'}`
const root = document.getElementById('files-harness-root') as HTMLElement

const contract = {
  auth: { token: () => TOKEN, userId: () => 'user-1', isAuthenticated: () => true, whenReady: async () => {}, onChange: () => () => {} },
  runtime: { mode: () => 'hosted' as const, isGateway: () => true, graphBaseUrl: () => base },
} as unknown as Pick<ShrubberyContract, 'auth' | 'runtime'>

let rpc = 0
const mcp = {
  async toolsCall(name: string, args: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpc, method: 'tools/call', params: { name, arguments: args } }) })
    const json = await response.json() as { result: { isError?: boolean; content: { text: string }[] } }
    if (json.result.isError) throw new Error(json.result.content.map(c => c.text).join(''))
    return json.result
  },
}

const client = new FilesClient(contract, mcp)
let sections: readonly FilePaneSection[] = []
let seeded = false
let scheduled = false
const schedule = () => {
  if (scheduled) return
  scheduled = true
  queueMicrotask(() => { scheduled = false; draw() })
}

async function refresh(): Promise<void> {
  const response = await fetch(`${base}/navigation/${encodeURIComponent(GRAPH)}`, { headers: { Authorization: `Bearer ${TOKEN}` }, cache: 'no-store' })
  const listing = await response.json() as { folders: Record<string, unknown>[]; artifacts: Record<string, unknown>[]; documents?: Record<string, unknown>[] }
  const folders: SidebarFolder[] = listing.folders.map(f => ({ id: String(f.id), label: String(f.label ?? f.name ?? f.id),
    parentId: typeof f.parentId === 'string' ? f.parentId : null, order: Number(f.order ?? 0), section: f.section === 'artifacts' ? 'artifacts' : 'documents' }))
  const artifacts: SidebarArtifact[] = listing.artifacts.map(a => ({ id: String(a.id), label: String(a.label), parentId: typeof a.parentId === 'string' ? a.parentId : null,
    order: Number(a.order ?? 0), mimeType: String(a.mimeType), status: String(a.status), fileType: String(a.fileType) }))
  const docs: SidebarDocument[] = (listing.documents ?? []).map(d => ({ id: String(d.id), label: String(d.label ?? d.title ?? d.id),
    parentId: typeof d.parentId === 'string' ? d.parentId : null, order: Number(d.order ?? 0), readOnly: false, sourceFile: null }))
  sections = sidebarSectionsFromDocuments(docs, null, [], folders, new Set(folders.map(f => f.id)), artifacts)
  bind()
  // `?connections=seed` draws a few connections between the files by name, once (the canvas browser script and the local view).
  if (params.get('connections') === 'seed' && !seeded && artifacts.length) {
    seeded = true
    const byLabel = new Map(artifacts.map(a => [a.label, a.id]))
    const rows = (params.get('seedRows') ?? 'Field notes.pdf>Kitchen plan.png>supports;Field notes.pdf>Budget 2026.xlsx>qualifies;Letter to Lucy.docx>Recording.m4a>contradicts')
      .split(';').flatMap(row => {
        const [a, b, predicate] = row.split('>')
        const source = byLabel.get(a ?? ''), target = byLabel.get(b ?? '')
        return source && target ? [{ source, target, predicate: predicate ?? 'relatedTo' }] : []
      })
    void shell.seedConnections(rows)
  }
  schedule()
}

// The way back to the place from a document, as the real shell offers it (cell/place-notice.ts).
const notice = mountPlaceNotice(document.body)
let placeReturn: { folderId: string | null; label: string } | null = null
let openedDocument: string | null = null
let grouping: FilePaneGrouping = { ...DEFAULT_FILE_PANE_GROUPING }

const menuEl = document.createElement('mn-context-menu') as MnContextMenu
document.body.appendChild(menuEl)
const showMenu = filesMenuPresenter(menuEl)

const phoneMedia = window.matchMedia(PHONE_BREAKPOINT_QUERY)
phoneMedia.addEventListener('change', () => schedule())
const discovery = new FilesDiscovery(schedule)
const shell = new FilesShell({
  client,
  refresh,
  onChange: schedule,
  menu: showMenu,
  // Test-only: ?engine=house pins the house engine (the default loads Excalidraw), to compare the two in the real pane.
  ...(params.get('engine') === 'house' ? { loadEngine: async () => ({ engine: houseEngine, kind: 'house' as const, reason: null }) } : {}),
  // Test-only stand-in for the editor: a document opened from the place hides the pane and offers the way back.
  openDocument: (documentId, place) => { openedDocument = documentId; placeReturn = place; shell.leave(); schedule() },
  canvasCommand: command => {
    const canvas = root.querySelector('mn-files-canvas') as (HTMLElement & { command?: (c: typeof command) => void }) | null
    canvas?.command?.(command)
  },
})

let handledLink = ''
function bind(): FilesShell {
  const state = discovery.state(client, GRAPH)
  const ready = state.status === 'ready' ? state : null
  shell.bind({ graphId: GRAPH, ownerId: 'owner-1', graphIncarnation: ready?.graphIncarnation ?? '', writable: WRITABLE,
    advert: ready?.advert ?? null, sections, phone: phoneMedia.matches && !FORCE_PANE })
  const link = parseEvidenceLink(window.location)
  if (link && shell.visible() && handledLink !== window.location.hash) { handledLink = window.location.hash; shell.openEvidence(link.artifactId, link.id) }
  return shell
}

function draw(): void {
  bind()
  const files = openedDocument ? null : shell.options()
  notice.back(openedDocument && placeReturn ? { label: placeReturn.label, onBack: () => {
    const target = placeReturn; openedDocument = null; placeReturn = null
    if (target) { shell.openFolder(target.folderId); schedule() }
  } } : null)
  const model = files ? shell.inspector() : null
  renderWorkspace(GARDEN_DEFAULT, {
    container: root,
    surface: true,
    // A narrow window: the tree and the margin give way to the page (design §12.1, below 760 px).
    ...(FORCE_PANE && window.innerWidth < 760 ? { leftCollapsed: true, rightCollapsed: true } : {}),
    ...(files ? { files } : {}),
    chrome: { rightPanel: 'inspector', rightPanels: ['inspector'] },
    inspector: { model, actions: [], info: shell.infoOpen ? {
      model: shell.infoModel(), onClose: () => shell.closeInfo(),
      onRename: detail => { void shell.infoRename(detail.name) }, onAction: detail => { void shell.infoAction(detail.action) },
    } : null },
    sidebar: {
      sections: filesSidebarSections(sections, shell.visible()),
      grouping,
      capabilities: { sort: true, group: true, contextMenu: true },
      // The tree's node menu, as main.ts's command menu has it: Show info for the node (or the several selected).
      onAction: detail => {
        if (detail.action !== 'node-menu') return
        const keys = (detail.nodes ?? (detail.node ? [detail.node] : [])).map(n => `${n.kind}:${n.id}`)
        showMenu({ items: [{ id: 'info', label: 'Show info', icon: 'info', shortcut: INFO_SHORTCUT }], x: detail.clientX ?? 240, y: detail.clientY ?? 120,
          onSelect: () => { shell.showInfo(keys) } })
      },
      onGroupingChange: detail => { grouping = detail.grouping; schedule() },
      onNodeOpen: detail => {
        if (!shell.visible()) return
        // One tree: opening any folder opens the place; a document opens in the editor (here a stand-in); a file in the reader page.
        if (detail.node.kind === 'folder') { openedDocument = null; shell.openFolder(detail.id) }
        else if (detail.node.kind === 'artifact') { openedDocument = null; shell.openFile(detail.id) }
        else if (detail.node.kind === 'document') { openedDocument = detail.id; placeReturn = null; shell.leave() }
        schedule()
      },
      onSectionAction: ({ sectionId, actionId }) => {
        if (sectionId === 'tree' && actionId === FILES_SECTION_ACTION) { openedDocument = null; shell.openFolder(null); schedule() }
      },
    },
  })
  const discovered = discovery.state(client, GRAPH)
  ;(window as unknown as { __filesHarness: unknown }).__filesHarness = {
    state: {
      ready: discovered.status !== 'loading',
      discovery: discovered.status,
      visible: shell.visible(),
      open: shell.isOpen,
      openedDocument,
      kind: grouping.kind ?? 'all',
      trash: files?.trash ? { status: files.trash.status, items: files.trash.items.map(i => ({ key: i.key, label: i.label, kind: i.kind, confirm: i.confirm })), canPurge: files.trash.canPurge, note: files.trash.note } : null,
      face: files?.face ?? null,
      breadcrumbs: files?.breadcrumbs.map(c => c.label) ?? [],
      status: files?.status ?? null,
      banner: files?.banner ?? null,
      preview: files?.preview ? { kind: files.preview.kind, assertions: files.preview.kind === 'pdf' ? files.preview.assertions?.length ?? null : null, status: files.preview.status, name: files.preview.name, error: files.preview.error,
        label: files.preview.kind === 'reader' ? files.preview.label : files.preview.kind === 'file' ? files.preview.typeLabel : null,
        variant: files.preview.kind === 'reader' ? files.preview.view?.variant ?? null : files.preview.kind === 'media' ? files.preview.media : null,
        source: files.preview.kind === 'reader' ? files.preview.source ?? null : null } : null,
      rows: files?.rows.map(r => ({ label: r.label, kind: r.kind, selected: r.selected, naming: r.naming ?? null })) ?? [],
      inspector: model?.identity.title ?? null,
    },
  }
}

// Test-only: open the pane when the tree (and its Open Files action) is collapsed away.
;(window as unknown as { __openFiles: () => void }).__openFiles = () => { shell.openFolder(null); schedule() }

void refresh().catch(error => {
  ;(window as unknown as { __filesHarness: unknown }).__filesHarness = { state: { ready: true, error: String(error) } }
})
