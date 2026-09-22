export * from './garden.js'
export * from './rdf.js'
export * from './types.js'

import { GARDEN_SITE_BUNDLE } from './garden.js'
import type { SiteBundle } from './types.js'

const BUNDLES: Readonly<Record<string, SiteBundle>> = Object.freeze({
  garden: GARDEN_SITE_BUNDLE,
})

export const SITE_BUNDLE_IDS = Object.freeze(Object.keys(BUNDLES))

export interface SiteInterpreterRegistration {
  readonly packageName: string
  readonly version: string
  readonly bundleId: string
}

const INTERPRETERS: readonly SiteInterpreterRegistration[] = Object.freeze(
  Object.values(BUNDLES).map((bundle) => Object.freeze({
    packageName: bundle.interpreter.packageName,
    version: bundle.interpreter.version,
    bundleId: bundle.id,
  })),
)

/** The exact interpreter tuples this code artifact can execute. This is a
 * closed registry: callers never receive a "latest" fallback. */
export function siteInterpreterCatalog(): readonly SiteInterpreterRegistration[] {
  return INTERPRETERS
}

export function siteBundleForInterpreter(packageName: string, version: string): SiteBundle {
  const registration = INTERPRETERS.find((candidate) =>
    candidate.packageName === packageName && candidate.version === version,
  )
  if (!registration) {
    throw new Error(`unsupported site interpreter '${packageName}@${version}'`)
  }
  return siteBundleFor(registration.bundleId)
}

export function siteBundleFor(id: string): SiteBundle {
  const bundle = BUNDLES[id]
  if (!bundle) {
    throw new Error(`unknown site bundle '${id}' — available: ${SITE_BUNDLE_IDS.join(', ')}`)
  }
  return bundle
}
