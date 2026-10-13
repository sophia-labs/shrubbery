/** The automatic starter reuses this edition; it never updates an older copy. */
import { GARDEN_ONBOARDING_EDITION, GARDEN_ONBOARDING_PAGES, gardenOnboardingDocument } from './garden-onboarding-content.js'
import { sha256Digest } from '@shrubbery/nucleus/web-crypto'

export const STARTER_MANIFEST_SHA256 = 'b6b781c0b096e89bc7962939fa3a569796d83322e18e6eadb56e4706efef9c3f'
export const STARTER_EDITION = GARDEN_ONBOARDING_EDITION
export const STARTER_PAGES = GARDEN_ONBOARDING_PAGES.map(page => ({
  documentId: page.documentId,
  title: page.title,
  tiptapJson: gardenOnboardingDocument(page),
}))

/** Hashes of recursively key-sorted {documentId,title,tiptapJson}; not prose. */
export const STARTER_PAGE_HASHES: Readonly<Record<string, string>> = {
  "garden-tour-20260906-start": "fc3041b8fb66fe466e5736fdb4db6c37e2c6f3cc8f38e471e7014ab74930f374",
  "garden-tour-20260906-notes": "31ef97a2cc619697c912d537f3708f7ebc01f1f08fd6dc24a3257178ac88b337",
  "garden-tour-20260906-finding": "d5d9366e37089ad16dfb50b089131726dc15ac2ee03ed2fbafa073bf318aaf47",
  "garden-tour-20260906-return": "88e4c6baef1af5d04dcd9002d8c724d3ab1c078627fb5a50d28ad77641288c76",
  "garden-tour-20260906-search": "4a1f738a6a696777299e5fde52f44e06661472afb00aa42211479d133d884a29",
  "garden-tour-20260906-sources": "625a1c2fec981aedc79e54bb41366028a2ac771eb1bd86d0ad535dbad0f226d5",
  "garden-tour-20260906-wires": "20e6ed4a449b94e54e96ab5c717483e5f639e56a4d4f5bedf7d25079f5b800c7",
  "garden-tour-20260906-sharing": "dbe99c94153c6d24d3ad30ff8a8628550441fdc920fdcf04ff61862b035aaff7",
  "garden-tour-20260906-agents": "207d79621da0429357346fa64ff2f469b583f6a164af2415cc8cd37450503b35"
}

export function starterManifestBytes(): string {
  return JSON.stringify({ schema: 'sophia.garden-starter-manifest.v1', edition: STARTER_EDITION, pages: STARTER_PAGES })
}

/** Narrow JSON identity: no stripping attrs/marks, flattening text or sorting arrays. */
export function starterCanonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(starterCanonicalJson).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${starterCanonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  throw new Error('Starter content is not complete JSON')
}

export async function starterSha256(value: string): Promise<string> {
  const digest = await sha256Digest(new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
