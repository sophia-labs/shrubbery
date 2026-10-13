import type { DevelopmentWorkspaceService, DevelopmentRift, DevelopmentRiftSnapshot, DevelopmentRun, ProviderHandle } from '@shrubbery/nucleus'
import type { DevelopmentIdeService, DevelopmentIdeOperations } from '@shrubbery/nucleus'

export interface DevelopmentWorkspaceServiceOptions {
  readonly baseUrl: string
  readonly fetch?: typeof fetch
  readonly headers?: () => HeadersInit | Promise<HeadersInit>
  /** Opens an actual Garden document room through the shell's CRDT backend. */
  readonly openDocument: (riftId: string, documentId: string) => Promise<ProviderHandle>
}

export class HttpDevelopmentWorkspaceService implements DevelopmentWorkspaceService {
  readonly ide:DevelopmentIdeService = {
    request:<K extends keyof DevelopmentIdeOperations>(riftId:string,operation:K,args:DevelopmentIdeOperations[K]['args']) => this.request<DevelopmentIdeOperations[K]['result']>(`/rifts/${encodeURIComponent(riftId)}/ide`,{operation,args}),
    artifactUrl:(riftId,path) => `${this.options.baseUrl.replace(/\/$/,'')}/rifts/${encodeURIComponent(riftId)}/artifact?path=${encodeURIComponent(path)}`,
  }
  constructor(private readonly options: DevelopmentWorkspaceServiceOptions) {}
  private async request<T>(path: string, body?: unknown): Promise<T> {
    const headers = new Headers(await this.options.headers?.())
    headers.set('Accept', 'application/json')
    if (body !== undefined) headers.set('Content-Type', 'application/json')
    const response = await (this.options.fetch ?? fetch)(`${this.options.baseUrl.replace(/\/$/, '')}${path}`, {
      method: body === undefined ? 'GET' : 'POST', headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) {
      let detail = ''
      try {
        const error = await response.json() as { error?: string; message?: string }
        detail = error.error ?? error.message ?? ''
      } catch { /* Do not display arbitrary proxy HTML or reflected credentials. */ }
      throw new Error(`Development service: ${response.status}${detail ? ` · ${detail}` : ''}`)
    }
    const text = await response.text()
    return (text.trim() ? JSON.parse(text) : undefined) as T
  }
  listRifts(): Promise<readonly DevelopmentRift[]> { return this.request('/rifts') }
  inspectRift(riftId: string): Promise<DevelopmentRiftSnapshot> { return this.request(`/rifts/${encodeURIComponent(riftId)}`) }
  openDocument(riftId: string, documentId: string): Promise<ProviderHandle> { return this.options.openDocument(riftId, documentId) }
  synchronize(riftId: string): Promise<DevelopmentRiftSnapshot> { return this.request(`/rifts/${encodeURIComponent(riftId)}/synchronize`, {}) }
  checkpoint(riftId: string): Promise<DevelopmentRiftSnapshot> { return this.request(`/rifts/${encodeURIComponent(riftId)}/checkpoint`, {}) }
  executeCell(riftId: string, notebookDocumentId: string, cellId: string): Promise<DevelopmentRun> {
    return this.request(`/rifts/${encodeURIComponent(riftId)}/execute`, { notebookDocumentId, cellId })
  }
}
