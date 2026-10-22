/**
 * Offline hardening of the board: nothing it mounts reaches for the network. Each test holds one way it could:
 * a cached `validateEmbeddable` answer that lets any web address embed, the Web Embed tool, a pasted remote image,
 * and a font that would be fetched from a CDN because this app does not serve it.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createCardHost } from './card-embed.js'
import { explicitBooleanValidator, guardEmbeddableTool, pasteGuard, WHITEBOARD_HIDE_TOOLS_CSS, WHITEBOARD_UI_OPTIONS } from './sh-whiteboard.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..', '..', '..', '..')
const PUBLIC_FONTS = join(REPO_ROOT, 'apps', 'organism', 'public', 'excalidraw-assets', 'fonts')

/** The installed Excalidraw package: walk up from this file to the first `node_modules` that holds it. */
function excalidrawDist(): string {
  for (let dir = HERE; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', '@excalidraw', 'excalidraw', 'dist')
    if (existsSync(candidate)) return candidate
    if (dirname(dir) === dir) throw new Error('@excalidraw/excalidraw is not installed above ' + HERE)
  }
}

function filesUnder(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else out.push(relative(root, full))
    }
  }
  walk(root)
  return out.sort()
}

const INPUTS: unknown[] = [
  undefined, null, '', 'mnemosyne://document/wb-graph/d', 'mnemosyne://object/wb-graph/x', 'https://example.org/', 'javascript:alert(1)',
  0, 1, true, false, {}, [], /mnemosyne/, () => true, Symbol('x'),
]

describe('validateEmbeddable', () => {
  it('validate_embeddable_is_a_boolean_for_every_input', () => {
    // Whatever the inner function answers or throws, Excalidraw gets true or false, and only an inner `true` is true.
    const inners: Array<[string, (link: unknown) => unknown, (link: unknown) => boolean]> = [
      ['undefined', () => undefined, () => false],
      ['a regexp', () => /.*/, () => false],
      ['a string', () => 'yes', () => false],
      ['a number', () => 1, () => false],
      ['a throw', () => { throw new Error('boom') }, () => false],
      ['true', () => true, () => true],
      ['a link test', (link) => typeof link === 'string' && link.startsWith('mnemosyne://'), (link) => typeof link === 'string' && link.startsWith('mnemosyne://')],
    ]
    for (const [name, inner, expected] of inners) {
      const validate = explicitBooleanValidator(inner)
      for (const input of INPUTS) {
        const answer = validate(input as string)
        expect(typeof answer, `${name} on ${String(input)}`).toBe('boolean')
        expect(answer, `${name} on ${String(input)}`).toBe(expected(input))
      }
    }
  })

  // BLOCKED: card-embed.ts createCardHost body (S3)
  it('the card host answers true only for a mnemosyne link, as a boolean', () => {
    const host = createCardHost({ createElement: () => null, typedObjects: () => null, graphId: 'wb-graph' })
    const validate = explicitBooleanValidator((link) => host.validateEmbeddable(link))
    for (const input of INPUTS) expect(typeof validate(input as string)).toBe('boolean')
    expect(validate('mnemosyne://document/wb-graph/d')).toBe(true)
    expect(validate('https://example.org/')).toBe(false)
    expect(validate('')).toBe(false)
    host.dispose()
  })
})

describe('the Web Embed tool', () => {
  it('embeddable_tool_is_off', () => {
    // The hint stays, but the pinned build ignores it: it rebuilds UIOptions keeping only tools.image.
    expect(WHITEBOARD_UI_OPTIONS.tools.embeddable).toBe(false)
    expect(WHITEBOARD_UI_OPTIONS.canvasActions.loadScene).toBe(false)
    const bundle = readFileSync(join(excalidrawDist(), 'dev', 'index.js'), 'utf8')
    // Documents the normalization: if an Excalidraw upgrade starts honouring the key, this fails and is noticed.
    expect(bundle).toContain('image: props.UIOptions?.tools?.image ?? true')
    // So the board puts the selection tool back whenever the embeddable tool becomes active.
    const calls: Array<Record<string, unknown>> = []
    const recorder = (type: string) => ({
      getAppState: () => ({ activeTool: { type } }),
      setActiveTool: (tool: Record<string, unknown>) => { calls.push(tool) },
    })
    guardEmbeddableTool(recorder('embeddable'))
    expect(calls).toEqual([{ type: 'selection' }])
    guardEmbeddableTool(recorder('selection'))
    guardEmbeddableTool(recorder('rectangle'))
    expect(calls).toHaveLength(1)
    // And the menu entry is taken off the screen.
    expect(WHITEBOARD_HIDE_TOOLS_CSS).toContain('[data-testid="toolbar-embeddable"]')
    expect(WHITEBOARD_HIDE_TOOLS_CSS).toContain('display: none')
  })
})

describe('paste', () => {
  it('paste_refuses_a_remote_img', () => {
    const told: string[] = []
    const guard = pasteGuard((message) => told.push(message))
    // HTML with a remote <img> reaches onPaste as mixed content with an imageUrl node.
    const refused = guard({ mixedContent: [{ type: 'text' }, { type: 'imageUrl' }] })
    expect(refused).toBe(false)
    expect(told).toHaveLength(1)
    expect(told[0]).toMatch(/image/i)
    // Text, and shapes copied from a board, go through untouched and say nothing.
    expect(guard({ mixedContent: [{ type: 'text' }] })).toBe(true)
    expect(guard({})).toBe(true)
    expect(told).toHaveLength(1)
  })
})

describe('fonts', () => {
  it('every_excalidraw_font_is_served_locally', () => {
    const shipped = filesUnder(join(excalidrawDist(), 'prod', 'fonts'))
    expect(shipped.length).toBeGreaterThan(0)
    const served = new Set(filesUnder(PUBLIC_FONTS))
    const missing = shipped.filter((file) => !served.has(file))
    // A missing file is a font Excalidraw would fetch from a CDN (esm.sh) the first time its glyphs are drawn.
    expect(missing).toEqual([])
  })
})
