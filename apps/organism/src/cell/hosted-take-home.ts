import type { MnSettingsSection } from '@shrubbery/components'

/**
 * Settings → Account → "Download my gardens" (self-host, 2026-10-12).
 *
 * This downloads every garden the person owns, as the raw gardend
 * folders (`README.md` + `graphs/<graph-id>/…`), to run on their own computer with gardend.
 *
 * The gateway streams a tar that can be several GB, which `fetch` cannot hand to the browser as a blob.
 * So: `POST /me/export/garden` with the session's bearer mints a short-lived, one-time link, and the browser
 * fetches that link itself in a hidden frame and saves the file natively. Not a same-tab navigation: that
 * fires `beforeunload`, which tears the workspace down even though the page never leaves.
 */

export const TAKE_HOME_ACTION = 'download-gardens'
export const TAKE_HOME_DESCRIPTION =
  'For running Sophia on your own computer: a copy of every garden you own, to open with gardend.'
/** The row beside the download: the public step-by-step guide, opened in a new tab. */
export const SELF_HOST_GUIDE_ACTION = 'self-host-guide'
export const SELF_HOST_GUIDE_URL =
  'https://github.com/sophia-labs/gardend/blob/main/docs/self-host-cloudflare-tunnel.md'
export const SELF_HOST_GUIDE_DESCRIPTION =
  'Step by step: install gardend, open your gardens, and reach them from your phone and your family.'
const DOWNLOAD_PATH = '/me/export/garden.tar'

export const TAKE_HOME_MESSAGES = {
  dailyLimit: 'You have already downloaded your gardens 3 times today. Try again tomorrow.',
  busy: 'Someone else is downloading their gardens right now. Try again in a few minutes.',
  nothingOwned: 'You do not own any gardens yet, so there is nothing to download.',
  signIn: 'Sign in again to download your gardens.',
  unavailable: 'Your gardens could not be downloaded right now. Try again in a few minutes.',
  unreachable: 'Sophia could not be reached. Check your connection and try again.',
} as const

const CODES: Readonly<Record<string, string>> = {
  take_home_daily_limit: TAKE_HOME_MESSAGES.dailyLimit,
  take_home_busy: TAKE_HOME_MESSAGES.busy,
  take_home_nothing_owned: TAKE_HOME_MESSAGES.nothingOwned,
  human_user_required: TAKE_HOME_MESSAGES.signIn,
}

interface TakeHomeAuth {
  userId(): string
  token(): string | null | undefined
  whenReady?(): Promise<void>
}

/** Open `url` in a new tab, with no way back into this page. */
export function openInNewTab(url: string): void {
  globalThis.open?.(url, '_blank', 'noopener,noreferrer')
}

/** Start a native download of `url` without leaving the page: a hidden frame the browser saves from. */
export function startFrameDownload(url: string, doc: Document = globalThis.document): void {
  const frame = doc.createElement('iframe')
  frame.hidden = true
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  frame.dataset.takeHome = ''
  frame.src = url
  doc.body.append(frame)
  // Long enough for the gateway to pin the gardens and send its headers; a download that has begun belongs
  // to the browser, not to this frame.
  globalThis.setTimeout(() => frame.remove(), 10 * 60_000)
}

async function errorCode(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json()
    const code = body && typeof body === 'object' ? (body as Record<string, unknown>).code : undefined
    return typeof code === 'string' ? code : ''
  } catch {
    return ''
  }
}

/** The account's take-home download (one gateway call, then the browser's own download) and its guide. */
export class HostedTakeHome {
  private readonly base: URL
  private readonly fetchImpl: typeof fetch
  private readonly listeners = new Set<() => void>()
  private pending = false
  private status = ''
  private error = ''

  constructor(
    private readonly auth: TakeHomeAuth,
    gatewayBaseUrl: string,
    fetchImpl: typeof fetch = globalThis.fetch,
    private readonly download: (url: string) => void = url => startFrameDownload(url),
    private readonly openGuideUrl: (url: string) => void = openInNewTab,
  ) {
    // Native browser fetch requires the Window receiver, not this service.
    this.fetchImpl = fetchImpl.bind(globalThis) as typeof fetch
    this.base = new URL(gatewayBaseUrl)
    if (!['https:', 'http:'].includes(this.base.protocol) || this.base.username || this.base.password || this.base.search || this.base.hash) {
      throw new Error('Invalid gateway URL')
    }
  }

  subscribe(callback: () => void): () => void {
    this.listeners.add(callback)
    return () => { this.listeners.delete(callback) }
  }

  private emit(): void { for (const listener of this.listeners) listener() }

  private async failure(response: Response): Promise<string> {
    const code = await errorCode(response)
    if (code && Object.hasOwn(CODES, code)) return CODES[code] as string
    if (response.status === 401 || response.status === 403) return TAKE_HOME_MESSAGES.signIn
    if (response.status === 429) return TAKE_HOME_MESSAGES.dailyLimit
    return TAKE_HOME_MESSAGES.unavailable
  }

  /** Open the self-host guide. Called straight from the click, so the browser allows the new tab. */
  openGuide(): void {
    this.openGuideUrl(SELF_HOST_GUIDE_URL)
  }

  /** Mint the one-time link, then hand it to the browser. Never throws: the outcome is a note on Account. */
  async start(): Promise<void> {
    if (this.pending) return
    this.pending = true; this.status = ''; this.error = ''; this.emit()
    try {
      try { await this.auth.whenReady?.() } catch { /* the request reports an absent session */ }
      const subject = this.auth.userId(), token = this.auth.token() ?? ''
      if (!subject || !token) throw new Error(TAKE_HOME_MESSAGES.signIn)
      let response: Response
      try {
        response = await this.fetchImpl(new URL('/me/export/garden', this.base).href, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30_000),
        })
      } catch { throw new Error(TAKE_HOME_MESSAGES.unreachable) }
      if (!response.ok) throw new Error(await this.failure(response))
      let body: Record<string, unknown>
      try { body = await response.json() as Record<string, unknown> } catch { throw new Error(TAKE_HOME_MESSAGES.unavailable) }
      const link = new URL(typeof body.url === 'string' ? body.url : '', this.base)
      if (link.origin !== this.base.origin || link.pathname !== DOWNLOAD_PATH || !link.searchParams.get('ticket')) {
        throw new Error(TAKE_HOME_MESSAGES.unavailable)
      }
      if (subject !== this.auth.userId() || token !== this.auth.token()) throw new Error(TAKE_HOME_MESSAGES.signIn)
      this.download(link.href)
      const count = typeof body.graphs === 'number' && Number.isSafeInteger(body.graphs) && body.graphs > 0 ? body.graphs : 0
      const what = count ? `${count} garden${count === 1 ? '' : 's'}` : 'your gardens'
      this.status = `Your download has started (${what}). Your browser saves it as a .tar file; `
        + 'the README inside says how to open it with gardend.'
    } catch (error) {
      this.error = error instanceof Error && error.message ? error.message : TAKE_HOME_MESSAGES.unavailable
    } finally {
      this.pending = false; this.emit()
    }
  }

  /** The Account section, with the download action first, the guide beside it, and the outcome as a note. */
  decorate(section: MnSettingsSection): MnSettingsSection {
    if (section.id !== 'account') return section
    return {
      ...section,
      actions: [
        {
          id: TAKE_HOME_ACTION,
          label: this.pending ? 'Preparing your download…' : 'Download my gardens',
          description: TAKE_HOME_DESCRIPTION,
          icon: 'download',
          disabled: this.pending,
        },
        {
          id: SELF_HOST_GUIDE_ACTION,
          label: 'How to run it yourself',
          description: SELF_HOST_GUIDE_DESCRIPTION,
          icon: 'external-link',
        },
        ...(section.actions ?? []),
      ],
      notes: [
        ...(section.notes ?? []),
        ...(this.status ? [this.status] : []),
        ...(this.error ? [this.error] : []),
      ],
    }
  }
}
