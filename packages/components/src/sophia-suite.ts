/**
 * sophia-suite — the one app catalogue every Sophia top bar draws from.
 *
 * Garden, Choreograph and Hoja (and Grapevine / Flow where a shell
 * composes them) share one `<mn-top-bar>`: the same picker, the same order,
 * the same names and tiles. What an app bar is ALLOWED to list (the audience
 * gate) stays with each shell — this module never decides who sees what. It
 * only fixes how a permitted app is named, drawn, ordered and linked, so two
 * shells that permit the same apps render the same launcher.
 *
 * Backend-free: pure data + pure functions. No lit, no stores, no features.
 */

/**
 * Release stage shown beside an app's name in the launcher. Absent = a
 * released app with no tag. Data, not a special case: any catalogue entry (or
 * a shell's ChromeAppTab) may carry one.
 */
export type SophiaAppStage = 'experimental' | 'beta' | 'preview'

/** Launcher identity for one app. */
export interface SophiaAppIdentity {
  readonly id: string
  readonly label: string
  /** An icons.ts glyph name. */
  readonly icon: string
  /** One line for the launcher. */
  readonly description: string
  /** Release stage tag for the launcher (see SophiaAppStage). */
  readonly stage?: SophiaAppStage
}

/**
 * Canonical order. Garden leads (the default app); in-graph apps follow; the
 * standalone suite apps close the list. An id not listed here sorts after
 * every known one, keeping the order it was given in.
 */
export const SOPHIA_APP_ORDER: readonly string[] = Object.freeze([
  'garden',
  'choreograph',
  'grapevine',
  'flow',
  'hoja',
])

export const SOPHIA_APPS: Readonly<Record<string, SophiaAppIdentity>> = Object.freeze({
  garden: { id: 'garden', label: 'Garden', icon: 'sprout', description: 'Notes, documents and the knowledge graph' },
  choreograph: { id: 'choreograph', label: 'Choreograph', icon: 'workflow', description: 'Agents, runs and workflows' },
  grapevine: { id: 'grapevine', label: 'Grapevine', icon: 'message-circle', description: 'Conversations with your agents' },
  flow: { id: 'flow', label: 'Flow', icon: 'network', description: 'Mithras Flow: systems, requirements and trades on one board' },
  hoja: { id: 'hoja', label: 'Hoja', icon: 'leaf', description: 'A quiet place for your notes', stage: 'experimental' },
  ovillo: { id: 'ovillo', label: 'Ovillo', icon: 'ovillo', description: 'Pieces played by Ariadne Worlds, and their energy', stage: 'experimental' },
})

/** The catalogue identity for an id; an unknown id gets a title-cased label and a generic tile. */
export function sophiaApp(id: string): SophiaAppIdentity {
  const known = SOPHIA_APPS[id]
  if (known) return known
  return {
    id,
    label: id.length > 0 ? id.charAt(0).toUpperCase() + id.slice(1) : id,
    icon: 'layers',
    description: '',
  }
}

/** The accessible name for an app in the launcher: "Hoja (experimental)" when staged. */
export function sophiaAppAccessibleName(label: string, stage: string | null | undefined): string {
  return stage ? `${label} (${stage})` : label
}

/** Sort entries by the canonical order; unknown ids keep their relative order at the end. */
export function orderSophiaApps<T extends { readonly id: string }>(entries: readonly T[]): T[] {
  const rank = (id: string): number => {
    const index = SOPHIA_APP_ORDER.indexOf(id)
    return index === -1 ? SOPHIA_APP_ORDER.length : index
  }
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => rank(a.entry.id) - rank(b.entry.id) || a.index - b.index)
    .map(({ entry }) => entry)
}

/**
 * A cross-app URL that lands in the same workspace: `base` with `?graph=<id>`
 * set (any other query the base carries is kept). Relative bases stay
 * relative; an empty graph id returns the base untouched.
 */
export function sophiaAppHref(base: string, graphId: string | null | undefined): string {
  const graph = graphId?.trim() ?? ''
  if (!base || !graph) return base
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(base)
  const url = new URL(base, 'http://sophia.invalid')
  url.searchParams.set('graph', graph)
  if (absolute) return url.href
  return `${url.pathname}${url.search}${url.hash}`
}
