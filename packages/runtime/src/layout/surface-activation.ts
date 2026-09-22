import type {
  SurfaceActivationDiagnostics,
  SurfaceActivationPriority,
  SurfaceActivationScheduler,
} from './types.js'
import { ActivationScheduler } from '@shrubbery/nucleus'

export interface SurfaceActivationQueueOptions {
  /** Code-owned network/compute budget. Defaults to four visible tasks. */
  readonly maxConcurrent?: number
}

/**
 * Small priority-aware bounded queue for Surface resource work.
 *
 * Scheduling always crosses a microtask boundary. That lets one structural
 * interpreter pass stage every visible face/loading shell before resource
 * work can settle and mutate those faces. Visible tasks drain before
 * background work, but neither priority can exceed the host-owned cap.
 */
export class SurfaceActivationQueue implements SurfaceActivationScheduler {
  private readonly scheduler: ActivationScheduler

  constructor(options: SurfaceActivationQueueOptions = {}) {
    this.scheduler = new ActivationScheduler(options)
  }

  schedule<T>(
    task: () => Promise<T>,
    priority: SurfaceActivationPriority = 'visible',
  ): Promise<T> {
    return this.scheduler.schedule(() => task(), priority).promise
  }

  whenIdle(): Promise<void> {
    return this.scheduler.whenIdle()
  }

  diagnostics(): SurfaceActivationDiagnostics {
    return this.scheduler.diagnostics()
  }
}
