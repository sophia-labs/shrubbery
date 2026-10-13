/**
 * css-template-integrity.test.ts — no backticks inside a css`` template.
 *
 * A guard against a mistake I have now made three times in this file, in three
 * separate sittings: writing a CSS comment that quotes a selector or property
 * in `backticks`, the way every other comment in this codebase does. Inside a
 * tagged template literal a backtick TERMINATES the template, and the damage
 * shows up as a parse error hundreds of lines away — the compiler points at the
 * next `render()` or a stray brace, never at the comment that caused it. Each
 * time it cost a confusing round of bisecting an error message that described
 * the wrong place.
 *
 * It is not a typo, it is a habit collision: prose about code SHOULD use
 * backticks, and this is the one context where prose cannot. A rule that has to
 * be remembered every time will be forgotten again, so it gets a test.
 *
 * Scope is deliberately every `static styles = css` block in the package rather
 * than the one file that keeps getting it wrong — the trap belongs to the
 * syntax, not to editor-host.ts.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full))
    else if (entry.endsWith('.ts')) found.push(full)
  }
  return found
}

/**
 * Spans of every css`` template in a file, as [startLine, endLine] 1-indexed.
 * Found by scanning forward from the tag to the line that closes it — the
 * closing line is the first one whose only content is a backtick, which is the
 * convention every styles block in this package follows.
 */
function cssTemplateSpans(source: string): Array<[number, number]> {
  const lines = source.split('\n')
  const spans: Array<[number, number]> = []
  for (let i = 0; i < lines.length; i += 1) {
    if (!/=\s*css`\s*$/.test(lines[i])) continue
    for (let j = i + 1; j < lines.length; j += 1) {
      if (/^\s*`\s*$/.test(lines[j])) {
        spans.push([i + 1, j + 1])
        i = j
        break
      }
    }
  }
  return spans
}

describe('css`` templates contain no stray backticks', () => {
  it('finds at least one styles block to check, so the scan cannot pass vacuously', () => {
    const withStyles = sourceFiles(SRC).filter(file => cssTemplateSpans(readFileSync(file, 'utf8')).length > 0)
    expect(withStyles.length).toBeGreaterThan(0)
  })

  it('no line inside a css template carries a backtick', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(SRC)) {
      const source = readFileSync(file, 'utf8')
      const lines = source.split('\n')
      for (const [start, end] of cssTemplateSpans(source)) {
        // start and end are the tag line and the closing line; the backticks on
        // those two are the template's own delimiters.
        for (let line = start; line < end - 1; line += 1) {
          if (lines[line].includes('`')) {
            offenders.push(`${file.slice(SRC.length + 1)}:${line + 1}  ${lines[line].trim().slice(0, 70)}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
