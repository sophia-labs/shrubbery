/** In-memory browser identity for the dev-only server-side cloud-2 proxy. */
import type { AuthStorage, CognitoTokenSet } from './cognito-auth-session.js'

const STORAGE_KEY = 'shrubbery.cognito.tokens.v1'

function base64UrlJson(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

/**
 * The token is deliberately inert: Vite's server-only proxy replaces it with
 * the real service credential. It exists only so the normal hosted Garden boot
 * path can carry the same subject locally without teaching production auth a
 * second credential type.
 */
export function createDevServiceProxyAuthStorage(subject: string, now = Date.now()): AuthStorage {
  const normalized = subject.trim()
  if (!normalized || [...normalized].some(character => {
    const code = character.charCodeAt(0)
    return code <= 0x1f || code === 0x7f
  })) {
    throw new Error('Cloud-2 development proxy subject is invalid')
  }
  const expiresAt = now + 24 * 60 * 60 * 1_000
  const idToken = `${base64UrlJson({ alg: 'none', typ: 'JWT' })}.${base64UrlJson({
    sub: normalized,
    username: 'cloud2-local-agent',
    exp: Math.floor(expiresAt / 1_000),
  })}.development-proxy`
  const tokens: CognitoTokenSet = {
    accessToken: 'development-proxy',
    idToken,
    refreshToken: 'development-proxy-no-refresh',
    expiresAt,
  }
  let raw: string | null = JSON.stringify(tokens)
  return {
    getItem(key) { return key === STORAGE_KEY ? raw : null },
    setItem(key, value) { if (key === STORAGE_KEY) raw = value },
    removeItem(key) { if (key === STORAGE_KEY) raw = null },
  }
}
