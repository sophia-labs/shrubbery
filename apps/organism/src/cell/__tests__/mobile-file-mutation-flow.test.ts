import { describe, expect, it } from 'vitest'
import type { FilePaneOperationFeedback } from '@shrubbery/nucleus'
import {
  classifyMobileFileMutationFailure,
  MobileFileMutationFlow,
  type MobileFileMutationIntent,
} from '../mobile-file-mutation-flow.js'
import { SidebarMutationRejectedError } from '../sidebar-mutations.js'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

const intent: MobileFileMutationIntent = {
  action: 'delete',
  nodeId: 'doc-inbox',
  graphId: 'garden',
  label: 'Inbox',
}

describe('MobileFileMutationFlow', () => {
  it('publishes pending immediately and success only after the host execution boundary resolves', async () => {
    const execution = deferred()
    const changes: Array<FilePaneOperationFeedback | null> = []
    const flow = new MobileFileMutationFlow({
      execute: async () => execution.promise,
      idFactory: () => 'mobile-delete-1',
      onChange: feedback => changes.push(feedback),
    })

    const resultPromise = flow.run(intent)
    expect(flow.current).toMatchObject({
      id: 'mobile-delete-1',
      state: 'pending',
      nodeId: 'doc-inbox',
    })
    expect(changes).toHaveLength(1)

    execution.resolve()
    await expect(resultPromise).resolves.toMatchObject({
      id: 'mobile-delete-1',
      state: 'success',
    })
    expect(changes.map(change => change?.state)).toEqual(['pending', 'success'])
  })

  it('uses a structured rejection marker and only replays an explicitly retryable terminal error', async () => {
    let calls = 0
    let ids = 0
    const flow = new MobileFileMutationFlow({
      execute: async () => {
        calls += 1
        if (calls === 1) throw new SidebarMutationRejectedError('Name is required.', true)
      },
      idFactory: () => `mobile-rename-${++ids}`,
    })

    const rejected = await flow.run({ ...intent, action: 'rename' })
    expect(rejected).toMatchObject({
      id: 'mobile-rename-1',
      state: 'terminal-error',
      retryable: true,
      message: 'Name is required.',
    })

    const retried = await flow.retry(rejected.id)
    expect(retried).toMatchObject({ id: 'mobile-rename-2', state: 'success' })
    expect(calls).toBe(2)
  })

  it('treats a server MCP rejection as terminal without treating unknown delivery the same way', () => {
    const serverError = Object.assign(new Error('folder is not empty'), { name: 'McpError' })
    expect(classifyMobileFileMutationFailure(serverError)).toEqual({
      state: 'terminal-error',
      message: 'folder is not empty',
      retryable: false,
    })

    expect(classifyMobileFileMutationFailure(new TypeError('Failed to fetch'))).toEqual({
      state: 'indeterminate',
      message: 'Failed to fetch',
      retryable: false,
    })

    const loopbackUnavailable = Object.assign(new Error('MCP HTTP 503 for delete_document'), {
      name: 'McpError',
      code: 503,
    })
    expect(classifyMobileFileMutationFailure(loopbackUnavailable)).toMatchObject({
      state: 'indeterminate',
      retryable: false,
    })
  })

  it('recognizes Garden durable-queue timeout as indeterminate even when MCP returned the error', () => {
    const timeout = Object.assign(new Error(
      'CRDT operation timed out waiting for the desktop runtime; operation remains durably queued for local retry',
    ), { name: 'McpError' })

    expect(classifyMobileFileMutationFailure(timeout)).toMatchObject({
      state: 'indeterminate',
      retryable: false,
    })
  })

  it('reconciles ambiguous delivery by reading state without replaying the mutation', async () => {
    let executions = 0
    let reconciliations = 0
    const changes: FilePaneOperationFeedback[] = []
    const flow = new MobileFileMutationFlow({
      execute: async () => {
        executions += 1
        throw new TypeError('Connection closed before a response arrived.')
      },
      reconcile: async () => {
        reconciliations += 1
        return { state: 'success', message: 'Inbox is no longer in the current files.' }
      },
      idFactory: () => 'mobile-delete-ambiguous',
      onChange: feedback => { if (feedback) changes.push(feedback) },
    })

    const ambiguous = await flow.run(intent)
    expect(ambiguous).toMatchObject({
      state: 'indeterminate',
      retryable: false,
    })
    await expect(flow.run({ ...intent, nodeId: 'doc-other' })).rejects.toThrow('Check the previous')

    const reconciled = await flow.reconcile(ambiguous.id)
    expect(reconciled).toMatchObject({
      id: 'mobile-delete-ambiguous',
      state: 'success',
      message: 'Inbox is no longer in the current files.',
    })
    expect(executions).toBe(1)
    expect(reconciliations).toBe(1)
    expect(changes.some(change => change.reconciling && change.state === 'indeterminate')).toBe(true)
  })

  it('stays indeterminate when reconciliation itself cannot confirm current state', async () => {
    const flow = new MobileFileMutationFlow({
      execute: async () => { throw new TypeError('network unavailable') },
      reconcile: async () => { throw new TypeError('refresh unavailable') },
      idFactory: () => 'mobile-move-ambiguous',
    })

    const ambiguous = await flow.run({ ...intent, action: 'move' })
    const checked = await flow.reconcile(ambiguous.id)
    expect(checked).toMatchObject({
      state: 'indeterminate',
      retryable: false,
      reconciling: false,
    })
    expect(checked?.message).toContain('still could not confirm')
  })
})
