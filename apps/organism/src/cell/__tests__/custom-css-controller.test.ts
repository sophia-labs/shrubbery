import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Editor } from '../../../../../packages/editor-kernel/src/index.js'
import type { HojaEditor } from '@shrubbery/hoja'
import type { CellContract } from '../session-store.js'
import { CustomCssController, cssConsentKey as scopedConsentKey, cssHash, type CustomCssSnapshot } from '../custom-css.js'

const cssConsentKey = (snapshot: CustomCssSnapshot) => scopedConsentKey(snapshot, 'test-user')

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.restoreAllMocks() })

async function authority(cssText = '') {
  const graphId = `css-test-${crypto.randomUUID()}`
  let current: CustomCssSnapshot = { schemaVersion: 1, scope: 'graph', graphId, graphIncarnation: 'life', cssText, contentHashSha256: await cssHash(cssText), revision: 0 }
  const writes: string[] = []
  const replays = new Map<string, string>()
  let reads = 0
  let readGate: ReturnType<typeof deferred> | null = null
  let readArrived = deferred()
  let writeGate: ReturnType<typeof deferred> | null = null
  const writeArrived = deferred()
  let dropResponse = false
  let responseIncarnation: string | null = null
  let readerOnly = false
  let accountId = 'test-user'
  let authenticated = true
  const authListeners = new Set<() => void>()
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json')
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'content-type, authorization')
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return }
    if (request.method === 'GET') {
      ++reads
      const returned = { ...current }
      const gate = readGate
      readGate = null
      readArrived.resolve()
      if (gate) await gate.promise
      response.end(JSON.stringify(returned)); return
    }
    let body = ''
    for await (const chunk of request) body += chunk
    writes.push(body)
    const operation = JSON.parse(body)
    if (readerOnly) { response.writeHead(403); response.end('{}'); return }
    const prior = replays.get(operation.operationId)
    if (prior && prior !== body) { response.writeHead(409); response.end('{}'); return }
    if (!prior) {
      if (operation.graphIncarnation !== current.graphIncarnation || operation.expectedRevision !== current.revision || operation.expectedContentSha256 !== current.contentHashSha256) {
        response.writeHead(409); response.end('{}'); return
      }
      const text = request.method === 'DELETE' ? '' : operation.cssText
      current = { ...current, cssText: text, contentHashSha256: await cssHash(text), revision: current.revision + 1 }
      replays.set(operation.operationId, body)
    }
    // Deliberately inject a wrong-authority successful response in one caller
    // refusal test. This is not evidence the native producer sends this shape.
    const returned = { ...current, graphIncarnation: responseIncarnation ?? current.graphIncarnation }
    responseIncarnation = null
    writeArrived.resolve()
    if (writeGate) await writeGate.promise
    if (dropResponse) { dropResponse = false; response.destroy(); return }
    response.end(JSON.stringify(returned))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  const contract = { runtime: { graphBaseUrl: () => `http://127.0.0.1:${address.port}`, mode: () => 'hosted' }, auth: {
    token: () => null, userId: () => accountId, isAuthenticated: () => authenticated,
    onChange: (listener: () => void) => { authListeners.add(listener); return () => authListeners.delete(listener) },
  } } as unknown as CellContract
  const controller = new CustomCssController(contract, graphId)
  cleanup.push(async () => {
    controller.dispose(); writeGate?.resolve(); readGate?.resolve()
    localStorage.removeItem(cssConsentKey(current))
    await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections() })
  })
  await controller.open()
  const editor = document.querySelector('hoja-editor') as HojaEditor
  await editor.updateComplete
  const kernel = (editor as unknown as { editor: Editor }).editor
  return {
    controller, editor, writes, graphId,
    get current() { return current }, get reads() { return reads },
    style: () => document.querySelector<HTMLStyleElement>(`style[data-sophia-custom-css="${graphId}"]`),
    status: () => document.querySelector('[role="status"]')?.textContent ?? '',
    edit(text: string) { kernel.view.dispatch(kernel.state.tr.insertText(text, 1, kernel.state.doc.content.size - 1)) },
    async remote(text: string, incarnation = current.graphIncarnation) { current = { ...current, graphIncarnation: incarnation, cssText: text, contentHashSha256: await cssHash(text), revision: current.revision + 1 } },
    holdWrite() { writeGate = deferred(); return { arrived: writeArrived.promise, release: () => { writeGate?.resolve(); writeGate = null } } },
    holdRead() { const gate = deferred(); readGate = gate; readArrived = deferred(); return { arrived: readArrived.promise, release: gate.resolve } },
    dropNextWriteResponse() { dropResponse = true },
    replaceNextWriteResponseIncarnation(value: string) { responseIncarnation = value },
    readerOnly() { readerOnly = true },
    changeAccount(id: string, loggedIn = true) { accountId = id; authenticated = loggedIn; for (const listener of [...authListeners]) listener() },
    newController() { const next = new CustomCssController(contract, graphId); cleanup.push(async () => next.dispose()); return next },
  }
}

describe('actual controller / Hoja with synthetic HTTP scheduling, not native/browser proof', () => {
  it('does not reapply old consent on Cancel after a successful wrong-incarnation write response', async () => {
    const f = await authority('old{}')
    await f.controller.applyReadRevision()
    await f.controller.open()
    const editor = document.querySelector('hoja-editor') as HojaEditor
    await editor.updateComplete
    editor.value = 'new{}'
    f.replaceNextWriteResponseIncarnation('replacement-life')
    await f.controller.save()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    document.querySelector('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }))
    expect(f.style()?.textContent).toBe('')
    expect(localStorage.getItem(cssConsentKey(f.current))).toBeNull()
  })

  it('does not reapply old consent after exact retry observes a newer shared revision', async () => {
    const f = await authority('old{}')
    await f.controller.applyReadRevision()
    await f.controller.open()
    const editor = document.querySelector('hoja-editor') as HojaEditor
    await editor.updateComplete
    editor.value = 'requested{}'
    f.dropNextWriteResponse()
    await f.controller.save()
    await f.remote('newer{}')
    await f.controller.save()
    expect(f.writes[1]).toBe(f.writes[0])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    document.querySelector('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }))
    expect(f.style()?.textContent).toBe('')
    expect(localStorage.getItem(cssConsentKey(f.current))).toBeNull()
  })

  it('removes applied CSS immediately at account change and does not reuse another account consent', async () => {
    const f = await authority('a{}')
    await f.controller.applyReadRevision()
    expect(f.style()?.textContent).toBe('a{}')
    f.changeAccount('other-user')
    expect(f.style()).toBeNull()
    const other = f.newController()
    await other.open()
    expect(f.style()?.textContent).toBe('')
    expect(localStorage.getItem(scopedConsentKey(f.current, 'other-user'))).toBeNull()
    expect(localStorage.getItem(cssConsentKey(f.current))).toBe(f.current.contentHashSha256)
  })

  it('does not approve a late save after logout/account change', async () => {
    const f = await authority()
    f.edit('a{}')
    const hold = f.holdWrite()
    const save = f.controller.save(); await hold.arrived
    f.changeAccount('', false); hold.release(); await save
    expect(f.style()).toBeNull()
    expect(document.querySelector('dialog')).toBeNull()
    expect(localStorage.getItem(cssConsentKey(f.current))).toBeNull()
  })
  it('retains edits made while save is in flight and keeps the editor/style suspended', async () => {
    const f = await authority()
    f.edit('body { color: red }')
    const hold = f.holdWrite()
    const save = f.controller.save()
    await hold.arrived
    f.edit('body { color: blue }')
    hold.release(); await save
    expect(f.current.cssText).toBe('body { color: red }')
    expect(document.querySelector('hoja-editor')).toBe(f.editor)
    expect(f.editor.value).toBe('body { color: blue }')
    expect(f.style()?.textContent).toBe('')
    await f.controller.save()
    expect(f.current.cssText).toBe('body { color: blue }')
    expect(JSON.parse(f.writes[1]).expectedRevision).toBe(1)
  })

  it('coalesces busy invalidations into a trailing read of newer remote CSS', async () => {
    const f = await authority()
    f.edit('a{}')
    const hold = f.holdWrite()
    const save = f.controller.save(); await hold.arrived
    await f.remote('b{}')
    const before = f.reads
    await f.controller.refresh(); await f.controller.refresh()
    expect(f.reads).toBe(before)
    hold.release(); await save
    await expect.poll(() => f.reads).toBe(before + 1)
    await expect.poll(() => f.style()?.textContent).toBe('')
  })

  it('allows a reader to apply a freshly read revision without a shared write', async () => {
    const f = await authority(':root { --mn-radius-control: 9px }')
    f.readerOnly()
    expect(f.style()?.textContent).toBe('')
    await f.controller.applyReadRevision()
    expect(f.writes).toHaveLength(0)
    expect(f.style()?.textContent).toBe(f.current.cssText)
    expect(localStorage.getItem(cssConsentKey(f.current))).toBe(f.current.contentHashSha256)
    await f.controller.open()
    expect(f.style()?.textContent).toBe('')
    await f.controller.refresh()
    expect(f.style()?.textContent).toBe('')
    document.querySelector('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }))
    expect(f.style()?.textContent).toBe(f.current.cssText)
  })

  it('does not apply dirty draft bytes through the read-only action', async () => {
    const f = await authority('a{}')
    f.edit('b{}')
    await f.controller.applyReadRevision()
    expect(f.writes).toHaveLength(0)
    expect(f.style()?.textContent).toBe('')
    expect(f.editor.value).toBe('b{}')
  })

  it('does not resurrect application after a newer Disable while a save completes', async () => {
    const f = await authority()
    f.edit('a{}')
    const hold = f.holdWrite()
    const save = f.controller.save(); await hold.arrived
    f.controller.disable(); hold.release(); await save
    expect(f.style()?.textContent).toBe('')
    expect(localStorage.getItem(cssConsentKey(f.current))).toBeNull()
    expect(document.querySelector('hoja-editor')).toBe(f.editor)
  })

  it('does not resurrect application after Disable during local apply verification', async () => {
    const f = await authority('a{}')
    const hold = f.holdRead()
    const apply = f.controller.applyReadRevision(); await hold.arrived
    f.controller.disable(); hold.release(); await apply
    expect(f.style()?.textContent).toBe('')
    expect(localStorage.getItem(cssConsentKey(f.current))).toBeNull()
  })

  it('disposes a delayed write without reopening or approving its late result', async () => {
    const f = await authority()
    f.edit('a{}')
    const hold = f.holdWrite()
    const save = f.controller.save(); await hold.arrived
    f.controller.dispose(); hold.release(); await save
    expect(f.style()).toBeNull()
    expect(document.querySelector('dialog')).toBeNull()
    expect(localStorage.getItem(cssConsentKey(f.current))).toBeNull()
  })

  it('admits only one concurrent save and replays the exact lost-response request', async () => {
    const f = await authority()
    f.edit('a{}')
    const hold = f.holdWrite()
    f.dropNextWriteResponse()
    const save = f.controller.save(); await hold.arrived
    await f.controller.save()
    expect(f.writes).toHaveLength(1)
    hold.release(); await save
    expect(f.status()).toContain('Retry preserves')
    await f.controller.save()
    expect(f.writes).toHaveLength(2)
    expect(f.writes[1]).toBe(f.writes[0])
    expect(f.current.revision).toBe(1)
    expect(f.style()?.textContent).toBe('a{}')
  })

  it('retains the original CAS revision and dirty draft after a remote change', async () => {
    const f = await authority('a{}')
    f.edit('local{}')
    await f.remote('remote{}'); await f.controller.refresh()
    expect(f.editor.value).toBe('local{}')
    await f.controller.save()
    expect(JSON.parse(f.writes[0]).expectedRevision).toBe(0)
    expect(f.current.cssText).toBe('remote{}')
    expect(f.editor.value).toBe('local{}')
    expect(f.style()?.textContent).toBe('')
  })

  it('does not restore an older response or a replaced graph incarnation', async () => {
    const f = await authority('a{}')
    const hold = f.holdRead()
    const oldRead = f.controller.refresh(); await hold.arrived
    await f.remote('b{}'); await f.controller.refresh()
    hold.release(); await oldRead
    expect(f.editor.value).toBe('b{}')
    await f.remote('replacement{}', 'new-life'); await f.controller.refresh()
    await f.remote('a{}', 'life'); await f.controller.refresh(); await f.controller.save()
    expect(f.writes).toHaveLength(0)
    expect(f.style()?.textContent).toBe('')
  })
})
