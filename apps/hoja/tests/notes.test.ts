import { describe, expect, it } from 'vitest'
import { firstLineTitle, relativeTime, snippetOf } from '../src/notes.js'

describe('firstLineTitle', () => {
  it('takes the first non-empty line and strips heading tokens', () => {
    expect(firstLineTitle('# The seed\n\nBody here.')).toBe('The seed')
  })

  it('strips list and task tokens', () => {
    expect(firstLineTitle('- [ ] water the garden\n')).toBe('water the garden')
    expect(firstLineTitle('1. first things\n')).toBe('first things')
  })

  it('skips blank lines and falls back when empty', () => {
    expect(firstLineTitle('\n\n## Late title')).toBe('Late title')
    expect(firstLineTitle('')).toBe('New leaf')
    expect(firstLineTitle('', 'Untitled')).toBe('Untitled')
  })

  it('truncates long titles', () => {
    const long = 'x'.repeat(100)
    expect(firstLineTitle(long)).toHaveLength(64)
    expect(firstLineTitle(long).endsWith('…')).toBe(true)
  })
})

describe('snippetOf', () => {
  it('returns the line after the title, de-markdowned', () => {
    expect(snippetOf('# Title\n\nA **bold** [link](https://x.dev) here.')).toBe(
      'A bold link here.',
    )
  })

  it('returns empty for single-line notes', () => {
    expect(snippetOf('# Only a title')).toBe('')
  })
})

describe('relativeTime', () => {
  const now = new Date('2026-08-01T15:00:00Z').getTime()

  it('renders quiet buckets', () => {
    expect(relativeTime(now - 10_000, now)).toBe('now')
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5m')
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3h')
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2d')
  })

  it('falls back to a date for older leaves', () => {
    expect(relativeTime(now - 30 * 86_400_000, now)).toMatch(/^Jul \d+$/)
  })
})
