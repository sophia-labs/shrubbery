import { describe, expect, it } from 'vitest'
import { SurfaceActivationQueue } from '../surface-activation.js'

function deferred<T>(): {
  readonly promise: Promise<T>
  resolve(value: T): void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}

describe('SurfaceActivationQueue', () => {
  it('never exceeds its host-owned concurrency budget', async () => {
    const queue = new SurfaceActivationQueue({ maxConcurrent: 2 })
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()]
    let active = 0
    let peak = 0
    const runs: number[] = []

    const tasks = gates.map((gate, index) => queue.schedule(async () => {
      runs.push(index)
      active += 1
      peak = Math.max(peak, active)
      await gate.promise
      active -= 1
      return index
    }))

    await Promise.resolve()
    await Promise.resolve()
    expect(runs).toEqual([0, 1])
    expect(queue.diagnostics()).toMatchObject({ active: 2, queuedVisible: 1, maxConcurrent: 2 })

    gates[0]!.resolve()
    await tasks[0]
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(runs).toEqual([0, 1, 2])

    gates[1]!.resolve()
    gates[2]!.resolve()
    await expect(Promise.all(tasks)).resolves.toEqual([0, 1, 2])
    await queue.whenIdle()
    expect(peak).toBe(2)
  })

  it('drains newly-visible work before queued background work', async () => {
    const queue = new SurfaceActivationQueue({ maxConcurrent: 1 })
    const gate = deferred<void>()
    const order: string[] = []

    const first = queue.schedule(async () => {
      order.push('first')
      await gate.promise
    })
    const background = queue.schedule(async () => {
      order.push('background')
    }, 'background')

    await Promise.resolve()
    await Promise.resolve()
    const visible = queue.schedule(async () => {
      order.push('visible')
    })
    gate.resolve()

    await Promise.all([first, background, visible])
    expect(order).toEqual(['first', 'visible', 'background'])
  })
})
