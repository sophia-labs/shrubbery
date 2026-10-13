import { afterEach, describe, expect, it } from 'vitest'
import type { Editor } from '../../../../../packages/editor-kernel/src/index.js'
import { HojaEditor } from '@shrubbery/hoja'
import { cssHash, decodeCustomCss, cssConsentKey as scopedConsentKey, CustomCssController } from '../custom-css.js'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { CellContract } from '../session-store.js'

const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const base = { schemaVersion: 1, scope: 'graph', graphId: 'g', graphIncarnation: 'life', cssText: '', contentHashSha256: emptyHash, revision: 0 }
const cssConsentKey = (snapshot: Parameters<typeof scopedConsentKey>[0]) => scopedConsentKey(snapshot, 'test-user')

describe('Custom CSS native wire, exact text and consent', () => {
  it('accepts the exact empty authority', async () => { expect(await decodeCustomCss(base, 'g')).toEqual(base) })
  it('checks returned exact bytes instead of trusting supplied hash', async () => {
    await expect(decodeCustomCss({ ...base, cssText: 'body { color:red }' }, 'g')).rejects.toThrow()
  })
  it.each(['\ud800', '\udfff'])('refuses a lone surrogate %s', async text => { await expect(cssHash(text)).rejects.toThrow() })
  it('retains UTF-8 BOM and non-ASCII source', async () => {
    const text = '\ufeff/* 🌱 */\n:root { --hello: "你好"; }\n'
    const snapshot = { ...base, cssText: text, contentHashSha256: await cssHash(text) }
    expect((await decodeCustomCss(snapshot, 'g')).cssText).toBe(text)
  })
  it('limits UTF-8 bytes rather than UTF-16 length', async () => { await expect(cssHash('🌱'.repeat(16_385))).rejects.toThrow() })
  it.each([{ graphId: 'other' }, { graphIncarnation: '' }, { revision: -1 }, { revision: 0.5 }, { scope: 'profile' }, { schemaVersion: 2 }])('rejects mismatched metadata %j', async patch => {
    await expect(decodeCustomCss({ ...base, ...patch }, 'g')).rejects.toThrow()
  })
  it('consent is incarnation- and graph-scoped with unambiguous encoding', () => {
    expect(cssConsentKey(base)).not.toBe(cssConsentKey({ ...base, graphIncarnation: 'new' }))
    expect(cssConsentKey({ graphId: 'a:b', graphIncarnation: 'c' })).not.toBe(cssConsentKey({ graphId: 'a', graphIncarnation: 'b:c' }))
    expect(scopedConsentKey(base, 'A')).not.toBe(scopedConsentKey(base, 'B'))
  })
})

describe('real Hoja literal source profile', () => {
  afterEach(() => { document.querySelectorAll('hoja-editor').forEach(el => el.remove()) })
  async function mount(text: string): Promise<{ element: HojaEditor; editor: Editor }> {
    const element = document.createElement('hoja-editor') as HojaEditor
    element.sourceMode = true; element.posture = 'embedded'; element.value = text
    document.body.append(element)
    await element.updateComplete; await Promise.resolve(); await element.updateComplete
    const editor = (element as unknown as { editor: Editor }).editor
    return { element, editor }
  }
  it('round-trips literal CSS without Markdown or wiki transforms', async () => {
    const text = '/* **bold** [[not-a-reference]] */\n:root { --a: "<style>"; }\n\n'
    const { element, editor } = await mount(text)
    expect(editor.state.doc.textContent).toBe(text)
    expect(Object.keys(editor.schema.marks)).toEqual([])
    expect(Object.keys(editor.schema.nodes).sort()).toEqual(['codeBlock', 'doc', 'text'])
    expect(element.getJSON().content?.[0].type).toBe('codeBlock')
  })
  it('preserves entered newlines and emits exact source through real transactions', async () => {
    const { element, editor } = await mount('a{}\n')
    let value = ''
    element.onChange = detail => { value = detail.value; element.value = detail.value }
    editor.view.dispatch(editor.state.tr.insertText('\n/* x */', editor.state.doc.content.size - 1))
    expect(value).toBe('a{}\n\n/* x */')
    element.requestUpdate(); await element.updateComplete
    expect(editor.state.doc.textContent).toBe(value)
  })
  it('keeps ordinary Hoja Markdown as the default', async () => {
    const element = document.createElement('hoja-editor') as HojaEditor
    element.value = '**bold**'; document.body.append(element)
    await element.updateComplete; await Promise.resolve(); await element.updateComplete
    const editor = (element as unknown as { editor: Editor }).editor
    expect(editor.schema.marks.bold).toBeTruthy()
    expect(editor.state.doc.textContent).toBe('bold')
  })
})

describe('real CSS controller against synthetic HTTP authority (not native proof)', () => {
  it('saves a guarded source, applies only approved bytes, and disables on remote change', async () => {
    let current = { ...base }
    let written: Record<string, unknown> | null = null
    const server = createServer(async (request, response) => {
      response.setHeader('Content-Type', 'application/json')
      response.setHeader('Access-Control-Allow-Origin', '*')
      response.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS')
      response.setHeader('Access-Control-Allow-Headers', 'content-type, authorization')
      if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return }
      if (request.method === 'PUT') {
        let body = ''
        for await (const chunk of request) body += chunk
        written = JSON.parse(body) as Record<string, unknown>
        current = { ...current, cssText: String(written.cssText), contentHashSha256: await cssHash(String(written.cssText)), revision: current.revision + 1 }
      }
      response.end(JSON.stringify(current))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as AddressInfo
    const contract = { runtime: { graphBaseUrl: () => `http://127.0.0.1:${address.port}`, mode: () => 'hosted' }, auth: { token: () => null, userId: () => 'test-user', isAuthenticated: () => true, onChange: () => () => {} } } as unknown as CellContract
    const controller = new CustomCssController(contract, 'g')
    try {
      await controller.open()
      const editor = document.querySelector('hoja-editor') as HojaEditor
      editor.value = ':root { --mn-radius-control: 13px; }'
      await controller.save()
      expect(written).toMatchObject({ expectedRevision: 0, expectedContentSha256: emptyHash, graphIncarnation: 'life', cssText: editor.value })
      expect(typeof (written as unknown as Record<string, unknown>).operationId).toBe('string')
      expect(document.querySelector('style[data-sophia-custom-css]')?.textContent).toBe(editor.value)
      expect(localStorage.getItem(cssConsentKey(current))).toBe(current.contentHashSha256)
      current = { ...current, cssText: 'body { display:none }', contentHashSha256: await cssHash('body { display:none }'), revision: 2 }
      await controller.refresh()
      expect(document.querySelector('style[data-sophia-custom-css]')?.textContent).toBe('')
      await controller.open()
      expect((document.querySelector('hoja-editor') as HojaEditor).value).toBe(current.cssText)
      controller.disable()
      expect(localStorage.getItem(cssConsentKey(current))).toBeNull()
    } finally {
      controller.dispose()
      await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections() })
    }
    expect(document.querySelector('style[data-sophia-custom-css]')).toBeNull()
    expect(document.querySelector('dialog')).toBeNull()
  })
})
