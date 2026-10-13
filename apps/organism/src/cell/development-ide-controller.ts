import * as Y from 'yjs'
import type {
  DevelopmentWorkspaceService,DevelopmentIdeService,DevelopmentIdeState,DevelopmentIdeIntent,DevelopmentRiftSnapshot,
  IdeTab,IdeLanguageOperation,DevelopmentEditorInput,DevelopmentEditorTools,IdeTask,
} from '@shrubbery/nucleus'
import {gardenCodeSource,gardenCodeText} from '@shrubbery/runtime/collab/development-code-editor'
import { sha256Digest } from '@shrubbery/nucleus/web-crypto'

const MAX_TREE_FILES=25_000,MAX_TABS=24,MAX_LOG=150_000
function initial():DevelopmentIdeState {
  return {tree:{files:[],directories:[],total:0,revision:''},directory:'',filter:'',treePending:false,quickOpen:{open:false,query:'',pending:false,files:[]},search:{query:'',pending:false,matches:[],truncated:false},tabs:[],active:[null,null],focusPane:0,split:false,panel:'problems',panelOpen:true,diagnostics:[],locations:[],languageStatus:'TypeScript ready on first request',cursor:{offset:0,line:0,column:0},reveal:null,review:null,git:null,diff:'',tasks:[],selectedTaskId:null,log:'',previewUrl:null,assignments:[],presence:[],renameRequest:0,checkpointId:null,commit:null,pending:null,error:''}
}
function message(error:unknown):string {return error instanceof Error?error.message:String(error)}
async function hash(text:string):Promise<string> {
  return Array.from(new Uint8Array(await sha256Digest(new TextEncoder().encode(text))),byte=>byte.toString(16).padStart(2,'0')).join('')
}
function offsetAt(text:string,line:number,column:number):number {
  const lines=text.split('\n');let offset=0
  for(let index=0;index<Math.min(line,lines.length-1);index++)offset+=lines[index]!.length+1
  return Math.min(text.length,offset+Math.min(column,lines[Math.min(line,lines.length-1)]!.length))
}

/** Bounded lazy provider pool. Its only text authority is the leased Garden document. */
export class DevelopmentIdeController {
  private state=initial()
  private listeners=new Set<(state:DevelopmentIdeState)=>void>()
  private cleanups=new Map<string,()=>void>()
  private opening=new Map<string,Promise<void>>()
  private disposed=false
  private navigationEpoch=0
  private treeEpoch=0
  private quickEpoch=0
  private searchEpoch=0
  private languageEpoch=new Map<string,number>()
  private pollTimer:ReturnType<typeof setTimeout>|null=null
  private logCursor=0
  private polling=false
  private pollRound=0
  private inputQueue:Promise<void>=Promise.resolve()
  private readonly api:DevelopmentIdeService
  constructor(private readonly service:DevelopmentWorkspaceService,private readonly riftId:string,workspace:DevelopmentRiftSnapshot,private readonly onWorkspace:(workspace:DevelopmentRiftSnapshot)=>void) {
    if(!service.ide)throw new Error('Repository service is unavailable')
    this.api=service.ide
    this.state={...this.state,checkpointId:workspace.rift.checkpointId??null}
  }
  get snapshot():DevelopmentIdeState{return this.state}
  subscribe(listener:(state:DevelopmentIdeState)=>void):()=>void{this.listeners.add(listener);listener(this.state);return()=>{this.listeners.delete(listener)}}
  private set(patch:Partial<DevelopmentIdeState>):void{if(this.disposed)return;this.state={...this.state,...patch};this.listeners.forEach(listener=>listener(this.state))}
  private fail(error:unknown):void{this.set({error:message(error),pending:null})}
  async initialize():Promise<void>{await Promise.all([this.loadFiles(),this.refreshTasks(),this.refreshGit(),this.refreshAssignments()]);this.schedulePoll()}
  updateWorkspace(workspace:DevelopmentRiftSnapshot):void{
    this.set({checkpointId:workspace.rift.checkpointId??this.state.checkpointId,tabs:this.state.tabs.map(tab=>{
      const file=workspace.files.find(file=>file.documentId===tab.file?.documentId)
      return file?{...tab,file,dirty:file.syncState==='dirty'||file.syncState==='conflict'}:tab
    })})
    // A complete metadata snapshot also follows remote renames by stable file ID.
    if(!this.state.treePending)void this.loadFiles(true)
  }
  private async refreshWorkspace():Promise<void>{const workspace=await this.service.inspectRift(this.riftId);if(!this.disposed){this.updateWorkspace(workspace);this.onWorkspace(workspace)}}

  async loadFiles(background=false):Promise<void>{
    const epoch=++this.treeEpoch
    this.set({treePending:true,...(background?{}:{error:''})})
    try{
      // One bounded snapshot; no bodies or document leases. Never combine pages
      // from different filesystem revisions or advertise an incomplete tree.
      const page=await this.api.request(this.riftId,'files',{limit:MAX_TREE_FILES})
      if(epoch!==this.treeEpoch||this.disposed)return
      if(page.files.length!==page.total)throw new Error(`Repository explorer needs a complete metadata snapshot (${page.files.length} of ${page.total} files; limit ${MAX_TREE_FILES}). Quick open remains available.`)
      const byId=new Map(page.files.map(file=>[file.fileId,file]))
      if(byId.size!==page.files.length||new Set(page.files.map(file=>file.path)).size!==page.files.length)throw new Error('Repository metadata has duplicate file identities or paths.')
      const tabs=this.state.tabs.map(tab=>{
        const entry=byId.get(tab.entry.fileId)
        if(!entry)return{...tab,error:'File was removed from this Rift. Its shared document is retained.'}
        return{...tab,entry,file:tab.file?{...tab.file,path:entry.path}:null,error:tab.error.startsWith('File was removed')?'':tab.error}
      })
      const documentPaths=new Map(tabs.filter(tab=>tab.file).map(tab=>[tab.file!.documentId,tab.entry.path]))
      this.set({tree:page,treePending:false,tabs,presence:this.state.presence.map(person=>({...person,path:documentPaths.get(person.documentId)??person.path}))})
    }catch(error){if(epoch===this.treeEpoch){this.set({treePending:false});this.fail(error)}}
  }
  private async quickQuery(query:string):Promise<void>{
    const epoch=++this.quickEpoch;this.set({quickOpen:{...this.state.quickOpen,query,pending:true}})
    try{const result=await this.api.request(this.riftId,'files',{query,fuzzy:true,limit:60});if(epoch===this.quickEpoch)this.set({quickOpen:{open:true,query,pending:false,files:result.files}})}
    catch(error){if(epoch===this.quickEpoch){this.set({quickOpen:{...this.state.quickOpen,pending:false}});this.fail(error)}}
  }
  private async search(query:string):Promise<void>{
    const epoch=++this.searchEpoch;this.set({panel:'search',panelOpen:true,search:{query,pending:true,matches:[],truncated:false}})
    try{const result=await this.api.request(this.riftId,'search',{query,maxResults:200});if(epoch===this.searchEpoch)this.set({search:{query,pending:false,...result}})}
    catch(error){if(epoch===this.searchEpoch){this.set({search:{...this.state.search,pending:false}});this.fail(error)}}
  }
  private tab(id:string):IdeTab|undefined{return this.state.tabs.find(tab=>tab.id===id)}
  private activeTab():IdeTab|undefined{return this.tab(this.state.active[this.state.focusPane]??'')}
  private patchTab(id:string,patch:Partial<IdeTab>):void{this.set({tabs:this.state.tabs.map(tab=>tab.id===id?{...tab,...patch}:tab)})}
  private activate(id:string,pane:0|1=this.state.focusPane):void{this.quickEpoch++;const active:[string|null,string|null]=[...this.state.active];active[pane]=id;this.set({active,focusPane:pane,quickOpen:{...this.state.quickOpen,open:false}})}
  private source(tab:IdeTab):string{
    if(!tab.provider||!tab.file?.blockId)throw new Error('This item is not an editable source file')
    return gardenCodeSource(gardenCodeText(tab.provider.doc as Y.Doc,tab.file.blockId))
  }
  async open(path:string,reveal?:{offset?:number;line?:number;column?:number},pane:0|1=this.state.focusPane):Promise<void>{
    const epoch=++this.navigationEpoch
    let tab=this.state.tabs.find(tab=>tab.entry.path===path)
    if(!tab){
      if(this.state.tabs.length>=MAX_TABS){this.fail(new Error(`Close a tab before opening more than ${MAX_TABS} shared documents.`));return}
      if(this.opening.has(path)){await this.opening.get(path);tab=this.state.tabs.find(tab=>tab.entry.path===path)}
      else{
        const opening=this.loadTab(path);this.opening.set(path,opening)
        try{await opening}finally{this.opening.delete(path)}
        tab=this.state.tabs.find(tab=>tab.entry.path===path)
      }
    }
    if(!tab||this.disposed||epoch!==this.navigationEpoch)return
    this.activate(tab.id,pane)
    if(reveal&&tab.provider){
      await tab.provider.whenRenderable
      if(this.disposed||epoch!==this.navigationEpoch)return
      const offset=reveal.offset??offsetAt(this.source(tab),reveal.line??0,reveal.column??0)
      this.set({reveal:{tabId:tab.id,offset,token:Date.now()}})
    }
  }
  private async loadTab(path:string):Promise<void>{
    this.set({pending:`Opening ${path}`,error:''})
    try{
      let entry=[...this.state.tree.files,...this.state.quickOpen.files].find(entry=>entry.path===path)
      if(!entry){const found=await this.api.request(this.riftId,'files',{prefix:path,limit:50});entry=found.files.find(item=>item.path===path)}
      if(!entry)throw new Error(`File is not indexed: ${path}`)
      if(this.disposed)return
      const id=entry.fileId
      const tab:IdeTab={id,entry,file:null,provider:null,tools:null,dirty:false,loading:true,error:''}
      this.set({tabs:[...this.state.tabs,tab]})
      if(!entry.editable){
        const preview=await this.api.request(this.riftId,'file-preview',{path,length:128*1024})
        this.patchTab(id,{preview,artifactUrl:this.api.artifactUrl(this.riftId,path),loading:false})
      }else{
        const file=await this.api.request(this.riftId,'open',{path})
        const provider=await this.service.openDocument(this.riftId,file.documentId)
        if(this.disposed||!this.tab(id)){provider.destroy();return}
        this.patchTab(id,{file,provider,loading:false,tools:/\.[cm]?[jt]sx?$/.test(path)?this.editorTools(id):null})
        await provider.whenSynced
        if(this.disposed||!this.tab(id))return
        const doc=provider.doc as Y.Doc
        const awareness=provider.awareness as {getStates?:()=>Map<number,{user?:{name?:string;userId?:string};presence?:{publishedAt?:number}}> ;on?:(event:string,listener:()=>void)=>void;off?:(event:string,listener:()=>void)=>void}
        const onPresence=():void=>{
          const observedAt=new Date().toISOString()
          const presence=[...awareness?.getStates?.().entries()??[]].filter(([,state])=>state.user?.name||state.user?.userId).map(([clientId,state])=>({id:`${file.documentId}:${clientId}`,name:state.user?.name??state.user?.userId??'Unnamed peer',documentId:file.documentId,path:this.tab(id)?.entry.path??path,local:clientId===doc.clientID,observedAt}))
          this.set({presence:[...this.state.presence.filter(item=>item.documentId!==file.documentId),...presence]})
        }
        onPresence();awareness?.on?.('change',onPresence)
        const onUpdate=():void=>{this.patchTab(id,{dirty:true});if(this.state.review?.files.some(file=>file.path===this.tab(id)?.entry.path))this.set({review:{...this.state.review,status:'source-changed'}})}
        doc.on('update',onUpdate);this.cleanups.set(id,()=>{doc.off('update',onUpdate);awareness?.off?.('change',onPresence);provider.destroy();this.set({presence:this.state.presence.filter(item=>item.documentId!==file.documentId)})})
      }
      this.set({pending:null})
    }catch(error){const tab=this.state.tabs.find(tab=>tab.entry.path===path);if(tab)this.patchTab(tab.id,{loading:false,error:message(error)});this.fail(error)}
  }
  private closeTab(id:string):void{
    this.navigationEpoch++
    const tab=this.tab(id);if(!tab)return
    const cleanup=this.cleanups.get(id)
    if(cleanup)cleanup();else tab.provider?.destroy()
    this.cleanups.delete(id)
    const tabs=this.state.tabs.filter(tab=>tab.id!==id),fallback=tabs.at(-1)?.id??null
    this.set({tabs,active:this.state.active.map(active=>active===id?fallback:active) as [string|null,string|null]})
  }
  private editorTools(id:string):DevelopmentEditorTools{
    return {
      diagnostics:async input=>{
        const envelope=await this.language(id,'diagnostics',input)
        if(envelope.result.kind!=='diagnostics')return[]
        const tab=this.tab(id)
        if(tab)this.set({diagnostics:[...this.state.diagnostics.filter(item=>item.path!==tab.entry.path),...envelope.result.items]})
        return envelope.result.items.filter(item=>item.path===tab?.entry.path).map(item=>({from:item.start,to:item.start+item.length,severity:item.severity,message:`${item.message} (TS${item.code})`}))
      },
      completions:async input=>{const result=await this.language(id,'completions',input);return result.result.kind==='completions'?result.result.items:[]},
      hover:async input=>{const envelope=await this.language(id,'hover',input);const result=envelope.result;return result.kind==='hover'&&result.display?{from:result.start??input.offset,to:(result.start??input.offset)+(result.length??0),text:[result.display,result.documentation].filter(Boolean).join('\n\n')}:null},
      command:(operation,input)=>{if(operation==='rename'){this.set({renameRequest:this.state.renameRequest+1});return}void this.runLanguage(id,operation,input)},
      selection:(offset,line,column)=>{this.set({cursor:{offset,line,column}})},
    }
  }
  private async language(id:string,operation:IdeLanguageOperation,input:DevelopmentEditorInput,newName?:string){
    const tab=this.tab(id);if(!tab)throw new Error('The source tab was closed')
    const key=`${id}:${operation}`,epoch=(this.languageEpoch.get(key)??0)+1;this.languageEpoch.set(key,epoch)
    try{
      const [result,sourceHash]=await Promise.all([
        this.api.request(this.riftId,'language',{path:tab.entry.path,operation,offset:input.offset,...(newName?{newName}:{})}),hash(input.source),
      ])
      if(this.disposed||this.languageEpoch.get(key)!==epoch||!this.tab(id)||this.source(this.tab(id)!)!==input.source||result.sourceHash!==sourceHash)throw new Error('Source changed while the language service was reading it. Retry on the current shared source.')
      this.set({languageStatus:`TypeScript · ${result.project} · generation ${result.generation} · ${Math.round(result.durationMs)} ms`})
      return result
    }catch(error){this.set({languageStatus:message(error)});throw error}
  }
  private async runLanguage(id:string,operation:IdeLanguageOperation,input?:DevelopmentEditorInput,newName?:string):Promise<void>{
    const tab=this.tab(id);if(!tab)return
    this.set({pending:operation==='format'||operation==='rename'?'Preparing edit review':null,error:''})
    try{
      const result=await this.language(id,operation,input??{source:this.source(tab),offset:this.state.cursor.offset},newName)
      if(result.review)this.set({review:result.review,panel:'changes',panelOpen:true})
      if(result.result.kind==='definitions'||result.result.kind==='references'){
        this.set({locations:result.result.items,panel:'references',panelOpen:true})
        if(result.result.kind==='definitions'&&result.result.items.length===1){const target=result.result.items[0]!;await this.open(target.path,{offset:target.start})}
      }
      if(result.result.kind==='diagnostics')this.set({diagnostics:result.result.items,panel:'problems',panelOpen:true})
      this.set({pending:null})
    }catch(error){this.fail(error)}
  }
  private async refreshGit():Promise<void>{try{const git=await this.api.request(this.riftId,'git-status',{});this.set({git})}catch(error){this.fail(error)}}
  private async refreshAssignments():Promise<void>{try{const result=await this.api.request(this.riftId,'assignments',{});this.set({assignments:result.assignments})}catch(error){this.fail(error)}}
  private async refreshTasks():Promise<void>{try{const result=await this.api.request(this.riftId,'task-list',{});this.set({tasks:result.tasks});const preview=result.tasks.find(task=>task.previewUrl&&['running','starting'].includes(task.status));if(preview?.previewUrl)this.set({previewUrl:preview.previewUrl})}catch(error){this.fail(error)}}
  private async selectTask(id:string):Promise<void>{this.logCursor=0;this.set({selectedTaskId:id,log:'',panel:'terminal',panelOpen:true});await this.pollLog()}
  private async pollLog():Promise<void>{
    const taskId=this.state.selectedTaskId;if(!taskId||this.polling)return
    this.polling=true
    try{const result=await this.api.request(this.riftId,'task-log',{taskId,cursor:this.logCursor});if(this.state.selectedTaskId!==taskId)return;this.logCursor=result.cursor;this.set({log:(this.state.log+result.text).slice(-MAX_LOG),...(result.task?{tasks:this.state.tasks.map(task=>task.id===taskId?result.task!:task)}:{})})}catch(error){this.fail(error)}finally{this.polling=false}
  }
  private schedulePoll():void{if(this.disposed)return;this.pollTimer=setTimeout(()=>{const refreshTree=++this.pollRound%4===0&&!this.state.treePending;void Promise.all([this.refreshTasks(),this.pollLog(),...(refreshTree?[this.loadFiles(true),this.refreshGit()]:[])]).finally(()=>this.schedulePoll())},1500)}
  private async recordTask(task:IdeTask):Promise<void>{this.set({tasks:[task,...this.state.tasks.filter(item=>item.id!==task.id)],...(task.previewUrl?{previewUrl:task.previewUrl}:{})});await this.selectTask(task.id)}

  async handleIntent(intent:DevelopmentIdeIntent):Promise<void>{
    if(this.disposed)return
    const tab=this.activeTab()
    try{
      switch(intent.action){
        case'directory':this.set({directory:intent.path??'',filter:''});return
        case'filter':this.set({filter:intent.query??''});return
        case'more-files':if(!this.state.treePending)await Promise.all([this.loadFiles(),this.refreshGit()]);return
        case'open':if(intent.path)return this.open(intent.path,{offset:intent.offset,line:intent.line,column:intent.column},intent.pane);return
        case'close-tab':if(intent.id)this.closeTab(intent.id);return
        case'activate-tab':if(intent.id)this.activate(intent.id,intent.pane);return
        case'split':this.set({split:!this.state.split,active:[this.state.active[0],this.state.active[1]??this.state.active[0]],focusPane:0});return
        case'focus-pane':this.set({focusPane:intent.pane??0});return
        case'quick-open':if(intent.query==='close'){this.quickEpoch++;this.set({quickOpen:{...this.state.quickOpen,open:false}});return}this.set({quickOpen:{...this.state.quickOpen,open:true}});return this.quickQuery('')
        case'quick-query':if(this.state.quickOpen.open)return this.quickQuery(intent.query??'');return
        case'search':return this.search(intent.query??'')
        case'panel':this.set({panel:intent.panel??'problems',panelOpen:intent.query!=='close'});return
        case'language':if(tab&&intent.operation)return this.runLanguage(tab.id,intent.operation,undefined,intent.newName);return
        case'review-disk':this.set({pending:'Reviewing disk changes'});this.set({review:await this.api.request(this.riftId,'review-disk',{}),pending:null,panel:'changes',panelOpen:true});return
        case'dismiss-review':this.set({review:null});return
        case'apply-review':if(this.state.review){this.set({pending:'Applying reviewed changes'});const review=await this.api.request(this.riftId,'apply-review',{reviewId:this.state.review.id});this.set({review,pending:null});await this.refreshGit()}return
        case'create-file':if(!intent.path)return;this.set({pending:'Creating file'});await this.api.request(this.riftId,'create-file',{path:intent.path,text:intent.text??''});await this.loadFiles();await this.open(intent.path);return
        case'rename-file':if(!tab||!intent.newPath)return;this.set({pending:'Renaming file'});await this.api.request(this.riftId,'rename-file',{path:tab.entry.path,newPath:intent.newPath,expectedDiskVersion:tab.entry.diskVersion});this.patchTab(tab.id,{entry:{...tab.entry,path:intent.newPath},file:tab.file?{...tab.file,path:intent.newPath}:null});{const page=await this.api.request(this.riftId,'files',{prefix:intent.newPath,limit:50});const entry=page.files.find(file=>file.path===intent.newPath);if(entry)this.patchTab(tab.id,{entry});else throw new Error('Renamed file metadata is not yet available. Refresh before another file operation.')}await this.loadFiles();await this.refreshGit();break
        case'delete-file':if(!tab)return;this.set({pending:'Deleting file'});await this.api.request(this.riftId,'delete-file',{path:tab.entry.path,expectedDiskVersion:tab.entry.diskVersion});this.closeTab(tab.id);await this.loadFiles();await this.refreshGit();break
        case'git-refresh':return this.refreshGit()
        case'git-diff':{const result=await this.api.request(this.riftId,'git-diff',{...(intent.path?{path:intent.path}:{})});this.set({diff:result.diff,panel:'changes',panelOpen:true});return}
        case'checkpoint':{this.set({pending:'Capturing source checkpoint'});const result=await this.api.request(this.riftId,'checkpoint',{});this.set({checkpointId:result.checkpoint.id});await this.refreshWorkspace();await this.refreshGit();break}
        case'commit':if(!this.state.checkpointId)throw new Error('Create a checkpoint before committing its immutable source.');this.set({pending:'Committing checkpoint'});this.set({commit:await this.api.request(this.riftId,'commit',{checkpointId:this.state.checkpointId,message:intent.text??'',...(this.state.git?.head?{expectedParent:this.state.git.head}:{})})});break
        case'task-start':if(!intent.command)return;await this.recordTask(await this.api.request(this.riftId,'task-start',{command:intent.command,cwd:intent.cwd??'.',kind:intent.command==='/bin/sh'?'terminal':'task'}));return
        case'task-select':if(intent.id)return this.selectTask(intent.id);return
        case'task-input':if(this.state.selectedTaskId){const taskId=this.state.selectedTaskId,input=`${intent.text??''}${intent.raw?'':'\n'}`;const sending=this.inputQueue.then(()=>this.api.request(this.riftId,'task-input',{taskId,input})).then(()=>{});this.inputQueue=sending.catch(()=>{});await sending}return
        case'task-resize':if(this.state.selectedTaskId&&intent.cols&&intent.rows)await this.api.request(this.riftId,'task-resize',{taskId:this.state.selectedTaskId,cols:intent.cols,rows:intent.rows});return
        case'task-cancel':if(this.state.selectedTaskId)await this.recordTask(await this.api.request(this.riftId,'task-cancel',{taskId:this.state.selectedTaskId}));return
        case'task-restart':if(this.state.selectedTaskId)await this.recordTask(await this.api.request(this.riftId,'task-restart',{taskId:this.state.selectedTaskId}));return
        case'preview-start':{this.set({pending:'Starting Rift preview'});const task=await this.api.request(this.riftId,'preview-start',{});await this.recordTask(task);this.set({panel:'preview',panelOpen:true});break}
        case'assign-task':if(intent.name&&intent.text){await this.api.request(this.riftId,'assign-task',{name:intent.name,task:intent.text});await this.refreshAssignments()}return
        case'refresh-tasks':return this.refreshTasks()
        case'run-cell':if(tab?.file?.kind==='notebook'&&intent.id){this.set({pending:'Running notebook cell'});await this.service.executeCell(this.riftId,tab.file.documentId,intent.id);await this.refreshWorkspace()}break
      }
      this.set({pending:null})
    }catch(error){this.fail(error)}
  }
  dispose():void{this.disposed=true;this.navigationEpoch++;this.treeEpoch++;this.quickEpoch++;this.searchEpoch++;if(this.pollTimer)clearTimeout(this.pollTimer);for(const tab of this.state.tabs){const cleanup=this.cleanups.get(tab.id);if(cleanup)cleanup();else tab.provider?.destroy()}this.cleanups.clear();this.listeners.clear()}
}
