import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import {createHash} from 'node:crypto'
import type {DevelopmentWorkspaceService,DevelopmentRiftSnapshot,ProviderHandle,IdeFile,DevelopmentIdeService,IdeLanguageResult} from '@shrubbery/nucleus'
import {DevelopmentIdeController} from '../development-ide-controller.js'

const cleanup:(()=>void)[]=[]
afterEach(()=>cleanup.splice(0).forEach(dispose=>dispose()))
const workspace:DevelopmentRiftSnapshot={rift:{id:'alpha',name:'Alpha',project:'Repository',baseRevision:'base'},observedAt:'2026-09-19T00:00:00Z',participants:[],environments:[],files:[],runs:[],ide:{projectRootLabel:'Shrubbery',enabled:true}}
const entry=(path:string):IdeFile=>({path,fileId:path,bytes:20,mode:'100644',tracked:true,gitStatus:'',kind:'text',editable:true,diskVersion:'disk:original'})
function fixture(){
  const text='export const answer = 42\n',doc=new Y.Doc(),block=new Y.XmlElement('codeBlock'),body=new Y.XmlText()
  block.setAttribute('data-block-id','body');body.insert(0,text);block.insert(0,[body]);doc.getXmlFragment('content').insert(0,[block]);cleanup.push(()=>doc.destroy())
  const lifecycle={connection:'connected' as const,synchronized:true,shouldConnect:true}
  const provider:ProviderHandle={doc,awareness:null,lifecycle:{get:()=>lifecycle,subscribe:()=>()=>{}},whenRenderable:Promise.resolve(),whenEditable:Promise.resolve(),whenSynced:Promise.resolve(),renderSource:Promise.resolve('live'),destroy:vi.fn()}
  const request=vi.fn(async(_rift:string,operation:string,args:Record<string,unknown>):Promise<unknown>=>{
    if(operation==='files')return{files:[entry(String(args.prefix??'source.ts'))],directories:[],total:1,revision:'r'}
    if(operation==='open')return{id:'source',documentId:'doc',blockId:'body',path:args.path,language:'typescript',kind:'source'}
    if(operation==='task-list')return{tasks:[]};if(operation==='assignments')return{assignments:[]};if(operation==='git-status')return{files:[]}
    if(operation==='task-log')return{text:'retained output\n',cursor:16}
    throw new Error(`Unexpected ${operation}`)
  })
  const service:DevelopmentWorkspaceService={ide:{request:request as DevelopmentIdeService['request'],artifactUrl:()=>'/artifact'},openDocument:vi.fn(async()=>provider),inspectRift:async()=>workspace,listRifts:async()=>[workspace.rift],synchronize:async()=>workspace,checkpoint:async()=>workspace,executeCell:async()=>{throw new Error('notebook not used')}}
  const controller=new DevelopmentIdeController(service,'alpha',workspace,()=>{});cleanup.push(()=>controller.dispose())
  return{controller,service,request,provider,doc,body,text}
}

describe('repository workbench controller',()=>{
  it('loads only metadata initially and shares one lease across tabs/splits until the tab closes',async()=>{
    const {controller,service,provider}=fixture();await controller.initialize()
    expect(service.openDocument).not.toHaveBeenCalled()
    await controller.open('source.ts');await controller.handleIntent({action:'split'});await controller.open('source.ts',undefined,1)
    expect(service.openDocument).toHaveBeenCalledOnce();expect(controller.snapshot.active).toEqual(['source.ts','source.ts'])
    await controller.handleIntent({action:'split'});expect(provider.destroy).not.toHaveBeenCalled()
    await controller.handleIntent({action:'close-tab',id:'source.ts'});expect(provider.destroy).toHaveBeenCalledOnce()
    await controller.open('source.ts');expect(service.openDocument).toHaveBeenCalledTimes(2)
  })
  it('releases a provider returned after the Rift controller was disposed',async()=>{
    const {controller,service,provider}=fixture();let resolve!:(provider:ProviderHandle)=>void
    service.openDocument=vi.fn(()=>new Promise<ProviderHandle>(r=>{resolve=r}))
    const opening=controller.open('source.ts');await vi.waitFor(()=>expect(service.openDocument).toHaveBeenCalledOnce())
    controller.dispose();resolve(provider);await opening;expect(provider.destroy).toHaveBeenCalledOnce()
  })
  it('ignores stale tree responses and does not open document bodies when filtering',async()=>{
    const {controller,request,service}=fixture();let resolve!:(value:unknown)=>void
    request.mockImplementationOnce(()=>new Promise(r=>{resolve=r}))
    const stale=controller.loadFiles();await controller.loadFiles()
    const requests=request.mock.calls.length
    await controller.handleIntent({action:'filter',query:'old'});await controller.handleIntent({action:'directory',path:'packages'})
    resolve({files:[entry('old.ts')],total:1,revision:'old'});await stale
    expect(controller.snapshot.directory).toBe('packages');expect(controller.snapshot.tree.revision).toBe('r');expect(service.openDocument).not.toHaveBeenCalled();expect(request.mock.calls.length).toBe(requests)
  })
  it('keeps the previous complete tree when the metadata response is truncated',async()=>{
    const {controller,request,service}=fixture();await controller.loadFiles()
    request.mockResolvedValueOnce({files:[entry('partial.ts')],total:30000,revision:'incomplete'})
    await controller.loadFiles()
    expect(controller.snapshot.tree.revision).toBe('r')
    expect(controller.snapshot.error).toContain('complete metadata snapshot')
    expect(service.openDocument).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledWith('alpha','files',{limit:25000})
  })
  it('follows a remote rename by file ID without replacing the shared document or lease',async()=>{
    const {controller,request,provider,service}=fixture();await controller.open('source.ts')
    request.mockResolvedValueOnce({files:[{...entry('nested/remote.ts'),fileId:'source.ts',diskVersion:'disk:remote'}],total:1,revision:'remote'})
    await controller.loadFiles()
    expect(controller.snapshot.tabs[0]!.entry.path).toBe('nested/remote.ts')
    expect(controller.snapshot.tabs[0]!.file!.path).toBe('nested/remote.ts')
    expect(controller.snapshot.tabs[0]!.provider).toBe(provider)
    await controller.open('nested/remote.ts')
    expect(service.openDocument).toHaveBeenCalledOnce();expect(provider.destroy).not.toHaveBeenCalled()
    expect(controller.snapshot.active[0]).toBe('source.ts')
  })
  it('leaves file identity and path unchanged when an authoritative rename is refused',async()=>{
    const {controller,request,provider}=fixture();await controller.open('source.ts')
    request.mockRejectedValueOnce(new Error('File changed before rename'))
    await controller.handleIntent({action:'rename-file',newPath:'rejected.ts'})
    expect(controller.snapshot.tabs[0]!.entry.path).toBe('source.ts')
    expect(controller.snapshot.tabs[0]!.provider).toBe(provider)
    expect(controller.snapshot.error).toContain('File changed before rename')
  })
  it('does not reopen quick-open after a pending query returns past file selection',async()=>{
    const {controller,request}=fixture();await controller.open('source.ts');await controller.handleIntent({action:'quick-open'});expect(request).toHaveBeenCalledWith('alpha','files',{query:'',fuzzy:true,limit:60})
    let resolve!:(value:unknown)=>void;request.mockImplementationOnce(()=>new Promise(r=>{resolve=r}))
    const query=controller.handleIntent({action:'quick-query',query:'source'});await controller.handleIntent({action:'activate-tab',id:'source.ts'})
    resolve({files:[entry('source.ts')],total:1,revision:'r'});await query
    expect(controller.snapshot.quickOpen.open).toBe(false)
    const count=request.mock.calls.length;await controller.handleIntent({action:'quick-query',query:'late debounce'});expect(request.mock.calls.length).toBe(count)
  })
  it('rejects stale language output against the exact shared source and only applies reviewed changes by id',async()=>{
    const {controller,request,text,body}=fixture();await controller.open('source.ts')
    const envelope:IdeLanguageResult={riftId:'alpha',path:'source.ts',generation:1,project:'tsconfig.json',sourceVersion:'v1',sourceHash:createHash('sha256').update(text).digest('hex'),durationMs:1,truncated:false,result:{kind:'format',files:[]},review:{id:'review-1',status:'proposed',files:[{path:'source.ts',before:text,after:text+'\n',expectedVersion:'v1'}]}}
    request.mockResolvedValueOnce(envelope);await controller.handleIntent({action:'language',operation:'format'})
    expect(controller.snapshot.review?.id).toBe('review-1');expect(body.toString()).toBe(text)
    request.mockResolvedValueOnce({...envelope.review,status:'applied'});request.mockResolvedValueOnce({files:[]})
    await controller.handleIntent({action:'apply-review'});expect(request).toHaveBeenCalledWith('alpha','apply-review',{reviewId:'review-1'})
    let resolve!:(value:unknown)=>void;request.mockImplementationOnce(()=>new Promise(r=>{resolve=r}))
    const stale=controller.snapshot.tabs[0]!.tools!.completions({source:text,offset:10});body.insert(0,'// teammate\n');resolve({...envelope,result:{kind:'completions',items:[]}})
    await expect(stale).rejects.toThrow('Source changed');expect(controller.snapshot.review?.status).toBe('source-changed')
  })
  it('uses fresh disk metadata after a nested file rename for subsequent deletion',async()=>{
    const {controller,request}=fixture();await controller.open('source.ts')
    const original=request.getMockImplementation()!
    request.mockImplementation(async(rift,operation,args)=>{
      if(operation==='rename-file'||operation==='delete-file')return{}
      if(operation==='files'&&args.prefix==='nested/renamed.ts')return{files:[{...entry('nested/renamed.ts'),diskVersion:'disk:renamed'}],total:1,revision:'new'}
      return original(rift,operation,args)
    })
    await controller.handleIntent({action:'rename-file',newPath:'nested/renamed.ts'})
    await controller.handleIntent({action:'delete-file'})
    expect(request).toHaveBeenCalledWith('alpha','delete-file',{path:'nested/renamed.ts',expectedDiskVersion:'disk:renamed'})
  })
  it('reattaches retained task logs and forwards raw PTY input/resize without claiming process ownership',async()=>{
    const {controller,request}=fixture();await controller.handleIntent({action:'task-select',id:'retained-task'})
    expect(controller.snapshot.log).toBe('retained output\n')
    request.mockResolvedValue(undefined);await controller.handleIntent({action:'task-input',text:'\u0003',raw:true});await controller.handleIntent({action:'task-resize',cols:90,rows:24})
    expect(request).toHaveBeenCalledWith('alpha','task-input',{taskId:'retained-task',input:'\u0003'})
    expect(request).toHaveBeenCalledWith('alpha','task-resize',{taskId:'retained-task',cols:90,rows:24})
    controller.dispose();expect(request.mock.calls.some(call=>call[1]==='task-cancel')).toBe(false)
  })
})
