/**
 * emit-reference-web.mts — serialize the REFERENCE_WEB authoring config into
 * the fossil-v1 N-Triples document the app boots from
 * (src/catalog/reference-web.nt), prove the round trip, and derive the
 * server's JSON projection (src/catalog/reference-web.json).
 *
 * Run with `pnpm --dir apps/atelier-feed-lab emit:web` after editing
 * src/catalog/reference-web-config.ts. Deterministic: the capturedAt is the
 * authoring timestamp of the web revision, bumped by hand when the web
 * changes, so a re-run with an unchanged config is byte-identical.
 *
 * The JSON is derived FROM THE EMITTED FOSSIL (parse → decode → project), not
 * from the config literal — the fossil stays the single authority and the
 * projection cannot drift from it. The projection also precomputes the derived
 * views the server needs (role, pending, embeddedIn) so vite.config.ts stays
 * import-free and logic-light.
 */

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseNT, triplesToNT } from '@shrubbery/nucleus'
import {
  embeddedHostOf,
  isPendingEntity,
  parseTriplesToWeb,
  referenceWebGraphIri,
  roleForKind,
  serializeWebToTriples,
} from '../src/catalog/reference-web-codec.ts'
import { REFERENCE_WEB, REFERENCE_WEB_GRAPH_ID } from '../src/catalog/reference-web-config.ts'

// The web revision's authoring instant (NOT the emit run's wall clock).
// 2026-07-31 — the seven-kind ratification evening.
const CAPTURED_AT = Date.UTC(2026, 6, 31, 23, 30, 0)

const graphIri = referenceWebGraphIri(REFERENCE_WEB_GRAPH_ID)
const header = [
  '# shrubbery fossil v1',
  `# graphIri: ${graphIri}`,
  `# capturedAt: ${CAPTURED_AT} (${new Date(CAPTURED_AT).toISOString()})`,
  '# source: apps/atelier-feed-lab scripts/emit-reference-web.mts (authored config, no cell)',
  '',
].join('\n')

const nt = triplesToNT(serializeWebToTriples(REFERENCE_WEB))
const body = header + nt
const catalogDir = join(dirname(fileURLToPath(import.meta.url)), '../src/catalog')

// ── Round trip: the fossil must decode back to the authored web, exactly. ────
const decoded = parseTriplesToWeb(parseNT(body))
const canonical = (entities: typeof decoded): string =>
  JSON.stringify(
    [...entities].sort((a, b) => a.id.localeCompare(b.id)).map((entity) => ({
      ...entity,
      relations: [...entity.relations].sort(
        (a, b) => a.kind.localeCompare(b.kind) || a.target.localeCompare(b.target),
      ),
    })),
  )
if (canonical(decoded) !== canonical([...REFERENCE_WEB])) {
  throw new Error('emit-reference-web: the fossil did not round-trip to the authored web — refusing to write')
}

writeFileSync(join(catalogDir, 'reference-web.nt'), body)

// ── The server's projection, derived from the fossil itself. ─────────────────
const projection = {
  $generated:
    'scripts/emit-reference-web.mts — a projection of reference-web.nt (the fossil is the authority); do not edit by hand',
  graphIri,
  capturedAt: CAPTURED_AT,
  entities: decoded.map((entity) => ({
    id: entity.id,
    kind: entity.kind,
    role: roleForKind(entity.kind),
    name: entity.name,
    description: entity.description,
    pending: isPendingEntity(entity),
    ...(embeddedHostOf(entity) !== undefined ? { embeddedIn: embeddedHostOf(entity) } : {}),
    ...(entity.providerReference !== undefined ? { providerReference: entity.providerReference } : {}),
    compositionNotes: entity.compositionNotes,
    invariant: entity.invariant,
  })),
}
writeFileSync(join(catalogDir, 'reference-web.json'), `${JSON.stringify(projection, null, 2)}\n`)

console.log(
  `wrote reference-web.nt (${nt.split('\n').filter(Boolean).length} triples, graph <${graphIri}>) + reference-web.json (${projection.entities.length} entities, ${projection.entities.filter((entity) => entity.pending).length} pending) — round trip proven`,
)
