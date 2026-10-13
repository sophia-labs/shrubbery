import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import type { ProviderHandle, CrdtProviderLifecycle } from '@shrubbery/nucleus'
import { gardenCodeText, gardenCodeSource, type ShDevelopmentCodeEditor } from '../development-code-editor.js'

const insertRule = CSSStyleSheet.prototype.insertRule
CSSStyleSheet.prototype.insertRule = function(rule: string, index?: number) {
  // happy-dom 15 rejects CodeMirror's legal non-ASCII generated class names.
  // Escape that codepoint in CSS only; editing and CRDT behavior stay real.
  return insertRule.call(this,rule.replaceAll('ͼ','\\37c '),index)
}

const releases: (() => void)[] = []
afterEach(() => { document.body.replaceChildren(); releases.splice(0).forEach(release => release()) })

function seed(source = 'print("hello")\n'): Y.Doc {
  const doc = new Y.Doc()
  const block = new Y.XmlElement('codeBlock')
  block.setAttribute('data-block-id','cell-source')
  block.setAttribute('language','python')
  const text = new Y.XmlText(); text.insert(0,source); block.insert(0,[text])
  doc.getXmlFragment('content').insert(0,[block])
  releases.push(() => doc.destroy())
  return doc
}
function provider(doc: Y.Doc, whenEditable = Promise.resolve()): ProviderHandle {
  const awareness = new Awareness(doc)
  releases.push(() => awareness.destroy())
  const state = {connection:'connected' as const,synchronized:true,shouldConnect:true}
  return {doc,awareness,lifecycle:{get:() => state,subscribe:listener => {listener(state); return () => {}}},
    whenRenderable:Promise.resolve(),whenEditable,whenSynced:Promise.resolve(),renderSource:Promise.resolve('live'),destroy:vi.fn()}
}
async function mount(handle: ProviderHandle): Promise<ShDevelopmentCodeEditor> {
  const element = document.createElement('sh-development-code-editor')
  element.provider = handle; element.blockId = 'cell-source'; element.language = 'python'
  document.body.append(element)
  await element.updateComplete
  await vi.waitFor(() => expect(element.editorView,element.shadowRoot!.textContent ?? '').not.toBeNull())
  return element
}

describe('Garden CodeMirror live body',() => {
  it('requests diagnostics on first open using the actual shared source',async()=>{
    const diagnostics=vi.fn(async(_input:{source:string;offset:number})=>[])
    const element=document.createElement('sh-development-code-editor')
    element.provider=provider(seed());element.blockId='cell-source';element.language='python'
    element.tools={diagnostics,completions:async()=>[],hover:async()=>null,command:()=>{}}
    document.body.append(element);await element.updateComplete
    await vi.waitFor(()=>expect(diagnostics).toHaveBeenCalled(),{timeout:2000})
    expect(diagnostics.mock.calls[0]![0]).toMatchObject({source:'print("hello")\n',offset:0})
  })

  it('shows an already connected provider snapshot when subscriptions only emit changes',async () => {
    const ready = provider(seed())
    let current: CrdtProviderLifecycle = {connection:'connected',synchronized:true,shouldConnect:true}
    let notify: (state: CrdtProviderLifecycle) => void = () => {}
    const handle: ProviderHandle = {...ready,lifecycle:{get:() => current,subscribe:listener => {notify = listener; return () => {}}}}
    const first = await mount(handle)
    expect(first.shadowRoot!.querySelector('[role="status"]')!.textContent).toBe('connected · room synchronized')
    first.remove()
    const reopened = await mount(handle)
    expect(reopened.shadowRoot!.querySelector('[role="status"]')!.textContent).toBe('connected · room synchronized')
    current = {connection:'disconnected',synchronized:false,shouldConnect:true}
    notify(current)
    await reopened.updateComplete
    expect(reopened.shadowRoot!.querySelector('[role="status"]')!.textContent).toBe('disconnected · synchronizing')
  })

  it('converges concurrent human and agent edits on XmlText and reopens the retained document',async () => {
    const first = seed('value = "<hello>&"\n')
    const second = new Y.Doc(); Y.applyUpdate(second,Y.encodeStateAsUpdate(first)); releases.push(() => second.destroy())
    const handle = provider(first)
    const view = await mount(handle)
    const peer = await mount(provider(second))
    // Two disconnected replicas edit independently, then exchange real Yjs updates.
    view.editorView!.dispatch({changes:{from:0,insert:'# human\n'}})
    const agentText = gardenCodeText(second,'cell-source')
    second.transact(() => agentText.insert(agentText.length,'# agent\n'),'mcp-agent')
    expect(peer.editorView!.state.doc.toString()).toContain('# agent')
    const updateA = Y.encodeStateAsUpdate(first)
    const updateB = Y.encodeStateAsUpdate(second)
    Y.applyUpdate(first,updateB); Y.applyUpdate(second,updateA)
    const expected = '# human\nvalue = "<hello>&"\n# agent\n'
    expect(view.editorView!.state.doc.toString()).toBe(expected)
    expect(peer.editorView!.state.doc.toString()).toBe(expected)
    expect(gardenCodeSource(gardenCodeText(first,'cell-source'))).toBe(expected)
    expect(first.getXmlFragment('content').get(0).getAttribute('language')).toBe('python')
    view.remove()
    expect(handle.destroy).not.toHaveBeenCalled()
    const resumed = new Y.Doc(); Y.applyUpdate(resumed,Y.encodeStateAsUpdate(first)); releases.push(() => resumed.destroy())
    const reopened = await mount(provider(resumed))
    expect(reopened.editorView!.state.doc.toString()).toBe(expected)
    expect(gardenCodeText(resumed,'cell-source').parent).toBe(resumed.getXmlFragment('content').get(0))
  })

  it('follows a stable block identity after an agent structurally replaces its body',async () => {
    const doc = seed()
    const view = await mount(provider(doc))
    const detached = gardenCodeText(doc,'cell-source')
    const block = doc.getXmlFragment('content').get(0) as Y.XmlElement
    doc.transact(() => { const replacement = new Y.XmlText(); replacement.insert(0,'print("replacement")\n'); block.delete(0,1); block.insert(0,[replacement]) },'mcp-replace')
    await vi.waitFor(() => expect(view.editorView!.state.doc.toString()).toBe('print("replacement")\n'))
    view.editorView!.dispatch({changes:{from:0,insert:'# reopened\n'}})
    expect(gardenCodeSource(gardenCodeText(doc,'cell-source'))).toContain('# reopened')
    expect(gardenCodeText(doc,'cell-source')).not.toBe(detached)
    doc.getXmlFragment('content').delete(0,1)
    await vi.waitFor(() => expect(view.editorView).toBeNull())
    expect(view.shadowRoot!.textContent).toContain('found 0')
  })

  it('waits for the provider editing gate and isolates the second Rift',async () => {
    let permit = () => {}
    const gate = new Promise<void>(resolve => { permit = resolve })
    const a = seed('first Rift\n'), b = seed('second Rift\n')
    const view = await mount(provider(a,gate))
    expect(view.editorView!.contentDOM.getAttribute('contenteditable')).toBe('false')
    permit()
    await vi.waitFor(() => expect(view.editorView!.contentDOM.getAttribute('contenteditable')).toBe('true'))
    view.editorView!.dispatch({changes:{from:0,insert:'changed '}})
    const other = await mount(provider(b))
    expect(other.editorView!.state.doc.toString()).toBe('second Rift\n')
  })

  it('rejects ambiguous identities and rich text rather than creating a second source body',() => {
    const crlf = seed('first\r\nsecond\r\n')
    expect(() => gardenCodeText(crlf,'cell-source')).toThrow('LF newline policy')
    const doc = seed()
    gardenCodeText(doc,'cell-source').format(0,2,{bold:{}})
    expect(() => gardenCodeText(doc,'cell-source')).toThrow('rich-text')
    const clone = new Y.XmlElement('codeBlock'); clone.setAttribute('data-block-id','cell-source')
    doc.getXmlFragment('content').insert(1,[clone])
    expect(() => gardenCodeText(doc,'cell-source')).toThrow('found 2')
    expect([...doc.share.keys()]).toEqual(['content'])
  })
})
