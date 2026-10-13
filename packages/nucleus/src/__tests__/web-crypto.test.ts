// @vitest-environment node
/**
 * web-crypto — the helpers must work where a plain-HTTP page leaves them: no
 * `crypto.randomUUID`, no `crypto.subtle`, only `crypto.getRandomValues`.
 *
 * The insecure context is reproduced for real: `globalThis.crypto` is replaced
 * by an object carrying only Node's real `getRandomValues`, which is what a
 * browser hands a non-secure origin. The native reference stays reachable as
 * `webcrypto` from `node:crypto`, so the fallback is compared byte-for-byte
 * against the real `subtle.digest`.
 */
import { randomBytes, webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID, sha256Digest } from '../web-crypto.js'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const hex = (buffer: ArrayBuffer): string => Buffer.from(buffer).toString('hex')
const utf8 = (text: string) => new TextEncoder().encode(text)
const nativeDigest = (data: BufferSource): Promise<ArrayBuffer> => webcrypto.subtle.digest('SHA-256', data)

// FIPS 180-2 appendix B / NIST CSHA vectors, plus the common pangram.
const VECTORS: ReadonlyArray<readonly [string, string]> = [
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  [
    'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
    'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1',
  ],
  ['The quick brown fox jumps over the lazy dog', 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592'],
]

describe('web-crypto on a plain-HTTP page (no randomUUID, no subtle)', () => {
  let saved: PropertyDescriptor | undefined
  beforeEach(() => {
    saved = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) },
    })
  })
  afterEach(() => {
    if (saved) Object.defineProperty(globalThis, 'crypto', saved)
  })

  it('really is the insecure shape: getRandomValues only', () => {
    expect(typeof globalThis.crypto.getRandomValues).toBe('function')
    expect((globalThis.crypto as { randomUUID?: unknown }).randomUUID).toBeUndefined()
    expect((globalThis.crypto as { subtle?: unknown }).subtle).toBeUndefined()
  })

  it('randomUUID mints RFC 4122 version 4 ids, all distinct', () => {
    const ids = Array.from({ length: 20_000 }, () => randomUUID())
    for (const id of ids) expect(id).toMatch(UUID_V4)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('randomUUID sets the version nibble and variant bits on every draw, not by chance', () => {
    // Over 20k random draws an unmasked byte would show every nibble in those
    // positions; the mask leaves exactly {4} and {8,9,a,b}.
    const versions = new Set<string>(), variants = new Set<string>()
    for (let i = 0; i < 20_000; i++) {
      const id = randomUUID()
      versions.add(id[14]!)
      variants.add(id[19]!)
    }
    expect([...versions]).toEqual(['4'])
    expect([...variants].sort()).toEqual(['8', '9', 'a', 'b'])
  })

  it('sha256Digest matches the published vectors', async () => {
    for (const [input, expected] of VECTORS) expect(hex(await sha256Digest(utf8(input))), JSON.stringify(input)).toBe(expected)
  })

  it('sha256Digest matches the one-million-"a" vector (many blocks)', async () => {
    expect(hex(await sha256Digest(new Uint8Array(1_000_000).fill(0x61)))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    )
  })

  it('sha256Digest equals native subtle.digest at every length across the padding edges, and beyond', async () => {
    const lengths = [...Array.from({ length: 200 }, (_, n) => n), 447, 448, 511, 512, 1000, 4095, 4096, 4097, 65_536, 65_537, 300_001]
    for (const length of lengths) {
      const bytes = Uint8Array.from(randomBytes(length))
      expect(hex(await sha256Digest(bytes)), `length ${length}`).toBe(hex(await nativeDigest(bytes)))
    }
  })

  it('sha256Digest resolves an ArrayBuffer of 32 bytes, the shape subtle.digest resolves', async () => {
    const digest = await sha256Digest(utf8('abc'))
    expect(digest).toBeInstanceOf(ArrayBuffer)
    expect(digest.byteLength).toBe(32)
  })

  it('sha256Digest hashes exactly the bytes of a view, not the buffer behind it', async () => {
    const backing = Uint8Array.from(randomBytes(300))
    const window = backing.subarray(37, 37 + 129)
    const expected = hex(await nativeDigest(window.slice()))
    expect(hex(await sha256Digest(window))).toBe(expected)
    expect(hex(await sha256Digest(new DataView(backing.buffer, 37, 129)))).toBe(expected)
    expect(hex(await sha256Digest(window.slice().buffer))).toBe(expected)
    expect(hex(await sha256Digest(new Uint32Array(backing.buffer.slice(40, 40 + 128))))).toBe(
      hex(await nativeDigest(backing.slice(40, 40 + 128))),
    )
  })
})

describe('web-crypto in a secure context (Node offers the native calls)', () => {
  it('randomUUID delegates to the native call, bound to crypto', () => {
    expect(typeof globalThis.crypto.randomUUID).toBe('function')
    expect(randomUUID()).toMatch(UUID_V4)
  })

  it('sha256Digest delegates to subtle.digest with the same result shape', async () => {
    expect(globalThis.crypto.subtle).toBeDefined()
    const digest = await sha256Digest(utf8('abc'))
    expect(digest).toBeInstanceOf(ArrayBuffer)
    expect(hex(digest)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})
