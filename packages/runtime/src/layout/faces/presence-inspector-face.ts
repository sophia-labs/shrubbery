/**
 * presence-inspector-face.ts — the `presence.inspector` face (Wave 1, north
 * star §2.2/§3: "Elevate the 5 trapped faces").
 *
 * WRAPS THE REAL, hoisted `<mn-presence-inspector>` (`@shrubbery/components`,
 * `mn-presence-inspector.ts`) — the per-person live-session-detail markup the
 * catalogue found trapped inside `mn-bottom-bar.ts`'s own private
 * `_renderPresenceInspector` method (catalogue: "Per-person session detail +
 * Follow cursor-reveal + self-rename/color... Elevation candidate — see §4
 * G2"). `mn-presence-inspector.ts`'s own header documents the hoist; this
 * face is the SECOND half of the elevation — the leaf mount over REAL live
 * awareness data, exactly the "change of mount" this wave is about.
 *
 * NOT A SESSION-ROSTER FACE (Vera's own open decision, north star §2.2's G2
 * / §5 "Presence: build a session-roster face, or keep presence chrome-only?
 * (open Q7)"): this face shows ONE named person's session detail, never a
 * "who's here" listing of everyone present. Building a roster leaf is
 * explicitly OUT OF SCOPE here — it is Vera's own open decision, not this
 * wave's to make.
 *
 * LIVE-VS-DERIVED VERDICT: LIVE. Presence is Yjs CRDT awareness — a
 * subscribed, streaming, identity-bearing resource (north star §2.1's own
 * LIVE definition: "subscribed/streaming, identity-bearing — document, chat,
 * presence"), not a fetch-on-demand query. Concretely: this face's resource
 * adapter is `durable` (guard rail 1's "LIVE... maps to the broker's durable
 * shape" precedent, same as `hoja.document`) — it acquires the SAME
 * `EditorRoomPool` room `hoja.document`/`doc.history` already share for a
 * given document (design's proven "two leaves on the same document share one
 * exact provider" mechanism, extended a third way), then reads that
 * provider's REAL `awareness` and subscribes to its real `'change'` events —
 * never a second, parallel awareness-transport implementation.
 *
 * Resource locator: `{ kind: 'document', graphId, documentId }` — the SAME
 * locator shape `hoja.document`/`doc.history` use, because presence in this
 * v1 integration is bound to one specific document's live room (mirrors
 * `apps/organism/src/cell/crdt-presence.ts`'s own `PresenceRoomLocation`,
 * whose `documentId` field this face's resource identity matches). WHO to
 * inspect is not part of the durable resource identity (presence membership
 * is ephemeral; a leaf's identity is not) — it is a required CLOSED param,
 * `{ personId: string }` (the exact `id` a real `projectPresence(...)`
 * aggregation produces, mirrored 1:1 from `apps/organism/src/cell/chrome-
 * controller.ts`'s own `OrganismChromePresencePerson.id`).
 *
 * OUT OF SCOPE (deliberately, "production-shell integration is Wave 3, NOT
 * here"): cross-shell cursor-reveal (`revealFollowedPresenceCursor` in
 * `crdt-presence.ts` searches the WHOLE app's shadow-DOM tree for a
 * `.ProseMirror-yjs-cursor` — a leaf owns only its own DOM, not the shell's;
 * "Follow" here toggles LOCAL highlight state on the mounted `<mn-presence-
 * inspector>` only, exactly matching its own real `followedPresenceClientId`
 * prop/visual contract, with no cross-shell reveal effect).
 */
import type { ResourceLocator, ViewDescriptor } from '@shrubbery/nucleus/layout'
import {
  projectPresence,
  canEditSelfPresence,
  updateLocalPresenceProfile,
  PRESENCE_COLORS,
  type PresenceAwarenessLike,
  type PresencePerson,
  type PresenceSession,
} from '../../presence-projection.js'
import { type EditorRoomLease, type EditorRoomPool } from '../../collab/editor-room-pool.js'
// Side-effect import: registers the <mn-presence-inspector> custom element —
// NOT this component's mn-presence-inspector.ts (packages/runtime cannot
// import @shrubbery/components; see doc-history-face.ts's own header). The
// harness/app that mounts this face already depends on @shrubbery/components
// and triggers the real registration, exactly like doc.history's own harness
// wiring does for <mn-doc-history-panel>.
import {
  closedParamsSchema,
  type DurableResourceAdapter,
  type FaceRegistration,
  type FaceView,
  type LeafConstraints,
  type ResourceKey,
} from '../types.js'
import { resourceKeyTuple } from '../resource-key.js'

export const PRESENCE_INSPECTOR_FACE_ID = 'presence.inspector'
export const PRESENCE_INSPECTOR_RESOURCE_ADAPTER_ID = 'presence.inspector.room-pool'

export interface PresenceInspectorParams {
  /** The exact `id` a real `projectPresence(...)` aggregation produces for the person to show. */
  readonly personId: string
}

/** The durable, broker-shared resource this face's adapter loads once per (graphId, documentId) — the SAME pool room `hoja.document`/`doc.history` share. */
export interface PresenceInspectorRoomResource {
  readonly roomLease: EditorRoomLease
  readonly graphId: string
  readonly documentId: string
}

function documentResourceKey(locator: ResourceLocator): ResourceKey {
  if (locator.kind !== 'document') {
    throw new Error(`presence.inspector: resource adapter given a non-document locator (kind '${locator.kind}')`)
  }
  return resourceKeyTuple('document', locator.graphId, locator.documentId)
}

/** Module-level monotonic seq, mirrors doc-history-face.ts's own `nextDocHistoryAttachmentSeq` — a fresh pool attachment id per `load()`, never the bare canonical key (see that file's header for the reacquire-race this avoids). */
let nextPresenceInspectorAttachmentSeq = 0

export function createPresenceInspectorResourceAdapter(pool: EditorRoomPool): DurableResourceAdapter<PresenceInspectorRoomResource> {
  return {
    adapterId: PRESENCE_INSPECTOR_RESOURCE_ADAPTER_ID,
    shape: 'durable',
    accepts: (locator) => locator.kind === 'document',
    resourceKey: documentResourceKey,
    async load(locator) {
      if (locator.kind !== 'document') throw new Error('unreachable: resourceKey already validated the kind')
      const key = documentResourceKey(locator)
      const attachmentId = `${key}#pi#${nextPresenceInspectorAttachmentSeq++}`
      const roomLease = await pool.acquire({ kind: 'doc', graphId: locator.graphId, docId: locator.documentId }, attachmentId)
      return { roomLease, graphId: locator.graphId, documentId: locator.documentId }
    },
    dispose(value) {
      value.roomLease.release()
    },
  }
}

function presenceInspectorConstraints(): LeafConstraints {
  return { minWidth: 280, minHeight: 220, overflow: 'clip' }
}

function personIdFromParams(descriptor: ViewDescriptor): string {
  const params = descriptor.params as PresenceInspectorParams | undefined
  const personId = params?.personId
  if (typeof personId !== 'string' || !personId.trim()) {
    throw new Error('presence.inspector: params.personId is required')
  }
  return personId
}

/** The (loosely typed) property/event surface `mn-presence-inspector` exposes — mirrors that component's real props 1:1 (packages/runtime cannot import `@shrubbery/components`, see this file's own header). */
interface MnPresenceInspectorElement extends HTMLElement {
  person: PresencePerson | null
  followedPresenceClientId: string | null
  selfPresenceEditable: boolean
  presenceColors: readonly string[]
  showClose: boolean
}

/**
 * The `presence.inspector` `FaceRegistration`. `mount()` acquires the SAME
 * document-room pool lease `hoja.document`/`doc.history` use, reads its
 * REAL awareness, and drives the REAL `<mn-presence-inspector>` off a
 * per-leaf controller that re-projects on every real awareness `'change'`
 * event — never a second, parallel awareness-aggregation implementation.
 */
export function createPresenceInspectorFace(): FaceRegistration {
  return {
    faceId: PRESENCE_INSPECTOR_FACE_ID,
    // Carries real local state (follow-highlight selection) a user would not
    // want silently discarded across a move/swap/focus handoff — same
    // reasoning doc-history-face.ts gives for its own classification.
    persistence: 'persistent-relocatable',
    resourceAdapterId: PRESENCE_INSPECTOR_RESOURCE_ADAPTER_ID,
    accepts: (locator) => locator.kind === 'document',
    paramsSchema: closedParamsSchema({ personId: { type: 'string' } }),
    constraints: presenceInspectorConstraints,
    async mount(context) {
      const { target, descriptor, lease } = context
      const personId = personIdFromParams(descriptor)
      const { roomLease } = lease.value as PresenceInspectorRoomResource
      const awareness = roomLease.provider.awareness as PresenceAwarenessLike

      const panel = document.createElement('mn-presence-inspector') as MnPresenceInspectorElement
      panel.style.cssText = 'display:block;position:static;width:100%;height:100%;min-height:0;'
      panel.showClose = false // no channel to request close_leaf — chrome owns that (design: "chrome is shell-owned")
      target.replaceChildren(panel)

      let followedClientId: string | null = null
      let disposed = false

      function currentPerson(): PresencePerson | null {
        return projectPresence(awareness).find((candidate) => candidate.id === personId) ?? null
      }

      function render(): void {
        const person = currentPerson()
        panel.person = person
        panel.followedPresenceClientId = followedClientId
        panel.selfPresenceEditable = person?.isSelf === true && canEditSelfPresence(awareness)
        panel.presenceColors = PRESENCE_COLORS
      }

      const onAwarenessChange = (): void => {
        if (!disposed) render()
      }
      awareness.on('change', onAwarenessChange)

      panel.addEventListener('mn-presence-follow', (event) => {
        const detail = (event as CustomEvent<{ session: PresenceSession; following: boolean }>).detail
        followedClientId = detail.following ? detail.session.clientId : null
        render()
      })
      panel.addEventListener('mn-presence-self-update', (event) => {
        const detail = (event as CustomEvent<{ name?: string; color?: string }>).detail
        updateLocalPresenceProfile(awareness, { name: detail.name, color: detail.color })
        // No explicit render() here: a real self-update mutates the SAME
        // awareness local state, which fires the real 'change' event above —
        // re-projecting from that is the single source of truth, not a
        // second, locally-optimistic copy of the write.
      })
      // No-op: a leaf has no "close the leaf" channel to request (see this
      // file's own header) — closing is a shell/chrome close_leaf operation.
      panel.addEventListener('mn-presence-close', () => {})

      render()

      const view: FaceView = {
        focus(_request) {
          const panelWithFocus = panel as unknown as { focus?: () => void }
          panelWithFocus.focus?.()
          return true
        },
        blur() {},
        resize() {
          // The panel fills 100%/100% via the wrapper's CSS — no-op.
        },
        serialize(): ViewDescriptor {
          return descriptor
        },
        dispose() {
          if (disposed) return
          disposed = true
          awareness.off('change', onAwarenessChange)
          panel.remove()
        },
      }
      return view
    },
  }
}
