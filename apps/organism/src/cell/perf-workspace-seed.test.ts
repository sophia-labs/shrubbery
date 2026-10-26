/**
 * perf-workspace-seed.test.ts — the seed that makes a graph named `perf` open to the bench dashboard parses through
 * the production read path, declares the fragment marker with its own surface, and its ux:layoutJson validates
 * against the SAME closed fragment face catalogue the shell loads with (bench.dashboard is a member).
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseNT, parseTriplesToConfig, validateConfig, type WorkspaceConfig } from '@shrubbery/nucleus'
import { createValidatedLayoutDocument, type LayoutDocument } from '@shrubbery/nucleus/layout'
import { createFragmentFaceRegistry } from '@shrubbery/runtime/layout'
import { fragmentRegionsOf } from './workspace-fragments.js'

const nt = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../seeds/perf-workspace.ux.nt'), 'utf8')
const SURFACE = 'urn:sophia:ux:surface:perf-lens'

function config(): WorkspaceConfig {
  return parseTriplesToConfig(parseNT(nt))
}

describe('perf workspace seed', () => {
  it('parses and passes the commit-gate validator', () => {
    expect(config().id).toBe('PerfDefault')
    expect(validateConfig(config())).toEqual({ ok: true })
  })

  it('declares the fragment marker on region-center with the perf-lens surface', () => {
    expect(fragmentRegionsOf(config())).toEqual([{ regionId: 'region-center', surfaceIri: SURFACE }])
  })

  it('carries exactly one ux:layoutJson on that surface, valid against the fragment face catalogue', () => {
    const triples = parseNT(nt).filter((t) => t.s === SURFACE && t.p === 'http://mnemosyne.dev/ux#layoutJson')
    expect(triples).toHaveLength(1)
    const object = triples[0]!.o as { value: string }
    const doc = JSON.parse(object.value) as LayoutDocument
    const registry = createFragmentFaceRegistry()
    const verdict = createValidatedLayoutDocument(doc, {
      isFaceRegistered: registry.toFaceRegistrationPredicate(),
      isFaceGridEligible: registry.toFaceGridEligibilityPredicate(),
    })
    expect(verdict.ok).toBe(true)
    const leaf = doc.nodes[doc.rootNodeId]!
    expect(leaf.kind === 'leaf' && leaf.descriptor.faceId).toBe('bench.dashboard')
  })
})
