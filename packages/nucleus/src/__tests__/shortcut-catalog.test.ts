import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { EDITOR_SHORTCUTS } from '../shortcut-catalog.js'

const PACKAGES = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('EDITOR_SHORTCUTS', () => {
  it('names each binding where its source still binds it', () => {
    const missing: string[] = []
    for (const entry of EDITOR_SHORTCUTS) {
      if (!entry.source || !entry.binding) continue
      const text = readFileSync(resolve(PACKAGES, entry.source), 'utf8')
      const bound = text.includes(`'${entry.binding}'`)
        || text.includes(`"${entry.binding}"`)
        || new RegExp(`\\b${entry.binding.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`).test(text)
        || (entry.binding.includes(' ') ? text.includes(entry.binding) : false)
      if (!bound) missing.push(`${entry.id}: ${entry.binding} in ${entry.source}`)
    }
    expect(missing).toEqual([])
  })

  it('has unique ids and no shortcut listed twice', () => {
    expect(new Set(EDITOR_SHORTCUTS.map(entry => entry.id)).size).toBe(EDITOR_SHORTCUTS.length)
    const shortcuts = EDITOR_SHORTCUTS.map(entry => entry.shortcut.toLowerCase())
    expect(shortcuts.filter((value, index) => shortcuts.indexOf(value) !== index)).toEqual([])
  })
})
