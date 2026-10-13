/** Same-origin authentication navigation; does not establish an account cohort. */
import { settingsReturnPath } from './settings-navigation.js'

export function safeAuthReturnUrl(location: Pick<Location, 'href'> | URL): string {
  const url = location instanceof URL ? location : new URL(location.href)
  return settingsReturnPath(url)
}

export function hostedSignUpLocation(location: Pick<Location, 'href'> | URL): URL {
  const current = location instanceof URL ? location : new URL(location.href)
  const next = new URL('/signup', current.origin)
  const returnTo = safeAuthReturnUrl(current)
  if (returnTo !== '/') next.searchParams.set('returnTo', returnTo)
  return next
}
