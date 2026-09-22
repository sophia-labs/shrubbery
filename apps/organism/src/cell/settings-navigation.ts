/** Pure URL policy for entering and leaving the full-page Settings route. */

function localPath(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * Build a Settings URL without discarding the active local-cell workspace.
 * Credentials remain proxy-owned; only the non-secret graph selector crosses
 * the navigation boundary.
 */
export function settingsNavigationUrl(current: URL, graphId?: string | null): URL {
  const next = new URL('/settings', current.origin)
  const graph = graphId?.trim() ?? ''
  if (graph) {
    next.searchParams.set('source', 'cell')
    next.searchParams.set('graph', graph)
  }
  const returnTo = localPath(current)
  if (returnTo !== '/') next.searchParams.set('returnTo', returnTo)
  return next
}

/** Resolve the graph whose authenticated local-cell contract Settings should use. */
export function settingsCellGraph(url: URL): string | null {
  const path = url.pathname.replace(/\/+$/, '') || '/'
  if (path !== '/settings' || url.searchParams.get('source') !== 'cell') return null
  return url.searchParams.get('graph')?.trim() || null
}

/** Only same-origin path-shaped return locations are accepted. */
export function settingsReturnPath(url: URL): string {
  const requested = url.searchParams.get('returnTo')?.trim() ?? ''
  if (
    !requested.startsWith('/')
    || requested.startsWith('//')
    || requested.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(requested)
  ) return '/'
  try {
    const resolved = new URL(requested, url.origin)
    return resolved.origin === url.origin
      ? `${resolved.pathname}${resolved.search}${resolved.hash}`
      : '/'
  } catch {
    return '/'
  }
}
