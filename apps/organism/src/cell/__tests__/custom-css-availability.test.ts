import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CellContract } from '../session-store.js'
import { CustomCssController, cssHash } from '../custom-css.js'

const controllers: CustomCssController[] = []
afterEach(() => { controllers.splice(0).forEach(controller => controller.dispose()); vi.unstubAllGlobals(); vi.restoreAllMocks() })
const sourceLabels = ['Save & apply here', 'Apply this revision here', 'Reset shared CSS']
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('dialog button')].find(el => el.textContent === label)!
const expectSourceDisabled = (disabled: boolean) => sourceLabels.forEach(label => expect(button(label).disabled, label).toBe(disabled))
const contract = { runtime: { graphBaseUrl: () => 'https://engine.test/o/owner/g/graph', mode: () => 'hosted' }, auth: {
  token: () => 'synthetic', userId: () => 'synthetic-user', isAuthenticated: () => true, onChange: () => () => {},
} } as unknown as CellContract
async function snapshot() { return { schemaVersion: 1, scope: 'graph', graphId: 'graph', graphIncarnation: 'life', cssText: 'body{}', contentHashSha256: await cssHash('body{}'), revision: 3 } }
function create() { const controller = new CustomCssController(contract, 'graph'); controllers.push(controller); return controller }

describe('mixed-engine CSS availability through actual dialog controls', () => {
  it.each([404, 401, 403, 500])('disables source actions for HTTP %s without hiding recovery or losing the draft', async status => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status }))
    vi.stubGlobal('fetch', fetcher)
    const controller = create(); await controller.open()
    expectSourceDisabled(true)
    for (const label of ['Disable here', 'Reload shared source', 'Cancel']) expect(button(label).disabled).toBe(false)
    const editor = document.querySelector('hoja-editor') as HTMLElement & { value: string }
    editor.value = 'draft{}'
    sourceLabels.forEach(label => button(label).click())
    await controller.save(); await controller.save(true); await controller.applyReadRevision()
    expect(editor.value).toBe('draft{}')
    expect(fetcher.mock.calls.every(call => (call[1] as RequestInit | undefined)?.method === 'GET')).toBe(true)
    const text = document.querySelector('dialog [role="status"]')?.textContent
    if (status === 404) expect(text).toContain('not available on this workspace')
    else { expect(text).toContain(`HTTP ${status}`); expect(text).not.toContain('not available on this workspace') }
  })

  it('keeps controls disabled while loading, admits valid authority, and blocks stale actions after an invalid successor', async () => {
    const good = await snapshot()
    let resolve!: () => void
    const gate = new Promise<void>(done => { resolve = done })
    let invalid = false
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => { await gate; return new Response(JSON.stringify(invalid ? { ...good, graphId: 'wrong' } : good)) })
    vi.stubGlobal('fetch', fetcher)
    const controller = create(); const opening = controller.open()
    expectSourceDisabled(true)
    resolve(); await opening; expectSourceDisabled(false)
    invalid = true; await controller.refresh(); expectSourceDisabled(true)
    const before = fetcher.mock.calls.length
    sourceLabels.forEach(label => button(label).click())
    await controller.save(); await controller.applyReadRevision()
    expect(fetcher).toHaveBeenCalledTimes(before)
    expect(document.querySelector('dialog [role="status"]')?.textContent).toContain('Invalid or mismatched')
    invalid = false; await controller.refresh(); expectSourceDisabled(false)
  })

  it('retains a failed save draft but withdraws source actions when the authority disappears', async () => {
    const good = await snapshot()
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === 'GET'
      ? new Response(JSON.stringify(good)) : new Response('Not found', { status: 404 }))
    vi.stubGlobal('fetch', fetcher)
    const controller = create(); await controller.open(); expectSourceDisabled(false)
    const editor = document.querySelector('hoja-editor') as HTMLElement & { value: string }
    editor.value = 'draft{}'; editor.dispatchEvent(new Event('hoja-change'))
    await controller.save(); expectSourceDisabled(true)
    expect(editor.value).toBe('draft{}')
    const before = fetcher.mock.calls.length
    await controller.save(); await controller.save(true); await controller.applyReadRevision()
    expect(fetcher).toHaveBeenCalledTimes(before)
    expect(document.querySelector('dialog [role="status"]')?.textContent).toContain('not available on this workspace')
  })
})
