/**
 * main.ts — the SEELe workbench vessel's real entry point (W6.2/W6.8, under
 * the 2026-08-03 ratification's D17: **local-first**).
 *
 * D17, restated because it governs every choice below: v1 is a special Vite
 * shrubbery app over a LOCAL gardend cell — the spawn-gardend + Vite harness
 * pattern, promoted to a named app. The eventual path is proper Tauri
 * packaging into a native app. Canary/wasm hosting drops out of the near-term
 * sequencing entirely. So there is no gateway client here, no Cognito, no
 * deploy story: the browser talks to one local cell through the same-origin
 * `/cell` proxy, and to one local `nature` binary through the same-origin
 * `/seele/compile` route. Both are served by the same dev server that serves
 * this page.
 *
 * NO MOCKS anywhere in the boot path. `EditorRoomPool` wraps a REAL
 * `LoopbackCrdtBackend` (real doc-sync over a real socket); `hoja.document`
 * mounts the REAL `<sh-editor-host>`; `seele.context` renders reports produced
 * by the REAL `nature` binary. Nothing on this page fabricates a compile
 * result, and there is no code path that could.
 *
 * BOOT ORDER IS LOAD-BEARING (C20/W6.8). `seele.context` must be registered
 * BEFORE the layout literal is validated: `LAY-003` rejects any leaf whose
 * face is absent from the registry, and `seal()` makes later registration
 * throw. So: register both faces → register both adapters → seal → build the
 * literal → validate it against the SEALED registry → reconcile. A
 * deliberately-unregistered face id fails that gate with a message naming the
 * face, instead of painting a blank pane.
 */
import '@shrubbery/tokens/tokens.css'
import { applySkinTheme } from '@shrubbery/tokens'
import {
  EditorRoomPool,
  createHttpSeeleCompiler,
  createSeeleWorkbenchController,
  type SeeleWorkbenchController,
  type SeeleWorkbenchReportHandle,
} from '@shrubbery/runtime'
import {
  FaceRegistry,
  LayoutInterpreter,
  LayoutResourceBroker,
  createHojaDocumentFace,
  createHojaDocumentResourceAdapter,
  createSeeleContextFace,
  createSeeleContextResourceAdapter,
  createSophiaHomeFace,
  createSophiaHomeResourceAdapter,
  hojaDocumentContentPort,
} from '@shrubbery/runtime/layout'
import { createValidatedLayoutDocument, type LayoutDocument } from '@shrubbery/nucleus/layout'
import { assertEveryFaceRegistered } from './boot-gate.js'
import { LoopbackCrdtBackend } from '@shrubbery/organism/cell/loopback-crdt-backend'
import {
  buildSeeleWorkbenchDocument,
  CONSTITUTION_LEAF_ID,
  DEFAULT_CONTRACT_NAME,
  SEELE_CONTEXT_LEAF_ID,
} from './seele-workbench-document.js'

applySkinTheme({ skin: 'garden', theme: 'light' })

// ── identity: which cell, which constitution ────────────────────────────────
const params = new URLSearchParams(window.location.search)
export const DEFAULT_GRAPH_ID = 'seele-workbench'
export const DEFAULT_DOCUMENT_ID = 'constitution'
const graphId = params.get('graph') ?? DEFAULT_GRAPH_ID
const documentId = params.get('doc') ?? DEFAULT_DOCUMENT_ID
const contractName = params.get('contract') ?? DEFAULT_CONTRACT_NAME
const debounceMs = Number(params.get('debounce') ?? '400')

const root = document.querySelector<HTMLElement>('#seele-workbench-root')!
const stage = document.querySelector<HTMLElement>('#workbench-stage')!
const identityEl = document.querySelector<HTMLElement>('#workbench-identity')!
identityEl.textContent = `${graphId} / ${documentId} · ${contractName}`

// ── the real collab plane (no mocks) ────────────────────────────────────────
// Same-origin `/cell/mcp`: the dev server's proxy injects the cell's bearer
// token server-side, so the random port and the token never reach browser JS.
const backend = new LoopbackCrdtBackend({ mcpUrl: '/cell/mcp' })
const pool = new EditorRoomPool(backend)

// ── the controller: document → source → compile → report ────────────────────
// One controller per constitution document. The map exists because the
// resource adapter is handed a LOCATOR, not the app's own identity — a second
// constitution opened later resolves to its own controller rather than
// silently sharing this one's report.
const compile = createHttpSeeleCompiler()
const controllers = new Map<string, SeeleWorkbenchController>()
function controllerFor(key: string): SeeleWorkbenchController {
  let controller = controllers.get(key)
  if (!controller) {
    controller = createSeeleWorkbenchController({ compile, debounceMs })
    controllers.set(key, controller)
  }
  return controller
}
function handleFor(locator: { graphId: string; documentId: string }): SeeleWorkbenchReportHandle {
  return controllerFor(`${locator.graphId}\u0000${locator.documentId}`).reportHandle
}

// ── registry + broker, sealed before anything is validated ──────────────────
const registry = new FaceRegistry()
registry.register(createHojaDocumentFace())
registry.register(createSeeleContextFace())
// LAY-010's replacement leaf: closing the last leaf swaps in `sophia.home`, so
// the face must exist or that legal document state paints an error box.
registry.register(createSophiaHomeFace())
registry.seal()

const broker = new LayoutResourceBroker()
broker.registerAdapter(createHojaDocumentResourceAdapter(pool))
broker.registerAdapter(createSeeleContextResourceAdapter(handleFor))
broker.registerAdapter(createSophiaHomeResourceAdapter())

const interpreter = new LayoutInterpreter(root, { registry, broker })

// ── the layout literal, validated against the SEALED registry (W6.8) ────────
const candidate = buildSeeleWorkbenchDocument(graphId, documentId, { contractName })
assertEveryFaceRegistered(candidate, registry)
const construction = createValidatedLayoutDocument(candidate, {
  isFaceRegistered: registry.toFaceRegistrationPredicate(),
  isFaceGridEligible: registry.toFaceGridEligibilityPredicate(),
})
if (!construction.ok) {
  throw new Error(
    `seele-workbench: the layout literal did not validate against the sealed registry — ${JSON.stringify(construction.diagnostics)}`,
  )
}
const doc: LayoutDocument = construction.doc

// ── reconcile, serialized, and re-solved on real container resize ───────────
let containerSize = { width: stage.clientWidth || 1400, height: stage.clientHeight || 900 }
function applyRootBox(): void {
  root.style.width = `${containerSize.width}px`
  root.style.height = `${containerSize.height}px`
}
applyRootBox()

let reconcileQueue: Promise<{ ok: boolean; diagnostics: readonly unknown[] }> = Promise.resolve({
  ok: true,
  diagnostics: [],
})
function reconcileAndRender(): Promise<{ ok: boolean; diagnostics: readonly unknown[] }> {
  reconcileQueue = reconcileQueue.then(async () => {
    const result = await interpreter.reconcile(doc, containerSize)
    attachControllerToConstitution()
    return result
  })
  return reconcileQueue
}

/**
 * Bind the controller to the constitution leaf's W14.1 content port.
 *
 * `LayoutInterpreter.mountedView(leafId)` is the supported route from a layout
 * node id to its live view — no `querySelector` archaeology, no reaching into
 * the pool. Re-checked after every reconcile because a face view can be torn
 * down and rebuilt (document swap, provider swap); attaching to a dead view
 * would leave the pane looking alive and silently deaf. `attach()` detaches
 * any previous port, so re-running this is safe and cheap.
 */
let attachedPort: unknown = null
function attachControllerToConstitution(): void {
  const port = hojaDocumentContentPort(interpreter.mountedView(CONSTITUTION_LEAF_ID))
  if (!port || port === attachedPort) return
  attachedPort = port
  controllerFor(`${graphId}\u0000${documentId}`).attach(port)
}

const resizeObserver = new ResizeObserver(() => {
  const width = stage.clientWidth
  const height = stage.clientHeight
  if (width < 1 || height < 1) return
  if (width === containerSize.width && height === containerSize.height) return
  containerSize = { width, height }
  applyRootBox()
  void reconcileAndRender()
})
resizeObserver.observe(stage)

// ── the introspection bridge the browser acceptance script drives ───────────
declare global {
  interface Window {
    __seeleWorkbench?: {
      readonly ready: boolean
      readonly interpreter: LayoutInterpreter
      readonly registry: FaceRegistry
      readonly broker: LayoutResourceBroker
      readonly pool: EditorRoomPool
      readonly graphId: string
      readonly documentId: string
      readonly constitutionLeafId: string
      readonly contextLeafId: string
      getDoc(): LayoutDocument
      /** The controller's latest snapshot — the same value the pane is rendering. */
      snapshot(): ReturnType<SeeleWorkbenchReportHandle['current']>
      /** Compile immediately, bypassing the debounce window (an explicit gesture). */
      compileNow(): Promise<void>
      reconcile(): Promise<{ ok: boolean; diagnostics: readonly unknown[] }>
    }
  }
}

async function boot(): Promise<void> {
  const result = await reconcileAndRender()
  const controller = controllerFor(`${graphId}\u0000${documentId}`)
  window.__seeleWorkbench = {
    ready: result.ok,
    interpreter,
    registry,
    broker,
    pool,
    graphId,
    documentId,
    constitutionLeafId: CONSTITUTION_LEAF_ID,
    contextLeafId: SEELE_CONTEXT_LEAF_ID,
    getDoc: () => doc,
    snapshot: () => controller.reportHandle.current(),
    compileNow: () => controller.compileNow(),
    reconcile: reconcileAndRender,
  }
  document.body.dataset.seeleWorkbenchReady = String(result.ok)
  if (!result.ok) {
    document.body.dataset.seeleWorkbenchError = JSON.stringify(result.diagnostics)
  }
}

window.addEventListener('beforeunload', () => {
  resizeObserver.disconnect()
  for (const controller of controllers.values()) controller.dispose()
  pool.destroyAll()
})

void boot().catch((error: unknown) => {
  document.body.dataset.seeleWorkbenchError = error instanceof Error ? (error.stack ?? error.message) : String(error)
})
