import { describe, expect, it } from 'vitest'
import { createCoalescedRunner } from '../coalesced-runner.js'

/** A run whose completion the test controls (a real promise, not a stand-in for any collaborator). */
function gate() {
  const runs: Array<() => void> = []
  let started = 0
  const run = (): Promise<number> => new Promise((resolve) => {
    const id = ++started
    runs.push(() => resolve(id))
  })
  return { run, finish: (index: number) => runs[index]!(), get started() { return started } }
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('createCoalescedRunner', () => {
  it('starts immediately when idle and runs again after it settles', async () => {
    const g = gate()
    const request = createCoalescedRunner(g.run)
    const first = request()
    expect(g.started).toBe(1)
    g.finish(0)
    expect(await first).toBe(1)
    await tick()
    const second = request()
    expect(g.started).toBe(2)
    g.finish(1)
    expect(await second).toBe(2)
  })

  it('collapses any number of requests during a run into exactly one trailing run, shared by all of them', async () => {
    const g = gate()
    const request = createCoalescedRunner(g.run)
    const first = request()
    const a = request()
    const b = request()
    const c = request()
    expect(g.started, 'no extra queries while one is in flight').toBe(1)
    expect(a).toBe(b)
    expect(b).toBe(c)
    g.finish(0)
    expect(await first).toBe(1)
    await tick()
    expect(g.started, 'one trailing run started when the first settled').toBe(2)
    g.finish(1)
    expect(await a).toBe(2)
    expect(await c).toBe(2)
    await tick()
    expect(g.started, 'and nothing more').toBe(2)
  })

  it('a request that arrives during the trailing run schedules one more, not many', async () => {
    const g = gate()
    const request = createCoalescedRunner(g.run)
    void request()
    const t1 = request()
    g.finish(0)
    await tick()
    expect(g.started).toBe(2)
    const t2 = request()
    const t3 = request()
    expect(t2).toBe(t3)
    g.finish(1)
    expect(await t1).toBe(2)
    await tick()
    expect(g.started).toBe(3)
    g.finish(2)
    expect(await t2).toBe(3)
  })

  it('never merges across keys: another graph starts at once and the first graph read is not waited on', async () => {
    const g = gate()
    let key = 'g1'
    const request = createCoalescedRunner(g.run, () => key)
    const one = request()
    key = 'g2'
    const two = request()
    expect(g.started, 'a different graph does not queue behind the first').toBe(2)
    g.finish(1)
    expect(await two).toBe(2)
    g.finish(0)
    expect(await one).toBe(1)
  })

  it('a superseded run hands its collapsed callers to the run now in flight', async () => {
    const g = gate()
    let key = 'g1'
    const request = createCoalescedRunner(g.run, () => key)
    void request()
    const waiting = request() // collapses behind g1's run
    key = 'g2'
    void request() // supersedes the g1 slot
    expect(g.started).toBe(2)
    g.finish(0) // g1 settles; its trailing callers join the g2 run
    g.finish(1)
    expect(await waiting).toBe(2)
  })

  it('propagates a failure to the callers of that run without wedging the runner', async () => {
    let calls = 0
    const request = createCoalescedRunner(async () => {
      calls += 1
      if (calls === 1) throw new Error('boom')
      return calls
    })
    await expect(request()).rejects.toThrow('boom')
    await tick()
    expect(await request()).toBe(2)
  })
})
