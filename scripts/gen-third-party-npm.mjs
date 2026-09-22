#!/usr/bin/env node
// gen-third-party-npm.mjs — regenerates THIRD-PARTY-NPM.md, the third-party
// license inventory for the pnpm workspace's PRODUCTION dependency closure
// (satisfies NOTICE.md's forward obligation to complete this review).
//
// Scope mirrors EXPORT-MANIFEST.md: every workspace member that ships in the
// public export, i.e. all of them EXCEPT @shrubbery/flow-app (apps/flow/ is
// permanently excluded — verbatim third-party vendor, no license grant).
// packages/atelier/fixtures/vrm/ is not an npm package and has no bearing on
// this closure.
//
// Method: `pnpm licenses list --json --prod --filter '!@shrubbery/flow-app'`
// — pnpm's own license checker, not a hand-rolled pnpm-lock.yaml walk. Tried
// first per the work item's own instruction, and it works: it resolves
// entirely from the lockfile + the local pnpm content-addressable store, no
// `pnpm install` / node_modules required first. `--prod` restricts to
// "dependencies" + "optionalDependencies" (excludes devDependencies — the
// tooling that builds and tests Shrubbery, not what ships in it). The
// `--filter '!@shrubbery/flow-app'` exclusion was verified directly: diffing
// the filtered and unfiltered listings shows it removes exactly
// apps/flow's own unique production dependencies (@xyflow/react,
// @duckdb/duckdb-wasm, frappe-gantt, idb-keyval, and their own transitive
// closures) and adds nothing.
//
// Regenerate whenever pnpm-lock.yaml changes: `node scripts/gen-third-party-npm.mjs`
// (writes THIRD-PARTY-NPM.md at the repo root). Requires pnpm 9.x (the
// version pinned in package.json#packageManager) on PATH.

import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const OUT_FILE = join(ROOT, 'THIRD-PARTY-NPM.md')

const FLOW_FILTER = '!@shrubbery/flow-app'

function runPnpmLicenses() {
  const raw = execFileSync(
    'pnpm',
    ['licenses', 'list', '--json', '--prod', '--filter', FLOW_FILTER],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  return JSON.parse(raw)
}

// pnpm groups by license string -> [{ name, versions, license, homepage, ... }].
// Flatten to one row per (name, version) — a handful of packages carry more
// than one resolved version in the closure and each is a real, separate
// dependency-tree entry a license reviewer needs to see.
function flattenRows(grouped) {
  const rows = []
  for (const [license, entries] of Object.entries(grouped)) {
    for (const entry of entries) {
      for (const version of entry.versions) {
        rows.push({
          name: entry.name,
          version,
          license,
          homepage: entry.homepage ?? null,
        })
      }
    }
  }
  rows.sort((a, b) => (a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name)))
  return rows
}

// Known upstream repo URLs for the handful of packages whose own npm
// metadata carries no `homepage`/`repository` field at all (verified by hand
// against `npm view <pkg>@<version>` — this is a real gap in their published
// package.json, not a pnpm/tooling artifact). Filled in so the "Source"
// column is never silently blank for these; flagged below regardless, since
// the gap is in their own upstream metadata and future versions could differ.
const KNOWN_REPO_FALLBACKS = {
  'prosemirror-changeset': 'https://github.com/prosemirror/prosemirror-changeset',
  'prosemirror-model': 'https://github.com/prosemirror/prosemirror-model',
  'prosemirror-view': 'https://github.com/prosemirror/prosemirror-view',
}

function resolvedSource(row) {
  if (row.homepage) return row.homepage
  if (KNOWN_REPO_FALLBACKS[row.name]) return KNOWN_REPO_FALLBACKS[row.name]
  return `https://www.npmjs.com/package/${row.name}/v/${row.version}`
}

function isConjunctive(license) {
  // "(X AND Y)" — compliance with BOTH licenses is required, not a choice
  // between them (unlike "X OR Y", which is a normal, unremarkable dual
  // license). Worth a maintainer's eyes; not necessarily a problem.
  return /\bAND\b/.test(license)
}

function isUnknown(license) {
  return !license || license === 'Unknown'
}

function buildFlaggedSection(rows) {
  const flagged = []
  for (const row of rows) {
    const reasons = []
    if (isUnknown(row.license)) reasons.push('no license field in published package.json (pnpm reports "Unknown")')
    if (isConjunctive(row.license)) reasons.push(`conjunctive license expression ("${row.license}") — compliance with BOTH terms required, not a choice`)
    if (!row.homepage) reasons.push(`no homepage/repository field in published package.json — source column falls back to ${KNOWN_REPO_FALLBACKS[row.name] ? 'a manually verified upstream repo URL' : 'the npm package page'}`)
    if (reasons.length > 0) flagged.push({ ...row, reasons })
  }
  return flagged
}

function mdEscape(s) {
  return String(s).replace(/\|/g, '\\|')
}

function buildMarkdown(rows, flagged, packageCount) {
  const lines = []
  lines.push('# Third-Party npm Dependencies — Production Closure')
  lines.push('')
  lines.push(
    'This inventory covers the **production dependency closure of the pnpm workspace members that ship in the public export** — every `apps/*` and `packages/*` member except `@shrubbery/flow-app` (`apps/flow/` is permanently excluded from the export; see `EXPORT-MANIFEST.md`). It does **not** cover devDependencies (the tooling that builds and tests Shrubbery, never shipped) or `packages/atelier/fixtures/vrm/` (binary test fixtures, not an npm package). Satisfies the forward obligation in `NOTICE.md` to complete this review before a first tagged release.',
  )
  lines.push('')
  lines.push(
    `Generated an inventory of ${packageCount} unique third-party npm packages (${rows.length} package/version rows — a handful of packages resolve to more than one version across the closure) from \`pnpm licenses list --json --prod --filter '!@shrubbery/flow-app'\` via \`scripts/gen-third-party-npm.mjs\` — pnpm's own license checker, resolved from \`pnpm-lock.yaml\` and the local pnpm content-addressable store (no prior \`pnpm install\` required). Regenerate whenever \`pnpm-lock.yaml\` changes: \`node scripts/gen-third-party-npm.mjs\`.`,
  )
  lines.push('')

  if (flagged.length > 0) {
    lines.push('## Flagged — missing or unusual license metadata')
    lines.push('')
    lines.push(
      `${flagged.length} package/version ${flagged.length === 1 ? 'entry' : 'entries'} out of ${rows.length} need a maintainer's eyes before relying on the table below for compliance:`,
    )
    lines.push('')
    for (const f of flagged) {
      lines.push(`- **\`${f.name}\`** \`${f.version}\` (reported license: \`${f.license || '(none)'}\`)`)
      for (const reason of f.reasons) lines.push(`  - ${reason}`)
    }
    lines.push('')
  }

  lines.push('| Package | Version | License | Source |')
  lines.push('|---|---|---|---|')
  for (const row of rows) {
    lines.push(`| \`${mdEscape(row.name)}\` | ${mdEscape(row.version)} | ${mdEscape(row.license || 'Unknown')} | ${mdEscape(resolvedSource(row))} |`)
  }
  lines.push('')
  return lines.join('\n')
}

function main() {
  const grouped = runPnpmLicenses()
  const rows = flattenRows(grouped)
  const uniquePackageNames = new Set(rows.map((r) => r.name))
  const flagged = buildFlaggedSection(rows)
  const markdown = buildMarkdown(rows, flagged, uniquePackageNames.size)
  writeFileSync(OUT_FILE, markdown, 'utf8')
  console.log(`Wrote ${OUT_FILE}: ${uniquePackageNames.size} packages, ${rows.length} package/version rows, ${flagged.length} flagged.`)
}

main()
