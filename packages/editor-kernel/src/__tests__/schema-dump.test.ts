/**
 * The committed schema dump (`schema/editor-kernel.schema.json`) is the kernel as it is: gardend's block-contract
 * parity test reads a copy of it. Stale = fail; `EDITOR_SCHEMA_WRITE=1` regenerates it.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { editorSchemaDump, editorSchemaDumpText } from '../schema-dump'

const DUMP = join(dirname(fileURLToPath(import.meta.url)), '../../schema/editor-kernel.schema.json')

describe('the editor schema dump gardend reads', () => {
  it('is current', () => {
    const text = editorSchemaDumpText()
    if (process.env.EDITOR_SCHEMA_WRITE) writeFileSync(DUMP, text)
    expect(readFileSync(DUMP, 'utf8'), 'schema/editor-kernel.schema.json is stale: regenerate with EDITOR_SCHEMA_WRITE=1').toBe(text)
  })

  it('carries objectEmbed exactly as the §4 embed contract names it: a block atom with the six attrs', () => {
    const node = (editorSchemaDump().nodes as { name: string; group: string; atom: boolean; inline: boolean; content: string | null; attrs: Record<string, unknown> }[])
      .find((n) => n.name === 'objectEmbed')
    expect(node).toMatchObject({ group: 'block', atom: true, inline: false, content: null })
    expect(Object.keys(node!.attrs).sort()).toEqual(['classLabel', 'data-block-id', 'graphId', 'iri', 'label', 'slot'])
  })
})
