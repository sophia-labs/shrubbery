/**
 * negotiate.test.ts — the hoisted conneg rule (U8, D12/R5).
 *
 * Pins the ONE surviving negotiate's contract:
 *   - explicit `.ext` ALWAYS wins over Accept (the pin),
 *   - the Accept table (html→dom, json/ld+json→json, turtle→turtle, md→hypertext),
 *   - the DEFAULT is markdown (bare curl, `*\/*`, text/plain, missing),
 *   - the query string passes through as URLSearchParams (never breaks routing),
 *   - the `pinned` flag reports whether an ext made the decision,
 *   - a trailing slash is stripped (but root '/' survives).
 *
 * Pure string-in/decision-out — runs in the plain node environment.
 */

import { describe, it, expect } from 'vitest'
import { negotiate, targetFromAccept } from '../negotiate.js'

describe('targetFromAccept — the Accept table', () => {
  it('no Accept → markdown (the default)', () => {
    expect(targetFromAccept(undefined)).toBe('hypertext')
    expect(targetFromAccept('')).toBe('hypertext')
  })

  it('*/* (bare curl) → markdown', () => {
    expect(targetFromAccept('*/*')).toBe('hypertext')
  })

  it('text/html → dom (browsers, even with q-lists)', () => {
    expect(targetFromAccept('text/html')).toBe('dom')
    expect(targetFromAccept('text/html,application/xhtml+xml;q=0.9,*/*;q=0.8')).toBe('dom')
  })

  it('application/ld+json and application/json → json', () => {
    expect(targetFromAccept('application/ld+json')).toBe('json')
    expect(targetFromAccept('application/json')).toBe('json')
  })

  it('text/turtle → turtle', () => {
    expect(targetFromAccept('text/turtle')).toBe('turtle')
  })

  it('text/markdown → hypertext', () => {
    expect(targetFromAccept('text/markdown')).toBe('hypertext')
  })

  it('text/plain / unknown types → markdown (never a machine blob)', () => {
    expect(targetFromAccept('text/plain')).toBe('hypertext')
    expect(targetFromAccept('image/png')).toBe('hypertext')
  })

  it('is case-insensitive', () => {
    expect(targetFromAccept('TEXT/HTML')).toBe('dom')
    expect(targetFromAccept('Text/Turtle')).toBe('turtle')
  })
})

describe('negotiate — ext precedence (the pin)', () => {
  it('explicit .ttl wins over Accept: text/html, and is pinned', () => {
    const r = negotiate('/catalog.ttl', 'text/html')
    expect(r.path).toBe('/catalog')
    expect(r.target).toBe('turtle')
    expect(r.pinned).toBe(true)
  })

  it('every known ext maps to its face', () => {
    expect(negotiate('/x.md', undefined).target).toBe('hypertext')
    expect(negotiate('/x.markdown', undefined).target).toBe('hypertext')
    expect(negotiate('/x.ttl', undefined).target).toBe('turtle')
    expect(negotiate('/x.json', undefined).target).toBe('json')
    expect(negotiate('/x.jsonld', undefined).target).toBe('json')
    expect(negotiate('/x.html', undefined).target).toBe('dom')
  })

  it('ext is case-insensitive and strips only the LAST segment ext', () => {
    const r = negotiate('/catalog/mn-top-bar.JSON', 'text/turtle')
    expect(r.path).toBe('/catalog/mn-top-bar')
    expect(r.target).toBe('json')
    expect(r.pinned).toBe(true)
  })

  it('a dotted segment that is NOT a known ext is NOT pinned — Accept decides', () => {
    const r = negotiate('/catalog/mn-x.unknownext', 'text/turtle')
    expect(r.pinned).toBe(false)
    expect(r.path).toBe('/catalog/mn-x.unknownext')
    expect(r.target).toBe('turtle')
  })

  it('a leading dot (hidden-file shape) is not an ext', () => {
    const r = negotiate('/.ttl', undefined)
    expect(r.pinned).toBe(false)
    expect(r.path).toBe('/.ttl')
  })
})

describe('negotiate — Accept decides when no ext, default markdown', () => {
  it('bare path, no Accept → markdown, not pinned', () => {
    const r = negotiate('/catalog', undefined)
    expect(r.path).toBe('/catalog')
    expect(r.target).toBe('hypertext')
    expect(r.pinned).toBe(false)
  })

  it('Accept maps: turtle / json / html', () => {
    expect(negotiate('/catalog', 'text/turtle').target).toBe('turtle')
    expect(negotiate('/catalog', 'application/ld+json').target).toBe('json')
    expect(negotiate('/catalog', 'text/html').target).toBe('dom')
  })

  it('root "/" stays "/" and defaults to markdown', () => {
    const r = negotiate('/', undefined)
    expect(r.path).toBe('/')
    expect(r.target).toBe('hypertext')
    expect(r.pinned).toBe(false)
  })
})

describe('negotiate — query passthrough', () => {
  it('splits ?asof off the path and returns it as URLSearchParams', () => {
    const r = negotiate('/plot/3c373460?asof=2023-05-25', undefined)
    expect(r.path).toBe('/plot/3c373460')
    expect(r.query.get('asof')).toBe('2023-05-25')
  })

  it('query survives an ext pin (the temporal lens composes with a pinned face)', () => {
    const r = negotiate('/plot/3c373460.ttl?asof=2023-05-25&turn=4', 'text/html')
    expect(r.path).toBe('/plot/3c373460')
    expect(r.target).toBe('turtle')
    expect(r.pinned).toBe(true)
    expect(r.query.get('asof')).toBe('2023-05-25')
    expect(r.query.get('turn')).toBe('4')
  })

  it('no query → an EMPTY URLSearchParams (always present, never undefined)', () => {
    const r = negotiate('/catalog', undefined)
    expect(r.query).toBeInstanceOf(URLSearchParams)
    expect([...r.query.keys()]).toEqual([])
  })

  it('a dot inside the query string never pins a face', () => {
    const r = negotiate('/plot?asof=2023-05-25T00:00:00.000Z', undefined)
    expect(r.path).toBe('/plot')
    expect(r.pinned).toBe(false)
    expect(r.query.get('asof')).toBe('2023-05-25T00:00:00.000Z')
  })
})

describe('negotiate — trailing-slash strip', () => {
  it('strips a trailing slash (and query) from a resource path', () => {
    const r = negotiate('/catalog/?x=1', undefined)
    expect(r.path).toBe('/catalog')
    expect(r.query.get('x')).toBe('1')
  })

  it('collapses multiple trailing slashes', () => {
    expect(negotiate('/catalog///', undefined).path).toBe('/catalog')
  })

  it('but keeps the root "/"', () => {
    expect(negotiate('/', undefined).path).toBe('/')
  })
})
