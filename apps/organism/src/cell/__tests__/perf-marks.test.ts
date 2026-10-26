import { afterEach, describe, expect, it } from 'vitest'
import { perfCount, perfEnabled, perfMeasure, perfSpan, setPerfEnabled } from '../perf-marks.js'

function measures(name: string): PerformanceEntry[] {
  return performance.getEntriesByName(`shrubbery:${name}`, 'measure')
}

describe('perf-marks', () => {
  afterEach(() => {
    setPerfEnabled(false)
    performance.clearMeasures()
    performance.clearMarks()
  })

  it('records nothing and leaves the timeline untouched when disabled', () => {
    setPerfEnabled(false)
    expect(perfEnabled()).toBe(false)
    const before = performance.getEntries().length
    perfSpan('shell.render')()
    perfCount('shell.render.requests')
    expect(perfMeasure('x', () => 7)).toBe(7)
    expect(performance.getEntries().length).toBe(before)
  })

  it('records one measure per span with its detail when enabled, and leaves no marks behind', () => {
    setPerfEnabled(true)
    const end = perfSpan('shell.render', { cause: 'test' })
    end({ blocks: 3 })
    end({ blocks: 99 }) // second end is ignored
    const [entry] = measures('shell.render') as PerformanceMeasure[]
    expect(measures('shell.render')).toHaveLength(1)
    expect(entry.duration).toBeGreaterThanOrEqual(0)
    expect(entry.detail).toEqual({ cause: 'test', blocks: 3 })
    expect(performance.getEntriesByType('mark').filter(m => m.name.startsWith('shrubbery:shell.render'))).toHaveLength(0)
  })

  it('records a span even when the body throws', () => {
    setPerfEnabled(true)
    expect(() => perfMeasure('boom', () => { throw new Error('x') })).toThrow('x')
    expect(measures('boom')).toHaveLength(1)
  })

  it('counts events as zero-length measures', () => {
    setPerfEnabled(true)
    perfCount('shell.render.requests', { cause: 'awareness' })
    perfCount('shell.render.requests', { cause: 'sidebar' })
    expect(measures('shell.render.requests')).toHaveLength(2)
  })
})
