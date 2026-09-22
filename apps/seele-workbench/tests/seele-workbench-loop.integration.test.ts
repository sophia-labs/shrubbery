/**
 * seele-workbench-loop.integration.test.ts — the whole loop, end to end, in
 * the fast lane: a real editor's bytes → the real projection → a real HTTP
 * request → the REAL `nature` binary → the real controller → a real mounted
 * `seele.context` face → the chip in the DOM.
 *
 * NO MOCKS, and specifically:
 *   - the server is a REAL Vite dev server booted from THIS APP'S OWN
 *     `vite.config.ts` — so if the compile route were ever dropped from the
 *     vessel's plugin list, this file fails rather than passing against a
 *     hand-mounted plugin the app does not actually use;
 *   - the compiler is the REAL `nature` binary, and every hash asserted below
 *     is cross-checked against a SEPARATE, direct CLI invocation of that same
 *     binary on the same bytes — the host never computes a contract hash and
 *     this test never trusts it to;
 *   - the editor is a REAL `@shrubbery/editor-kernel` `Editor` (document
 *     profile — the same kernel roster `<sh-editor-host>` mounts), driven
 *     through real commands;
 *   - the face, the registry, the broker and the resource lease are the real
 *     production classes.
 *
 * THE ONE SEAM THIS FILE DOES NOT EXERCISE, STATED PLAINLY: the hosted
 * `<sh-editor-host>` content port (W14.1) — `getDocumentJSON` /
 * `onDocumentContentChanged` over a live CRDT room. That needs a real spawned
 * `gardend` and a real browser, which is `scripts/seele-workbench-gardend-
 * browser.mts`'s job. `realEditorContentPort` below is a real adapter over a
 * real editor, not a fake of the host: it satisfies the same port interface
 * from the same kind of object the host itself wraps.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer as createViteServer, type ViteDevServer } from 'vite'
import { createKernelEditor, type Editor } from '@shrubbery/editor-kernel'
import {
  createHttpSeeleCompiler,
  createSeeleWorkbenchController,
  type SeeleWorkbenchController,
  type SeeleWorkbenchSnapshot,
} from '@shrubbery/runtime'
import {
  LayoutResourceBroker,
  SEELE_CONTEXT_ADAPTER_ID,
  createSeeleContextFace,
  createSeeleContextResourceAdapter,
  type HojaDocumentContentPort,
} from '@shrubbery/runtime/layout'
import { DEFAULT_NATURE_BIN } from '@shrubbery/organism/scripts/seele-compile-route'
import type { ViewDescriptor } from '@shrubbery/nucleus/layout'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// The nature checkout is a SIBLING repo, not reachable by a fixed relative
// path from this worktree — derive its root from the binary path itself.
const natureRepoRoot = resolve(dirname(DEFAULT_NATURE_BIN), '../..')
const circleOnePath = resolve(natureRepoRoot, 'examples/circle-1.seele.yaml')
const natureAvailable = existsSync(DEFAULT_NATURE_BIN) && existsSync(circleOnePath)

const GRAPH_ID = 'seele-workbench-proof'
const DOCUMENT_ID = 'constitution'
const PORT = 5399

/** Compile a source with the CLI DIRECTLY — the independent oracle for every hash below. */
function compileWithCli(source: string): Record<string, unknown> {
  const dir = mkdtempSync(join(tmpdir(), 'seele-cli-oracle.'))
  const file = join(dir, 'oracle.seele.yaml')
  try {
    writeFileSync(file, source, 'utf8')
    let stdout: string
    try {
      stdout = execFileSync(DEFAULT_NATURE_BIN, ['seele', 'compile', file, '--json'], { encoding: 'utf8' })
    } catch (error) {
      // A refused compile exits non-zero but still prints the report.
      const withOutput = error as { stdout?: string }
      if (typeof withOutput.stdout !== 'string') throw error
      stdout = withOutput.stdout
    }
    return JSON.parse(stdout) as Record<string, unknown>
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * A REAL `HojaDocumentContentPort` over a REAL kernel editor.
 *
 * This is an adapter, not a double: `getJSON` is the editor's own `getJSON()`
 * and `onChanged` rides its own `update` event. The hosted implementation
 * (`ShEditorHost.getDocumentJSON`/`onDocumentContentChanged`) does the same two
 * things over the same underlying object, plus survival across DOM relocation
 * — which is why the browser script, not this file, is what proves it.
 */
function realEditorContentPort(editor: Editor): HojaDocumentContentPort {
  return {
    getJSON: () => editor.getJSON(),
    onChanged(listener, options) {
      const debounceMs = Math.max(0, options?.debounceMs ?? 250)
      let timer: ReturnType<typeof setTimeout> | null = null
      const onUpdate = (): void => {
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(() => {
          timer = null
          listener({ json: editor.getJSON(), reason: 'transaction' })
        }, debounceMs)
      }
      editor.on('update', onUpdate)
      return () => {
        if (timer !== null) clearTimeout(timer)
        editor.off('update', onUpdate)
      }
    },
  }
}

const sleep = (ms: number): Promise<void> => new Promise(resolveSleep => setTimeout(resolveSleep, ms))

async function waitForSnapshot(
  controller: SeeleWorkbenchController,
  predicate: (snapshot: SeeleWorkbenchSnapshot) => boolean,
  label: string,
  timeoutMs = 25_000,
): Promise<SeeleWorkbenchSnapshot> {
  const deadline = Date.now() + timeoutMs
  let last = controller.reportHandle.current()
  while (Date.now() < deadline) {
    last = controller.reportHandle.current()
    if (predicate(last)) return last
    await sleep(25)
  }
  throw new Error(`timed out waiting for ${label}; last snapshot = ${JSON.stringify(last)}`)
}

let server: ViteDevServer | null = null
const editors: Editor[] = []
const disposers: Array<() => void | Promise<void>> = []

beforeAll(async () => {
  if (!natureAvailable) return
  server = await createViteServer({
    root: appDir,
    configFile: resolve(appDir, 'vite.config.ts'),
    server: { host: '127.0.0.1', port: PORT, strictPort: true, hmr: false },
    logLevel: 'error',
  })
  await server.listen()
}, 60_000)

afterAll(async () => {
  await server?.close()
  server = null
})

afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose()
  for (const editor of editors.splice(0)) editor.destroy()
  document.body.replaceChildren()
})

function mountEditor(): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = createKernelEditor(element, { profile: 'document' })
  editors.push(editor)
  return editor
}

function seeleFence(text: string) {
  return { type: 'codeBlock', attrs: { language: 'seele' }, content: [{ type: 'text', text }] }
}

function contextDescriptor(): ViewDescriptor {
  return {
    schemaVersion: 1,
    faceId: 'seele.context',
    resource: { kind: 'document', graphId: GRAPH_ID, documentId: DOCUMENT_ID },
    params: { contractName: 'seele-core' },
  }
}

function buildController(debounceMs = 60): SeeleWorkbenchController {
  const controller = createSeeleWorkbenchController({
    compile: createHttpSeeleCompiler({ url: `http://127.0.0.1:${PORT}/seele/compile` }),
    debounceMs,
  })
  disposers.push(() => controller.dispose())
  return controller
}

/** Mount the REAL face through the REAL broker, and return its shadow root once it has rendered. */
async function mountContextPane(controller: SeeleWorkbenchController): Promise<ShadowRoot> {
  const broker = new LayoutResourceBroker()
  broker.registerAdapter(createSeeleContextResourceAdapter(() => controller.reportHandle))
  const lease = await broker.acquire({ kind: 'document', graphId: GRAPH_ID, documentId: DOCUMENT_ID }, SEELE_CONTEXT_ADAPTER_ID)
  const target = document.createElement('div')
  document.body.appendChild(target)
  const view = await createSeeleContextFace().mount({
    target,
    descriptor: contextDescriptor(),
    lease,
    constraints: { minWidth: 0, minHeight: 0, overflow: 'clip' },
  })
  disposers.push(async () => {
    await view.dispose('closed')
    lease.release()
  })
  const element = target.querySelector('sh-seele-context-view') as (HTMLElement & { updateComplete: Promise<unknown> }) | null
  if (!element) throw new Error('seele.context did not mount its view element')
  await element.updateComplete
  return element.shadowRoot!
}

async function readPane(shadow: ShadowRoot): Promise<{ sealState: string | null; text: string }> {
  const host = shadow.host as HTMLElement & { updateComplete: Promise<unknown> }
  await host.updateComplete
  const chip = shadow.querySelector('[data-seal-state]')
  // Whitespace-collapsed: Lit's rendered output carries the template's own
  // indentation, which is not part of what the pane SAYS.
  const text = (shadow.textContent ?? '').replace(/\s+/g, ' ').trim()
  return { sealState: chip?.getAttribute('data-seal-state') ?? null, text }
}

describe.skipIf(!natureAvailable)('the SEELe workbench loop, end to end', () => {
  it('a clean circle-1 fence seals, and the seal matches the CLI’s hash for the same bytes', async () => {
    const source = readFileSync(circleOnePath, 'utf8')
    const oracle = compileWithCli(source)
    expect(oracle.clean).toBe(true)
    expect(typeof oracle.contractHash).toBe('string')

    const editor = mountEditor()
    editor.commands.setContent([
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'circle-1' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'The constitution of the first circle.' }] },
      seeleFence(source),
    ])

    const controller = buildController()
    const shadow = await mountContextPane(controller)
    controller.attach(realEditorContentPort(editor))

    const snapshot = await waitForSnapshot(controller, s => s.seal?.kind === 'sealed', 'a sealed report')
    expect(snapshot.source).toBe(source) // byte-exact, straight off the editor
    expect(snapshot.report?.clean).toBe(true)
    expect(snapshot.report?.contractHash).toBe(oracle.contractHash)
    expect(snapshot.report?.sourceDigest).toBe(oracle.sourceDigest)
    // Length from the ORACLE, not a literal: `circle-1.seele.yaml` lives in a
    // sibling repo under active development, so pinning a number here would
    // make this suite fail on someone else's unrelated edit. What must hold is
    // that the route and the CLI agree, and that the ecology is non-empty.
    expect(snapshot.report?.declaredObjects.length).toBe((oracle.declaredObjects as unknown[]).length)
    expect(snapshot.report?.declaredObjects.length).toBeGreaterThan(0)
    if (snapshot.seal?.kind !== 'sealed') throw new Error('unreachable')
    expect(snapshot.seal.contractHash).toBe(oracle.contractHash)
    expect(snapshot.seal.compilerVersion).toBe(oracle.compilerVersion)

    const pane = await readPane(shadow)
    expect(pane.sealState).toBe('sealed')
    expect(pane.text).toContain('sealed')
    expect(pane.text).toContain(String(oracle.contractHash))
    expect(pane.text).toContain(`${(oracle.declaredObjects as unknown[]).length} declared objects`)
    // W9.3: no durability claim anywhere on the hosted track.
    expect(pane.text.toLowerCase()).not.toMatch(/\bsaved\b|\bsaving\b|\bdurable\b|\bwarning\b/)
  })

  it('a broken fence refuses, renders the diagnostics, and shows NO hash', async () => {
    const broken = 'apiVersion: seele/v1\nkind: Ecology\nmetadata:\n  id: [unclosed\n'
    const oracle = compileWithCli(broken)
    expect(oracle.clean).toBe(false)
    expect(oracle.contractHash).toBeNull()

    const editor = mountEditor()
    editor.commands.setContent([seeleFence(broken)])
    const controller = buildController()
    const shadow = await mountContextPane(controller)
    controller.attach(realEditorContentPort(editor))

    const snapshot = await waitForSnapshot(controller, s => s.seal?.kind === 'refused', 'a refusal')
    if (snapshot.seal?.kind !== 'refused') throw new Error('unreachable')
    expect(snapshot.seal.errorCount).toBeGreaterThan(0)
    expect(snapshot.report?.contractHash).toBeNull()

    const pane = await readPane(shadow)
    expect(pane.sealState).toBe('refused')
    expect(pane.text).toContain('refused')
    expect(shadow.querySelectorAll('[data-diagnostic-severity="error"]').length).toBe(snapshot.seal.errorCount)
    // A refusal never displays a hash.
    expect(shadow.querySelector('[data-contract-hash]')).toBeNull()
  })

  it('a document with NO seele fence says so loudly and shows no chip at all', async () => {
    const editor = mountEditor()
    editor.commands.setContent([{ type: 'paragraph', content: [{ type: 'text', text: 'no fence here' }] }])
    const controller = buildController()
    const shadow = await mountContextPane(controller)
    controller.attach(realEditorContentPort(editor))

    const snapshot = await waitForSnapshot(controller, s => s.sourceError !== null, 'a projection error')
    expect(snapshot.source).toBeNull()
    expect(snapshot.seal).toBeNull()
    expect(snapshot.sourceError).toMatch(/seele/i)

    const pane = await readPane(shadow)
    expect(pane.sealState).toBeNull() // no chip — there is nothing to seal
    expect(shadow.querySelector('[data-source-error]')).not.toBeNull()
  })

  it('editing the fence drifts, then re-seals with a DIFFERENT hash — and never renders a stale verdict', async () => {
    const source = readFileSync(circleOnePath, 'utf8')
    const editor = mountEditor()
    editor.commands.setContent([seeleFence(source)])
    const controller = buildController()
    const shadow = await mountContextPane(controller)
    controller.attach(realEditorContentPort(editor))

    const first = await waitForSnapshot(controller, s => s.seal?.kind === 'sealed', 'the first seal')
    const firstHash = first.report?.contractHash
    expect(typeof firstHash).toBe('string')

    // A real edit: rename the ecology. Same shape, different canonical dataset,
    // therefore a genuinely different contract hash — not just a different
    // source digest (a comment-only edit would move the latter and not the
    // former, which is exactly the distinction the seal exists to make).
    const edited = source.replace('name: circle-1', 'name: circle-2')
    expect(edited).not.toBe(source)
    editor.commands.setContent([seeleFence(edited)])

    const second = await waitForSnapshot(
      controller,
      s => s.seal?.kind === 'sealed' && s.compiledSource === edited,
      'the second seal',
    )
    expect(second.report?.contractHash).not.toBe(firstHash)
    expect(second.report?.contractHash).toBe(compileWithCli(edited).contractHash)
    // The applied report is always ABOUT the bytes on screen — never a stale one.
    expect(second.compiledSource).toBe(second.source)

    const pane = await readPane(shadow)
    expect(pane.sealState).toBe('sealed')
    expect(pane.text).toContain(String(second.report?.contractHash))
    expect(pane.text).not.toContain(String(firstHash))
  })

  it('DURING the pending window the body is seal-gated: no hash, no count, only an explicitly-labelled older-bytes line', async () => {
    // Tranche-1 finding A's oracle: the settled end-state tests above cannot
    // see this defect — the stale hash rendered only WHILE the chip said
    // `typing`/`compiling`. So this test holds the pending window open (a
    // deliberately enormous debounce; the first compile bypasses it via the
    // explicit-gesture path) and inspects the pane INSIDE it.
    const source = readFileSync(circleOnePath, 'utf8')
    const editor = mountEditor()
    editor.commands.setContent([seeleFence(source)])
    const controller = buildController(120_000)
    const shadow = await mountContextPane(controller)
    controller.attach(realEditorContentPort(editor))
    await controller.compileNow()

    const first = await waitForSnapshot(controller, s => s.seal?.kind === 'sealed', 'the first seal')
    const firstHash = first.report?.contractHash
    expect(typeof firstHash).toBe('string')
    const sealedPane = await readPane(shadow)
    expect(sealedPane.sealState).toBe('sealed')
    expect(sealedPane.text).toContain(String(firstHash))

    const edited = source.replace('name: circle-1', 'name: circle-2')
    expect(edited).not.toBe(source)
    editor.commands.setContent([seeleFence(edited)])

    // The window is open: new bytes on screen, the old verdict on hand.
    const pending = await waitForSnapshot(
      controller,
      s => s.seal?.kind === 'typing' && s.source === edited,
      'the typing window',
    )
    expect(pending.report?.contractHash).toBe(firstHash) // the stale report IS still held…

    const pendingPane = await readPane(shadow)
    expect(pendingPane.sealState).toBe('typing') // …the chip is honest…
    // …and the body never presents that report as current:
    expect(shadow.querySelector('[data-contract-hash]')).toBeNull()
    expect(pendingPane.text).not.toContain(String(firstHash))
    expect(pendingPane.text).not.toContain('declared object')
    // The previous verdict may appear ONLY under the explicit older-bytes label.
    const staleLine = shadow.querySelector('[data-stale-verdict]')
    expect(staleLine).not.toBeNull()
    expect(staleLine?.textContent).toContain('older bytes')

    // Close the loop: the explicit gesture compiles the NEW bytes and the
    // pane's body returns, gated, with the new hash — never the old one.
    await controller.compileNow()
    const second = await waitForSnapshot(
      controller,
      s => s.seal?.kind === 'sealed' && s.compiledSource === edited,
      'the second seal',
    )
    expect(second.report?.contractHash).not.toBe(firstHash)
    const resealedPane = await readPane(shadow)
    expect(resealedPane.sealState).toBe('sealed')
    expect(resealedPane.text).toContain(String(second.report?.contractHash))
    expect(resealedPane.text).not.toContain(String(firstHash))
  })
})
