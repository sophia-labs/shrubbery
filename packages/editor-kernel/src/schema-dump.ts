/**
 * The editor kernel's document schema as gardend's block-contract parity test reads it
 * (`src-tauri/tests/fixtures/block_contract/editor-kernel-*.schema.json`, checked by
 * `contract_matches_the_editor_kernel_document_schema`): every node and mark of `kernelExtensions({collaborative:
 * true})` — the roster the live, collaborative editor mounts — with its group, content expression, marks, inline and
 * atom flags, and its attribute names with their defaults.
 *
 * The committed copy is `packages/editor-kernel/schema/editor-kernel.schema.json`; `schema-dump.test.ts` fails when it
 * is stale (regenerate with `EDITOR_SCHEMA_WRITE=1 pnpm --filter @shrubbery/editor-kernel exec vitest run
 * schema-dump`). gardend copies it into its fixtures when it takes a new node out of `AWAITING_EDITOR`.
 */

import { getSchema } from '@tiptap/core'
import { kernelExtensions } from './index'

interface AttrDump {
  readonly default: unknown
  readonly required: boolean
}

function attrsOf(spec: Record<string, { default?: unknown }> | undefined): Record<string, AttrDump> {
  const out: Record<string, AttrDump> = {}
  for (const name of Object.keys(spec ?? {}).sort()) {
    const attr = spec![name]!
    const required = !Object.hasOwn(attr, 'default')
    out[name] = { default: required ? null : (attr.default ?? null), required }
  }
  return out
}

export function editorSchemaDump(source = 'Shrubbery packages/editor-kernel (sophia-labs/shrubbery) kernelExtensions({collaborative:true})') {
  const schema = getSchema(kernelExtensions({ collaborative: true }))
  const nodes: unknown[] = []
  schema.spec.nodes.forEach((name, spec) => {
    nodes.push({
      name,
      group: spec.group ?? null,
      content: spec.content ?? null,
      marks: spec.marks ?? null,
      inline: spec.inline === true,
      atom: spec.atom === true,
      attrs: attrsOf(spec.attrs as Record<string, { default?: unknown }> | undefined),
    })
  })
  const marks: unknown[] = []
  schema.spec.marks.forEach((name, spec) => {
    marks.push({
      name,
      excludes: spec.excludes ?? null,
      inclusive: spec.inclusive !== false,
      attrs: attrsOf(spec.attrs as Record<string, { default?: unknown }> | undefined),
    })
  })
  return { source, topNode: schema.spec.topNode ?? 'doc', nodes, marks }
}

/** The committed text: two-space JSON and a final newline. */
export function editorSchemaDumpText(): string {
  return `${JSON.stringify(editorSchemaDump(), null, 2)}\n`
}
