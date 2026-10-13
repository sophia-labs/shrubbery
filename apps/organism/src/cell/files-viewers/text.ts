/**
 * Reading bytes as text, honestly: a BOM is believed, UTF-8 is tried strictly, and Windows-1252 is the fallback (every
 * byte means something there, so nothing is lost silently). Before any of that, a sniff: bytes that are not text (NULs,
 * control characters) are a binary file, whatever its name says, and go to the file page.
 */

/** Text over this many bytes shows its start first, with Show all. */
export const TEXT_CAP_BYTES = 2 * 1024 * 1024

/** Whether the start of `bytes` looks like text. UTF-16 with a BOM is text; NULs or many control bytes are not. */
export function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8192)
  if (n === 0) return false
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return false
  let control = 0
  for (let i = 0; i < n; i++) {
    const b = bytes[i]!
    if (b === 0) return true
    // Tab, LF, VT, FF, CR and ESC occur in text; the other C0 controls do not.
    if (b < 32 && b !== 9 && b !== 10 && b !== 11 && b !== 12 && b !== 13 && b !== 27) control++
  }
  return control / n > 0.1
}

export interface DecodedText {
  readonly text: string
  readonly encoding: 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252'
}

/** Decode bytes as text: BOM, then strict UTF-8, then Windows-1252. A UTF-8 BOM is not part of the text. */
export function decodeText(bytes: Uint8Array): DecodedText {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' }
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' }
  }
}

/**
 * The first `cap` bytes, cut back to the last line break (and never inside a UTF-8 sequence), or all of them when they
 * fit. `truncated` says whether anything was left out.
 */
export function capBytes(bytes: Uint8Array, cap = TEXT_CAP_BYTES): { readonly bytes: Uint8Array; readonly truncated: boolean } {
  if (bytes.length <= cap) return { bytes, truncated: false }
  let end = cap
  const floor = Math.max(0, cap - 64 * 1024)
  for (let i = cap; i > floor; i--) if (bytes[i - 1] === 10) { end = i; break }
  // Not inside a multi-byte sequence: step back over continuation bytes.
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--
  return { bytes: bytes.subarray(0, end), truncated: true }
}
