// @vitest-environment node
/** Eyewright: real Y.Doc invalidation, explicit fake lifecycle/read transport.
 * These are controller-model witnesses, not HTTP, browser or deployed proof.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { createHash } from 'node:crypto'
import type { ShrubberyContract } from '@shrubbery/nucleus'
import type { EditorRoomPool } from '../editor-room-pool.js'
import { ArtifactLivePreview, ArtifactTextReadError, watchArtifactWorkspace,
  type ArtifactLivePreviewOptions, type ArtifactTextSnapshot } from '../artifact-live-preview.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function flush() { for (let i = 0; i < 16; i++) await Promise.resolve() }
function snapshot(text = '<p>committed</p>', incarnation = 'inc-1'): ArtifactTextSnapshot {
  return { graphId: 'g', graphIncarnation: incarnation, artifactId: 'a', filename: 'a.html',
    mimeType: 'text/html', text, sizeBytes: new TextEncoder().encode(text).length,
    contentHashSha256: createHash('sha256').update(text).digest('hex') }
}
const cleanup: Array<() => void> = []
function controller() {
  const calls: Array<{ signal: AbortSignal; result: ReturnType<typeof deferred<ArtifactTextSnapshot>> }> = []
  const changed = vi.fn(), stop = vi.fn()
  let invalidate!: () => void
  let unavailable!: Parameters<ArtifactLivePreviewOptions['watch']>[1]
  const value = new ArtifactLivePreview({
    timeoutMs: 1000,
    read: signal => { const result = deferred<ArtifactTextSnapshot>(); calls.push({ signal, result }); return result.promise },
    watch: (next, missing) => { invalidate = next; unavailable = missing; return stop },
    onChange: changed,
  })
  cleanup.push(() => value.dispose())
  return { value, calls, changed, stop, invalidate: () => invalidate(), unavailable: (message: string) => unavailable(message) }
}
beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }))
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) close()
  await flush()
  expect(vi.getTimerCount()).toBe(0)
  vi.useRealTimers()
})

describe('live HTML read ownership', () => {
  it('starts once, coalesces bursts, and reads again after late notifications', async () => {
    const h = controller(); h.value.start(); h.value.start(); h.invalidate(); h.invalidate()
    await flush(); expect(h.calls).toHaveLength(1)
    h.invalidate(); h.invalidate(); h.calls[0]!.result.resolve(snapshot('stale'))
    await flush(); expect(h.calls).toHaveLength(2); expect(h.value.snapshot().snapshot).toBeNull()
    h.calls[1]!.result.resolve(snapshot('current')); await flush()
    expect(h.value.snapshot().snapshot?.text).toBe('current')
    h.invalidate(); await flush(); expect(h.calls).toHaveLength(3)
    h.calls[2]!.result.resolve(snapshot('late notification')); await flush()
    expect(h.value.snapshot().snapshot?.text).toBe('late notification')
  })

  it('retains the last committed content while a notified in-flight result is superseded', async () => {
    const h = controller(); h.value.start(); await flush()
    h.calls[0]!.result.resolve(snapshot('original')); await flush()
    h.value.refresh(); await flush(); h.invalidate()
    h.calls[1]!.result.resolve(snapshot('intermediate')); await flush()
    expect(h.value.snapshot().snapshot?.text).toBe('original')
    h.calls[2]!.result.resolve(snapshot('latest')); await flush()
    expect(h.value.snapshot().snapshot?.text).toBe('latest')
  })

  it('cancels and closes once; a late old-owner result cannot affect a replacement controller', async () => {
    const old = controller(); old.value.start(); await flush()
    const before = old.changed.mock.calls.length
    old.value.dispose(); old.value.dispose(); old.invalidate(); old.value.refresh()
    const next = controller(); next.value.start(); await flush()
    old.calls[0]!.result.resolve(snapshot('old graph', 'old-inc'))
    next.calls[0]!.result.resolve(snapshot('new graph', 'new-inc')); await flush()
    expect(old.calls[0]!.signal.aborted).toBe(true)
    expect(old.stop).toHaveBeenCalledTimes(1)
    expect(old.changed).toHaveBeenCalledTimes(before)
    expect(next.value.snapshot().snapshot?.text).toBe('new graph')
    expect(old.calls).toHaveLength(1)
  })

  it('does not open a read when disposed before its scheduled start', async () => {
    const h = controller(); h.value.start(); h.value.dispose(); await flush()
    expect(h.calls).toHaveLength(0); expect(h.stop).toHaveBeenCalledTimes(1)
  })

  it.each(['network', 'timeout'])('retains committed HTML with an honest %s error', async kind => {
    const h = controller(); h.value.start(); await flush()
    h.calls[0]!.result.resolve(snapshot('keep')); await flush(); h.value.refresh(); await flush()
    if (kind === 'network') h.calls[1]!.result.reject(new TypeError('Network unavailable'))
    else await vi.advanceTimersByTimeAsync(1000)
    await flush()
    expect(h.value.snapshot()).toMatchObject({ status: 'ready', snapshot: { text: 'keep' } })
    expect(h.value.snapshot().error).toMatch(kind === 'network' ? /Network/ : /timed out/)
    if (kind === 'timeout') {
      expect(h.calls[1]!.signal.aborted).toBe(true)
      h.calls[1]!.result.resolve(snapshot('late timed-out bytes')); await flush()
      expect(h.value.snapshot().snapshot?.text).toBe('keep')
    }
  })

  it.each(['HTTP 401', 'HTTP 403', 'HTTP 404', 'HTTP 410', 'malformed content'])('clears committed HTML on %s', async reason => {
    const h = controller(); h.value.start(); await flush()
    h.calls[0]!.result.resolve(snapshot('protected')); await flush(); h.value.refresh(); await flush()
    h.calls[1]!.result.reject(new ArtifactTextReadError(reason, true)); await flush()
    expect(h.value.snapshot()).toMatchObject({ status: 'error', snapshot: null, error: reason })
  })

  it('preserves disconnected telemetry when a byte refresh succeeds', async () => {
    const h = controller(); h.value.start(); await flush()
    h.unavailable('Live updates disconnected')
    h.calls[0]!.result.resolve(snapshot()); await flush()
    expect(h.value.snapshot()).toMatchObject({ status: 'ready', error: 'Live updates disconnected' })
  })

  it('terminally fences an incarnation replacement, including later old-incarnation resurrection', async () => {
    const h = controller(); h.value.start(); await flush()
    h.calls[0]!.result.resolve(snapshot('old committed', 'old')); await flush()
    h.value.refresh(); await flush(); h.calls[1]!.result.resolve(snapshot('replacement', 'new')); await flush()
    expect(h.value.snapshot()).toMatchObject({ status: 'error', snapshot: null })
    h.value.refresh(); await flush()
    h.calls[2]?.result.resolve(snapshot('resurrected old bytes', 'old')); await flush()
    expect(h.value.snapshot().snapshot).toBeNull()
    expect(h.value.snapshot().status).toBe('error')
  })
})

function workspace(authReady = Promise.resolve()) {
  const doc = new Y.Doc(), artifacts = doc.getMap<Y.Map<unknown>>('artifacts')
  const entry = new Y.Map<unknown>(); entry.set('contentHashSha256', 'h1'); artifacts.set('a', entry)
  let state = { connection: 'disconnected', synchronized: false }
  const listeners = new Set<() => void>()
  const release = vi.fn(), unsubscribe = vi.fn()
  const acquire = vi.fn(() => ({ release, provider: { doc, lifecycle: {
    get: () => state,
    subscribe: (callback: () => void) => { listeners.add(callback); return () => { unsubscribe(); listeners.delete(callback) } },
  } } }))
  const contract = { auth: { whenReady: () => authReady } } as unknown as Pick<ShrubberyContract, 'auth'>
  const changed = vi.fn(), unavailable = vi.fn()
  const close = watchArtifactWorkspace(contract, { acquire } as unknown as EditorRoomPool, 'g', 'a', changed, unavailable)
  cleanup.push(() => { close(); doc.destroy() })
  return { doc, artifacts, entry, acquire, release, unsubscribe, changed, unavailable, close,
    lifecycle: (connected: boolean, synchronized = connected) => {
      state = { connection: connected ? 'connected' : 'disconnected', synchronized }
      for (const callback of listeners) callback()
    } }
}

describe('real workspace Y.Doc hints and lease lifetime', () => {
  it('ignores unrelated entries, notices actual revisions/deletion/recreation, and releases once', async () => {
    const h = workspace(); await flush(); expect(h.changed).toHaveBeenCalledTimes(1)
    expect(h.acquire).toHaveBeenCalledWith({ kind: 'workspace', graphId: 'g' }, expect.stringMatching(/^artifact-preview-/))
    h.changed.mockClear()
    const other = new Y.Map(); h.artifacts.set('other', other); other.set('contentHashSha256', 'unrelated')
    expect(h.changed).not.toHaveBeenCalled()
    h.doc.transact(() => { h.entry.set('contentHashSha256', 'h2'); h.entry.set('contentOperationId', 'op2') })
    expect(h.changed).toHaveBeenCalledTimes(1)
    h.artifacts.delete('a'); expect(h.changed).toHaveBeenCalledTimes(2)
    const recreated = new Y.Map(); recreated.set('contentHashSha256', 'h3'); h.artifacts.set('a', recreated)
    expect(h.changed).toHaveBeenCalledTimes(3)
    h.close(); h.close(); recreated.set('contentHashSha256', 'after-close'); h.lifecycle(true)
    expect(h.changed).toHaveBeenCalledTimes(3); expect(h.release).toHaveBeenCalledTimes(1)
    expect(h.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('refreshes once on synchronized open and once on reconnect, not repeated lifecycle notifications', async () => {
    const h = workspace(); await flush(); h.changed.mockClear()
    h.lifecycle(true, false); expect(h.changed).not.toHaveBeenCalled()
    h.lifecycle(true); h.lifecycle(true); expect(h.changed).toHaveBeenCalledTimes(1)
    h.lifecycle(false); expect(h.unavailable).toHaveBeenCalledWith(expect.stringMatching(/disconnected/))
    h.lifecycle(true); expect(h.changed).toHaveBeenCalledTimes(2)
  })

  it('does not acquire a room after close wins against late authentication', async () => {
    const auth = deferred<void>(), h = workspace(auth.promise)
    h.close(); auth.resolve(); await flush()
    expect(h.acquire).not.toHaveBeenCalled(); expect(h.changed).not.toHaveBeenCalled()
    expect(h.release).not.toHaveBeenCalled()
  })

  it('reports failed authentication without a lease, and suppresses late failure after close', async () => {
    const auth = deferred<void>(), h = workspace(auth.promise)
    auth.reject(new Error('auth refused')); await flush()
    expect(h.unavailable).toHaveBeenCalledWith(expect.stringContaining('auth refused'))
    expect(h.acquire).not.toHaveBeenCalled()
    const late = deferred<void>(), closed = workspace(late.promise)
    closed.close(); late.reject(new Error('late refusal')); await flush()
    expect(closed.unavailable).not.toHaveBeenCalled()
  })
})
