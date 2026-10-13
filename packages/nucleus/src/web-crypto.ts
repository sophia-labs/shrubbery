/**
 * `crypto.randomUUID` and `crypto.subtle.digest('SHA-256', …)` that also work on
 * a plain-HTTP page.
 *
 * Browsers expose `randomUUID` and `subtle` only in secure contexts (HTTPS,
 * localhost). Garden is also served over plain HTTP on a LAN address (the Sophia
 * Resident add-on, `http://<host>.local:8100`), where both are missing and a bare
 * call throws: the editor's block ids, artifact/file/CSS hashes and every minted
 * operation id fail. Each helper uses the native call when the browser offers
 * it, and otherwise falls back: a v4 UUID from `crypto.getRandomValues` (which
 * every context has) and a pure-JS SHA-256 with the same `ArrayBuffer` result.
 *
 * Dependency-free on purpose: imported as `@shrubbery/nucleus/web-crypto` by the
 * editor and chat kernels too, without taking the rest of nucleus.
 */

/** An RFC 4122 version 4 UUID: native `crypto.randomUUID()` when present, else built from `getRandomValues`. */
export function randomUUID(): string {
  const c = globalThis.crypto
  if (typeof c?.randomUUID === 'function') return c.randomUUID()
  const b = c.getRandomValues(new Uint8Array(16))
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** SHA-256 of `data`, as `crypto.subtle.digest('SHA-256', data)` resolves it: native when present, else pure JS. */
export async function sha256Digest(data: BufferSource): Promise<ArrayBuffer> {
  const subtle = globalThis.crypto?.subtle
  if (subtle) return subtle.digest('SHA-256', data)
  return sha256(ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data))
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n))

/** FIPS 180-4 SHA-256 over whole bytes. */
function sha256(message: Uint8Array): ArrayBuffer {
  const total = Math.ceil((message.length + 9) / 64) * 64
  const padded = new Uint8Array(total)
  padded.set(message)
  padded[message.length] = 0x80
  const view = new DataView(padded.buffer)
  const bits = message.length * 8
  view.setUint32(total - 8, Math.floor(bits / 0x100000000))
  view.setUint32(total - 4, bits >>> 0)
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const W = new Uint32Array(64)
  for (let offset = 0; offset < total; offset += 64) {
    for (let t = 0; t < 16; t++) W[t] = view.getUint32(offset + t * 4)
    for (let t = 16; t < 64; t++) {
      const x = W[t - 15]!, y = W[t - 2]!
      W[t] = W[t - 16]! + (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) + W[t - 7]! + (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10))
    }
    let a = H[0]!, b = H[1]!, c = H[2]!, d = H[3]!, e = H[4]!, f = H[5]!, g = H[6]!, h = H[7]!
    for (let t = 0; t < 64; t++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[t]! + W[t]!) | 0
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h
  }
  const out = new DataView(new ArrayBuffer(32))
  for (let i = 0; i < 8; i++) out.setUint32(i * 4, H[i]!)
  return out.buffer
}
