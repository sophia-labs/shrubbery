/** PDF block provenance transport. Original-byte truth is verified by consumers. */
import { sha256Digest } from './web-crypto.js'
export const PDF_SOURCE_ANCHOR_ATTRIBUTE = 'data-pdf-anchor'
export type PdfRect = readonly [number, number, number, number]
export interface PdfSourceAnchorV1 {
  version: 1
  source: { sha256: string; byteLength: number; artifactId?: string; revisionId?: string }
  textSha256: string
  relation: 'derived-from'
  precision: 'block'
  extraction: { approach: string; version: string }
  targets: readonly {
    pageIndex: number
    space: 'pdf-user-space'
    viewBox: PdfRect
    userUnit: number
    rotation: 0 | 90 | 180 | 270
    rects: readonly PdfRect[]
  }[]
}
export type PdfSourceAnchorInspection =
  | { status: 'absent' }
  | { status: 'invalid' | 'unsupported'; reason: string }
  | { status: 'mapped'; anchor: PdfSourceAnchorV1 }

const utf8 = new TextEncoder()
const HASH = /^[a-f0-9]{64}$/
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/
const MAX_BYTES = 65_536
const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v))
const keys = (v: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean =>
  required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => required.includes(k) || optional.includes(k))
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && utf8.encode(v).length <= 128
function rect(v: unknown): v is PdfRect {
  return Array.isArray(v) && v.length === 4 && v.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e9)
    && positive(v[2] - v[0]) && positive(v[3] - v[1])
    && positive((v[2] - v[0]) * (v[3] - v[1]))
}
function validate(v: unknown): v is PdfSourceAnchorV1 {
  if (!object(v) || !keys(v, ['version', 'source', 'textSha256', 'relation', 'precision', 'extraction', 'targets'])) return false
  if (v.version !== 1 || v.relation !== 'derived-from' || v.precision !== 'block' || typeof v.textSha256 !== 'string' || !HASH.test(v.textSha256)) return false
  const s = v.source, e = v.extraction
  if (!object(s) || !keys(s, ['sha256', 'byteLength'], ['artifactId', 'revisionId'])) return false
  if (typeof s.sha256 !== 'string' || !HASH.test(s.sha256) || !Number.isSafeInteger(s.byteLength) || !(Number(s.byteLength) > 0)) return false
  for (const k of ['artifactId', 'revisionId']) if (Object.hasOwn(s, k) && (typeof s[k] !== 'string' || !ID.test(s[k] as string))) return false
  if (Object.hasOwn(s, 'revisionId') && !Object.hasOwn(s, 'artifactId')) return false
  if (!object(e) || !keys(e, ['approach', 'version']) || !text(e.approach) || !text(e.version)) return false
  if (!Array.isArray(v.targets) || !v.targets.length || v.targets.length > 64) return false
  let count = 0
  for (const t of v.targets) {
    if (!object(t) || !keys(t, ['pageIndex', 'space', 'viewBox', 'userUnit', 'rotation', 'rects'])) return false
    if (!Number.isSafeInteger(t.pageIndex) || Number(t.pageIndex) < 0 || t.space !== 'pdf-user-space' || ![0, 90, 180, 270].includes(t.rotation as number)) return false
    if (!rect(t.viewBox) || !positive(t.userUnit) || t.userUnit > 1e6) return false
    const width = (t.viewBox[2] - t.viewBox[0]) * t.userUnit, height = (t.viewBox[3] - t.viewBox[1]) * t.userUnit
    if (!positive(width) || !positive(height) || !positive(width * height)) return false
    if (!Array.isArray(t.rects) || !t.rects.length || (count += t.rects.length) > 2048) return false
    for (const r of t.rects) {
      if (!rect(r) || r[0] < t.viewBox[0] || r[1] < t.viewBox[1] || r[2] > t.viewBox[2] || r[3] > t.viewBox[3]) return false
      const w = (r[2] - r[0]) * t.userUnit, h = (r[3] - r[1]) * t.userUnit
      if (!positive(w) || !positive(h) || !positive(w * h)) return false
    }
  }
  return true
}
export function inspectPdfSourceAnchor(value: unknown): PdfSourceAnchorInspection {
  if (value === undefined || value === null) return { status: 'absent' }
  if (typeof value !== 'string') return { status: 'invalid', reason: 'PDF anchor must be a JSON string.' }
  if (value.length > MAX_BYTES || utf8.encode(value).length > MAX_BYTES) return { status: 'invalid', reason: 'PDF anchor exceeds its byte limit.' }
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { return { status: 'invalid', reason: 'PDF anchor is not valid JSON.' } }
  if (object(parsed) && Number.isSafeInteger(parsed.version) && Number(parsed.version) > 1) return { status: 'unsupported', reason: 'PDF anchor version is not supported.' }
  return validate(parsed) ? { status: 'mapped', anchor: parsed } : { status: 'invalid', reason: 'PDF anchor does not satisfy the version 1 contract.' }
}
export function decodePdfSourceAnchor(value: unknown): PdfSourceAnchorV1 | null {
  const result = inspectPdfSourceAnchor(value)
  return result.status === 'mapped' ? result.anchor : null
}
export function encodePdfSourceAnchor(anchor: PdfSourceAnchorV1): string {
  if (!validate(anchor)) throw new Error('Invalid PDF source anchor')
  const { source: s, extraction: e } = anchor
  const value = JSON.stringify({ version: 1, source: { sha256: s.sha256, byteLength: s.byteLength,
    ...(s.artifactId === undefined ? {} : { artifactId: s.artifactId }), ...(s.revisionId === undefined ? {} : { revisionId: s.revisionId }) },
    textSha256: anchor.textSha256, relation: anchor.relation, precision: anchor.precision,
    extraction: { approach: e.approach, version: e.version }, targets: anchor.targets.map(t => ({
      pageIndex: t.pageIndex, space: t.space, viewBox: t.viewBox, userUnit: t.userUnit, rotation: t.rotation, rects: t.rects,
    })) })
  if (utf8.encode(value).length > MAX_BYTES) throw new Error('PDF source anchor exceeds its byte limit')
  return value
}
/** Exact descendant text leaves, without separators, marks, attrs or cached ancestor text. */
export function pdfSourceText(node: unknown): string {
  const pieces: string[] = [], stack: unknown[] = [node]
  while (stack.length) {
    const current = stack.pop()
    if (!object(current)) continue
    const children = Array.isArray(current.content) ? current.content : []
    if (!children.length && current.type === 'text' && typeof current.text === 'string') pieces.push(current.text)
    else for (let i = children.length - 1; i >= 0; i--) stack.push(children[i])
  }
  return pieces.join('')
}
export async function sha256PdfSourceBytes(bytes: Uint8Array): Promise<string> {
  const digest = await sha256Digest(new Uint8Array(bytes))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}
export function pdfSourceTextSha256(node: unknown): Promise<string> {
  return sha256PdfSourceBytes(utf8.encode(pdfSourceText(node)))
}
export const canonicalPdfAnchorText = pdfSourceText
export const sha256PdfAnchorText = pdfSourceTextSha256
