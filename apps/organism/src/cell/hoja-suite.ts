import { isEnabled, localFeatureOptIns } from '@shrubbery/source/features'
import { sophiaAppHref } from '@shrubbery/components/sophia-suite'

/**
 * The Garden app picker's link to the standalone Hoja notes app (/hoja/).
 * Gated by the `hoja-v2` feature: hosted = open to every session since
 * 2026-09-23 (features.ts); playground/desktop = off unless the build sets
 * `VITE_SHRUBBERY_FEATURES=hoja-v2`. An empty string hides the picker entry.
 */
export interface HojaSuiteHrefInput {
  readonly deploymentMode: 'hosted' | 'playground'
  /** Cognito sub of the current hosted session ('' when anonymous). */
  readonly userId: string | null | undefined
  readonly env: Readonly<Record<string, unknown>> | undefined
  /** Vite dev server: Hoja's own dev server is the target. */
  readonly dev: boolean
}

export function hojaSuiteHref(input: HojaSuiteHrefInput): string {
  const enabled = isEnabled('hoja-v2', {
    mode: input.deploymentMode === 'hosted' ? 'hosted' : 'local',
    userId: input.userId ?? null,
    localOptIns: localFeatureOptIns(input.env),
  })
  if (!enabled) return ''
  return input.dev ? 'http://127.0.0.1:5190/' : '/hoja/'
}

/** One suite app the Sophia top bar opens by navigation (mn-top-bar ChromeAppLink). */
export interface SuiteAppLink {
  readonly id: string
  readonly label: string
  readonly icon: string
  readonly href: string
}

export interface SuiteAppLinksInput extends HojaSuiteHrefInput {
  /** The workspace the user is in; every link lands in the same one (`?graph=`). */
  readonly graphId: string | null | undefined
  /** Apps this shell already renders as in-shell tabs (they need no link). */
  readonly shellApps?: readonly string[]
}

function featureSession(input: HojaSuiteHrefInput) {
  return {
    mode: input.deploymentMode === 'hosted' ? 'hosted' as const : 'local' as const,
    userId: input.userId ?? null,
    localOptIns: localFeatureOptIns(input.env),
  }
}

/** The Choreograph route (`/choreograph`) for the operator suite entry; '' when gated off. */
export function choreographSuiteHref(input: HojaSuiteHrefInput): string {
  return isEnabled('choreograph', featureSession(input)) ? '/choreograph' : ''
}

/**
 * The organism's cross-app links, gated here and pointed at the current
 * workspace: Hoja (`hoja-v2`) and — when the workspace config itself has no
 * Choreograph app — the Choreograph route (`choreograph`). Garden-only users
 * get none, so their picker lists Garden alone.
 */
export function suiteAppLinks(input: SuiteAppLinksInput): SuiteAppLink[] {
  const shell = new Set(input.shellApps ?? [])
  const links: SuiteAppLink[] = []
  const choreograph = choreographSuiteHref(input)
  if (choreograph && !shell.has('choreograph')) {
    links.push({ id: 'choreograph', label: 'Choreograph', icon: 'workflow', href: sophiaAppHref(choreograph, input.graphId) })
  }
  const hoja = hojaSuiteHref(input)
  if (hoja && !shell.has('hoja')) {
    links.push({ id: 'hoja', label: 'Hoja', icon: 'leaf', href: sophiaAppHref(hoja, input.graphId) })
  }
  return links
}

/**
 * The /choreograph route's links: Garden (always — the route is reached from
 * Garden and must lead back to the same workspace) and Hoja when permitted.
 */
export function choreographRouteAppLinks(input: SuiteAppLinksInput): SuiteAppLink[] {
  return [
    { id: 'garden', label: 'Garden', icon: 'sprout', href: sophiaAppHref('/', input.graphId) },
    ...suiteAppLinks({ ...input, shellApps: ['garden', 'choreograph'] }),
  ]
}
