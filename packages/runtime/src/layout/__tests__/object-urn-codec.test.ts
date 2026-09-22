/**
 * object-urn-codec.test.ts — the `urn:sophia:object:` codec round-trip law
 * (WS1 §6.1/§9 S2, master spec §3 Slice 2).
 */
import { describe, expect, it } from 'vitest'
import {
  OBJECT_URN_PREFIX,
  objectKeyOf,
  objectUrn,
  parseObjectKey,
  parseObjectUrn,
  type ObjectKeyParts,
} from '../source-object-service.js'

const TABLE: readonly ObjectKeyParts[] = [
  { vocab: 'koch-morse', class: 'PracticeSession', objectId: '2026-07-29T14:02:11Z-a1b2' },
  { vocab: 'emporium-bookmark', class: 'Bookmark', objectId: 'shared-bookmark' },
  // `:`-bearing parts — the URN's own separator, requires escaping.
  { vocab: 'v', class: 'C', objectId: 'has:colon:in:it' },
  // `%`-bearing parts — totality, never a real id, but the codec must not lose them.
  { vocab: 'v', class: 'C', objectId: 'has%percent' },
  { vocab: 'v', class: 'C', objectId: 'both%25and:colon' },
]

describe('object URN codec — round-trip law', () => {
  it.each(TABLE)('parseObjectUrn(objectUrn(%o)) deep-equals the input', (parts) => {
    expect(parseObjectUrn(objectUrn(parts))).toEqual(parts)
  })

  it('mints the documented urn:sophia:object: scheme', () => {
    expect(OBJECT_URN_PREFIX).toBe('urn:sophia:object:')
    expect(objectUrn({ vocab: 'koch-morse', class: 'PracticeSession', objectId: 'abc' })).toBe(
      'urn:sophia:object:koch-morse:PracticeSession:abc',
    )
  })

  it('objectUrn throws on any empty part', () => {
    expect(() => objectUrn({ vocab: '', class: 'C', objectId: 'x' })).toThrow()
    expect(() => objectUrn({ vocab: 'v', class: '', objectId: 'x' })).toThrow()
    expect(() => objectUrn({ vocab: 'v', class: 'C', objectId: '' })).toThrow()
  })

  it('parseObjectUrn returns null for a projection subject IRI', () => {
    expect(parseObjectUrn('http://mnemosyne.dev/graph:projection:koch-morse:session:abc')).toBeNull()
  })

  it('parseObjectUrn returns null for a bare iri', () => {
    expect(parseObjectUrn('urn:sophia:observatory:gap:1')).toBeNull()
  })

  it('parseObjectUrn returns null for a truncated URN', () => {
    expect(parseObjectUrn('urn:sophia:object:only-two:parts')).toBeNull()
    expect(parseObjectUrn('urn:sophia:object:only-one')).toBeNull()
  })

  it('parseObjectUrn returns null for a URN with the wrong part count', () => {
    expect(parseObjectUrn('urn:sophia:object:a:b:c:d')).toBeNull()
  })

  it('parseObjectUrn returns null for a string with no object prefix at all', () => {
    expect(parseObjectUrn('not-a-urn-at-all')).toBeNull()
  })

  it('one-pass decode: %253A never becomes a raw colon (two-pass would turn it into one)', () => {
    const parts: ObjectKeyParts = { vocab: 'v', class: 'C', objectId: 'literal-percent-3A-%253A' }
    const urn = objectUrn(parts)
    expect(parseObjectUrn(urn)).toEqual(parts)
    // The encoded objectId segment contains the escaped-escaped form, not a bare colon.
    expect(urn).toContain('%2525')
  })
})

describe('objectKeyOf / parseObjectKey — the wire form', () => {
  it.each(TABLE)('parseObjectKey(objectKeyOf(%o)) deep-equals the input', (parts) => {
    expect(parseObjectKey(objectKeyOf(parts))).toEqual(parts)
  })

  it('joins on the ASCII Unit Separator, matching garden object_key()', () => {
    const key = objectKeyOf({ vocab: 'koch-morse', class: 'PracticeSession', objectId: 'abc' })
    expect(key).toBe('koch-morsePracticeSessionabc')
  })

  it('parseObjectKey returns null for a malformed key', () => {
    expect(parseObjectKey('not-a-key')).toBeNull()
    expect(parseObjectKey('ab')).toBeNull()
    expect(parseObjectKey('abcd')).toBeNull()
  })
})
