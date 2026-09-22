import { describe, expect, it } from 'vitest'
import { ActivationScheduler } from '../activation-scheduler.js'

function deferred<T>(): { readonly promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => { resolve = yes })
  return { promise, resolve }
}

describe('ActivationScheduler', () => {
  it('prioritizes visible work within a bounded budget', async () => {
    const scheduler = new ActivationScheduler({ maxConcurrent: 1 })
    const gate = deferred<void>()
    const order: string[] = []
    const first = scheduler.schedule(async () => {
      order.push('first')
      await gate.promise
    })
    const background = scheduler.schedule(async () => { order.push('background') }, 'background')

    await Promise.resolve()
    await Promise.resolve()
    const visible = scheduler.schedule(async () => { order.push('visible') })
    gate.resolve()

    await Promise.all([first.promise, background.promise, visible.promise])
    expect(order).toEqual(['first', 'visible', 'background'])
  })

  it('removes queued work and aborts active work', async () => {
    const scheduler = new ActivationScheduler({ maxConcurrent: 1 })
    let activeAborted = false
    const active = scheduler.schedule(async signal => {
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => {
          activeAborted = true
          resolve()
        }, { once: true })
      })
    }, 'background')
    const queued = scheduler.schedule(async () => {
      throw new Error('cancelled queued task ran')
    }, 'background')

    await Promise.resolve()
    await Promise.resolve()
    queued.cancel()
    active.cancel()

    await expect(queued.promise).rejects.toMatchObject({ name: 'AbortError' })
    await expect(active.promise).resolves.toBeUndefined()
    await scheduler.whenIdle()
    expect(activeAborted).toBe(true)
    expect(scheduler.diagnostics()).toMatchObject({ active: 0, queuedBackground: 0 })
  })
})
