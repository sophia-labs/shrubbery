export type JsonRecord = Record<string, unknown>

export interface VehicleAuthConfig {
  readonly bearerToken?: string | null
  readonly internalServiceSecret?: string | null
  readonly userId?: string | null
}

export interface VehicleConfig {
  readonly baseUrl: string
  readonly auth: VehicleAuthConfig
  readonly fixture: boolean
  readonly clientId: string
  readonly authorId: string
  readonly role: string
  readonly pollMs: number
}

export interface VehicleRunSummary {
  readonly runId: string
  readonly workflowName: string
  readonly graphId: string
  readonly status: string
  readonly startedAt?: number | null
  readonly updatedAt?: number | null
  readonly endedAt?: number | null
  readonly durationMs?: number | null
  readonly agentCount?: number | null
  readonly totalTokens?: number | null
  readonly synthesisDocId?: string | null
  readonly frontier?: unknown
}

export interface VehicleAgentSummary {
  readonly sessionId: string
  readonly runId: string
  readonly workflowName: string
  readonly graphId: string
  readonly nodeKey: string
  readonly label: string
  readonly phaseIndex?: number | null
  readonly agentId?: string | null
  readonly sandboxId?: string | null
  readonly model: string
  readonly status: string
  readonly frontier?: unknown
  readonly result?: unknown
  readonly attach?: unknown
}

export interface VehicleAgentRecord {
  readonly agentId: string
  readonly agentUri?: string
  readonly handle: string
  readonly agentType?: string | null
  readonly workflowName?: string | null
  readonly graphId: string
  readonly ownerUserId?: string | null
  readonly provider?: string | null
  readonly model?: string | null
  readonly lifecycle: string
  readonly activeSessionId?: string | null
  readonly activeRunId?: string | null
  readonly activeSandboxId?: string | null
  readonly status?: string | null
  readonly createdAt?: number | null
  readonly updatedAt?: number | null
}

export interface VehicleAgentListResponse {
  readonly agents: readonly VehicleAgentRecord[]
  readonly count: number
}

export interface VehicleRunListResponse {
  readonly runs: readonly VehicleRunSummary[]
  readonly count: number
}

export interface VehicleWorkflowRecord {
  readonly workflowId: string
  readonly label: string
  readonly description?: string | null
  readonly whenToUse?: string | null
  readonly definitionSubject: string
  readonly sourceKind: 'current-state' | 'event-log' | 'derived'
  readonly identityKind: 'doc-uri' | 'logical-id' | 'event-id' | 'resolve-by-query' | 'urn-template'
  readonly graphIds: readonly string[]
  readonly status: string
  readonly runCount: number
  readonly agentCount: number
  readonly totalTokens?: number | null
  readonly latestRunId?: string | null
  readonly activeRunId?: string | null
  readonly agentIds: readonly string[]
  readonly runIds: readonly string[]
  readonly phaseCount?: number | null
  readonly agentNodeCount?: number | null
  readonly archetypeUris: readonly string[]
  readonly binding?: {
    readonly bindingId: string
    readonly operationId?: string | null
    readonly executor: string
    readonly workflowName: string
    readonly inputSchema?: JsonRecord | string | null
    readonly outputSchema?: JsonRecord | string | null
    readonly requiresAuth?: boolean | null
  } | null
  readonly draft?: {
    readonly runnable: boolean
    readonly gaps: readonly {
      readonly gapKind: string
      readonly gapTarget: string
      readonly gapBlocking: boolean
      readonly rationale?: string | null
    }[]
    readonly warnings: readonly string[]
    readonly derivedFromQuery: string
  } | null
  readonly runStatistics?: {
    readonly runCount: number
    readonly latestRunStatus?: string | null
    readonly lastRunAt?: number | null
    readonly medianRunTokens?: number | null
    readonly derivedFromQuery: string
  } | null
  readonly updatedAt?: number | null
  readonly ontology?: JsonRecord
}

export interface VehicleWorkflowListResponse {
  readonly workflows: readonly VehicleWorkflowRecord[]
  readonly count: number
}

export interface VehicleRunAgentsResponse {
  readonly run: VehicleRunSummary
  readonly agents: readonly VehicleAgentSummary[]
}

export interface VehicleWorkflowRunResponse {
  readonly runId: string
  readonly status: string
  readonly graphId: string
  readonly workflowId: string
}

export interface VehicleAgentSessionEvent {
  readonly sessionId: string
  readonly seq: number
  readonly ts: number
  readonly type: string
  readonly payload: JsonRecord
}

export interface VehicleAgentWorldDoc {
  readonly schema: string
  readonly agent: JsonRecord
  readonly status: JsonRecord
  readonly prompts: JsonRecord
  readonly toolbelt: JsonRecord
  readonly schemas: JsonRecord
  readonly world: JsonRecord
  readonly memory: JsonRecord
  readonly conversation: JsonRecord
  readonly runtime: JsonRecord
  readonly control: JsonRecord
  readonly collaborators: JsonRecord
  readonly codex: JsonRecord
  readonly ontology: JsonRecord
}

export interface VehicleAgentWorldResponse {
  readonly agent: JsonRecord
  readonly worldDoc: VehicleAgentWorldDoc
  readonly agentVisiblePacket?: unknown
  readonly session?: VehicleAgentSummary | null
  readonly run?: VehicleRunSummary | null
}

export interface VehicleTurnContextPreview {
  readonly schema: string
  readonly mode: string
  readonly turnId: string
  readonly systemPrompt: string
  readonly latestMessage: JsonRecord
  readonly agentVisiblePacket: unknown
  readonly turnPrompt: string
  readonly turnPromptSections?: JsonRecord
  readonly constraints?: readonly unknown[]
  readonly tools?: readonly unknown[]
  readonly promptDigest?: string
  readonly packetDigest?: string
  readonly turnPromptDigest?: string
}

export interface VehicleTurnPreviewResponse {
  readonly preview: VehicleTurnContextPreview
  readonly agent?: JsonRecord
  readonly worldDoc?: VehicleAgentWorldDoc
  readonly agentVisiblePacket?: unknown
  readonly session?: VehicleAgentSummary | null
  readonly run?: VehicleRunSummary | null
}

export interface VehicleAgentWorldEventsResponse extends VehicleAgentWorldResponse {
  readonly events: readonly VehicleAgentSessionEvent[]
  readonly nextCursor: number
}

export interface VehicleControlResponse {
  readonly applied: boolean
  readonly driver?: string | null
  readonly reason?: string | null
  readonly events?: readonly VehicleAgentSessionEvent[]
  readonly document?: JsonRecord
  readonly documentOp?: unknown
  readonly liveDelivery?: unknown
}

export interface VehicleActivityItem {
  readonly id: string
  readonly eventIndex: number
  readonly seq: number
  readonly origin?: 'event' | 'projection'
  readonly label: string
  readonly title: string
  readonly detail: string
  readonly status: 'idle' | 'running' | 'completed' | 'warning' | 'error' | 'blocked'
  readonly event: VehicleAgentSessionEvent
}

export interface VehicleOntologyNode {
  readonly id: string
  readonly label?: string
  readonly note?: string
  readonly className?: string
  readonly evidence?: JsonRecord
}

export interface VehicleOntologyEdge {
  readonly from: string
  readonly to: string
  readonly predicate: string
  readonly kind?: 'predicate' | 'wire'
  readonly note?: string
}

export interface VehicleWorkflowOntologyFact {
  readonly label: string
  readonly value: string
  readonly tone?: 'default' | 'good' | 'warning' | 'danger'
}

export interface VehicleWorkflowOntologyModel {
  readonly nodes: readonly VehicleOntologyNode[]
  readonly edges: readonly VehicleOntologyEdge[]
  readonly facts: readonly VehicleWorkflowOntologyFact[]
  readonly shapeFailures: readonly JsonRecord[]
}

export interface VehicleDriverLease {
  readonly holder: string
  readonly epoch: number
  readonly expiresAt?: string | null
}

export interface VehiclePresence {
  readonly userId: string
  readonly displayName: string
  readonly focus: string
}

export type VehiclePaneKind =
  | 'agent'
  | 'control'
  | 'garden-document'
  | 'prompt'
  | 'pi-terminal'
  | 'choreograph-terminal'
  | 'runtime'
  | 'transcript'
  | 'vim-garden-document'

export type VehicleMode = 'vim' | 'pi' | 'choreograph'

export interface VehiclePane {
  readonly paneId: string
  readonly kind: VehiclePaneKind
  readonly title: string
  readonly mode?: VehicleMode | null
  readonly command?: string | null
  readonly args?: readonly string[]
  readonly state?: string | null
  readonly output?: string | null
}

export interface VehicleAgentEvent {
  readonly seq: number
  readonly source: string
  readonly text: string
}

export interface VehicleControlEvent {
  readonly actor: string
  readonly text: string
}

export interface VehicleSession {
  readonly sessionId: string
  readonly graphId: string
  readonly runId?: string | null
  readonly workflowName?: string | null
  readonly agentId?: string | null
  readonly agentLabel?: string | null
  readonly model?: string | null
  readonly status?: string | null
  readonly sandboxId?: string | null
  readonly revision?: number | null
  readonly driver: VehicleDriverLease
  readonly presences: readonly VehiclePresence[]
  readonly panes: readonly VehiclePane[]
  readonly transcript: readonly VehicleAgentEvent[]
  readonly inputDraft: string
  readonly pendingControlEvents: readonly VehicleControlEvent[]
}

export interface GardenBlock {
  readonly blockId: string
  readonly kind: string
  readonly text: string
  readonly attrs?: JsonRecord
}

export interface GardenDocument {
  readonly documentId: string
  readonly title: string
  readonly blocks: readonly GardenBlock[]
}

export type BridgeSupportLevel =
  | 'editable-text'
  | 'command-only'
  | 'read-only-opaque'
  | 'hidden-metadata'

export interface BridgeInlineMark {
  readonly markType: string
  readonly startUtf16: number
  readonly endUtf16: number
  readonly attrs: JsonRecord
}

export interface BridgeLine {
  readonly blockId: string
  readonly nodeType: string
  readonly text: string
  readonly support: BridgeSupportLevel
  readonly attrs: JsonRecord
  readonly marks: readonly BridgeInlineMark[]
}

export interface BridgeProjection {
  readonly formatVersion: number
  readonly documentId: string
  readonly title: string
  readonly revision: number
  readonly tiptapJson: JsonRecord
  readonly lines: readonly BridgeLine[]
  readonly unsupported: readonly {
    readonly blockId?: string | null
    readonly nodeType: string
    readonly reason: string
  }[]
}

export type BridgeOperation =
  | { readonly type: 'replace-block-text'; readonly blockId: string; readonly text: string }
  | { readonly type: 'insert-text'; readonly blockId: string; readonly offsetUtf16: number; readonly text: string }
  | { readonly type: 'delete-text'; readonly blockId: string; readonly offsetUtf16: number; readonly lenUtf16: number }
  | { readonly type: 'split-block'; readonly blockId: string; readonly offsetUtf16: number; readonly newBlockId?: string | null }
  | { readonly type: 'join-next'; readonly blockId: string }
  | { readonly type: 'insert-block'; readonly afterBlockId?: string | null; readonly block: GardenBlock }
  | { readonly type: 'delete-block'; readonly blockId: string }
  | { readonly type: 'move-block'; readonly blockId: string; readonly afterBlockId?: string | null }
  | { readonly type: 'set-block-attrs'; readonly blockId: string; readonly attrs: JsonRecord }

export type VehicleRoomTab =
  | 'activity'
  | 'cockpit'
  | 'bridge'
  | 'world'
  | 'tools'
  | 'prompt'
  | 'schema'
  | 'comments'
  | 'debug'
