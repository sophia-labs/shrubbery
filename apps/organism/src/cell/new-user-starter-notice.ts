import type { MnToast } from '@shrubbery/components'
import type { StarterStartupNotice } from './new-user-starter-startup.js'

/** Body-owned chrome survives route renders; it never selects or retries a graph. */
export function makeStarterStartupNotice(doc: Document, openWorkspaces: () => void): {
  show(notice: StarterStartupNotice | null): void
  destroy(): void
} {
  let live: MnToast | null = null
  const destroy = () => { live?.remove(); live = null }
  return {
    show(notice) {
      destroy()
      if (!notice) return
      live = doc.createElement('mn-toast')
      live.setAttribute('data-starter-startup-notice', notice.kind)
      live.type = notice.kind === 'attention' ? 'warning' : 'info'
      live.position = 'top-right'
      live.message = notice.message
      live.description = notice.description
      live.actionText = 'Workspaces'
      live.duration = notice.kind === 'prepared' || notice.kind === 'unavailable' ? 8_000 : 0
      live.autoShow = false
      live.closable = true
      live.addEventListener('mn-action', openWorkspaces)
      doc.body.append(live)
      live.show()
    },
    destroy,
  }
}
