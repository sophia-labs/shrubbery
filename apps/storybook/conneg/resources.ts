/**
 * resources.ts — the REAL resource set the conneg server + static build expose.
 *
 * NO MOCKS: every resource is derived from real data —
 *   - the catalog collection + per-component items come from CATALOG_ENTRIES,
 *     which is itself derived from the component-library MANIFEST + the built
 *     chrome set (catalog-model.ts) — the SAME single catalog Storybook renders.
 *   - the workspace resource is GARDEN_DEFAULT (the canonical WorkspaceConfig).
 *
 * This is the seam between the tooling-level catalog (which knows the manifest +
 * the custom-element registry) and the pure @shrubbery/render package (which only
 * knows how to render a Resource to four faces). The render package never imports
 * the catalog; the host hands it these resources.
 *
 * App/tooling level — NOT in the pure library.
 */

import { GARDEN_DEFAULT } from '@shrubbery/nucleus'
import type {
  CatalogComponent,
  CatalogResource,
  ComponentResource,
  RenderCtx,
  Resource,
  WorkspaceResource,
} from '@shrubbery/render'
import { CATALOG_ENTRIES, isBuiltStatic, type CatalogEntry } from '../catalog/catalog-model.js'
import { snapshotVocabSummaries, vocabCatalogResource, vocabPackResource } from './emporium.js'

/** Map a real CatalogEntry → the render package's CatalogComponent shape. */
function toComponent(e: CatalogEntry): CatalogComponent {
  return {
    tag: e.tag,
    persistence: e.persistence,
    manifested: e.manifested,
    // STATIC built signal (DOM-free) — this tooling runs in plain node and must
    // not import the Lit components. isBuiltStatic agrees with the live registry
    // (catalog-coherence pins: chrome built, panels not).
    built: isBuiltStatic(e),
    face: e.face,
    blurb: e.blurb,
  }
}

/** The catalog COLLECTION resource — the third/fourth face of the one catalog. */
export function catalogResource(): CatalogResource {
  return {
    kind: 'catalog',
    id: 'catalog',
    title: 'Shrubbery Component Catalog',
    summary:
      'The component library, derived from the engine MANIFEST + the built chrome set — the third and fourth (curl-able) faces of the one catalog, alongside Storybook and the manifest.',
    components: CATALOG_ENTRIES.map(toComponent),
  }
}

/** One per-component item resource (the `…/catalog/{tag}` item face), or null. */
export function componentResource(tag: string): ComponentResource | null {
  const entry = CATALOG_ENTRIES.find((e) => e.tag === tag)
  if (!entry) return null
  return { kind: 'component', component: toComponent(entry) }
}

/** The workspace resource — GARDEN_DEFAULT rendered as a curl resource. */
export function workspaceResource(): WorkspaceResource {
  return { kind: 'workspace', config: GARDEN_DEFAULT }
}

/** A served route: the resource + the RenderCtx (self/up path) the host supplies. */
export interface Route {
  readonly resource: Resource
  readonly ctx: (baseUrl: string) => RenderCtx
}

/**
 * The complete static route table — one entry per resource the build writes /
 * the server serves. selfPath is extensionless (the conneg layer pins the face);
 * upPath drives rel=up. The catalog's item routes are generated from the entries.
 */
export function routeTable(): Record<string, Route> {
  const routes: Record<string, Route> = {
    '/catalog': {
      resource: catalogResource(),
      ctx: (baseUrl) => ({ baseUrl, selfPath: '/catalog', upPath: null }),
    },
    '/workspace': {
      resource: workspaceResource(),
      ctx: (baseUrl) => ({ baseUrl, selfPath: '/workspace', upPath: null }),
    },
    // EMPORIUM — the vocab catalogue (the catalogue OF vocabularies), pointed at
    // the captured-real registry; live read is the organism integration test.
    '/emporium': {
      resource: vocabCatalogResource(),
      ctx: (baseUrl) => ({ baseUrl, selfPath: '/emporium', upPath: null }),
    },
  }
  for (const e of CATALOG_ENTRIES) {
    const r = componentResource(e.tag)!
    routes[`/catalog/${e.tag}`] = {
      resource: r,
      ctx: (baseUrl) => ({ baseUrl, selfPath: `/catalog/${e.tag}`, upPath: '/catalog' }),
    }
  }
  // One item route per vocabulary pack (the golden-contract face).
  for (const v of snapshotVocabSummaries()) {
    const r = vocabPackResource(v.name)
    if (!r) continue
    routes[`/emporium/${v.name}`] = {
      resource: r,
      ctx: (baseUrl) => ({ baseUrl, selfPath: `/emporium/${v.name}`, upPath: '/emporium' }),
    }
  }
  return routes
}
