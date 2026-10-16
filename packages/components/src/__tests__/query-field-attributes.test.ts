/**
 * Query fields (search, find, pickers) must not autocorrect, autocapitalize,
 * spellcheck or offer writing suggestions. On macOS those turned a search's
 * first word into a capitalized "sentence", and accepting the suggestion with
 * Return ran the search again (2026-10-07). Prose fields (the
 * editor, chat, rename and naming dialogs) keep them.
 *
 * Lit cannot spread a shared attribute set onto an <input>, so each field
 * writes the four out and this test holds them together. A new query field
 * belongs in QUERY_FIELDS.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const REQUIRED = ['autocapitalize="off"', 'autocorrect="off"', 'spellcheck="false"', 'writingsuggestions="false"']

/** [file, a string that appears only inside that field's <input ...> tag] */
const QUERY_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['mn-document-switcher.ts', "'Search graph...'"],
  ['mn-editor-toolbar.ts', 'data-search-input\n'],
  ['mn-editor-toolbar.ts', 'data-replace-input\n'],
  ['mn-wikilink-picker.ts', 'placeholder=${this.placeholder}'],
  ['mn-wire-picker.ts', 'placeholder=${this.placeholder}'],
  ['mn-node-link-picker.ts', 'Link to a document or artifact...'],
  ['mn-citation-picker.ts', 'Search your Zotero library...'],
  ['mn-sidebar-panel.ts', 'class="search-input"'],
  ['mn-zotero-library-panel.ts', 'Search library...'],
  ['mn-app-bar.ts', 'class="search-input"'],
  ['mn-mobile-file-list.ts', 'Search folders and documents'],
  ['mn-search-input.ts', 'type="search"'],
]

/** The text of the <input ...> tag that contains `marker`. */
function inputTagWith(source: string, marker: string): string | null {
  const at = source.indexOf(marker)
  if (at < 0) return null
  const start = source.lastIndexOf('<input', at)
  if (start < 0) return null
  const end = source.indexOf('\n', source.indexOf('>', at))
  return source.slice(start, end)
}

describe('query fields turn off autocorrect and writing suggestions', () => {
  for (const [file, marker] of QUERY_FIELDS) {
    it(`${file} (${marker})`, () => {
      const tag = inputTagWith(readFileSync(resolve(srcDir, file), 'utf8'), marker)
      expect(tag, `an <input> containing ${marker}`).not.toBeNull()
      for (const attribute of REQUIRED) expect(tag).toContain(attribute)
    })
  }
})
