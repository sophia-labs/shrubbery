/**
 * dom-server.ts — the `dom` face for the conneg server (server-side rendering).
 *
 * This is the bridge that lets a plain `curl -H "Accept: text/html"` (or a browser)
 * get the REAL DOM observatory — THE PLOT / THE BOUQUET — from the SAME resources
 * the curl/turtle/json faces render. It is the agent-native heart of the design:
 * one interpreter, one set of resources, two faces (markdown for the agent, the
 * lifted Lit observatory for the human), negotiated by Accept.
 *
 * It does NOT re-implement rendering — it drives slice-2's render path
 * (renderPlotDomString / renderBouquetDomString in render-dom.ts) — the EXACT path
 * the browser shell and the smoke use. So the DOM the server emits == the DOM the
 * browser renders.
 *
 * WHY VITE SSR (not raw tsx): @shrubbery/components are authored with Lit 3
 * STANDARD decorators; Vite's esbuild transform compiles them as such. Raw tsx
 * honors each package's tsconfig `experimentalDecorators:true` and emits the LEGACY
 * decorator helper, which Lit's standard `@property` rejects ("Unsupported
 * decorator location: field"). So we load the DOM render path through a lazily
 * created Vite SSR server (middleware mode) — the IDENTICAL transform the smoke
 * uses — guaranteeing the served DOM matches the browser + the test. happy-dom is
 * installed onto the SSR runtime's globalThis (dom-globals.ts) before render-dom
 * loads (it registers custom elements eagerly).
 *
 * The custom-element shadow DOM is serialized via Declarative Shadow DOM
 * (`<template shadowrootmode="open">`) so a browser re-hydrates the shadow trees
 * natively without JS, and a bare `curl` still sees every bloom + soil row in the
 * payload (the supersession story is in the bytes, not behind a script).
 *
 * Tokens CSS is inlined (the layered @import chain resolved at boot) so the page is
 * a real, styled, self-contained document — no static-asset server needed.
 *
 * Lazy + memoized: the Vite SSR server + the render module load once, on first html
 * request, and stay warm for the process's lifetime.
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type {
  GreenhouseResource,
  MemoryRecord,
  PlotResource,
  WalkIndexResource,
  WalkResource,
} from '@shrubbery/render'
import { installDom } from './dom-globals.js'
import type { MemoryWorld } from './memory-world.js'
import type { GreenhouseWorld } from './greenhouse-world.js'
import { EntityResolver } from './entity-resolution.js'
import { GardenClient } from './garden-client.js'
import type { GhostCluster } from './greenhouse-views.js'
import type { TraceWorld } from './trace-world.js'

type RenderDom = typeof import('./render-dom.js')

const __dir = dirname(fileURLToPath(import.meta.url))

let renderDomMod: Promise<RenderDom> | null = null

/**
 * Install happy-dom onto the process globalThis, then spin up a Vite SSR dev server
 * (middleware mode, no HMR) and ssrLoadModule the render path. Memoized: one warm
 * server.
 *
 * ORDER IS LOAD-BEARING: installDom() MUST run BEFORE the Vite server loads
 * lit-html. In Node mode lit-html captures `global.document` at module-init: if it
 * is still undefined it falls back to a no-op stub whose `createComment` is missing
 * (→ "l.createComment is not a function"). We install the DOM in the MAIN process
 * first (dom-globals has no decorators, so plain tsx handles it), so by the time
 * Vite SSR evaluates lit-html, `global.document` is the happy-dom one.
 */
function loadRenderDom(): Promise<RenderDom> {
  if (!renderDomMod) {
    renderDomMod = (async () => {
      await installDom() // BEFORE Vite loads lit-html (see note above)
      const { createServer } = await import('vite')
      const vite = await createServer({
        root: resolve(__dir, '..'),
        appType: 'custom',
        server: { middlewareMode: true, hmr: false },
        logLevel: 'silent',
        // Force lit (+ the workspace UI packages) through Vite's SSR TRANSFORM
        // rather than native nodeImport. Externalized lit-html loads in the main
        // Node registry and captures `global.document` at its first eval (the stub
        // if undefined → "createComment is not a function"); transformed in-SSR it
        // evaluates AFTER installDom set the SSR-runtime document. (Belt-and-braces
        // with the install-order above.)
        ssr: {
          noExternal: [
            'lit',
            'lit-html',
            'lit-element',
            '@lit/reactive-element',
            /^@shrubbery\//,
          ],
        },
      })
      // Re-assert inside the SSR runtime too (idempotent), then load the render path.
      const domGlobals = (await vite.ssrLoadModule('./src/dom-globals.ts')) as {
        installDom: (url?: string) => Promise<void>
      }
      await domGlobals.installDom()
      return (await vite.ssrLoadModule('./src/render-dom.ts')) as unknown as RenderDom
    })()
  }
  return renderDomMod
}

// ── Tokens CSS, inlined (resolve the @import layer chain once) ──────────────────

let cssCache: string | null = null

function inlineTokensCss(): string {
  if (cssCache !== null) return cssCache
  try {
    // src/ -> ../../../packages/tokens/css
    const cssDir = join(__dir, '..', '..', '..', 'packages', 'tokens', 'css')
    const entry = readFileSync(join(cssDir, 'tokens.css'), 'utf8')
    // Resolve the (single-level) @import layer chain into one stylesheet.
    cssCache = entry.replace(/@import\s+['"]\.\/([^'"]+)['"];/g, (_m, file: string) => {
      try {
        return readFileSync(join(cssDir, file), 'utf8')
      } catch {
        return ''
      }
    })
  } catch {
    cssCache = ''
  }
  return cssCache
}

// ── Declarative Shadow DOM rewrite ─────────────────────────────────────────────

/**
 * render-dom.ts emits shadow roots as `<!--shadow-->…<!--/shadow-->` comment
 * fences (its serializer is shadow-aware but renderer-neutral). For an HTML page we
 * rewrite each fence into a Declarative Shadow DOM template, so browsers attach the
 * shadow root natively (no JS) and curl still sees the full content inline.
 */
export function toDeclarativeShadow(html: string): string {
  return html
    .replace(/<!--shadow-->/g, '<template shadowrootmode="open">')
    .replace(/<!--\/shadow-->/g, '</template>')
}

// ── The page shell ─────────────────────────────────────────────────────────────

function htmlPage(title: string, bodyHtml: string): string {
  const css = inlineTokensCss()
  return `<!doctype html>
<html lang="en" data-theme="light" data-skin="emporium">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>${css}</style>
<style>
  html, body { height: 100%; }
  body { margin: 0; font-family: var(--mn-font-chrome, system-ui, sans-serif);
         background: var(--mn-color-surface-base, #fff); color: var(--mn-color-text-primary, #111); }
  rz-observatory, rz-walk { display: block; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`
}

// ── The two DOM faces (live resources in → styled HTML page out) ───────────────

/**
 * THE PLOT as a full HTML page (Declarative Shadow DOM), from a live resource.
 * `graphId` (when given) is used to DETECT the entity-resolution ghost clusters so
 * the curl/SSR Plot face plants the SAME merge-ghost banner the browser shell does
 * (agent-native parity). Omitted → no detection → no banner (best-effort, NO fake).
 */
export async function renderPlotHtml(
  world: MemoryWorld,
  asof: string | null,
  mintedBy: ReadonlyMap<string, string> = new Map(),
  graphId?: string,
): Promise<string> {
  const { renderPlotDomString } = await loadRenderDom()
  const plot: PlotResource = await world.plot(asof)
  const chains = new Map<string, readonly MemoryRecord[]>()
  for (const s of plot.subjects) {
    const sub = await world.subject(s.rootId, asof)
    if (sub) chains.set(s.rootId, sub.records)
  }
  const ghosts = graphId ? await ghostsFor(graphId) : []
  const inner = toDeclarativeShadow(await renderPlotDomString(plot, chains, mintedBy, ghosts))
  const title = `Rhizome — the plot${asof ? ` (as-of ${asof})` : ''}`
  return htmlPage(title, inner)
}

/** THE PLOT BED (one subject's flat structural lineage) as a full HTML page. */
export async function renderSubjectHtml(
  world: MemoryWorld,
  rootId: string,
  asof: string | null,
): Promise<string | null> {
  const { renderBouquetDomString } = await loadRenderDom()
  const subject = await world.subject(rootId, asof)
  if (!subject) return null
  const inner = toDeclarativeShadow(await renderBouquetDomString(subject))
  const title = `Rhizome — ${subject.topic}${asof ? ` (as-of ${asof})` : ''}`
  return htmlPage(title, inner)
}

/**
 * THE BOUQUET (the rich constellation reader) as a full HTML page, or null if the
 * bed is absent. Renders the SAME <rz-bouquet> the browser shell drives, over the
 * assembled BouquetResource — so the curl-able `/bouquet/{id}` HTML face is the
 * in-shell constellation (one render path, ergonomics and all).
 */
export async function renderBouquetHtml(
  world: MemoryWorld,
  rootId: string,
  asof: string | null,
): Promise<string | null> {
  const { renderBouquetResourceDomString } = await loadRenderDom()
  const bouquet = await world.bouquet(rootId, asof)
  if (!bouquet) return null
  const inner = toDeclarativeShadow(await renderBouquetResourceDomString(bouquet))
  const title = `Rhizome — Bouquet — ${bouquet.topic}${asof ? ` (as-of ${asof})` : ''}`
  return htmlPage(title, inner)
}

/** THE WALK INDEX (the run list) as a full HTML page, from the trace FILES. */
export async function renderWalkIndexHtml(world: TraceWorld): Promise<string> {
  const { renderWalkIndexDomString } = await loadRenderDom()
  const index: WalkIndexResource = await world.walk()
  const inner = toDeclarativeShadow(await renderWalkIndexDomString(index))
  return htmlPage('Rhizome — the walk (agentic-run traces)', inner)
}

/** ONE run's WALK ribbon as a full HTML page, or null if the run is absent. */
export async function renderWalkRunHtml(
  world: TraceWorld,
  runId: string,
  turn: number | null,
): Promise<string | null> {
  const { renderWalkRunDomString } = await loadRenderDom()
  const walk: WalkResource | null = await world.trace(runId, turn)
  if (!walk) return null
  const inner = toDeclarativeShadow(await renderWalkRunDomString(walk))
  const title = `Rhizome — walk ${runId}${turn != null ? ` (turn ${turn})` : ''}`
  return htmlPage(title, inner)
}

// ── THE GREENHOUSE — the cultivation knobs as DOM (the curl-able /tune HTML face) ──

/**
 * Detect the entity-resolution ghost clusters for the greenhouse's graph (the merge-
 * ghost affordance). Reads the SAME detector the shell uses, over a node-http client.
 * Best-effort: a failed read yields []  (the affordance just absents — NO fake).
 */
async function ghostsFor(graphId: string): Promise<GhostCluster[]> {
  try {
    const res = new EntityResolver(new GardenClient(), graphId)
    const [clusters, edges] = await Promise.all([res.detectDuplicates(), res.sameSubjectEdges()])
    const merged = new Set(edges.map((e) => e.from))
    return clusters.map((c) => ({
      signature: c.signature,
      label: c.label,
      recIris: c.records.map((r) => r.iri),
      n: c.records.length,
      merged: c.records.filter((r) => r.iri !== c.canonical).every((r) => merged.has(r.iri)),
    }))
  } catch {
    return []
  }
}

/** THE GREENHOUSE (the cultivation knobs) as a full HTML page, from a live resource. */
export async function renderGreenhouseHtml(
  world: GreenhouseWorld,
  asof: string | null,
): Promise<string> {
  const { renderGreenhouseDomString } = await loadRenderDom()
  const greenhouse: GreenhouseResource = await world.greenhouse(asof)
  const ghosts = await ghostsFor(world.graphId)
  const inner = toDeclarativeShadow(await renderGreenhouseDomString(greenhouse, ghosts))
  const title = `Rhizome — the Greenhouse${asof ? ` (as-of ${asof})` : ''}`
  return htmlPage(title, inner)
}

/** ONE KNOB as a full HTML page (the surface focused on that dial), or null if absent. */
export async function renderKnobHtml(
  world: GreenhouseWorld,
  knobId: string,
  asof: string | null,
): Promise<string | null> {
  const { renderKnobResourceDomString } = await loadRenderDom()
  const knob = await world.knob(knobId, asof)
  if (!knob) return null
  const ghosts = knob.id === 'entity-resolution' ? await ghostsFor(world.graphId) : []
  const inner = toDeclarativeShadow(await renderKnobResourceDomString(knob, ghosts))
  const title = `Rhizome — ${knob.title}${asof ? ` (as-of ${asof})` : ''}`
  return htmlPage(title, inner)
}
