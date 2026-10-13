/** Garden document identities and host-owned effects for the Choreograph pane. */
import type { ProviderHandle } from './contract.js'
import type { DevelopmentIdeService, DevelopmentIdeState, DevelopmentIdeIntent } from './development-ide.js'

export interface DevelopmentRift {
  readonly id: string
  readonly name: string
  readonly project: string
  readonly baseRevision: string
  readonly canonicalRemote?: string
  readonly checkpointId?: string | null
}

export interface DevelopmentCell {
  readonly id: string
  /** Stable Garden codeBlock identity inside the document's content fragment. */
  readonly blockId: string
  readonly language: string
  readonly kind: 'code' | 'narrative'
  readonly title?: string
}

export interface DevelopmentFile {
  readonly id: string
  readonly path: string
  readonly documentId: string
  readonly kind: 'source' | 'notebook'
  readonly language?: string
  readonly blockId?: string
  readonly cells?: readonly DevelopmentCell[]
  readonly version?: string
  readonly syncState?: 'synchronized' | 'dirty' | 'conflict' | 'unknown'
}

export interface DevelopmentParticipant {
  readonly id: string
  readonly name: string
  readonly task?: string
  /** Presence, assignments and running processes are distinct testimony. */
  readonly kind: 'presence' | 'assignment' | 'runtime'
  readonly status: string
  readonly observedAt: string
}

export interface DevelopmentEnvironment {
  readonly id: string
  readonly cluster: string
  readonly component: string
  readonly desiredRelease?: string
  readonly servingArtifact?: string
  readonly sourceRevision?: string
  readonly rolloutStatus: string
  readonly observedAt: string
  readonly observer: string
  readonly deploymentHistory?: readonly {
    readonly id: string
    readonly observedAt: string
    readonly artifact: string
    readonly status: string
    readonly checkpointId?: string
    readonly riftId?: string
  }[]
}

export interface DevelopmentRun {
  readonly id: string
  readonly riftId: string
  readonly notebookDocumentId: string
  readonly cellId: string
  readonly status: string
  readonly startedAt: string
  readonly finishedAt?: string
  readonly checkpointId: string
  readonly sourceVersion: string
  readonly kernelId: string
  readonly kernelGeneration: number
  readonly kernelRecovery?: string
  /** Bounded, plain-text rendering of recorded Jupyter output. */
  readonly output: string
  /** Hash observations at execution boundaries, not OS-level read tracing. */
  readonly sourceIntegrity?: 'boundary-checks-passed' | 'changed-during-run' | 'completion-unobserved'
  readonly consumedFiles: readonly { readonly path: string; readonly version: string }[]
  readonly stale?: boolean
}

export interface DevelopmentRiftSnapshot {
  readonly ide?: { readonly enabled:boolean; readonly projectRootLabel:string; readonly synchronizationError?:string|null }
  readonly rift: DevelopmentRift
  readonly files: readonly DevelopmentFile[]
  readonly participants: readonly DevelopmentParticipant[]
  readonly environments: readonly DevelopmentEnvironment[]
  readonly runs: readonly DevelopmentRun[]
  readonly kernelStatus?: string
  readonly observedAt: string
}

/** HTTP/MCP effects belong to the application. Open documents use Garden's room. */
export interface DevelopmentWorkspaceService {
  readonly ide?:DevelopmentIdeService
  listRifts(): Promise<readonly DevelopmentRift[]>
  inspectRift(riftId: string): Promise<DevelopmentRiftSnapshot>
  openDocument(riftId: string, documentId: string): Promise<ProviderHandle>
  synchronize(riftId: string): Promise<DevelopmentRiftSnapshot>
  checkpoint(riftId: string): Promise<DevelopmentRiftSnapshot>
  executeCell(riftId: string, notebookDocumentId: string, cellId: string): Promise<DevelopmentRun>
}

export interface DevelopmentWorkspaceViewState {
  readonly ide?:DevelopmentIdeState|null
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly error: string
  readonly pending: string | null
  readonly rifts: readonly DevelopmentRift[]
  readonly selectedRiftId: string
  readonly selectedFileId: string
  readonly selectedEnvironmentId: string
  readonly workspace: DevelopmentRiftSnapshot | null
  /** Lease owned/released by the host controller, never destroyed by an editor. */
  readonly document: { readonly documentId: string; readonly provider: ProviderHandle } | null
}

export interface DevelopmentWorkspaceIntent {
  readonly action: 'refresh' | 'select-rift' | 'select-file' | 'select-environment' | 'synchronize' | 'checkpoint' | 'execute' | 'ide'
  readonly ide?:DevelopmentIdeIntent
  readonly id?: string
}
