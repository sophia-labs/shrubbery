import {afterEach,expect,it} from 'vitest'
import type {DevelopmentIdeState,DevelopmentWorkspaceViewState,DevelopmentWorkspaceIntent,IdeFile} from '@shrubbery/nucleus'
import '../wf-development-ide.js'

afterEach(()=>document.body.replaceChildren())
const file=(index:number):IdeFile=>({fileId:String(index),path:`src/file-${index}.ts`,bytes:25,mode:'100644',tracked:true,gitStatus:'',kind:'text',editable:true,diskVersion:'disk:abc'})
const ide:DevelopmentIdeState={tree:{files:Array.from({length:300},(_,index)=>file(index)),total:1915,revision:'r'},directory:'',filter:'',treePending:false,quickOpen:{open:false,query:'',pending:false,files:[]},search:{query:'',pending:false,matches:[],truncated:false},tabs:[],active:[null,null],focusPane:0,split:false,panel:'problems',panelOpen:true,diagnostics:[],locations:[],languageStatus:'Ready',cursor:{offset:0,line:0,column:0},reveal:null,review:null,git:null,diff:'',tasks:[],selectedTaskId:null,log:'',previewUrl:null,assignments:[],presence:[],renameRequest:0,checkpointId:null,commit:null,pending:null,error:''}
const rift={id:'alpha',name:'Alpha',project:'Shrubbery',baseRevision:'base'}
const state:DevelopmentWorkspaceViewState={status:'ready',pending:null,error:'',rifts:[rift],selectedRiftId:'alpha',selectedFileId:'',selectedEnvironmentId:'',document:null,workspace:{rift,observedAt:'now',files:[],environments:[],participants:[],runs:[],ide:{projectRootLabel:'Shrubbery',enabled:true}},ide}
async function mount(next=state){const element=document.createElement('wf-development-ide');element.state=next;document.body.append(element);await element.updateComplete;return element}
function clickText(element:HTMLElement,text:string){const button=Array.from(element.shadowRoot!.querySelectorAll('button')).find(item=>item.textContent?.trim()===text);expect(button).toBeTruthy();button!.click()}

it('routes Rift-qualified tree opens through the host and preserves controlled state',async()=>{
  const element=await mount(),intents:DevelopmentWorkspaceIntent[]=[];element.addEventListener('development-workspace-intent',event=>intents.push((event as CustomEvent).detail))
  const tree=element.shadowRoot!.querySelector('wf-repository-tree')!
  tree.dispatchEvent(new CustomEvent('repository-file-open',{detail:{path:'src/file-0.ts',fileId:'0',riftId:'stale-rift'},bubbles:true,composed:true}))
  expect(intents).toEqual([])
  tree.dispatchEvent(new CustomEvent('repository-file-open',{detail:{path:'src/file-0.ts',fileId:'0',riftId:'alpha'},bubbles:true,composed:true}))
  expect(intents[0]).toEqual({action:'ide',ide:{action:'open',path:'src/file-0.ts'}});expect(element.state!.ide!.tabs).toEqual([])
  element.dispatchEvent(new KeyboardEvent('keydown',{key:'p',ctrlKey:true}));expect(intents.at(-1)).toEqual({action:'ide',ide:{action:'quick-open'}})
})

it('keeps a conflicted multi-file review visible and disables applying its obsolete source',async()=>{
  const review={id:'review',status:'conflicted',files:[{path:'src/a.ts',before:'old',after:'new',expectedVersion:'v1'}],conflicts:[{path:'src/a.ts',reason:'Shared source changed'}]}
  const element=await mount({...state,ide:{...ide,panel:'changes',review}})
  expect(element.shadowRoot!.textContent).toContain('Shared source changed');expect(element.shadowRoot!.querySelector('[aria-label="Before src/a.ts"]')!.textContent).toBe('old')
  const apply=Array.from(element.shadowRoot!.querySelectorAll('button')).find(button=>button.textContent==='Apply reviewed changes')!;expect(apply.disabled).toBe(true)
  const intents:DevelopmentWorkspaceIntent[]=[];element.addEventListener('development-workspace-intent',event=>intents.push((event as CustomEvent).detail));clickText(element,'Review disk changes')
  expect(intents).toEqual([{action:'ide',ide:{action:'review-disk'}}])
})

it('separates actual document presence, assignments and timestamped runtime observations',async()=>{
  const element=await mount({...state,workspace:{...state.workspace!,participants:[{id:'runtime',name:'Kernel',kind:'runtime',status:'Observed',observedAt:'runtime-time'}]},ide:{...ide,panel:'team',presence:[{id:'peer',name:'Connected browser',path:'src/a.ts',documentId:'doc-a',local:false,observedAt:'presence-time'}],assignments:[{id:'assignment',name:'Assigned person',kind:'assignment',task:'Review code',status:'Assigned',observedAt:'assignment-time'}]}})
  const text=element.shadowRoot!.textContent!
  expect(text).toContain('Connected document peers');expect(text).toContain('presence-time');expect(text).toContain('Participant assignments');expect(text).toContain('Runtime observations');expect(text).toContain('runtime-time')
})

it('opens F2 rename review entry and reports backend synchronization failures',async()=>{
  const element=await mount();element.state={...state,workspace:{...state.workspace!,ide:{projectRootLabel:'Shrubbery',enabled:true,synchronizationError:'Disk changed outside Garden'}},ide:{...ide,renameRequest:1}};await element.updateComplete;await element.updateComplete
  expect(element.shadowRoot!.querySelector('[aria-label="Rename symbol"]')).not.toBeNull();expect(element.shadowRoot!.querySelector('[role="alert"]')!.textContent).toContain('Disk changed outside Garden')
})
