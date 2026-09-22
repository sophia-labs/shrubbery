/**
 * DisplayKind render carrier — R4b/R4c proofs:
 *
 *   - the data-kind ATTRIBUTE convention is the ONE kind discriminator: render-dom
 *     output matches the exact `.mn-kind[data-kind=…]` selectors kind.css declares
 *     (read from disk), via a REAL DOM `querySelector`/`matches` (an explicit
 *     happy-dom Window — the render package itself stays lib-DOM-free), and
 *     emits ZERO `mn-kind-{kind}` discriminator classes,
 *   - the structural CHILD classes (mn-kind-value/unit/link/attribution) stay and
 *     light kind.css's descendant selectors,
 *   - timestamps in the DOM face come from the shared deterministic-UTC formatter,
 *   - the knob faces derive xsd:dateTime from the epoch-ms createdAt carrier.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { DISPLAY_KINDS, formatTimestamp, type DisplayKind } from '@shrubbery/nucleus'
import {
  CONTENT_TYPE,
  renderResource,
  type KindedValueResource,
  type KnobResource,
  type RenderCtx,
} from '../index.js'

const ctx: RenderCtx = { baseUrl: 'http://localhost:8787', selfPath: '/kinded', upPath: null }

const KIND_CSS_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../tokens/css/kind.css',
)

/** Every kind-scoped selector kind.css declares, read from disk (pseudo-elements stripped for querySelector). */
function kindCssSelectors(): string[] {
  const css = readFileSync(KIND_CSS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const selectors: string[] = []
  for (const match of css.matchAll(/(?:^|\})([^{}]+)\{/g)) {
    const selector = match[1].trim()
    if (selector.includes('[data-kind=')) selectors.push(selector.replace(/::[a-z-]+$/, ''))
  }
  return selectors
}

const KIND_FIXTURE: Readonly<Record<DisplayKind, KindedValueResource>> = {
  identity: {
    kind: 'kinded-value',
    id: 'identity',
    title: 'Identity',
    node: { kind: 'identity', value: 'learner-1', stance: 'room' },
  },
  state: {
    kind: 'kinded-value',
    id: 'state',
    title: 'State',
    node: { kind: 'state', value: 'resident' },
  },
  metric: {
    kind: 'kinded-value',
    id: 'metric',
    title: 'Metric',
    node: {
      kind: 'metric',
      value: '42',
      unit: 'ms',
      recency: {
        current: '42',
        capturedAt: 1783177200000,
        previous: { value: '44', capturedAt: 1783173600000 },
      },
    },
  },
  prose: {
    kind: 'kinded-value',
    id: 'prose',
    title: 'Prose',
    node: { kind: 'prose', value: 'A quiet sentence.' },
  },
  reference: {
    kind: 'kinded-value',
    id: 'reference',
    title: 'Reference',
    node: { kind: 'reference', value: 'Open Plot', href: 'http://localhost:8787/plot' },
  },
  testimony: {
    kind: 'kinded-value',
    id: 'testimony',
    title: 'Testimony',
    node: {
      kind: 'testimony',
      value: 'Observed the floor.',
      attribution: { observer: 'vehicle-web', observedAt: 1783177200000 },
    },
  },
  affordance: {
    kind: 'kinded-value',
    id: 'affordance',
    title: 'Affordance',
    node: { kind: 'affordance', value: 'Claim floor' },
  },
}

/** Any per-kind discriminator class (`mn-kind-identity` … `mn-kind-affordance`) — must never be emitted. */
const DISCRIMINATOR_CLASS = new RegExp(`mn-kind-(?:${DISPLAY_KINDS.join('|')})\\b`)

describe('DisplayKind render carrier', () => {
  it('renders every DisplayKind through every face', async () => {
    for (const [kind, resource] of Object.entries(KIND_FIXTURE) as Array<[DisplayKind, KindedValueResource]>) {
      const dom = await renderResource(resource, 'dom', ctx)
      expect(dom.contentType).toBe(CONTENT_TYPE.dom)
      expect(dom.body).toContain(`data-kind="${kind}"`)

      const markdown = await renderResource(resource, 'hypertext', ctx)
      expect(markdown.contentType).toBe(CONTENT_TYPE.hypertext)
      expect(markdown.body).toContain(resource.node.label ?? resource.node.value)

      const turtle = await renderResource(resource, 'turtle', ctx)
      expect(turtle.contentType).toBe(CONTENT_TYPE.turtle)
      expect(turtle.body).toContain(`dk:kind "${kind}"`)

      const json = await renderResource(resource, 'json', ctx)
      expect(json.contentType).toBe(CONTENT_TYPE.json)
      const parsed = JSON.parse(json.body) as Record<string, unknown>
      expect(JSON.stringify(parsed)).toContain('"displayKind"')
      expect(JSON.stringify(parsed)).toContain(kind)
    }
  })

  it('emits ZERO mn-kind-{kind} discriminator classes (data-kind is THE convention, R4b)', async () => {
    for (const resource of Object.values(KIND_FIXTURE)) {
      const dom = await renderResource(resource, 'dom', ctx)
      expect(dom.body).not.toMatch(DISCRIMINATOR_CLASS)
    }
  })

  it('DOM output matches the exact .mn-kind[data-kind=…] selectors kind.css declares (read from disk)', async () => {
    const window = new Window()
    const document = window.document
    const selectors = kindCssSelectors()
    expect(selectors.length).toBeGreaterThanOrEqual(7)

    // Every kind-scoped selector in kind.css is LIT by the real render output of
    // its kind — including the structural descendant selectors (mn-kind-value /
    // mn-kind-unit / mn-kind-link / mn-kind-attribution), which STAY.
    for (const selector of selectors) {
      const kindMatch = /\[data-kind="([a-z]+)"\]/.exec(selector)
      expect(kindMatch, selector).not.toBeNull()
      const kind = kindMatch![1] as DisplayKind
      const dom = await renderResource(KIND_FIXTURE[kind], 'dom', ctx)
      document.body.innerHTML = dom.body
      expect(document.querySelector(selector), `kind.css selector unlit: ${selector}`).not.toBeNull()
    }

    // And the root element matches ONLY its own kind's register selector.
    for (const [kind, resource] of Object.entries(KIND_FIXTURE) as Array<[DisplayKind, KindedValueResource]>) {
      const dom = await renderResource(resource, 'dom', ctx)
      document.body.innerHTML = dom.body
      const el = document.body.firstElementChild!
      expect(el.matches(`.mn-kind[data-kind="${kind}"]`), kind).toBe(true)
      for (const other of DISPLAY_KINDS) {
        if (other === kind) continue
        expect(el.matches(`.mn-kind[data-kind="${other}"]`), `${kind} vs ${other}`).toBe(false)
      }
    }
    window.close()
  })

  it('a stance:"contested" node matches [data-stance="contested"] in a real happy-dom document (WS1 S1)', async () => {
    const contestedResource: KindedValueResource = {
      kind: 'kinded-value',
      id: 'contested-field',
      title: 'Contested field',
      node: { kind: 'state', value: 'pending review', stance: 'contested' },
    }
    const dom = await renderResource(contestedResource, 'dom', ctx)
    expect(dom.body).toContain('data-stance="contested"')

    const window = new Window()
    const document = window.document
    document.body.innerHTML = dom.body
    const el = document.body.firstElementChild!
    expect(el.matches('[data-stance="contested"]')).toBe(true)
    window.close()
  })

  it('uses kind-specific text registers in markdown and DOM', async () => {
    const metricMarkdown = await renderResource(KIND_FIXTURE.metric, 'hypertext', ctx)
    expect(metricMarkdown.body).toContain('42 (ms)')

    const referenceMarkdown = await renderResource(KIND_FIXTURE.reference, 'hypertext', ctx)
    expect(referenceMarkdown.body).toContain('[Open Plot](http://localhost:8787/plot)')

    const testimonyMarkdown = await renderResource(KIND_FIXTURE.testimony, 'hypertext', ctx)
    expect(testimonyMarkdown.body).toContain('Observed the floor. — vehicle-web, 2026-07-04T15:00:00.000Z')

    const referenceDom = await renderResource(KIND_FIXTURE.reference, 'dom', ctx)
    expect(referenceDom.body).toContain('class="mn-kind-link"')
  })

  it('DOM-face timestamps come from the shared deterministic-UTC formatter (R4c)', async () => {
    const testimonyDom = await renderResource(KIND_FIXTURE.testimony, 'dom', ctx)
    expect(testimonyDom.body).toContain(`vehicle-web, ${formatTimestamp(1783177200000)}`)
    expect(testimonyDom.body).toContain('vehicle-web, 2026-07-04 15:00 UTC')
    // never a locale render
    expect(testimonyDom.body).not.toContain('PM')
  })
})

describe('knob faces — epoch-ms createdAt carrier → xsd:dateTime wire (R4c)', () => {
  const knob: KnobResource = {
    kind: 'tn-knob',
    id: 'supersession-conservatism',
    title: 'supersession conservatism',
    family: 'JUDGMENT',
    glyph: 'layers',
    focal: true,
    summary: 'How willing the agent is to declare one belief dead and another alive.',
    value: 'confident',
    axes: [],
    choices: ['add-only', 'confident', 'aggressive'],
    meter: { label: 'both-active leaks', value: 1, target: 0, green: false, offenders: ['both active: 27:12 AND 25:50'] },
    laws: [],
    writeMode: 'staged',
    justifiedBy: 'run/T-042',
    createdBy: 'vera',
    createdAt: 1783177200000,
    asOf: null,
    governsBed: null,
  }

  it('turtle face emits xsd:dateTime derived from the epoch-ms createdAt', async () => {
    const turtle = await renderResource(knob, 'turtle', ctx)
    expect(turtle.body).toContain('"2026-07-04T15:00:00.000Z"^^xsd:dateTime')
    // the epoch number itself never leaks onto the wire
    expect(turtle.body).not.toContain('"1783177200000"')
  })

  it('hypertext face shows the ISO wire form of the provenance date', async () => {
    const markdown = await renderResource(knob, 'hypertext', ctx)
    expect(markdown.body).toContain('**createdAt:** `2026-07-04T15:00:00.000Z`')
  })
})
