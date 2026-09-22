import { compareTriples, I, L, Lint, NS, type Triple, triplesToNT } from '@shrubbery/nucleus'
import type { SiteBundle, SitePublicationRoute, SiteSourceBinding } from './types.js'

export const SITE_NS = 'http://sophia.ai/site#'
export const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const XSD_DATE_TIME = 'http://www.w3.org/2001/XMLSchema#dateTime'
const XSD_LONG = 'http://www.w3.org/2001/XMLSchema#long'

const site = (local: string): string => SITE_NS + local
function assertGraphId(graphId: string): void {
  if (
    graphId.length === 0
    || graphId.length > 40
    || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(graphId)
  ) {
    throw new Error(
      `graphId must match platform-next's canonical lowercase slug grammar (got '${graphId}')`,
    )
  }
}

function assertOwnerPrincipal(owner: string, field: string): void {
  const separator = owner.indexOf(':')
  const kind = separator >= 0 ? owner.slice(0, separator) : ''
  const subject = separator >= 0 ? owner.slice(separator + 1) : ''
  if (
    !['user', 'agent', 'service', 'organization'].includes(kind)
    || subject.length === 0
    || subject.length > 192
    || !/^[A-Za-z0-9_.@:-]+$/.test(subject)
  ) {
    throw new Error(`${field} must be an exact typed owner principal (got '${owner}')`)
  }
}

const graphSubject = (graphId: string): string => {
  assertGraphId(graphId)
  return `urn:mnemosyne:local:graph:${graphId}`
}

export function siteProjectionGraphIri(graphId: string): string {
  return `${graphSubject(graphId)}:projection:site`
}

/** Reference the node identity the existing Nucleus layout serializer
 * actually emits. The site pack extends that deployed layout by reference; it
 * does not mint a parallel alias universe that cannot be dereferenced. */
export function uxNodeIri(localId: string): string {
  return `${NS.sux}${encodeURIComponent(localId)}`
}

function instance(graphId: string, kind: string, id: string): string {
  return `${graphSubject(graphId)}:projection:site:${kind}:${encodeURIComponent(id)}`
}

export function siteDefinitionIri(graphId: string, bundleId: string): string {
  return instance(graphId, 'definition', bundleId)
}

function assertAbsoluteIri(value: string, field: string): void {
  try {
    const url = new URL(value)
    if (!url.protocol) throw new Error('missing scheme')
  } catch {
    throw new Error(`${field} must be an absolute, redacted IRI (got '${value}')`)
  }
}

function valueNodeId(bundle: SiteBundle, dimensionId: string, literalValue: string): string {
  const dimension = bundle.layout.dimensions[dimensionId]
  const value = dimension?.values.find((candidate) => candidate.literalValue === literalValue)
  if (!value) {
    throw new Error(`site bundle '${bundle.id}' cannot resolve ${dimensionId} value '${literalValue}'`)
  }
  return value.id
}

/** Materialize the registered shrubbery-site projection from a code-reviewed
 * bundle. Garden's Emporium pack is the only live writer of these triples. */
export function siteProjectionTriples(
  bundle: SiteBundle,
  graphId: string,
  source?: SiteSourceBinding,
): readonly Triple[] {
  const out: Triple[] = []
  const add = (s: string, p: string, o: ReturnType<typeof I> | ReturnType<typeof L>): void => {
    out.push({ s, p, o })
  }
  const typed = (subject: string, className: string): void => add(subject, RDF_TYPE, I(site(className)))

  const definition = siteDefinitionIri(graphId, bundle.id)
  typed(definition, 'SiteDefinition')
  add(definition, site('bundleId'), L(bundle.id))
  add(definition, site('bundleVersion'), L(bundle.version))
  add(definition, site('interpreterPackage'), L(bundle.interpreter.packageName))
  add(definition, site('interpreterVersion'), L(bundle.interpreter.version))
  add(definition, site('layoutSeedSha256'), L(bundle.layoutSeedSha256))

  for (const surface of bundle.surfaces) {
    const subject = instance(graphId, 'surface', surface.id)
    typed(subject, 'Surface')
    add(subject, site('label'), L(surface.label))
    add(subject, site('workspace'), I(uxNodeIri(bundle.layout.id)))
    if (surface.entryRegion) add(subject, site('entryRegion'), I(uxNodeIri(surface.entryRegion)))
    for (const panel of surface.presentsPanels ?? []) {
      add(subject, site('presentsPanel'), I(uxNodeIri(panel)))
    }
  }

  for (const route of bundle.routes) {
    const subject = instance(graphId, 'route', route.id)
    typed(subject, 'Route')
    add(subject, site('path'), L(route.path))
    add(subject, site('label'), L(route.label))
    add(subject, site('order'), Lint(route.order))
    add(subject, site('surface'), I(instance(graphId, 'surface', route.surface)))
    add(subject, site('appValue'), I(uxNodeIri(valueNodeId(bundle, 'dim-app', route.app))))
    const appRoots = bundle.layout.appRootRegions?.[route.app]
    if (appRoots && appRoots.length > 0) {
      add(subject, site('appRootEntry'), I(uxNodeIri(`${bundle.layout.id}-approot-${route.app}-0`)))
    }
  }

  const themeSubject = instance(graphId, 'theme', 'default')
  typed(themeSubject, 'Theme')
  add(themeSubject, site('label'), L(`${bundle.title} appearance`))
  add(themeSubject, site('themeDimension'), I(uxNodeIri('dim-theme')))
  add(themeSubject, site('skinDimension'), I(uxNodeIri('dim-skin')))
  add(themeSubject, site('defaultThemeValue'), I(uxNodeIri(
    valueNodeId(bundle, 'dim-theme', bundle.appearance.defaultTheme),
  )))
  add(themeSubject, site('defaultSkinValue'), I(uxNodeIri(
    valueNodeId(bundle, 'dim-skin', bundle.appearance.defaultSkin),
  )))

  for (const binding of bundle.components) {
    const subject = instance(graphId, 'component-binding', binding.tag)
    typed(subject, 'ComponentBinding')
    add(subject, site('componentTag'), L(binding.tag))
    add(subject, site('npmPackage'), L(binding.npmPackage))
    add(subject, site('minVersion'), L(binding.minVersion))
    add(subject, site('persistenceClass'), L(binding.persistence))
  }

  const pack = instance(graphId, 'pack-provenance', bundle.id)
  typed(pack, 'PackProvenance')
  add(pack, site('packName'), L(bundle.packName))
  add(pack, site('packVersion'), L(bundle.packVersion))
  add(pack, site('contentSha'), L(bundle.layoutSeedSha256))
  add(pack, site('witness'), L('@shrubbery/site code-reviewed bundle'))

  if (source) {
    assertAbsoluteIri(source.endpoint, 'SiteSourceBinding.endpoint')
    assertGraphId(source.graphId)
    if (source.graphId !== graphId) {
      throw new Error(
        `SiteSourceBinding.graphId must equal the projection graph target (got '${source.graphId}', expected '${graphId}')`,
      )
    }
    const subject = instance(graphId, 'content-source', 'layout')
    typed(subject, 'ContentSource')
    add(subject, site('endpoint'), I(source.endpoint))
    if (source.ownerPrincipal) {
      assertOwnerPrincipal(source.ownerPrincipal, 'SiteSourceBinding.ownerPrincipal')
      add(subject, site('ownerPrincipal'), L(source.ownerPrincipal))
    }
    add(subject, site('graphId'), L(source.graphId))
    if (source.graphIri) {
      assertAbsoluteIri(source.graphIri, 'SiteSourceBinding.graphIri')
      add(subject, site('graphIri'), I(source.graphIri))
    }
    add(subject, site('authMode'), L(source.authMode))
    add(subject, site('liveness'), L(source.liveness))
    if (source.observer) add(subject, site('observer'), L(source.observer))
    if (source.readAt !== undefined) add(subject, site('readAt'), L(new Date(source.readAt).toISOString(), XSD_DATE_TIME))
    if (source.tripleCount !== undefined) add(subject, site('tripleCount'), L(String(source.tripleCount), XSD_LONG))
  }

  return out.sort(compareTriples)
}

/** Materialize one host-owned publication route in a registry graph. The
 * bundle supplies interpreter identity; an untrusted caller cannot smuggle a
 * different renderer into the route record. Published routes require an
 * explicit human (`user:`) approval witness. */
export function sitePublicationRouteTriples(
  registryGraphId: string,
  bundle: SiteBundle,
  route: SitePublicationRoute,
): readonly Triple[] {
  assertGraphId(registryGraphId)
  assertGraphId(route.graphId)
  assertOwnerPrincipal(route.ownerPrincipal, 'SitePublicationRoute.ownerPrincipal')
  if (!['unlisted', 'published', 'retired'].includes(route.state)) {
    throw new Error(`SitePublicationRoute.state is not a closed publication state (got '${route.state}')`)
  }
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(route.publicName)) {
    throw new Error(`SitePublicationRoute.publicName is not a canonical route name (got '${route.publicName}')`)
  }
  if (!route.pathPrefix.startsWith('/') || /\s|\.\./.test(route.pathPrefix)) {
    throw new Error(`SitePublicationRoute.pathPrefix must be an absolute safe path (got '${route.pathPrefix}')`)
  }
  if (route.state === 'published') {
    if (!route.approvedBy?.startsWith('user:') || !route.approvedAt) {
      throw new Error('a published site route requires approvedBy=user:<subject> and approvedAt')
    }
    assertOwnerPrincipal(route.approvedBy, 'SitePublicationRoute.approvedBy')
    if (Number.isNaN(Date.parse(route.approvedAt))) {
      throw new Error('SitePublicationRoute.approvedAt must be an ISO dateTime')
    }
  }

  const subject = instance(registryGraphId, 'publication-route', route.id)
  const out: Triple[] = [
    { s: subject, p: RDF_TYPE, o: I(site('PublicationRoute')) },
    { s: subject, p: site('publicName'), o: L(route.publicName) },
    { s: subject, p: site('pathPrefix'), o: L(route.pathPrefix) },
    { s: subject, p: site('ownerPrincipal'), o: L(route.ownerPrincipal) },
    { s: subject, p: site('graphId'), o: L(route.graphId) },
    { s: subject, p: site('siteDefinition'), o: I(siteDefinitionIri(route.graphId, bundle.id)) },
    { s: subject, p: site('interpreterPackage'), o: L(bundle.interpreter.packageName) },
    { s: subject, p: site('interpreterVersion'), o: L(bundle.interpreter.version) },
    { s: subject, p: site('publicationState'), o: L(route.state) },
  ]
  if (route.approvedBy) out.push({ s: subject, p: site('approvedBy'), o: L(route.approvedBy) })
  if (route.approvedAt) {
    out.push({ s: subject, p: site('approvedAt'), o: L(route.approvedAt, XSD_DATE_TIME) })
  }
  return out.sort(compareTriples)
}

export function siteProjectionNt(
  bundle: SiteBundle,
  graphId: string,
  source?: SiteSourceBinding,
): string {
  return `${triplesToNT(siteProjectionTriples(bundle, graphId, source))}\n`
}
