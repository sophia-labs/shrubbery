/**
 * navigation-service.ts — NavigationService: the host-side seam for "open another
 * document" (the wikilink-click target).
 *
 * Garden's wikilink click went `sessionStore.getState().setActiveDocument(...)` +
 * a block-focus dispatch (document-editor.ts::handleWikiLinkClick). That couples the
 * editor to the session store. Here it is a single-method seam the shell injects:
 * openDocument(graphId, documentId, blockId?). The kernel never sees it — buildKernelOptions
 * adapts it into the pure `onWikiLinkClick` callback.
 *
 * DEFAULT (eventNavigationService): dispatch a DOM CustomEvent('shrubbery:open-document')
 * the shell listens for. This is the honest no-shell-wiring-yet default — the event is
 * REAL (a real CustomEvent on a real EventTarget), but the shell-side LISTENER that turns
 * it into an actual navigation is DEFERRED (a later real-shell rung), NOT faked here.
 *
 * ISLAND NOTE: this lives in the editor-services/ SUBDIR (not top-level src/*.ts), so the
 * non-recursive island guard does not scan it — exactly like collab/live-editor.ts. The
 * host binding imports it via a './'-relative subdir specifier, which passes the guard.
 */

/** The detail payload of the shrubbery:open-document CustomEvent. */
export interface OpenDocumentDetail {
  readonly graphId: string
  readonly documentId: string
  /** Optional target block to scroll/focus after the document opens. */
  readonly blockId?: string
}

/** The event name the default NavigationService dispatches; the shell listens for it. */
export const OPEN_DOCUMENT_EVENT = 'shrubbery:open-document'

export interface OpenZoteroSourceDetail {
  readonly artifactId: string
  readonly zoteroKey: string
}

export const OPEN_ZOTERO_SOURCE_EVENT = 'mn-open-zotero-source'

/**
 * The host-side navigation seam. open another document/block — the wikilink-click
 * target. The shell provides a concrete (real navigation); the default dispatches a
 * CustomEvent for the shell to handle.
 */
export interface NavigationService {
  openDocument(graphId: string, documentId: string, blockId?: string): void
  openZoteroSource(artifactId: string, zoteroKey: string): void
}

/**
 * The default NavigationService: dispatch a CustomEvent('shrubbery:open-document') on
 * the given target (default: globalThis). REAL event, REAL target — the shell-side
 * listener that performs the actual navigation is DEFERRED, not mocked.
 *
 * `target` is injectable so a test (or a scoped shell) can observe the event on a real
 * EventTarget without touching the global one.
 */
export function eventNavigationService(target: EventTarget = globalThis): NavigationService {
  return {
    openDocument(graphId: string, documentId: string, blockId?: string): void {
      target.dispatchEvent(
        new CustomEvent<OpenDocumentDetail>(OPEN_DOCUMENT_EVENT, {
          detail: { graphId, documentId, blockId },
          bubbles: true,
          composed: true,
        }),
      )
    },
    openZoteroSource(artifactId: string, zoteroKey: string): void {
      target.dispatchEvent(
        new CustomEvent<OpenZoteroSourceDetail>(OPEN_ZOTERO_SOURCE_EVENT, {
          detail: { artifactId, zoteroKey },
          bubbles: true,
          composed: true,
        }),
      )
    },
  }
}
