import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import type { DevelopmentWorkspaceService, DevelopmentRiftSnapshot, ProviderHandle } from '@shrubbery/nucleus'
import { DevelopmentWorkspaceController } from '../development-workspace-controller.js'
import { HttpDevelopmentWorkspaceService } from '../development-workspace-service.js'

const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).forEach(fn => fn()))
function snapshot(id: string): DevelopmentRiftSnapshot {
  return {rift:{id,name:id,project:'fixture',baseRevision:'git-base'},observedAt:'2026-09-19T01:00:00Z',participants:[],environments:[],files:[{id:`${id}:file`,documentId:`${id}:document`,blockId:'body',path:'message.txt',kind:'source',syncState:'synchronized'}],runs:[]}
}
function provider(): ProviderHandle {
  const doc = new Y.Doc(); cleanup.push(() => doc.destroy())
  const state = {connection:'connected' as const,synchronized:true,shouldConnect:true}
  return {doc,awareness:null,lifecycle:{get:() => state,subscribe:listener => {listener(state); return () => {}}},whenRenderable:Promise.resolve(),whenEditable:Promise.resolve(),whenSynced:Promise.resolve(),renderSource:Promise.resolve('live'),destroy:vi.fn()}
}
function service(openDocument: DevelopmentWorkspaceService['openDocument']): DevelopmentWorkspaceService {
  return {listRifts:async () => [snapshot('alpha').rift,snapshot('beta').rift],inspectRift:async id => snapshot(id),openDocument,synchronize:async id => snapshot(id),checkpoint:async id => snapshot(id),executeCell:async () => {throw new Error('No notebook in this test')}}
}

describe('development workspace leases',() => {
  it('accepts successful empty process input and resize responses',async()=>{
    const backend=new HttpDevelopmentWorkspaceService({baseUrl:'/development',fetch:vi.fn(async()=>new Response(null,{status:204})),openDocument:async()=>provider()})
    await expect(backend.ide.request('alpha','task-input',{taskId:'shell',input:'ls\n'})).resolves.toBeUndefined()
    await expect(backend.ide.request('alpha','task-resize',{taskId:'shell',cols:80,rows:24})).resolves.toBeUndefined()
  })

  it('disposes an old asynchronous document open after selecting another Rift',async () => {
    const alpha = provider(), beta = provider()
    let releaseAlpha!: (handle: ProviderHandle) => void
    const delayed = new Promise<ProviderHandle>(resolve => {releaseAlpha = resolve})
    const controller = new DevelopmentWorkspaceController(service(async id => id === 'alpha' ? delayed : beta))
    cleanup.push(() => controller.dispose())
    const openingAlpha = controller.refresh()
    await vi.waitFor(() => expect(controller.snapshot.selectedFileId).toBe('alpha:file'))
    await controller.selectRift('beta')
    releaseAlpha(alpha); await openingAlpha
    expect(alpha.destroy).toHaveBeenCalledOnce()
    expect(beta.destroy).not.toHaveBeenCalled()
    expect(controller.snapshot.workspace!.rift.id).toBe('beta')
    expect(controller.snapshot.document!.documentId).toBe('beta:document')
    controller.dispose()
    expect(beta.destroy).toHaveBeenCalledOnce()
  })

  it('retains the same document lease on refresh, flags shared edits dirty and releases on leaving',async () => {
    const opened = provider()
    const backend = service(vi.fn(async () => opened))
    const controller = new DevelopmentWorkspaceController(backend)
    await controller.refresh()
    ;(opened.doc as Y.Doc).getText('test-agent-change').insert(0,'agent edit')
    expect(controller.snapshot.workspace!.files[0]!.syncState).toBe('dirty')
    await controller.refresh()
    expect(backend.openDocument).toHaveBeenCalledOnce()
    expect(opened.destroy).not.toHaveBeenCalled()
    controller.dispose()
    expect(opened.destroy).toHaveBeenCalledOnce()
  })

  it('uses the agreed HTTP contract and injected auth without sending editable text snapshots',async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({id:'execution'}),{status:200}))
    const backend = new HttpDevelopmentWorkspaceService({baseUrl:'http://localhost:43119',headers:async () => ({Authorization:'Bearer test-only'}),fetch:fetchMock,openDocument:async () => provider()})
    await backend.executeCell('alpha/rift','document-a','cell-stable')
    const [url,options] = fetchMock.mock.calls[0] as unknown as [string,RequestInit]
    expect(url).toBe('http://localhost:43119/rifts/alpha%2Frift/execute')
    expect(options.body).toBe(JSON.stringify({notebookDocumentId:'document-a',cellId:'cell-stable'}))
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-only')
  })
})
