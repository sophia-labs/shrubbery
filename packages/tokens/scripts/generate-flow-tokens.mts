/**
 * Regenerate css/flow-tokens.css from Mithras Flow's vendored stylesheet.
 *
 *   node packages/tokens/scripts/generate-flow-tokens.mts [--check]
 *
 * --check exits 1 (without writing) when the committed file is stale.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { flowTokenSource, renderFlowTokensCss } from '../src/flow-tokens.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../..')
const { stylesCss, provenance } = flowTokenSource(
  (path) => readFileSync(resolve(repo, path), 'utf8'),
  (text) => createHash('sha256').update(text).digest('hex'),
)
const target = resolve(here, '../css/flow-tokens.css')
const next = renderFlowTokensCss(stylesCss, provenance)
let current = ''
try { current = readFileSync(target, 'utf8') } catch { /* first generation */ }
if (process.argv.includes('--check')) {
  if (current !== next) {
    console.error('css/flow-tokens.css is stale — regenerate it')
    process.exit(1)
  }
  console.log('css/flow-tokens.css is current')
} else {
  writeFileSync(target, next)
  console.log(`wrote ${target} (${provenance.sourcePath} @ ${provenance.forkCommit}, sha256 ${provenance.sha256.slice(0, 16)}…)`)
}
