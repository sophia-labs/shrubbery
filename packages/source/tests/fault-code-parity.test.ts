/**
 * fault-code-parity.test.ts — THREE-way cross-repo fault-taxonomy parity
 * (master spec §2.2, §3 Slice 3, §8.2 gate G-R5; WS4
 * `04-garden-gateway-contract.md` §6.4).
 *
 * `SOURCE_FAULT_CODES` (this package) must spell the SAME codes as
 * `garden/src-tauri/src/app_error_codes.rs::ALL` and
 * `platform-next/gateway/src/fault_codes.rs::ALL`, read FROM DISK (the
 * `stance-register-parity.test.ts` / `fragment-face-set-closure.test.ts`
 * precedent) — this is a spelling-equality requirement across three
 * independent processes that can never import one another (two are separate
 * Rust binaries; one is this TS package), not a mock of either.
 *
 * SKIP-IF-ABSENT: a Shrubbery-only checkout (no sibling Garden/platform-next
 * worktree) stays green. Two candidate locations per side are tried, mirroring
 * the established `packages/source/src/node/spawn-gardend.ts` convention: the
 * standard sibling-repo checkout layout first, then Vera's local `~/dev/sophia`
 * tree. The first existing candidate wins; if neither exists, this file's
 * suite is skipped with a named reason, never silently "passes" by asserting
 * nothing.
 *
 * REAL BUG FOUND AND FIXED WHILE BUILDING THIS FILE (not a hypothetical): an
 * earlier draft used `describe.skipIf(cond)('...', () => { const gardenAll =
 * readRustAllArray(gardenPath!) ... })`. Vitest still EXECUTES a
 * `describe(...)` callback body to register its `it()`s even when the block
 * is marked skip — only the individual test bodies are skipped, not the
 * describe-level setup — so `readRustAllArray(null!)` threw and crashed the
 * whole file. Caught for real: the Garden worktree's `app_error_codes.rs`
 * (present when this test was first written and passing) was REMOVED from
 * disk mid-session by the concurrent out-of-band Slice-0 rebuild in the SAME
 * worktree this file reads — proving the skip-if-absent requirement is not
 * theoretical. Fixed by branching on a plain `if` BEFORE any `describe(...)`
 * call exists at all, so the absent-file path never reaches
 * `readRustAllArray`.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SOURCE_FAULT_CODES } from '../src/mirror/source-fault.js'

const HERE = dirname(fileURLToPath(import.meta.url))

const GARDEN_APP_ERROR_CODES_CANDIDATES: readonly string[] = [
  // Sibling-repo checkout: shrubbery/packages/source/tests/ → ../../../garden/...
  resolve(HERE, '../../../garden/src-tauri/src/app_error_codes.rs'),
  '/Users/vera/dev/sophia/garden/src-tauri/src/app_error_codes.rs',
]

const GATEWAY_FAULT_CODES_CANDIDATES: readonly string[] = [
  resolve(HERE, '../../../platform-next/gateway/src/fault_codes.rs'),
  '/Users/vera/dev/sophia/platform-next/gateway/src/fault_codes.rs',
]

function findExisting(candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Reads a Rust `pub(crate) const ALL: &[&str] = &[ ... ];` array, resolved to
 * its actual string values, in source order. Pure text extraction (no rustc,
 * same spirit as `stance-register-parity.test.ts`'s CSS selector read — this
 * file has no Rust toolchain dependency).
 *
 * `ALL` lists bare CONST IDENTIFIERS (`STALE_GRAPH_INCARNATION`, …), not
 * inline string literals — each is declared elsewhere in the same file as
 * `pub(crate) const NAME: &str = "value";`. Two passes: build the
 * identifier→value map from every such declaration, then resolve the `ALL`
 * array's identifier list through it, in order, failing loudly (not
 * silently returning `[]`) if any identifier is unresolved.
 */
function readRustAllArray(path: string): readonly string[] {
  const source = readFileSync(path, 'utf8')
  const values = new Map<string, string>()
  for (const match of source.matchAll(/const\s+([A-Z][A-Z0-9_]*)\s*:\s*&str\s*=\s*"([^"]*)"/g)) {
    values.set(match[1], match[2])
  }
  const arrayMatch = /\bALL\s*:\s*&\[&str\]\s*=\s*&\[([\s\S]*?)\];/.exec(source)
  if (!arrayMatch) {
    throw new Error(`fault-code-parity: no \`ALL: &[&str] = &[...]\` array found in ${path}`)
  }
  const identifiers = [...arrayMatch[1].matchAll(/([A-Z][A-Z0-9_]*)/g)].map(m => m[1])
  return identifiers.map((name) => {
    const value = values.get(name)
    if (value === undefined) {
      throw new Error(`fault-code-parity: ${path}'s ALL array names undeclared const ${name}`)
    }
    return value
  })
}

/** Codes the gateway originates that Garden never does. */
const GATEWAY_ONLY = ['quota_exceeded', 'rate_limited', 'at_capacity'] as const
/** Spellings the gateway ORIGINATES that Garden also originates. Parity is
 *  spelling equality, not disjointness — a code that means the same fact
 *  must be the same string whichever process emitted it. */
const SHARED_WITH_GARDEN = [
  'graph_exists',
  'graph_lifecycle_identity_mismatch',
  'graph_incarnation_unconfirmable',
  'stale_graph_incarnation',
] as const

const gardenPath = findExisting(GARDEN_APP_ERROR_CODES_CANDIDATES)
const gatewayPath = findExisting(GATEWAY_FAULT_CODES_CANDIDATES)

if (gardenPath !== null && gatewayPath !== null) {
  // Re-check immediately before reading, not just at module load: this
  // module-scope `if` runs once at collection time, but the two files live
  // in worktrees under ACTIVE concurrent WIP (the out-of-band Slice-0
  // rebuild) and can be renamed/removed between collection and the moment
  // Vitest actually invokes this describe's tests. `readRustAllArrayOrSkip`
  // re-verifies existence right at read time and degrades to a named skip
  // rather than a crash if the file vanished in that window.
  describe('fault-code-parity — Garden × gateway × client (master §2.2, gate G-R5)', () => {
    const stillPresent = existsSync(gardenPath) && existsSync(gatewayPath)

    it.skipIf(!stillPresent)('Garden originates exactly 14 codes, all snake_case', () => {
      const gardenAll = readRustAllArray(gardenPath)
      expect(gardenAll).toHaveLength(14)
      for (const code of gardenAll) expect(code).toMatch(/^[a-z][a-z0-9_]*$/)
      expect(new Set(gardenAll).size).toBe(gardenAll.length) // no duplicates
    })

    it.skipIf(!stillPresent)(
      'the gateway originates exactly 7 codes: the 3 gateway-only plus the 4 shared with Garden',
      () => {
        const gatewayAll = readRustAllArray(gatewayPath)
        expect(gatewayAll).toHaveLength(7)
        expect(new Set(gatewayAll)).toEqual(new Set([...GATEWAY_ONLY, ...SHARED_WITH_GARDEN]))
      },
    )

    it.skipIf(!stillPresent)('every SHARED_WITH_GARDEN code is spelled identically in both Rust crates', () => {
      const gardenAll = readRustAllArray(gardenPath)
      for (const code of SHARED_WITH_GARDEN) expect(gardenAll).toContain(code)
    })

    it.skipIf(!stillPresent)(
      'the client union is exactly Garden ∪ the 3 gateway-only codes — 17 total, each shared spelling counted once',
      () => {
        const gardenAll = readRustAllArray(gardenPath)
        expect(new Set(gardenAll)).toEqual(
          new Set(SOURCE_FAULT_CODES.filter(code => !(GATEWAY_ONLY as readonly string[]).includes(code))),
        )
        expect(SOURCE_FAULT_CODES).toHaveLength(17)
        expect(new Set(SOURCE_FAULT_CODES)).toEqual(new Set([...gardenAll, ...GATEWAY_ONLY]))
      },
    )
  })
} else {
  describe('fault-code-parity — skipped', () => {
    it.skip(
      `no sibling Garden/platform-next checkout found (tried: ${[
        ...GARDEN_APP_ERROR_CODES_CANDIDATES,
        ...GATEWAY_FAULT_CODES_CANDIDATES,
      ].join(', ')})`,
      () => {},
    )
  })
}
