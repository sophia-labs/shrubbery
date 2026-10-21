/**
 * Write the fixture's `:ux:config` graph (fixture/ux-config.nt) from the app's
 * built-in layouts, so the fixture exercises the graph-layout path and the two
 * never drift (tests/layout.test.ts compares them byte for byte).
 *
 *   pnpm --filter @shrubbery/ovillo fixture:ux            # write it
 *   pnpm --filter @shrubbery/ovillo fixture:ux -- --stdout  # print it (for the graph builder)
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultOvilloLayouts, layoutNTriples } from '../src/layout.js'
import { FIXTURE_DIR } from '../src/shell/site-middleware.js'

const nt = layoutNTriples(defaultOvilloLayouts())
if (process.argv.includes('--stdout')) process.stdout.write(nt)
else {
  const path = join(FIXTURE_DIR, 'ux-config.nt')
  writeFileSync(path, nt)
  console.log(`${nt.trim().split('\n').length} triples -> ${path}`)
}
