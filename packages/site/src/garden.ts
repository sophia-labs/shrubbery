import {
  COMPONENT_LIBRARY,
  GARDEN_DEFAULT,
  type Persistence,
  persistenceOf,
} from '@shrubbery/nucleus'
import {
  type EditorMaterial,
  type Theme,
  VISUAL_IDENTITY_SKINS,
} from '@shrubbery/tokens'
import { SITE_BUNDLE_SCHEMA, type SiteBundle, type SiteComponentBinding } from './types.js'

/** sha256 of the body bytes in the canonical 275-triple Garden seed. A test
 * hashes the artifact, so a legitimate layout edit forces this
 * provenance pin to move with it. */
export const GARDEN_LAYOUT_SEED_SHA256 = 'c00aa0a84a386ea02046d43e614d2cff3d04170636c18a9731e9fe543a606cd1'

const LIVE_HOST_TAGS = new Set(['mn-top-bar', 'mn-bottom-bar', 'mn-sidebar-panel', 'mn-comments-panel', 'mn-graph-panel', 'mn-inspector', 'wf-studio-shell'])
const SERVICE_BOUND_TAGS = new Map<string, string>([
  ['mn-document-editor', 'requires the EditorHostBinding + document/CRDT contract'],
  ['mn-chat-panel', 'requires a ChatService session contract'],
  ['mn-wires-panel', 'requires the wire bundle and context contracts'],
])

function packageFor(tag: string): string {
  if (tag === 'app-shell' || SERVICE_BOUND_TAGS.has(tag)) return '@shrubbery/runtime'
  return '@shrubbery/components'
}

function configuredTags(): readonly string[] {
  const tags = new Set<string>([GARDEN_DEFAULT.renderedByComponent])
  for (const region of Object.values(GARDEN_DEFAULT.regions)) {
    if (region.renderedByComponent) tags.add(region.renderedByComponent)
  }
  for (const panel of Object.values(GARDEN_DEFAULT.panels)) tags.add(panel.renderedByComponent)
  return [...tags].sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
}

function bindingFor(tag: string): SiteComponentBinding {
  const deferred = SERVICE_BOUND_TAGS.get(tag)
  const persistence: Persistence = persistenceOf(tag)
  return {
    tag,
    npmPackage: packageFor(tag),
    minVersion: '0.0.0',
    persistence,
    hostStatus: deferred ? 'deferred' : 'supported',
    ...(deferred ? { note: deferred } : {}),
  }
}

const themes = ['light', 'dark'] as const satisfies readonly Theme[]
const editorMaterials = ['continuous', 'paper', 'classic-word'] as const satisfies readonly EditorMaterial[]

export const GARDEN_SITE_BUNDLE: SiteBundle = Object.freeze({
  schema: SITE_BUNDLE_SCHEMA,
  id: 'garden',
  title: 'Garden',
  version: '0.1.0-local',
  packName: 'shrubbery-site',
  packVersion: '0.2.1',
  interpreter: {
    packageName: '@shrubbery/planter',
    version: '0.0.0',
  },
  layout: GARDEN_DEFAULT,
  layoutSeedSha256: GARDEN_LAYOUT_SEED_SHA256,
  surfaces: [
    {
      id: 'home',
      label: 'Garden Home',
      entryRegion: 'region-center',
      presentsPanels: ['panel-sidebar'],
    },
    {
      id: 'workspace',
      label: 'Garden Workspace',
      entryRegion: 'region-left-rail',
      presentsPanels: Object.keys(GARDEN_DEFAULT.panels).sort(),
    },
  ],
  routes: [
    { id: 'home', path: '/', label: 'Home', order: 0, surface: 'home', app: 'garden', view: 'home' },
    { id: 'home-alias', path: '/home', label: 'Home', order: 1, surface: 'home', app: 'garden', view: 'home' },
    { id: 'workspace', path: '/workspace', label: 'Workspace', order: 2, surface: 'workspace', app: 'garden', view: 'workspace' },
  ],
  faces: [
    { target: 'markdown', suffix: '.md', mediaType: 'text/markdown; charset=utf-8' },
    { target: 'turtle', suffix: '.ttl', mediaType: 'text/turtle; charset=utf-8' },
    { target: 'jsonld', suffix: '.json', mediaType: 'application/ld+json; charset=utf-8' },
    { target: 'html', suffix: '.html', mediaType: 'text/html; charset=utf-8' },
  ],
  appearance: {
    skins: [...VISUAL_IDENTITY_SKINS],
    themes,
    editorMaterials,
    defaultSkin: 'garden',
    defaultTheme: 'light',
    defaultEditorMaterial: 'continuous',
  },
  panels: {
    left: { min: 180, default: 280, max: 500, snap: '180px 280px 500px' },
    right: { min: 240, default: 420, max: 500, snap: '240px 420px 500px' },
    snapThreshold: 24,
  },
  components: configuredTags().map(bindingFor),
  features: [
    { id: 'layout-live-read', state: 'supported', note: 'Workspace layout is read from the bound TripleSource and polled with testimony.' },
    { id: 'four-faces', state: 'supported', note: 'Markdown, Turtle, JSON-LD and HTML are rendered from the same live read.' },
    { id: 'garden-home', state: 'supported', note: 'The controlled Garden home shell renders graph identity without fabricating document data.' },
    { id: 'appearance', state: 'supported', note: 'Garden, Sophia, 98 and Glass skins; light/dark; continuous/paper/classic-word material.' },
    { id: 'panel-layout', state: 'supported', note: 'Controlled widths, collapse/expand and Garden discrete snap points.' },
    { id: 'documents-editor', state: 'deferred', note: 'No document/CRDT authority exists in TripleSource.', laterContract: 'EditorHostBinding + document CRDT contract' },
    { id: 'daily-notes', state: 'deferred', note: 'Daily-note lookup/create is a write-capable product service.', laterContract: 'document service + write authority' },
    { id: 'settings', state: 'deferred', note: 'Settings, local AI and keychain secrets require native/hosted operations contracts.', laterContract: 'settings service + secret store' },
    { id: 'site-write', state: 'supported', note: 'Garden Emporium owns projection:site; callers submit typed records through its dry-run/apply/replay boundary.' },
    { id: 'ea3-publication', state: 'supported', note: 'The shrubbery-site 0.2.1 vocabulary is registered as Garden internal substrate.' },
  ],
  publication: {
    state: 'registered',
    writeTarget: 'projection:site',
    note: 'Garden owns the reserved projection. Public route publication remains a human-approved host effect.',
  },
} satisfies SiteBundle)

/** Every code-level component binding must either be a known component-library
 * row or an explicitly explained host/service seam. */
export function gardenBindingIsAccountedFor(binding: SiteComponentBinding): boolean {
  return binding.tag === 'app-shell' || LIVE_HOST_TAGS.has(binding.tag) || SERVICE_BOUND_TAGS.has(binding.tag) || Boolean(COMPONENT_LIBRARY[binding.tag])
}
