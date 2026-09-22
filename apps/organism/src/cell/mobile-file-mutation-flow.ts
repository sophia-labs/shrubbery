import type {
  FilePaneOperationAction,
  FilePaneOperationFeedback,
} from '@shrubbery/nucleus'

export interface MobileFileMutationIntent {
  readonly action: FilePaneOperationAction
  readonly nodeId?: string
  readonly graphId?: string
  readonly label?: string
}

export interface MobileFileMutationFailure {
  readonly state: 'terminal-error' | 'indeterminate'
  readonly message: string
  readonly retryable: boolean
}

export interface MobileFileMutationReconciliation {
  readonly state: 'success' | 'terminal-error' | 'indeterminate'
  readonly message?: string
  readonly retryable?: boolean
}

export interface MobileFileMutationFlowOptions<TIntent extends MobileFileMutationIntent> {
  /**
   * Resolve only after the mutation and the host's authoritative projection
   * refresh have both completed. A rejection is classified before it is shown.
   */
  readonly execute: (intent: TIntent) => Promise<void>
  /** Read current authoritative state after ambiguous delivery; never resubmit. */
  readonly reconcile?: (intent: TIntent) => Promise<MobileFileMutationReconciliation>
  readonly onChange?: (
    feedback: FilePaneOperationFeedback | null,
    intent: TIntent | null,
  ) => void
  readonly idFactory?: () => string
}

interface MutationDeliveryMarker {
  readonly mutationDelivery?: unknown
  readonly retryable?: unknown
  readonly status?: unknown
  readonly code?: unknown
  readonly name?: unknown
  readonly message?: unknown
}

const DURABLY_QUEUED_TIMEOUT = /(?:operation remains durably queued|caller[- ]timeout|timed out waiting for the desktop runtime)/i
const SERVER_REJECTION_NAMES = new Set(['McpError', 'GatewayMcpError'])
const AMBIGUOUS_HTTP_STATUSES = new Set([408, 425, 429])

function deliveryMarker(error: unknown): MutationDeliveryMarker | null {
  return error && typeof error === 'object' ? error as MutationDeliveryMarker : null
}

function failureMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  if (typeof error === 'string' && error.trim()) return error.trim()
  const message = deliveryMarker(error)?.message
  return typeof message === 'string' && message.trim() ? message.trim() : 'Garden could not confirm this operation.'
}

/**
 * Classify delivery using structured markers and transport types first. Garden's
 * current queue timeout is still an unstructured MCP message, so its durable-
 * queue phrase is the one intentional string fallback. Unknown failures are
 * conservative: the operation may have reached Garden.
 */
export function classifyMobileFileMutationFailure(error: unknown): MobileFileMutationFailure {
  const marker = deliveryMarker(error)
  const message = failureMessage(error)
  const retryable = marker?.retryable === true

  if (marker?.mutationDelivery === 'rejected') {
    return { state: 'terminal-error', message, retryable }
  }
  if (marker?.mutationDelivery === 'indeterminate') {
    return { state: 'indeterminate', message, retryable: false }
  }
  if (DURABLY_QUEUED_TIMEOUT.test(message)) {
    return { state: 'indeterminate', message, retryable: false }
  }

  // Loopback McpError uses `code` for both HTTP status and JSON-RPC codes.
  // A gateway/server 5xx or timeout-like HTTP response does not prove whether
  // the cell accepted the operation, even though an McpError object exists.
  const code = typeof marker?.code === 'number' ? marker.code : null
  if (code !== null && (code >= 500 || AMBIGUOUS_HTTP_STATUSES.has(code))) {
    return { state: 'indeterminate', message, retryable: false }
  }

  const name = typeof marker?.name === 'string'
    ? marker.name
    : error instanceof Error
      ? error.name
      : ''
  if (SERVER_REJECTION_NAMES.has(name)) {
    return { state: 'terminal-error', message, retryable }
  }

  const status = typeof marker?.status === 'number' ? marker.status : null
  if (status !== null && status >= 400 && status < 500 && !AMBIGUOUS_HTTP_STATUSES.has(status)) {
    return { state: 'terminal-error', message, retryable }
  }

  return { state: 'indeterminate', message, retryable: false }
}

let nextMutationId = 0

function defaultIdFactory(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return `mobile-file-${uuid}`
  nextMutationId += 1
  return `mobile-file-${Date.now().toString(36)}-${nextMutationId.toString(36)}`
}

function defaultIndeterminateMessage(): string {
  return 'Garden may still finish this operation. Check the current files before trying again.'
}

/**
 * One-operation flow for the controlled mobile Browse surface. It owns no file
 * data and performs no transport work itself; it only correlates a host intent,
 * projects honest lifecycle feedback, and keeps ambiguous reconciliation
 * separate from replay.
 */
export class MobileFileMutationFlow<TIntent extends MobileFileMutationIntent = MobileFileMutationIntent> {
  private feedback: FilePaneOperationFeedback | null = null
  private intent: TIntent | null = null
  private busy = false

  constructor(private readonly options: MobileFileMutationFlowOptions<TIntent>) {}

  get current(): FilePaneOperationFeedback | null {
    return this.feedback
  }

  async run(intent: TIntent): Promise<FilePaneOperationFeedback> {
    if (this.busy) throw new Error('A mobile file operation is already in progress.')
    if (this.feedback?.state === 'indeterminate') {
      throw new Error('Check the previous mobile file operation before starting another one.')
    }
    const id = (this.options.idFactory ?? defaultIdFactory)()
    return this.execute(id, intent)
  }

  async retry(operationId: string): Promise<FilePaneOperationFeedback | null> {
    if (
      !this.feedback
      || !this.intent
      || this.feedback.id !== operationId
      || this.feedback.state !== 'terminal-error'
      || !this.feedback.retryable
    ) return this.feedback
    return this.run(this.intent)
  }

  async reconcile(operationId: string): Promise<FilePaneOperationFeedback | null> {
    const reconcile = this.options.reconcile
    if (
      !reconcile
      || !this.feedback
      || !this.intent
      || this.feedback.id !== operationId
      || this.feedback.state !== 'indeterminate'
      || this.busy
    ) return this.feedback

    this.busy = true
    const intent = this.intent
    const priorMessage = this.feedback.message
    this.publish({
      ...this.feedback,
      reconciling: true,
      message: 'Checking the current files without repeating the operation.',
    }, intent)
    try {
      const result = await reconcile(intent)
      const next: FilePaneOperationFeedback = {
        id: operationId,
        action: intent.action,
        state: result.state,
        nodeId: intent.nodeId,
        graphId: intent.graphId,
        label: intent.label,
        message: result.message
          ?? (result.state === 'indeterminate' ? priorMessage || defaultIndeterminateMessage() : undefined),
        retryable: result.state === 'terminal-error' && result.retryable === true,
        reconciling: false,
      }
      this.publish(next, intent)
      return next
    } catch (error) {
      const next: FilePaneOperationFeedback = {
        id: operationId,
        action: intent.action,
        state: 'indeterminate',
        nodeId: intent.nodeId,
        graphId: intent.graphId,
        label: intent.label,
        message: `Garden still could not confirm the operation: ${failureMessage(error)}`,
        retryable: false,
        reconciling: false,
      }
      this.publish(next, intent)
      return next
    } finally {
      this.busy = false
    }
  }

  clear(operationId?: string): boolean {
    if (this.busy || this.feedback?.state === 'pending') return false
    if (operationId && this.feedback?.id !== operationId) return false
    this.feedback = null
    this.intent = null
    this.options.onChange?.(null, null)
    return true
  }

  private async execute(id: string, intent: TIntent): Promise<FilePaneOperationFeedback> {
    this.busy = true
    this.intent = intent
    this.publish({
      id,
      action: intent.action,
      state: 'pending',
      nodeId: intent.nodeId,
      graphId: intent.graphId,
      label: intent.label,
    }, intent)
    try {
      await this.options.execute(intent)
      const next: FilePaneOperationFeedback = {
        id,
        action: intent.action,
        state: 'success',
        nodeId: intent.nodeId,
        graphId: intent.graphId,
        label: intent.label,
      }
      this.publish(next, intent)
      return next
    } catch (error) {
      const failure = classifyMobileFileMutationFailure(error)
      const next: FilePaneOperationFeedback = {
        id,
        action: intent.action,
        state: failure.state,
        nodeId: intent.nodeId,
        graphId: intent.graphId,
        label: intent.label,
        message: failure.message,
        retryable: failure.state === 'terminal-error' && failure.retryable,
      }
      this.publish(next, intent)
      return next
    } finally {
      this.busy = false
    }
  }

  private publish(feedback: FilePaneOperationFeedback, intent: TIntent): void {
    this.feedback = feedback
    this.options.onChange?.(feedback, intent)
  }
}
