/**
 * vrm-fixtures.ts — shared existence guard for the two real VRM binaries in
 * fixtures/vrm/ (seed-san.vrm, avatar-sample-a.vrm).
 *
 * These fixtures are deliberately excluded from Shrubbery's public export
 * (see EXPORT-MANIFEST.md at the repo root and fixtures/vrm/PROVENANCE.md):
 * they're real third-party VRM avatar binaries whose own PROVENANCE.md says
 * "Neither file is redistributed as part of any Sophia product build." A
 * tree built from the export manifest omits packages/atelier/fixtures/vrm/
 * entirely.
 *
 * The three fixture-dependent suites (glb-inspect, ingest-base,
 * ingest-garment) call loadFixture() inside each `describe()` body — i.e.
 * at test-collection time, before any `it()` runs — so a missing file
 * would crash collection for the whole file, not just fail one assertion.
 * Each of those files wraps its describes in a plain `if (hasVrmFixtures)
 * { ... } else { ... }` (NOT `describe.skipIf`, which still invokes the
 * factory during collection and would still crash) so the suite is
 * green-or-skipped, never red, when the fixtures are absent.
 *
 * NO MOCKS: this is an existence guard, not a stand-in for the fixtures.
 * When the files are present (the ordinary case, in Sophia's own tree),
 * every test here still reads and dissects the real binaries exactly as
 * before this guard existed.
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Built via node:path.join from this file's own dirname rather than a literal
// `new URL('../relative/path', import.meta.url)` — Vite/Vitest statically
// rewrites that exact literal-string-plus-import.meta.url shape as an asset
// URL import (its bundled-static-asset convention), which does not resolve
// to a plain file:// URL for a path outside the package and throws "The URL
// must be of scheme file" at collection time. Routing through a runtime
// join() sidesteps that transform entirely, matching how the sibling
// loadFixture() helpers in the *.test.ts files already take their relative
// path as a runtime parameter rather than an inline literal.
const HERE = dirname(fileURLToPath(import.meta.url))
const SEED_SAN = join(HERE, '../../../fixtures/vrm/seed-san.vrm')
const AVATAR_SAMPLE_A = join(HERE, '../../../fixtures/vrm/avatar-sample-a.vrm')

/** True only when both VRM fixtures are present on disk. */
export const hasVrmFixtures: boolean = existsSync(SEED_SAN) && existsSync(AVATAR_SAMPLE_A)

export const VRM_FIXTURES_SKIP_MESSAGE =
  'SKIPPED (fixtures/vrm/*.vrm not found — excluded from Shrubbery\'s public export; ' +
  'see EXPORT-MANIFEST.md and packages/atelier/fixtures/vrm/PROVENANCE.md for sources)'

if (!hasVrmFixtures) {
  // Printed once at collection time regardless of the test reporter's verbosity,
  // so the skip reason is visible in plain `vitest run` output, not just in a
  // per-test name a summary reporter might collapse.
  // eslint-disable-next-line no-console
  console.warn(`[@shrubbery/atelier-vtuber] ${VRM_FIXTURES_SKIP_MESSAGE}`)
}
