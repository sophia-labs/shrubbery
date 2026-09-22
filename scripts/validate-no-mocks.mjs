#!/usr/bin/env node
// no-mocks ratchet — freezes the KNOWN app-layer violations of the README's
// "No mocks" testing principle and stops NEW ones from landing.
//
// Why a ratchet instead of a hard ban: the library core (packages/*) is already
// mock-free by design, but a handful of app-layer + editor-service tests still
// reach for vi.mock/vi.stubGlobal/vi.fn to stand in for a contract they should
// be driving for real. Eliminating that debt is a separate, larger effort. This
// guard's job is narrower and non-negotiable: the debt may only ever shrink.
// Any *.test.ts under packages/ or apps/ that uses one of the banned primitives
// and is NOT already on the frozen allowlist below fails CI.
//
// To pay down debt: delete the file's entry from ALLOWLIST once its mocks are
// gone. The guard also FAILS if an allowlisted file has been cleaned up but its
// entry was left behind (stale allowlist) — so the frozen set can only tighten,
// never rot. Regenerate the baseline intentionally with `--update` if you ever
// need to (e.g. a legitimate file rename), and explain why in the commit.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, sep } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const SCAN_DIRS = ['packages', 'apps']

// The banned primitives, as literal source substrings. Matching text, not AST,
// is deliberate: it is the same thing a reviewer greps for, and it cannot be
// defeated by a clever import alias without also making the intent obvious.
//
// vi.spyOn / vi.stubEnv / vi.mocked stand in for real collaborators just as much
// as vi.mock / vi.stubGlobal / vi.fn do — a spy that stubs a method's return, an
// env stub, or a typed mock wrapper is still standing between the test and the
// real ShrubberyContract. Banning only the first three left a spy-shaped hole
// the ratchet couldn't see; all six are the mocking surface the README forbids.
const BANNED = ['vi.mock(', 'vi.stubGlobal(', 'vi.fn(', 'vi.spyOn(', 'vi.stubEnv(', 'vi.mocked(']

// Frozen baseline — every *.test.ts that CURRENTLY trips a banned primitive.
// Paths are POSIX-relative to the repo root. This list may only shrink.
const ALLOWLIST = [
  'apps/koch/tests/faces.test.ts',
  'apps/organism/src/cell/__tests__/access-grant-controller.test.ts',
  'apps/organism/src/cell/__tests__/app-routes.test.ts',
  'apps/organism/src/cell/__tests__/choreograph-studio-service.test.ts',
  'apps/organism/src/cell/__tests__/choreograph-workspace-feature.test.ts',
  'apps/organism/src/cell/__tests__/chrome-controller.test.ts',
  'apps/organism/src/cell/__tests__/cognito-auth-session.test.ts',
  'apps/organism/src/cell/__tests__/document-activation.test.ts',
  'apps/organism/src/cell/__tests__/document-transfer.test.ts',
  'apps/organism/src/cell/__tests__/excalidraw-cell-service.test.ts',
  'apps/organism/src/cell/__tests__/gardend-contract.test.ts',
  'apps/organism/src/cell/__tests__/gateway-crdt-backend.test.ts',
  'apps/organism/src/cell/__tests__/hosted-access-feature.test.ts',
  'apps/organism/src/cell/__tests__/hosted-gateway-contract.test.ts',
  'apps/organism/src/cell/__tests__/hosted-viewer-rest-client.test.ts',
  'apps/organism/src/cell/__tests__/image-generation-flow.test.ts',
  'apps/organism/src/cell/__tests__/local-ai-settings.test.ts',
  'apps/organism/src/cell/__tests__/loopback-crdt-backend.test.ts',
  'apps/organism/src/cell/__tests__/original-file-controller.test.ts',
  'apps/organism/src/cell/__tests__/settings-operations.test.ts',
  'apps/organism/src/cell/__tests__/settings-overlay-transition.test.ts',
  'apps/organism/src/cell/__tests__/shell-feature-host.test.ts',
  'apps/organism/src/cell/__tests__/shell-features.test.ts',
  'apps/organism/src/cell/__tests__/source-mirror-runtime-retry.test.ts',
  'apps/organism/src/cell/__tests__/tts-controller.test.ts',
  'apps/organism/src/cell/__tests__/wire-mode-lifecycle.test.ts',
  'apps/organism/src/cell/__tests__/zotero-source.test.ts',
  'apps/organism/src/harness/observatory-layout-source.test.ts',
  'packages/components/src/__tests__/icons-render-smoke.test.ts',
  'packages/components/src/__tests__/mn-daily-note-primitives.test.ts',
  'packages/components/src/__tests__/mn-mobile-shell-surfaces.test.ts',
  'packages/components/src/__tests__/mn-quick-clip.test.ts',
  'packages/components/src/__tests__/mn-wire-radial-overlay.test.ts',
  'packages/editor-kernel/src/__tests__/copyable-code-block.test.ts',
  'packages/hoja/src/__tests__/hoja-editor.test.ts',
  'packages/nucleus/src/__tests__/command-registry.test.ts',
  'packages/nucleus/src/__tests__/wire-mode-controller.test.ts',
  'packages/runtime/src/__tests__/sh-editor-host-collab-body.test.ts',
  'packages/runtime/src/editor-services/__tests__/mermaid-renderer.test.ts',
  'packages/runtime/src/editor-services/__tests__/query-block-service.test.ts',
  'packages/runtime/src/editor-services/__tests__/query-block-vega.test.ts',
  'packages/runtime/src/editor-services/__tests__/workspace-gateway-service.test.ts',
  'packages/runtime/src/excalidraw/__tests__/excalidraw-runtime.test.ts',
  'packages/runtime/src/wire-mode/__tests__/install-advanced-wire-menu-bridge.test.ts',
  'packages/runtime/src/wire-mode/__tests__/install-wire-mode-keymap.test.ts',
  'packages/runtime/src/wire-mode/__tests__/install-wire-mode-mousedown.test.ts',
  'packages/runtime/src/wire-mode/__tests__/install-wire-mode.test.ts',
]

/** Recursively collect *.test.ts paths (repo-relative, POSIX), skipping node_modules/dist. */
function collectTestFiles(dir, out) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      collectTestFiles(abs, out)
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      out.push(relative(ROOT, abs).split(sep).join('/'))
    }
  }
  return out
}

function offends(relPath) {
  const source = readFileSync(join(ROOT, relPath), 'utf8')
  return BANNED.some((needle) => source.includes(needle))
}

const files = SCAN_DIRS.flatMap((d) => collectTestFiles(join(ROOT, d), []))
const currentOffenders = files.filter(offends).sort()

if (process.argv.includes('--update')) {
  const body = currentOffenders.map((p) => `  '${p}',`).join('\n')
  const self = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  const rewritten = self.replace(
    /const ALLOWLIST = \[[\s\S]*?\n\]/,
    `const ALLOWLIST = [\n${body}\n]`,
  )
  writeFileSync(fileURLToPath(import.meta.url), rewritten)
  console.log(`[no-mocks] allowlist rewritten to ${currentOffenders.length} entries.`)
  process.exit(0)
}

const allowed = new Set(ALLOWLIST)
const newOffenders = currentOffenders.filter((p) => !allowed.has(p))
const stale = ALLOWLIST.filter((p) => !currentOffenders.includes(p))

let failed = false

if (newOffenders.length > 0) {
  failed = true
  console.error(
    `\n[no-mocks] ${newOffenders.length} NEW mock-using test file(s) — the "No mocks" principle is a ratchet, and it may only tighten:`,
  )
  for (const p of newOffenders) console.error(`  + ${p}`)
  console.error(
    '\nDrive the real ShrubberyContract (or a real gardend cell) instead of vi.mock/vi.stubGlobal/vi.fn/vi.spyOn/vi.stubEnv/vi.mocked.',
  )
}

if (stale.length > 0) {
  failed = true
  console.error(
    `\n[no-mocks] ${stale.length} allowlisted file(s) no longer use mocks (or were renamed/removed) — delete the stale entry so the ratchet stays tight:`,
  )
  for (const p of stale) console.error(`  - ${p}`)
}

console.log(
  `[no-mocks] ratchet: ${currentOffenders.length} known offenders (frozen at ${ALLOWLIST.length}), 0 new allowed.`,
)

if (failed) process.exit(1)
console.log('[no-mocks] PASS — no new mock debt.')
