#!/usr/bin/env node
// vitest-if-present.mjs — run `vitest <args>` in the current workspace package, if the package uses vitest.
//
// `pnpm -r exec vitest ...` fails in every package that has no vitest dependency ("Command vitest not found"), which
// made `pnpm test:source` red for a package with no tests at all. A package with no vitest and no test files is
// skipped with a note; a package with test files and no vitest is still an error.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const cwd = process.cwd()
const bin = join(cwd, 'node_modules', '.bin', 'vitest')

function hasTestFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (hasTestFiles(path)) return true
    } else if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) {
      return true
    }
  }
  return false
}

if (existsSync(bin)) {
  const result = spawnSync(bin, process.argv.slice(2), { stdio: 'inherit' })
  process.exit(result.status ?? 1)
}
if (hasTestFiles(cwd)) {
  console.error(`${cwd}: has test files but no vitest dependency`)
  process.exit(1)
}
console.log(`${cwd}: no tests, skipped`)
