import * as Y from 'yjs'
import type { DevelopmentWorkspaceService, DevelopmentWorkspaceViewState, DevelopmentWorkspaceIntent, DevelopmentRiftSnapshot } from '@shrubbery/nucleus'
import { DevelopmentIdeController } from './development-ide-controller.js'

const initial = (): DevelopmentWorkspaceViewState => ({ status:'idle', error:'', pending:null, rifts:[], selectedRiftId:'', selectedFileId:'', selectedEnvironmentId:'', workspace:null, document:null })

/** One selected Rift/document lease; stale asynchronous opens are disposed. */
export class DevelopmentWorkspaceController {
  private state = initial()
  private readonly listeners = new Set<(state: DevelopmentWorkspaceViewState) => void>()
  private epoch = 0
  private fileEpoch = 0
  private disposed = false
  private unobserve = (): void => {}
  private ideController:DevelopmentIdeController|null=null
  private unsubscribeIde=():void=>{}
  constructor(private readonly service: DevelopmentWorkspaceService) {}
  get snapshot(): DevelopmentWorkspaceViewState { return this.state }
  subscribe(listener: (state: DevelopmentWorkspaceViewState) => void): () => void {
    this.listeners.add(listener); listener(this.state)
    return () => { this.listeners.delete(listener) }
  }
  private set(patch: Partial<DevelopmentWorkspaceViewState>): void {
    if (this.disposed) return
    this.state = {...this.state,...patch}
    this.listeners.forEach(listener => listener(this.state))
  }
  private closeDocument(): void {
    this.fileEpoch++
    this.unobserve(); this.unobserve = () => {}
    const document = this.state.document
    this.set({document:null})
    document?.provider.destroy()
  }
  async refresh(): Promise<void> {
    const epoch = ++this.epoch
    this.set({status:'loading',pending:'Reading workspace',error:''})
    try {
      const rifts = await this.service.listRifts()
      if (this.disposed || epoch !== this.epoch) return
      this.set({rifts,pending:null})
      const id = rifts.find(rift => rift.id === this.state.selectedRiftId)?.id ?? rifts[0]?.id
      if (id) await this.selectRift(id, true)
      else { this.closeDocument(); this.set({status:'ready',workspace:null,selectedRiftId:'',selectedFileId:''}) }
    } catch (error) { if (epoch === this.epoch) this.fail(error) }
  }
  async selectRift(id: string, preserveDocument = false): Promise<void> {
    const epoch = ++this.epoch
    const same = id === this.state.selectedRiftId
    if(!same){this.unsubscribeIde();this.ideController?.dispose();this.ideController=null;this.set({ide:null})}
    if (!same || !preserveDocument) this.closeDocument()
    this.set({selectedRiftId:id,status:'loading',pending:'Opening Rift',error:'',...(!same ? {workspace:null,selectedFileId:''} : {})})
    try {
      const workspace = await this.service.inspectRift(id)
      if (this.disposed || epoch !== this.epoch) return
      this.applyWorkspace(workspace)
      if(workspace.ide?.enabled&&this.service.ide){
        if(!this.ideController){
          this.closeDocument()
          this.ideController=new DevelopmentIdeController(this.service,id,workspace,next=>this.applyWorkspace(next))
          this.unsubscribeIde=this.ideController.subscribe(ide=>this.set({ide}))
          await this.ideController.initialize()
        }else this.ideController.updateWorkspace(workspace)
        return
      }
      const fileId = workspace.files.find(file => file.id === this.state.selectedFileId)?.id ?? workspace.files[0]?.id
      if (fileId) await this.selectFile(fileId)
      else this.closeDocument()
    } catch (error) { if (epoch === this.epoch) this.fail(error) }
  }
  private applyWorkspace(workspace: DevelopmentRiftSnapshot): void {
    this.ideController?.updateWorkspace(workspace)
    this.set({workspace,status:'ready',pending:null,rifts:this.state.rifts.map(rift => rift.id === workspace.rift.id ? workspace.rift : rift),
      selectedEnvironmentId:workspace.environments.some(env => env.id === this.state.selectedEnvironmentId) ? this.state.selectedEnvironmentId : workspace.environments[0]?.id ?? ''})
  }
  async selectFile(id: string): Promise<void> {
    const file = this.state.workspace?.files.find(file => file.id === id)
    if (!file || this.disposed) return
    if (this.state.document?.documentId === file.documentId) { this.set({selectedFileId:id}); return }
    this.closeDocument()
    const epoch = ++this.fileEpoch
    const riftId = this.state.selectedRiftId
    this.set({selectedFileId:id,pending:'Opening shared document',error:''})
    try {
      const provider = await this.service.openDocument(riftId,file.documentId)
      if (this.disposed || epoch !== this.fileEpoch || riftId !== this.state.selectedRiftId) { provider.destroy(); return }
      this.set({document:{documentId:file.documentId,provider},pending:null})
      await provider.whenSynced
      if (this.disposed || epoch !== this.fileEpoch) return
      const doc = provider.doc as Y.Doc
      const onUpdate = (): void => {
        const workspace = this.state.workspace
        if (!workspace) return
        this.set({workspace:{...workspace,
          files:workspace.files.map(item => item.id === file.id ? {...item,syncState:'dirty'} : item),
          runs:workspace.runs.map(run => run.notebookDocumentId === file.documentId || run.consumedFiles.some(input => input.path === file.path) ? {...run,stale:true} : run),
        }})
      }
      doc.on('update',onUpdate)
      this.unobserve = () => doc.off('update',onUpdate)
    } catch (error) { if (epoch === this.fileEpoch) this.fail(error) }
  }
  private fail(error: unknown): void { this.set({status:'error',pending:null,error:error instanceof Error ? error.message : String(error)}) }
  async handleIntent(intent: DevelopmentWorkspaceIntent): Promise<void> {
    if (this.disposed) return
    if(intent.action==='ide'&&intent.ide)return this.ideController?.handleIntent(intent.ide)
    if (intent.action === 'select-environment') { this.set({selectedEnvironmentId:intent.id ?? ''}); return }
    if (this.state.pending) return
    if (intent.action === 'refresh') return this.refresh()
    if (intent.action === 'select-rift' && intent.id) return this.selectRift(intent.id)
    if (intent.action === 'select-file' && intent.id) return this.selectFile(intent.id)
    const riftId = this.state.selectedRiftId
    if (!riftId) return
    const epoch = this.epoch
    this.set({pending:intent.action === 'execute' ? 'Running cell' : intent.action === 'checkpoint' ? 'Creating checkpoint' : 'Synchronizing files',error:''})
    try {
      if (intent.action === 'execute') {
        const file = this.state.workspace?.files.find(file => file.id === this.state.selectedFileId)
        if (!file || file.kind !== 'notebook' || !file.cells?.some(cell => cell.id === intent.id && cell.kind === 'code')) throw new Error('Select a notebook code cell to run.')
        const run = await this.service.executeCell(riftId,file.documentId,intent.id!)
        if (epoch !== this.epoch || this.disposed) return
        if (this.state.workspace) this.set({workspace:{...this.state.workspace,runs:[...this.state.workspace.runs.filter(item => item.id !== run.id),run]}})
        const workspace = await this.service.inspectRift(riftId)
        if (epoch === this.epoch) this.applyWorkspace(workspace)
      } else {
        const workspace = intent.action === 'checkpoint' ? await this.service.checkpoint(riftId) : await this.service.synchronize(riftId)
        if (epoch === this.epoch) this.applyWorkspace(workspace)
      }
    } catch (error) { if (epoch === this.epoch) this.fail(error) }
  }
  dispose(): void { this.unsubscribeIde();this.ideController?.dispose();this.closeDocument(); this.disposed = true; this.epoch++; this.listeners.clear() }
}
