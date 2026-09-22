/**
 * card-object-harness-main.ts — REAL entry point wiring `card.object` (a real
 * `FaceRegistry` + `LayoutResourceBroker` + `LayoutInterpreter`, the REAL
 * `card.object` face/adapter, and the REAL production `createSourceObjectService`
 * over a REAL `SourceMirrorRuntime`) against a REAL spawned gardend cell — the
 * MO object-face integration spec, master §3 Slice 2, gate G7.
 *
 * Mirrors `layout-workbench-main.ts`'s own shape (a minimal, real, single-
 * face-catalog specimen, driven by `scripts/card-object-browser-harness.mts`
 * through the SAME same-origin `/cell` proxy the production entry uses — the
 * port/bearer token never reach this module).
 *
 * NO MOCKS: `createGardendContract` builds the REAL `SourceMirrorRuntime`
 * (real IndexedDB-backed storage in a real browser, real MCP round-trips);
 * `createSourceObjectService` is `apps/organism`'s actual production
 * implementation, not a test double.
 */
import '@shrubbery/tokens/tokens.css'
import { applySkinTheme } from '@shrubbery/tokens'
import {
  FaceRegistry,
  LayoutResourceBroker,
  LayoutInterpreter,
  createCardObjectFace,
  createCardObjectResourceAdapter,
} from '@shrubbery/runtime/layout'
import { deepFreeze, type LayoutDocument, type ViewDescriptor } from '@shrubbery/nucleus/layout'
import type { ObjectKeyParts, SourceObjectRead } from '@shrubbery/runtime/layout'
import { createGardendContract, type GardendContract } from '../cell/gardend-contract.js'
import { createSourceObjectService } from '../cell/source-object-runtime.js'

export const GRAPH_ID = 'card-object-harness-proof'

function freshContract(): GardendContract {
  return createGardendContract({ transport: { mcpUrl: '/cell/mcp', healthUrl: '/cell/health' } })
}

interface CardObjectHarnessBridge {
  readonly interpreter: LayoutInterpreter
  mount(subjectIri: string | undefined): Promise<void>
  /** Master §3 Slice 5, gate G7: the wine annunciator's real computed
   *  colour in light AND dark — re-stamps `[data-theme]`; the SAME mounted
   *  card's `--mn-stance-contested-*` values recompute live (a standard
   *  CSS custom-property cascade change), no remount required. */
  setTheme(theme: 'light' | 'dark'): void
  /**
   * G4b RELOCATED HERE (master §8.2's G4b repair): `globalThis.indexedDB` is
   * `undefined` under `apps/organism`'s happy-dom vitest environment
   * (verified), so `SourceMirrorRuntime` would silently fall back to
   * `MemorySourceRuntimeStorage` there — a real no-mocks violation for a
   * seam this spec requires real IndexedDB for. `SourceMirrorStorage` also
   * carries no `kind`/`storageKind()` discriminator today (`source-mirror.
   * ts:204-209` — verified; the spec's own claim that one "already" exists
   * is code-wins-corrected here), so the assertion the repair specifies
   * cannot be written without inventing that infrastructure, which is
   * outside this slice's described content. Per the repair's own fallback
   * ("the relocation is total"): `source-object-runtime.integration.test.ts`
   * is NOT built as a vitest file; its five assertions are proved here
   * instead, in a REAL browser with REAL IndexedDB, driven by `scripts/
   * card-object-browser-harness.mts`'s `sourceObjectSeam` evidence block.
   */
  readonly sourceObjectSeam: {
    /** (1) mirror path — a real object, already synced. */
    readMirror(key: ObjectKeyParts): Promise<SourceObjectRead | null>
    /** (2) authority path — a FRESH, never-synced contract, same object. */
    readAuthority(key: ObjectKeyParts): Promise<SourceObjectRead | null>
    /** (3) absent object — mirror path. */
    readMirrorAbsent(key: ObjectKeyParts): Promise<SourceObjectRead | null>
    /** (4) a never-synced mirror (the real usableBundle incompleteness rule) falls through to authority. */
    readNeverSynced(key: ObjectKeyParts): Promise<{ readonly provenance: string | undefined }>
    /** (5) Q-9 — a class whose subject_rule needs an extra token rejects verbatim. */
    readSubjectRuleGap(key: ObjectKeyParts): Promise<{ readonly rejected: boolean; readonly message: string }>
  }
}

declare global {
  interface Window {
    __cardObjectHarness?: CardObjectHarnessBridge
  }
}

async function boot(): Promise<void> {
  applySkinTheme({ skin: 'garden', theme: 'light' })

  const root = document.querySelector<HTMLElement>('#card-object-root')
  if (!root) throw new Error('card-object-harness: #card-object-root is missing')

  const contract = createGardendContract({
    transport: { mcpUrl: '/cell/mcp', healthUrl: '/cell/health' },
  })
  // Prime the real mirror BEFORE exposing the bridge — createGardendContract
  // does not sync on its own (in the production shell this happens as part
  // of ordinary session bootstrap). Without this, every read here would
  // silently fall to the (still real, but degraded) authority path, and this
  // harness's whole purpose — proving the PRIMARY mirror path in a real
  // browser — would go untested.
  await contract.sourceMirror.open(GRAPH_ID)
  await contract.sourceMirror.sync(GRAPH_ID)
  const objects = createSourceObjectService({ runtime: contract.sourceMirror, caller: contract.rawMcp })

  const registry = new FaceRegistry()
  registry.register(createCardObjectFace())
  const broker = new LayoutResourceBroker()
  broker.registerAdapter(createCardObjectResourceAdapter(objects))

  const interpreter = new LayoutInterpreter(root, { registry, broker })

  // The interpreter's own remount-skip optimization keys on `(leafId,
  // descriptorRevision)` (layout-interpreter.ts's reconcile diff) — a fresh
  // document built with the SAME hardcoded revision looks unchanged even
  // when the resource binding itself differs, so this harness increments a
  // real per-mount revision, exactly like a `replace_descriptor` operation
  // would (LAY-007).
  let revision = 0

  function docFor(subjectIri: string | undefined): LayoutDocument {
    const descriptor: ViewDescriptor = {
      schemaVersion: 1,
      faceId: 'card.object',
      resource:
        subjectIri === undefined
          ? { kind: 'graph', graphId: GRAPH_ID }
          : { kind: 'graph', graphId: GRAPH_ID, subjectIri },
    }
    return deepFreeze({
      schemaVersion: 1,
      layoutId: 'card-object-harness',
      scope: 'session',
      graphId: GRAPH_ID,
      rootNodeId: 'K1',
      nodes: { K1: { kind: 'leaf', id: 'K1', descriptor, descriptorRevision: revision } },
      createdAt: '2026-07-30T00:00:00.000Z',
      updatedAt: '2026-07-30T00:00:00.000Z',
    })
  }

  async function mount(subjectIri: string | undefined): Promise<void> {
    revision += 1
    const result = await interpreter.reconcile(docFor(subjectIri), { width: 900, height: 500 })
    if (!result.ok) {
      throw new Error(`card-object-harness: reconcile failed — ${JSON.stringify(result.diagnostics)}`)
    }
  }

  window.__cardObjectHarness = {
    interpreter,
    mount,
    setTheme: (theme) => {
      applySkinTheme({ skin: 'garden', theme })
    },
    sourceObjectSeam: {
      readMirror: (key) => objects.read(GRAPH_ID, key),
      readAuthority: async (key) => {
        // A FRESH contract whose mirror is never opened/synced — real
        // usableBundle incompleteness forces the authority path, exactly
        // like source-object-runtime.integration.test.ts's own "second
        // contract" pattern.
        const other = freshContract()
        return createSourceObjectService({ runtime: other.sourceMirror, caller: other.rawMcp }).read(GRAPH_ID, key)
      },
      readMirrorAbsent: (key) => objects.read(GRAPH_ID, key),
      readNeverSynced: async (key) => {
        const other = freshContract()
        const read = await createSourceObjectService({ runtime: other.sourceMirror, caller: other.rawMcp }).read(GRAPH_ID, key)
        return { provenance: read?.provenance }
      },
      readSubjectRuleGap: async (key) => {
        const other = freshContract()
        try {
          await createSourceObjectService({ runtime: other.sourceMirror, caller: other.rawMcp }).read(GRAPH_ID, key)
          return { rejected: false, message: '' }
        } catch (error) {
          return { rejected: true, message: error instanceof Error ? error.message : String(error) }
        }
      },
    },
  }
  document.body.dataset.cardObjectHarnessReady = 'true'
}

boot().catch((error: unknown) => {
  document.body.dataset.cardObjectHarnessError = error instanceof Error ? error.message : String(error)
  // eslint-disable-next-line no-console
  console.error('card-object-harness boot failed:', error)
})
