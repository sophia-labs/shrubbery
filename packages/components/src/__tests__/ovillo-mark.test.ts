/**
 * Ovillo's mark — an egg made out of one string — in the icon system, the
 * suite catalogue and the top bar (real elements, happy-dom).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render } from 'lit'
import { icon, hasIcon } from '../icons.js'
import { OVILLO_MARK_NODE, OVILLO_MARK_PATH } from '../ovillo-mark.js'
import { SOPHIA_APPS, sophiaApp } from '../sophia-suite.js'
import '../mn-top-bar.js'
import type { MnTopBar } from '../mn-top-bar.js'

const here = dirname(fileURLToPath(import.meta.url))

function numbers(d: string): number[] {
  return (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
}

describe('the mark', () => {
  it('is one thread: a single path with a single moveto', () => {
    expect(OVILLO_MARK_NODE).toEqual([['path', { d: OVILLO_MARK_PATH }]])
    expect(OVILLO_MARK_PATH.match(/M/g)).toHaveLength(1)
    expect(OVILLO_MARK_PATH.startsWith('M')).toBe(true)
    expect(/[^MC\d .-]/.test(OVILLO_MARK_PATH)).toBe(false)
  })

  it('stays inside the 24-box with room for a 2-unit stroke', () => {
    const ns = numbers(OVILLO_MARK_PATH)
    expect(Math.min(...ns)).toBeGreaterThanOrEqual(1)
    expect(Math.max(...ns)).toBeLessThanOrEqual(23)
  })

  it('the icon system draws it like a lucide glyph, in currentColor', () => {
    expect(hasIcon('ovillo')).toBe(true)
    const host = document.createElement('div')
    render(icon('ovillo', { size: 16 }), host)
    const svg = host.querySelector('svg')!
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(svg.getAttribute('stroke')).toBe('currentColor')
    expect(svg.getAttribute('width')).toBe('16')
    const paths = svg.querySelectorAll('path')
    expect(paths).toHaveLength(1)
    expect(paths[0].getAttribute('d')).toBe(OVILLO_MARK_PATH)
  })
})

describe('Ovillo in the suite', () => {
  it('the catalogue names its own mark, not a borrowed glyph', () => {
    expect(SOPHIA_APPS.ovillo.icon).toBe('ovillo')
    expect(sophiaApp('ovillo')).toMatchObject({ label: 'Ovillo', icon: 'ovillo', stage: 'experimental' })
  })

  it('its tile is the carmine of Ariadne’s thread, a brand constant beside the others', () => {
    const css = readFileSync(resolve(here, '../../../tokens/css/component.css'), 'utf8')
    expect(css).toMatch(/--mn-app-tile-ovillo:\s*linear-gradient\(155deg, var\(--mn-ref-carmine-600\) 0 58%, var\(--mn-ref-carmine-700\) 58%\)/)
    const bar = readFileSync(resolve(here, '../mn-top-bar.ts'), 'utf8')
    expect(bar).toContain(".app-tile[data-app-id='ovillo'] { background: var(--mn-app-tile-ovillo, var(--mn-app-tile-default)); }")
  })

  it('the top bar draws the mark on Ovillo’s tile, in the masthead and the launcher', async () => {
    const el = document.createElement('mn-top-bar') as MnTopBar
    el.activeApp = 'ovillo'
    el.brand = 'Ovillo'
    el.apps = [{ id: 'ovillo', label: 'Ovillo', icon: sophiaApp('ovillo').icon }]
    el.appLinks = [{ id: 'garden', label: 'Garden', icon: 'sprout', href: 'https://garden.sophia-labs.com/' }]
    document.body.appendChild(el)
    await el.updateComplete
    const tiles = [...el.shadowRoot!.querySelectorAll<HTMLElement>('.app-tile[data-app-id="ovillo"]')]
    expect(tiles.length).toBeGreaterThanOrEqual(2)
    for (const tile of tiles) expect(tile.querySelector('path')?.getAttribute('d')).toBe(OVILLO_MARK_PATH)
  })
})
