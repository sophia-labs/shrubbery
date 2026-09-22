/**
 * Content-negotiation rule tests (curl-spike B0). The conneg logic mirrors the
 * CloudFront viewer-request function; these pin its contract:
 *   - bare request (no Accept) → markdown (the default; the whole point)
 *   - Accept maps to the right face
 *   - an explicit `.ext` ALWAYS wins over Accept
 *   - the resource path is correctly stripped of the pinning extension
 *
 * Since U8 (D12/R5) the rule lives in @shrubbery/render — the app-local copy is
 * retired; these tests keep running against the hoisted function, pinning the
 * behavior byte-identical across the migration. The hoisted result adds a
 * `query: URLSearchParams` field (the rhizome superset), so the full-object
 * equality assertions serialize `query` to its string form and stay EXACT —
 * every field of the complete NegotiationResult is pinned, and an unexpected
 * extra field fails the assertion.
 */

import { describe, it, expect } from 'vitest'
import { negotiate, targetFromAccept } from '@shrubbery/render'

describe('targetFromAccept — Accept → face', () => {
  it('no Accept → markdown (the default)', () => {
    expect(targetFromAccept(undefined)).toBe('hypertext')
    expect(targetFromAccept('')).toBe('hypertext')
  })
  it('*/* (bare curl sends this) → markdown', () => {
    expect(targetFromAccept('*/*')).toBe('hypertext')
  })
  it('text/html → dom (browsers)', () => {
    expect(targetFromAccept('text/html,application/xhtml+xml')).toBe('dom')
  })
  it('application/ld+json and application/json → json', () => {
    expect(targetFromAccept('application/ld+json')).toBe('json')
    expect(targetFromAccept('application/json')).toBe('json')
  })
  it('text/turtle → turtle', () => {
    expect(targetFromAccept('text/turtle')).toBe('turtle')
  })
  it('text/plain → markdown (default, never a machine blob)', () => {
    expect(targetFromAccept('text/plain')).toBe('hypertext')
  })
})

describe('negotiate — path + Accept → { path, target, pinned }', () => {
  it('bare path, no Accept → markdown, not pinned', () => {
    const r = negotiate('/catalog', undefined)
    expect({ ...r, query: r.query.toString() }).toEqual({ path: '/catalog', target: 'hypertext', query: '', pinned: false })
  })

  it('explicit .ttl wins over Accept: text/html', () => {
    const r = negotiate('/catalog.ttl', 'text/html')
    expect({ ...r, query: r.query.toString() }).toEqual({ path: '/catalog', target: 'turtle', query: '', pinned: true })
  })

  it('explicit .json on a nested item path strips only the last segment ext', () => {
    const r = negotiate('/catalog/mn-top-bar.json', undefined)
    expect({ ...r, query: r.query.toString() }).toEqual({ path: '/catalog/mn-top-bar', target: 'json', query: '', pinned: true })
  })

  it('.md / .html / .jsonld extensions map to their faces', () => {
    expect(negotiate('/catalog.md', undefined).target).toBe('hypertext')
    expect(negotiate('/catalog.html', undefined).target).toBe('dom')
    expect(negotiate('/catalog.jsonld', undefined).target).toBe('json')
  })

  it('a dotted segment that is NOT a known ext is NOT treated as pinned', () => {
    // e.g. a tag like 'mn-x.y' is not an extension we recognize → no pin.
    const r = negotiate('/catalog/weird.unknownext', undefined)
    expect(r.pinned).toBe(false)
    expect(r.path).toBe('/catalog/weird.unknownext')
  })

  it('strips query string and a trailing slash', () => {
    expect(negotiate('/catalog/?x=1', undefined).path).toBe('/catalog')
  })

  it('Accept decides when no extension is present', () => {
    expect(negotiate('/catalog', 'text/turtle').target).toBe('turtle')
    expect(negotiate('/catalog', 'application/ld+json').target).toBe('json')
  })
})
