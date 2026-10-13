// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The pure layer is DOM-free and React-free, and only reaches the rest of nucleus through the contract
 * file. This runs under the node environment, where any use of `document` or `window` would already have
 * thrown; the scan below also catches the code paths the other tests do not execute.
 */
const dir = join(dirname(fileURLToPath(import.meta.url)), '..')
const sources = readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const)

describe('files-canvas purity', () => {
  it('finds the modules of wave 1', () => {
    const names = sources.map(([f]) => f)
    for (const f of ['geometry.ts', 'engine-port.ts', 'engine-house.ts', 'engine-route.ts', 'interaction.ts', 'labels.ts', 'scene.ts', 'journal.ts', 'index.ts', 'engine-default.ts', 'engine-excalidraw.ts']) {
      expect(names, f).toContain(f)
    }
  })

  it('imports only its own modules and the contract file', () => {
    for (const [file, text] of sources) {
      for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)[^'"\n]*?from\s+['"]([^'"]+)['"]/g)) {
        const spec = m[1]!
        // The one door to Excalidraw: its element modules (no React, no DOM), imported by this file and no other.
        const engine = file === 'engine-excalidraw.ts' && /^@excalidraw\/(element|math|common)(\/types)?$/.test(spec)
        expect(spec.startsWith('./') || spec === '../folder-view-contract.js' || engine, `${file} imports ${spec}`).toBe(true)
      }
    }
  })

  it('reaches the Excalidraw-backed engine only through engine-default.ts, and only by a dynamic import', () => {
    for (const [file, text] of sources) {
      if (file === 'engine-excalidraw.ts') continue
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
      expect(/from\s+['"]\.\/engine-excalidraw\.js['"]/.test(code), `${file} imports engine-excalidraw.ts statically`).toBe(false)
      expect(/vendor\/excalidraw/.test(code), `${file} reaches the vendored snapper`).toBe(false)
    }
    const [, door] = sources.find(([f]) => f === 'engine-default.ts')!
    expect(door).toMatch(/import\('\.\/engine-excalidraw\.js'\)/)
  })

  it('names no DOM, framework or timer identifier outside comments and strings', () => {
    const forbidden = /\b(document|window|globalThis\.(?:document|window)|HTMLElement|SVGElement|Element|Node|customElements|requestAnimationFrame|cancelAnimationFrame|setTimeout|setInterval|localStorage|sessionStorage|getComputedStyle|PointerEvent|MouseEvent|KeyboardEvent|DragEvent|React|Lit|LitElement)\b/
    for (const [file, text] of sources) {
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''")
      const hit = forbidden.exec(code)
      expect(hit?.[0] ?? null, `${file} mentions ${hit?.[0]}`).toBeNull()
    }
  })

  it('does not read the clock or randomness: every step is a function of its inputs', () => {
    for (const [file, text] of sources) {
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
      expect(/\b(Date\.now|new Date|Math\.random|performance\.now|crypto\.)/.test(code), file).toBe(false)
    }
  })

  it('lets the reducer touch the engine only to ask it questions: the lifecycle calls are in the host\'s runEngineEffects and nowhere else', () => {
    // A lexical guard; the behavioural proof is in interaction.lifecycle.test.ts (evaluating the reducer calls nothing) and the replay fuzz.
    const [, text] = sources.find(([f]) => f === 'interaction.ts')!
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    const host = code.slice(code.indexOf('export function runEngineEffects'))
    const hostEnd = host.indexOf('\n}\n') + 3
    const rest = code.replace(host.slice(0, hostEnd), '')
    expect(host.slice(0, hostEnd)).toMatch(/engine\.prepareDrag\?\./)
    expect(/\.(prepareDrag|releaseDrag|dispose)\b/.test(rest), 'interaction.ts calls the engine lifecycle outside runEngineEffects').toBe(false)
    for (const [file, source] of sources) {
      // The engines implement the lifecycle; the reducer and the host are the only places it is called from.
      if (file === 'interaction.ts' || file === 'engine-port.ts' || file === 'engine-excalidraw.ts') continue
      expect(/\b(prepareDrag|releaseDrag)\?*\.?\(/.test(source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')), `${file} runs the drag lifecycle`).toBe(false)
    }
  })
})
