/**
 * emporium.ts — the conneg layer's view of the EMPORIUM vocab CATALOGUE.
 *
 * EMPORIUM is the KG-layer catalogue of vocabulary packs — "the pack IS the
 * catalog". A gardend cell serves it live (GET /emporium/vocabs +
 * /emporium/vocab/{name}/{version}); the SHELL reads it live (apps/organism
 * EmporiumClient + its integration test). Here, the conneg dev server + static
 * builder run in plain node with NO live cell, so they render from a VERBATIM
 * CAPTURE of the real cell output (./emporium-snapshot/*.json — see that dir's
 * README; the live read itself is the organism integration test, NOT a snapshot).
 *
 * This module maps the captured-real registry JSON into the pure @shrubbery/render
 * VocabResource / VocabPackResource shapes, so the conneg server can serve the
 * vocab catalogue's four faces exactly like it serves the component catalog.
 *
 * App/tooling level — the pure render package never reads files or the network.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  VocabPack,
  VocabResource,
  VocabPackResource,
  VocabSummary,
} from '@shrubbery/render'
// The DEEP golden-contract parse (enums, class→class relationships, minting,
// stats) lives ONCE in the shell-side read-model. The conneg server reuses it
// verbatim — the same single-source discipline the snapshot script already uses
// (it imports spawnGardend from the organism). This keeps the curl faces and the
// live shell read of the SAME contract producing the IDENTICAL VocabPack shape;
// there is no second, shallower parser to drift.
import { mapPack } from '../../organism/src/cell/emporium-client.js'

const SNAP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'emporium-snapshot')

interface VocabSummaryRaw {
  name: string
  version: string
  namespace: string
  sha: string
  title: string
}

/** Read the captured-real /emporium/vocabs rows. */
export function snapshotVocabSummaries(): VocabSummary[] {
  const raw = JSON.parse(readFileSync(resolve(SNAP_DIR, 'vocabs.json'), 'utf8')) as {
    vocabularies?: VocabSummaryRaw[]
  }
  return (raw.vocabularies ?? []).map((r) => ({
    name: r.name,
    version: r.version,
    namespace: r.namespace,
    sha: r.sha,
    title: r.title,
  }))
}

/** Read one captured-real golden contract pack (by name@version snapshot file). */
export function snapshotVocabPack(name: string): VocabPack | null {
  const summary = snapshotVocabSummaries().find((v) => v.name === name)
  if (!summary) return null
  const file = resolve(SNAP_DIR, `vocab.${name}.${summary.version}.json`)
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
  // Reuse the shell-side DEEP parse so the curl faces carry the FULL anatomy.
  return mapPack(name, raw as Parameters<typeof mapPack>[1], summary)
}

/** The Emporium vocab CATALOGUE collection resource (from the captured registry). */
export function vocabCatalogResource(): VocabResource {
  return {
    kind: 'vocab-catalog',
    id: 'emporium',
    title: 'Emporium — vocabulary catalogue',
    summary:
      'The KG-layer catalogue of vocabulary packs a gardend cell serves at /emporium. The pack IS the catalog. Read live by the shell (apps/organism); rendered here from a verbatim capture of the real cell output.',
    vocabs: snapshotVocabSummaries(),
  }
}

/** One vocab-pack item resource (the `…/emporium/{name}` golden-contract face). */
export function vocabPackResource(name: string): VocabPackResource | null {
  const pack = snapshotVocabPack(name)
  return pack ? { kind: 'vocab-pack', pack } : null
}
