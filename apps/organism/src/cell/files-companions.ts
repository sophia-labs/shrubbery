/**
 * Companions: files and documents that belong to another file rather than sitting beside it. A reader's text of a PDF
 * (`ti-opa2134_DS.text.txt`, id `<pdf id>-text`) and a person's notes on a file (document `notes-<file id>`) are not peers of the PDF
 * in its folder (Vera, 2026-10-13: the Datasheets folder showed 40 items for 20 sheets). Files hides them from the place and the tree;
 * the file's page reaches them.
 *
 * Found from the tree alone, synchronously, by the rules the kinds declare (`CompanionRule`): an id that is the file's id with a suffix
 * or a prefix, or a name that is a sibling's stem with an ending. Nothing is hidden whose file is not there: a companion whose file was
 * trashed shows again, in plain sight.
 */
import type { FilePaneNode, FilePaneSection } from '@shrubbery/nucleus'
import { FILE_KINDS, type FileKind } from './files-kinds/index.js'
import { STANDARD_COMPANIONS, type CompanionRule } from './files-kinds/registry.js'

export interface Companion {
  /** The companion's tree key (`artifact:{id}`, `document:{id}`). */
  readonly key: string
  readonly id: string
  readonly label: string
  /** Its file's tree key and id. */
  readonly ownerKey: string
  readonly ownerId: string
  readonly role: string
  readonly roleLabel: string
}

/** Every companion rule: the standard ones (notes), then each kind's. */
export function companionRules(kinds: readonly FileKind[] = FILE_KINDS): CompanionRule[] {
  const out = [...STANDARD_COMPANIONS]
  for (const k of kinds) for (const r of k.page?.companions ?? []) if (!out.some(o => o.role === r.role && o.entry === r.entry)) out.push(r)
  return out
}

type Kindish = { readonly kind?: string; readonly id: string; readonly label: string; readonly children?: readonly FilePaneNode[] }

const keyOf = (n: Kindish) => `${n.kind === 'artifact' ? 'artifact' : n.kind === 'folder' ? 'folder' : 'document'}:${n.id}`

/** The companions in these sections, by their own key. */
export function findCompanions(sections: readonly FilePaneSection[], rules: readonly CompanionRule[] = companionRules()): Map<string, Companion> {
  const artifacts = new Map<string, Kindish>()
  const siblings: Kindish[][] = []
  const documents: Kindish[] = []
  const walk = (nodes: readonly Kindish[]) => {
    siblings.push([...nodes])
    for (const n of nodes) {
      if (n.kind === 'artifact') artifacts.set(n.id, n)
      else if (n.kind === 'document' || n.kind === undefined) documents.push(n)
      if (n.children?.length) walk(n.children)
    }
  }
  for (const s of sections) if (s.id === 'tree' || s.id === 'documents' || s.id === 'artifacts') walk((s.nodes ?? []) as readonly Kindish[])
  const out = new Map<string, Companion>()
  const add = (n: Kindish, owner: Kindish, rule: CompanionRule) => {
    const key = keyOf(n)
    if (!out.has(key) && keyOf(owner) !== key) {
      out.set(key, { key, id: n.id, label: n.label, ownerKey: keyOf(owner), ownerId: owner.id, role: rule.role, roleLabel: rule.label })
    }
  }
  for (const rule of rules) {
    if (rule.entry === 'document' && rule.idPrefix) {
      for (const d of documents) {
        if (!d.id.startsWith(rule.idPrefix)) continue
        const owner = artifacts.get(d.id.slice(rule.idPrefix.length))
        if (owner) add(d, owner, rule)
      }
      continue
    }
    if (rule.entry !== 'artifact') continue
    if (rule.idSuffix) {
      for (const a of artifacts.values()) {
        if (!a.id.endsWith(rule.idSuffix)) continue
        const owner = artifacts.get(a.id.slice(0, -rule.idSuffix.length))
        if (owner) add(a, owner, rule)
      }
    }
    if (rule.nameSuffix) {
      const ending = rule.nameSuffix.toLowerCase()
      for (const group of siblings) {
        const files = group.filter(n => n.kind === 'artifact')
        for (const a of files) {
          if (!a.label.toLowerCase().endsWith(ending)) continue
          const stem = a.label.slice(0, a.label.length - ending.length).toLowerCase()
          const owner = files.find(o => o !== a && !o.label.toLowerCase().endsWith(ending) && o.label.toLowerCase().replace(/\.[a-z0-9]{1,5}$/, '') === stem)
          if (owner) add(a, owner, rule)
        }
      }
    }
  }
  return out
}

/** The sections without the companions: what the place, the list and the tree show. */
export function withoutCompanions<T extends FilePaneSection>(sections: readonly T[], companions: ReadonlyMap<string, Companion>): T[] {
  if (!companions.size) return [...sections]
  const prune = (nodes: readonly FilePaneNode[]): FilePaneNode[] => nodes.flatMap(n => {
    if (companions.has(keyOf(n as Kindish))) return []
    return [n.children?.length ? { ...n, children: prune(n.children) } : n]
  })
  return sections.map(s => (s.id === 'tree' || s.id === 'documents' || s.id === 'artifacts') && s.nodes ? { ...s, nodes: prune(s.nodes) } : s)
}

/** A file's companions. */
export function companionsOf(companions: ReadonlyMap<string, Companion>, ownerKey: string): Companion[] {
  return [...companions.values()].filter(c => c.ownerKey === ownerKey)
}
