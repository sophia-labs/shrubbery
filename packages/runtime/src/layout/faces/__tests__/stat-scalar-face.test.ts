/**
 * stat-scalar-face.test.ts — the resource-adapter shape proof (mirrors
 * sparql-bindings-table-face.test.ts's own scope) plus pure `formatStat
 * ScalarValue`/delta/sparkline-geometry unit coverage. A real query against a
 * real gardend cell — including the real delta/series data flow — is
 * exercised in stat-scalar-face.integration.test.ts.
 */
import { describe, expect, it } from 'vitest'
import type { QueryBlockResult, QueryBlockService } from '../../../editor-services/query-block-service.js'
import {
  createStatScalarResourceAdapter,
  deriveStatDeltaDirection,
  deriveStatDeltaTone,
  formatStatDeltaValue,
  formatStatScalarValue,
  STAT_SCALAR_FACE_ID,
  statScalarReading,
} from '../stat-scalar-face.js'
import { computeSparklineGeometry } from '../stat-scalar-view-element.js'
import { createRawTextQueryResolver } from '../../named-query-registry.js'

const unusedService: QueryBlockService = {
  async run() {
    throw new Error('stat-scalar-face.test.ts: run() should never be invoked by this suite')
  },
}

describe('stat.scalar — resource adapter shape', () => {
  it('has the expected face id and adapter id', () => {
    expect(STAT_SCALAR_FACE_ID).toBe('stat.scalar')
    const adapter = createStatScalarResourceAdapter(unusedService, createRawTextQueryResolver())
    expect(adapter.adapterId).toBe('stat.scalar.query-handle')
    expect(adapter.shape).toBe('derived')
  })

  it('accepts only query locators', () => {
    const adapter = createStatScalarResourceAdapter(unusedService, createRawTextQueryResolver())
    expect(adapter.accepts({ kind: 'query', graphId: 'g', queryId: 'SELECT (COUNT(?s) AS ?c) WHERE { ?s ?p ?o }' })).toBe(true)
    expect(adapter.accepts({ kind: 'graph', graphId: 'g' })).toBe(false)
  })

  it('resourceKey is a collision-safe tagged tuple', () => {
    const adapter = createStatScalarResourceAdapter(unusedService, createRawTextQueryResolver())
    const keyAB_C = adapter.resourceKey({ kind: 'query', graphId: 'a:b', queryId: 'c' })
    const keyA_BC = adapter.resourceKey({ kind: 'query', graphId: 'a', queryId: 'b:c' })
    expect(keyAB_C).not.toBe(keyA_BC)
  })
})

describe('stat.scalar — formatStatScalarValue (pure)', () => {
  it('passes raw text through when no format is given', () => {
    expect(formatStatScalarValue('42', undefined)).toBe('42')
    expect(formatStatScalarValue('hello world', undefined)).toBe('hello world')
  })

  it('formats "number" with locale grouping', () => {
    expect(formatStatScalarValue('1234567', 'number')).toBe('1,234,567')
  })

  it('formats "usd" as US currency', () => {
    expect(formatStatScalarValue('1234.5', 'usd')).toBe('$1,234.50')
  })

  it('formats "ms" with a trailing unit', () => {
    expect(formatStatScalarValue('812', 'ms')).toBe('812 ms')
  })

  it('formats "dateTimeRelative" relative to a fixed "now"', () => {
    const now = new Date('2026-07-16T12:00:00.000Z')
    const threeHoursAgo = new Date('2026-07-16T09:00:00.000Z').toISOString()
    expect(formatStatScalarValue(threeHoursAgo, 'dateTimeRelative', now)).toBe('3 hours ago')

    const inTwoDays = new Date('2026-07-18T12:00:00.000Z').toISOString()
    expect(formatStatScalarValue(inTwoDays, 'dateTimeRelative', now)).toBe('in 2 days')
  })

  it('falls back to the raw text on unparseable numeric/date input — never a fabricated value', () => {
    expect(formatStatScalarValue('not-a-number', 'number')).toBe('not-a-number')
    expect(formatStatScalarValue('not-a-number', 'usd')).toBe('not-a-number')
    expect(formatStatScalarValue('not-a-date', 'dateTimeRelative')).toBe('not-a-date')
  })
})

describe('stat.scalar — formatStatDeltaValue (pure)', () => {
  it('signs a positive delta with a leading "+"', () => {
    expect(formatStatDeltaValue('12', undefined)).toBe('+12')
    expect(formatStatDeltaValue('12', 'number')).toBe('+12')
  })

  it('signs a negative delta with a leading "-" and a positive magnitude', () => {
    expect(formatStatDeltaValue('-4.5', 'number')).toBe('-4.5')
  })

  it('renders zero unsigned — flat is not "+0"', () => {
    expect(formatStatDeltaValue('0', 'number')).toBe('0')
  })

  it('appends "%" and rounds to one decimal for the "percent" format', () => {
    expect(formatStatDeltaValue('12.345', 'percent')).toBe('+12.3%')
    expect(formatStatDeltaValue('-3', 'percent')).toBe('-3%')
  })

  it('falls back to the raw text on unparseable input — never a fabricated value', () => {
    expect(formatStatDeltaValue('not-a-number', 'number')).toBe('not-a-number')
  })
})

describe('stat.scalar — deriveStatDeltaDirection (pure)', () => {
  it('positive is up, negative is down, zero is flat', () => {
    expect(deriveStatDeltaDirection('7')).toBe('up')
    expect(deriveStatDeltaDirection('-7')).toBe('down')
    expect(deriveStatDeltaDirection('0')).toBe('flat')
  })

  it('unparseable input is honestly flat, never guessed as up/down', () => {
    expect(deriveStatDeltaDirection('not-a-number')).toBe('flat')
  })
})

describe('stat.scalar — deriveStatDeltaTone (pure, RESERVED status set only)', () => {
  it('up-is-good (the default): up -> good, down -> bad', () => {
    expect(deriveStatDeltaTone('up', 'up')).toBe('good')
    expect(deriveStatDeltaTone('down', 'up')).toBe('bad')
  })

  it('down-is-good (e.g. an error-rate metric): the mapping inverts', () => {
    expect(deriveStatDeltaTone('down', 'down')).toBe('good')
    expect(deriveStatDeltaTone('up', 'down')).toBe('bad')
  })

  it('flat is always neutral — never "good" or "bad" on its own, regardless of goodDirection', () => {
    expect(deriveStatDeltaTone('flat', 'up')).toBe('neutral')
    expect(deriveStatDeltaTone('flat', 'down')).toBe('neutral')
  })
})

describe('stat.scalar — statScalarReading (pure, the three honest outcomes)', () => {
  it('a serialized result is an error — WITH THE EXISTING MESSAGE TEXT (pins that the refactor changed no operator-visible string)', () => {
    const result: QueryBlockResult = {
      queryKind: 'construct',
      durationMs: 0,
      raw: null,
      resultKind: 'serialized',
      mediaType: 'text/turtle',
      value: '<urn:a> <urn:b> <urn:c> .',
    }
    expect(statScalarReading(result)).toEqual({
      kind: 'error',
      message: 'stat.scalar only renders SELECT/ASK results (got a serialized result)',
    })
  })

  it('zero rows is no-data', () => {
    const result: QueryBlockResult = {
      queryKind: 'select',
      durationMs: 0,
      raw: null,
      resultKind: 'bindings',
      columns: ['v'],
      rows: [],
    }
    expect(statScalarReading(result)).toEqual({ kind: 'no-data' })
  })

  it('a row whose first column is unbound is no-data — an OPTIONAL that missed', () => {
    const result: QueryBlockResult = {
      queryKind: 'select',
      durationMs: 0,
      raw: null,
      resultKind: 'bindings',
      columns: ['v'],
      rows: [{}],
    }
    expect(statScalarReading(result)).toEqual({ kind: 'no-data' })
  })

  it('zero columns is no-data — the degenerate SELECT * WHERE {} shape', () => {
    const result: QueryBlockResult = {
      queryKind: 'select',
      durationMs: 0,
      raw: null,
      resultKind: 'bindings',
      columns: [],
      rows: [{}],
    }
    expect(statScalarReading(result)).toEqual({ kind: 'no-data' })
  })

  it('a genuine zero literal is a VALUE, not no-data — the converse property, proving the fix does not simply hide zeros', () => {
    const result: QueryBlockResult = {
      queryKind: 'select',
      durationMs: 0,
      raw: null,
      resultKind: 'bindings',
      columns: ['v'],
      rows: [{ v: { type: 'literal', value: '0', datatype: 'http://www.w3.org/2001/XMLSchema#integer' } }],
    }
    expect(statScalarReading(result)).toEqual({ kind: 'value', raw: '0' })
  })
})

function parsePoints(linePoints: string): readonly (readonly [number, number])[] {
  return linePoints.split(' ').map((pair) => {
    const [x, y] = pair.split(',').map(Number)
    return [x, y] as const
  })
}

describe('stat.scalar — computeSparklineGeometry (pure)', () => {
  it('spans the first point at x=0 and the last point at x=100, one per series entry', () => {
    const points = parsePoints(computeSparklineGeometry([1, 2, 3]).linePoints)
    expect(points).toHaveLength(3)
    expect(points[0][0]).toBe(0)
    expect(points[2][0]).toBe(100)
  })

  it("the dot sits exactly at the series' last point", () => {
    const geometry = computeSparklineGeometry([1, 2, 3])
    const points = parsePoints(geometry.linePoints)
    const [lastX, lastY] = points[points.length - 1]
    expect(geometry.dotLeftPct).toBe(lastX)
    expect(geometry.dotTopPct).toBe(lastY)
  })

  it('the highest value sits at the smallest y (SVG y grows downward)', () => {
    const points = parsePoints(computeSparklineGeometry([1, 5]).linePoints)
    const [, firstY] = points[0]
    const [, lastY] = points[1]
    expect(lastY).toBeLessThan(firstY)
  })

  it('a flat series (min === max) draws a level line, not a division by zero', () => {
    const points = parsePoints(computeSparklineGeometry([5, 5, 5]).linePoints)
    const ys = points.map(([, y]) => y)
    expect(ys.every((y) => y === ys[0])).toBe(true)
    expect(Number.isFinite(ys[0])).toBe(true)
  })
})
