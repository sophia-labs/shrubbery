/**
 * build-static.ts — the STATIC face multiplier (the local mimic of the Vite
 * plugin / build step that will write S3 objects later).
 *
 * For each REAL resource it renders ALL FOUR faces and writes the exact object
 * layout the SFDM design specifies for S3:
 *
 *   <out>/<path>/index.html     — the html face (dom shell around the markdown)
 *   <out>/<path>/index.md       — the markdown face (the bare-curl default)
 *   <out>/<path>/index.ttl      — RDF/Turtle
 *   <out>/<path>/index.jsonld   — compacted JSON-LD (w/ @context)
 *
 * i.e. `index.{html,md,ttl,jsonld}` per resource, with correct content-types
 * (encoded in the extension, which the conneg layer maps back to a Content-Type)
 * and Link metadata (the html face carries the FAIR Signposting links as <link>
 * tags; an `index.json` alias is also written so an `application/json` request
 * that pins `.json` resolves the same JSON-LD bytes).
 *
 * This is the build-time format multiplication — NO deploy, NO prod infra: it
 * emits the files into a local `conneg-static/` dir you can `s3 sync` in the
 * gated follow-up, and which the dev server / a static file server can serve.
 *
 * Run: pnpm --dir apps/storybook conneg:build   (OUT=conneg-static by default)
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { renderResource, toLinkHeader, type RenderTarget } from '@shrubbery/render'
import { htmlShell } from './html-shell.js'
import { routeTable } from './resources.js'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(here, '..', process.env.OUT ?? 'conneg-static')
const BASE = process.env.BASE_URL ?? 'http://localhost:8787'

/** The text faces the pure render package produces. */
const TEXT_FACES: Exclude<RenderTarget, 'dom'>[] = ['hypertext', 'turtle', 'json']

/**
 * The file each face is written under. The pure package's FACE_EXT maps json→json;
 * here we additionally write the JSON-LD bytes under `.jsonld` (the canonical FAIR
 * extension) AND keep a `.json` alias for the `application/json` pin. The html
 * face is built locally (the runtime/Lit shell is out of the pure package).
 */
const FACE_FILES: Record<Exclude<RenderTarget, 'dom'>, readonly string[]> = {
  hypertext: ['index.md'],
  turtle: ['index.ttl'],
  json: ['index.jsonld', 'index.json'],
}

async function main(): Promise<void> {
  const routes = routeTable()
  let files = 0
  for (const [path, route] of Object.entries(routes)) {
    const ctx = route.ctx(BASE)
    const dir = join(OUT, path.replace(/^\//, ''))
    mkdirSync(dir, { recursive: true })

    // The three text faces (markdown / turtle / JSON-LD).
    for (const face of TEXT_FACES) {
      const out = await renderResource(route.resource, face, ctx)
      for (const file of FACE_FILES[face]) {
        writeFileSync(join(dir, file), out.body, 'utf8')
        files++
      }
    }

    // The html face — the dom shell around the (already rendered) markdown,
    // carrying the SAME FAIR Signposting Link set as <link> tags. Byte-identical
    // to what the live conneg server returns for Accept: text/html.
    const md = await renderResource(route.resource, 'hypertext', ctx)
    const html = htmlShell(path, md.body, toLinkHeader(md.links))
    writeFileSync(join(dir, 'index.html'), html, 'utf8')
    files++
  }
  // eslint-disable-next-line no-console
  console.log(
    `wrote ${files} face files (index.{html,md,ttl,jsonld,json}) for ${Object.keys(routes).length} resources → ${OUT}`,
  )
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})
