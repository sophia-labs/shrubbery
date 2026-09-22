/**
 * emit-layout.mts — serialize the FEED_LAB WorkspaceConfig into the fossil-v1
 * N-Triples document the app boots from (src/layout/feed-lab.ux.nt).
 *
 * Run with `pnpm --dir apps/atelier-feed-lab emit:layout` after editing
 * src/layout/feed-lab-config.ts. Deterministic: the capturedAt is the
 * authoring timestamp of the layout revision, bumped by hand when the shape
 * changes, so a re-run with an unchanged config is byte-identical.
 */

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  serializeConfigToTriples,
  triplesToNT,
  uxConfigGraphIri,
} from '@shrubbery/nucleus'
import { FEED_LAB, FEED_LAB_GRAPH_ID } from '../src/layout/feed-lab-config.ts'

// The layout revision's authoring instant (NOT the emit run's wall clock).
const CAPTURED_AT = Date.UTC(2026, 6, 31, 12, 0, 0)

const graphIri = uxConfigGraphIri(FEED_LAB_GRAPH_ID)
const header = [
  '# shrubbery fossil v1',
  `# graphIri: ${graphIri}`,
  `# capturedAt: ${CAPTURED_AT} (${new Date(CAPTURED_AT).toISOString()})`,
  '# source: apps/atelier-feed-lab scripts/emit-layout.mts (authored config, no cell)',
  '',
].join('\n')

const nt = triplesToNT(serializeConfigToTriples(FEED_LAB))
const out = join(dirname(fileURLToPath(import.meta.url)), '../src/layout/feed-lab.ux.nt')
writeFileSync(out, header + nt)
console.log(`wrote ${out} (${nt.split('\n').filter(Boolean).length} triples, graph <${graphIri}>)`)
