/**
 * Share-link landing: `https://<garden>/#share=shr_…`.
 *
 * The token rides the URL fragment so it never reaches a server log or a
 * Referer header. On a signed-in hosted boot this module removes the fragment
 * from history *before* any network call, redeems the token through the
 * gateway (which grants this account the link's role), and points the page at
 * the joined graph. Signed-out visitors keep the fragment through sign-in,
 * because the sign-in return path preserves `location.hash`.
 */

import type { MnToast } from '@shrubbery/components'
import { t } from '@shrubbery/nucleus'
import { shareTokenFromHash, type ControlRedeemedShareLink } from '@shrubbery/source/access-control'

export interface ShareLinkRedeemer {
  redeemShareLink(token: string): Promise<ControlRedeemedShareLink>
}

export type ShareLinkLanding =
  | { readonly kind: 'joined', readonly graphId: string, readonly owner: string, readonly role: 'viewer' | 'editor' }
  | { readonly kind: 'failed', readonly message: string }

export interface ShareLinkLandingOptions {
  readonly location: URL
  readonly gateway: ShareLinkRedeemer
  /** Replace the current history entry (no navigation). */
  readonly replaceUrl: (url: URL) => void
}

function withoutShareFragment(location: URL): URL {
  const url = new URL(location.href)
  const params = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash)
  params.delete('share')
  const rest = params.toString()
  url.hash = rest ? `#${rest}` : ''
  return url
}

function failureMessage(error: unknown): string {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined
  if (code === -32004) return 'This share link has expired, was revoked, or does not exist. Ask the owner for a new one.'
  if (code === -32003) return 'This share link could not be used from this session.'
  if (code === -32009) return 'You already own this workspace.'
  return error instanceof Error ? error.message : String(error)
}

/** Returns null when the location carries no share fragment. */
export async function redeemShareLinkFromLocation(options: ShareLinkLandingOptions): Promise<ShareLinkLanding | null> {
  const raw = options.location.hash
  const hasFragment = new URLSearchParams(raw.startsWith('#') ? raw.slice(1) : raw).has('share')
  if (!hasFragment) return null
  const token = shareTokenFromHash(raw)
  const cleaned = withoutShareFragment(options.location)
  // Scrub first: a failed or slow redemption must not leave the bearer token
  // in history, bookmarks, or a copied address bar.
  options.replaceUrl(cleaned)
  if (!token) return { kind: 'failed', message: 'This share link is malformed or incomplete.' }
  try {
    const joined = await options.gateway.redeemShareLink(token)
    // Both roles land in the joined graph: an Editor to edit it, a Viewer to read it (viewer mode).
    const target = new URL(cleaned.href)
    target.searchParams.set('graph', joined.graphId)
    target.searchParams.delete('graph_id')
    // A joined graph is another account's (redeeming one's own link is refused): name its owner, since the
    // account may hold a graph with the same id.
    target.searchParams.set('owner', joined.owner)
    options.replaceUrl(target)
    return { kind: 'joined', graphId: joined.graphId, owner: joined.owner, role: joined.role }
  } catch (error) {
    return { kind: 'failed', message: failureMessage(error) }
  }
}

/** A body-owned toast reporting the landing outcome. */
export function showShareLinkLanding(doc: Document, landing: ShareLinkLanding): MnToast {
  const toast = doc.createElement('mn-toast')
  toast.setAttribute('data-share-link-landing', landing.kind)
  toast.type = landing.kind === 'joined' ? 'success' : 'warning'
  toast.position = 'top-right'
  const viewer = landing.kind === 'joined' && landing.role === 'viewer'
  toast.message = landing.kind === 'joined'
    ? viewer ? t('sharing.joinedViewer', { name: landing.graphId }) : 'You joined this workspace'
    : 'Share link not accepted'
  toast.description = landing.kind === 'joined'
    ? viewer
      ? t('sharing.joinedViewerDetail')
      : `You can view and edit ${landing.graphId}. It now appears in your workspaces.`
    : landing.message
  toast.duration = 10_000
  toast.autoShow = false
  toast.closable = true
  doc.body.append(toast)
  toast.show()
  return toast
}
