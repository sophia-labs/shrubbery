import type { AppId, Persistence, WorkspaceConfig } from '@shrubbery/nucleus'
import type { EditorMaterial, Theme, VisualIdentitySkin } from '@shrubbery/tokens'

export const SITE_BUNDLE_SCHEMA = 'shrubbery-site-bundle/v1' as const

export type SiteFaceTarget = 'markdown' | 'turtle' | 'jsonld' | 'html'
export type SiteRouteView = 'workspace' | 'home'
export type SiteFeatureState = 'supported' | 'deferred'

export interface SiteFace {
  readonly target: SiteFaceTarget
  readonly suffix: '.md' | '.ttl' | '.json' | '.html'
  readonly mediaType: string
}

export interface SiteSurface {
  readonly id: string
  readonly label: string
  readonly entryRegion?: string
  readonly presentsPanels?: readonly string[]
}

export interface SiteRoute {
  readonly id: string
  readonly path: string
  readonly label: string
  readonly order: number
  readonly surface: string
  readonly app: AppId
  readonly view: SiteRouteView
}

export interface SiteAppearancePosture {
  readonly skins: readonly VisualIdentitySkin[]
  readonly themes: readonly Theme[]
  readonly editorMaterials: readonly EditorMaterial[]
  readonly defaultSkin: VisualIdentitySkin
  readonly defaultTheme: Theme
  readonly defaultEditorMaterial: EditorMaterial
}

export interface SitePanelPosture {
  readonly left: { readonly min: number; readonly default: number; readonly max: number; readonly snap: string }
  readonly right: { readonly min: number; readonly default: number; readonly max: number; readonly snap: string }
  readonly snapThreshold: number
}

export interface SiteComponentBinding {
  readonly tag: string
  readonly npmPackage: string
  readonly minVersion: string
  readonly persistence: Persistence
  /** Whether the generic read/host slice can give this tag its live service binding. */
  readonly hostStatus: SiteFeatureState
  readonly note?: string
}

/** Exact code interpreter selected by graph data. A deployment may map this
 * pair to an immutable image digest, but it may never silently substitute a
 * different package version for an existing site. */
export interface SiteInterpreterPin {
  readonly packageName: string
  readonly version: string
}

export interface SiteFeaturePosture {
  readonly id: string
  readonly state: SiteFeatureState
  readonly note: string
  readonly laterContract?: string
}

export interface SiteBundle {
  readonly schema: typeof SITE_BUNDLE_SCHEMA
  readonly id: string
  readonly title: string
  readonly version: string
  readonly packName: 'shrubbery-site'
  readonly packVersion: string
  readonly interpreter: SiteInterpreterPin
  readonly layout: WorkspaceConfig
  readonly layoutSeedSha256: string
  readonly surfaces: readonly SiteSurface[]
  readonly routes: readonly SiteRoute[]
  readonly faces: readonly SiteFace[]
  readonly appearance: SiteAppearancePosture
  readonly panels: SitePanelPosture
  readonly components: readonly SiteComponentBinding[]
  readonly features: readonly SiteFeaturePosture[]
  readonly publication: {
    readonly state: 'registered'
    readonly writeTarget: 'projection:site'
    readonly note: string
  }
}

/** Runtime testimony that can be projected as a site:ContentSource. Credentials
 * are deliberately absent. `endpoint` must already be an absolute, redacted IRI. */
export interface SiteSourceBinding {
  readonly endpoint: string
  /** Exact cloud owner. Required by hosted Planter; absent for local/static sources. */
  readonly ownerPrincipal?: string
  readonly graphId: string
  readonly graphIri?: string
  readonly authMode: 'none' | 'dev' | 'cognito' | 'service'
  readonly liveness: 'static' | 'poll' | 'push'
  readonly observer?: string
  readonly readAt?: number
  readonly tripleCount?: number
}

export type SitePublicationState = 'unlisted' | 'published' | 'retired'

/** Host-authored route intent. The target is always the exact owner+graph
 * tuple; interpreter facts are derived from the SiteBundle, never accepted
 * from an agent proposal. */
export interface SitePublicationRoute {
  readonly id: string
  readonly publicName: string
  readonly pathPrefix: string
  readonly ownerPrincipal: string
  readonly graphId: string
  readonly state: SitePublicationState
  readonly approvedBy?: string
  readonly approvedAt?: string
}

export function routeFor(bundle: SiteBundle, pathname: string): SiteRoute {
  const exact = bundle.routes.find((route) => route.path === pathname)
  if (exact) return exact
  const root = bundle.routes.find((route) => route.path === '/')
  if (!root) throw new Error(`site bundle '${bundle.id}' has no '/' route`)
  return root
}

export function featureFor(bundle: SiteBundle, id: string): SiteFeaturePosture | undefined {
  return bundle.features.find((feature) => feature.id === id)
}
