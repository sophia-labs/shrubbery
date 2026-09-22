/**
 * A dependency-free, bounded scheduler for proactive activation work.
 *
 * Surface resources and document snapshots have different retention semantics,
 * but they share this execution primitive: code owns the concurrency budget,
 * visible work runs before speculative work, and every task is cancellable.
 */

export type ActivationPriority = 'visible' | 'background'

export interface ActivationSchedulerDiagnostics {
  readonly active: number
  readonly queuedVisible: number
  readonly queuedBackground: number
  readonly maxConcurrent: number
}

export interface ActivationTask<T> {
  readonly promise: Promise<T>
  readonly signal: AbortSignal
  cancel(reason?: unknown): void
}

export interface ActivationSchedulerOptions {
  readonly maxConcurrent?: number
}

interface QueuedActivation<T> {
  readonly run: (signal: AbortSignal) => Promise<T>
  readonly controller: AbortController
  readonly resolve: (value: T | PromiseLike<T>) => void
  readonly reject: (cause: unknown) => void
  started: boolean
}

function abortError(reason?: unknown): unknown {
  if (reason !== undefined) return reason
  return new DOMException('Activation was cancelled', 'AbortError')
}

/**
 * Priority-aware queue used beneath policy-specific activation layers.
 *
 * Scheduling crosses a microtask boundary so callers can stage all visible
 * work before anything begins. Cancelling an active task aborts its signal;
 * the task remains responsible for forwarding that signal to cancellable I/O.
 */
export class ActivationScheduler {
  private readonly maxConcurrent: number
  private readonly visible: QueuedActivation<unknown>[] = []
  private readonly background: QueuedActivation<unknown>[] = []
  private readonly idleWaiters = new Set<() => void>()
  private active = 0
  private pumpQueued = false

  constructor(options: ActivationSchedulerOptions = {}) {
    const requested = options.maxConcurrent ?? 4
    if (!Number.isFinite(requested) || requested < 1) {
      throw new Error('ActivationScheduler: maxConcurrent must be a positive finite number')
    }
    this.maxConcurrent = Math.max(1, Math.trunc(requested))
  }

  schedule<T>(
    run: (signal: AbortSignal) => Promise<T>,
    priority: ActivationPriority = 'visible',
  ): ActivationTask<T> {
    const controller = new AbortController()
    let queued!: QueuedActivation<T>
    const promise = new Promise<T>((resolve, reject) => {
      queued = { run, controller, resolve, reject, started: false }
      const target = priority === 'background' ? this.background : this.visible
      target.push(queued as QueuedActivation<unknown>)
    })
    this.requestPump()
    return {
      promise,
      signal: controller.signal,
      cancel: (reason?: unknown): void => {
        if (controller.signal.aborted) return
        controller.abort(abortError(reason))
        if (queued.started) return
        if (this.removeQueued(queued as QueuedActivation<unknown>)) {
          queued.reject(controller.signal.reason)
          this.resolveIdle()
        }
      },
    }
  }

  whenIdle(): Promise<void> {
    if (this.active === 0 && this.visible.length === 0 && this.background.length === 0) {
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => this.idleWaiters.add(resolve))
  }

  diagnostics(): ActivationSchedulerDiagnostics {
    return {
      active: this.active,
      queuedVisible: this.visible.length,
      queuedBackground: this.background.length,
      maxConcurrent: this.maxConcurrent,
    }
  }

  private removeQueued(task: QueuedActivation<unknown>): boolean {
    for (const queue of [this.visible, this.background]) {
      const index = queue.indexOf(task)
      if (index === -1) continue
      queue.splice(index, 1)
      return true
    }
    return false
  }

  private requestPump(): void {
    if (this.pumpQueued) return
    this.pumpQueued = true
    queueMicrotask(() => {
      this.pumpQueued = false
      this.pump()
    })
  }

  private pump(): void {
    while (this.active < this.maxConcurrent) {
      const queued = this.visible.shift() ?? this.background.shift()
      if (!queued) break
      if (queued.controller.signal.aborted) {
        queued.reject(queued.controller.signal.reason)
        continue
      }
      queued.started = true
      this.active += 1
      Promise.resolve()
        .then(() => queued.run(queued.controller.signal))
        .then(queued.resolve, queued.reject)
        .finally(() => {
          this.active -= 1
          this.pump()
          this.resolveIdle()
        })
    }
    this.resolveIdle()
  }

  private resolveIdle(): void {
    if (this.active > 0 || this.visible.length > 0 || this.background.length > 0) return
    for (const resolve of this.idleWaiters) resolve()
    this.idleWaiters.clear()
  }
}
