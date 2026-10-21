/**
 * The mark's files for the static site and the TV app carry the same thread as
 * the icon system (packages/components/src/ovillo-mark.ts), and the banner is
 * the size Android TV asks for.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OVILLO_MARK_PATH } from '@shrubbery/components/ovillo-mark'
import { sophiaApp } from '@shrubbery/components/sophia-suite'

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const file = (rel: string): string => readFileSync(join(app, rel), 'utf8')
const pathsIn = (svg: string): string[] => [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1])

describe('the mark’s files', () => {
  it('ovillo-mark.svg is the thread alone: one path, the icon’s, in currentColor (carmine; lighter in the dark)', () => {
    const svg = file('public/ovillo-mark.svg')
    expect(pathsIn(svg)).toEqual([OVILLO_MARK_PATH])
    expect(svg).toContain('stroke="currentColor"')
    expect(svg).toContain('color="#be123c"')
    expect(svg).toMatch(/prefers-color-scheme: dark\) \{ \.ovillo-mark \{ color: #fda4af \}/)
  })

  it('the favicon is the tile: the carmine diagonal, the thread in white', () => {
    const svg = file('public/favicon.svg')
    expect(pathsIn(svg)).toEqual([OVILLO_MARK_PATH])
    expect(svg).toContain('stop-color="#e11d48"')
    expect(svg).toContain('stop-color="#be123c"')
    expect(svg).toContain('stroke="#fff"')
    expect(file('index.html')).toContain('<link rel="icon" type="image/svg+xml" href="./favicon.svg" />')
  })

  it('the TV banner is a 320 × 180 PNG', () => {
    const png = readFileSync(join(app, 'public/tv-banner.png'))
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG')
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([320, 180])
  })

  it('the app’s top bar shows Ovillo with its own mark', () => {
    expect(sophiaApp('ovillo').icon).toBe('ovillo')
    expect(file('src/ovillo-app.ts')).toContain("icon: sophiaApp('ovillo').icon")
  })
})
