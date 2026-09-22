/**
 * mount.ts — the Class-B editor-host mount glue (SE4).
 *
 * Three small pure-ish helpers the render host uses to lift the editor from an
 * inert in-arm stamp to a positioned live host:
 *
 *   - renderCenterSlotAnchor(regionId): the EMPTY position anchor the spine arm
 *     emits in place of the inert <mn-document-editor> stamp. DOM tokens are kept
 *     identical to the garden reference (id=mn-main-editor, role=main,
 *     position:relative, [data-center-slot]) so the float math + a11y lift
 *     unchanged.
 *
 *   - isPersistentCenter(config, regionId): whether a spine region resolves to a
 *     persistent-relocatable (Class B) tag — read from the FROZEN
 *     COMPONENT_LIBRARY via persistenceOf (D7: persistence is code, not data; a
 *     pack can never reclassify it). This is the gate that decides "emit an
 *     anchor + lift the host" vs "stamp inert".
 *
 *   - mountEditorHost(binding): the ONE live <sh-editor-host>, wrapped in a
 *     LITERAL-CONSTANT keyed() ChildPart so Lit reuses the SAME DOM node across
 *     EVERY re-render — collapse permutations, GARDEN_VARIANT relocation, AND a
 *     real app/branch switch where the editor region vanishes entirely. The
 *     binding flows in as a PROP (.binding), so a binding VALUE change re-renders
 *     the placeholder but never re-creates the node.
 *
 * CRITICAL (mount-once correctness): the host must be rendered at a STABLE
 * template-slot position. The render host places mountEditorHost(binding) at a
 * FIXED final binding inside `.main` (NOT as a trailing element of the
 * variable-length rails/spine array) — a variable-length array shifts the keyed
 * part's index and LOSES node identity when railIds becomes non-empty. The
 * garden reference renders render(html`${spine}${keyed(...)}`); we mirror that.
 *
 * Dependencies: lit (+ lit/directives/keyed.js) and @shrubbery/nucleus
 * (persistenceOf/resolveSurfaceTag) + sibling .js — no store/contract/CRDT.
 */

import { html, nothing, type TemplateResult } from 'lit'
import { keyed } from 'lit/directives/keyed.js'
import { persistenceOf, resolveSurfaceTag, type WorkspaceConfig } from '@shrubbery/nucleus'
import type { EditorHostBinding } from './editor-host-binding.js'
import type {
  EditorBlockFocusRequest,
  EditorDocumentAccess,
  EditorImageInserter,
  WireRadialContextMap,
} from './editor-host.js'
import type { WireBundle } from './editor-services/wire-bundle-service.js'
import type { SalienceBundle } from './editor-services/salience-bundle-service.js'
// The kernel-options TYPE alias re-exported through the sibling collab module — an
// island-legal relative .js. mount.ts carries the value as an OPAQUE callback set,
// never importing @shrubbery/editor-kernel directly.
import type { EditorKernelOptions } from './collab/live-editor.js'
// Side-effect import: registers the <sh-editor-host> custom element.
import './editor-host.js'

/** Stable key for the keyed() ChildPart — guarantees ONE reused live node. */
const HOST_KEY = 'sh-editor-host'

export interface EditorHostMountOptions {
  /** Stable block id to restore into the outliner-zoom plugin after mount. */
  readonly initialZoomBlockId?: string | null
  /** Transient block focus request after navigation; token distinguishes repeats. */
  readonly focusRequest?: EditorBlockFocusRequest | null
  /** Read-side wire bundle for the open document, if the shell loaded one. */
  readonly wireBundle?: WireBundle | null
  /** Shell-owned context previews for the editor radial wire overlay. */
  readonly wireRadialContexts?: WireRadialContextMap | null
  /** Read-side per-block salience scores for the editor's value gutter. */
  readonly salienceBundle?: SalienceBundle | null
  /** Shell-owned Garden-style image acquisition/upload seam. */
  readonly imageInserter?: EditorImageInserter | null
  /** Authoritative access state for the open document. */
  readonly documentAccess?: EditorDocumentAccess | null
  /** Controlled browser TTS state reflected into the editor toolbar. */
  readonly ttsStatus?: 'idle' | 'loading' | 'playing' | 'paused'
  readonly ttsAvailable?: boolean
}

/**
 * Whether the spine region `regionId` resolves to a persistent-relocatable
 * (Class B) component tag. Reads persistence from the frozen code manifest via
 * persistenceOf — the editor (mn-document-editor) is Class B.
 *
 * Pure: config + id in, boolean out. No DOM.
 */
export function isPersistentCenter(config: WorkspaceConfig, regionId: string): boolean {
  const tag = resolveSurfaceTag(config, regionId)
  if (!tag) return false
  return persistenceOf(tag) === 'persistent-relocatable'
}

/**
 * The EMPTY position anchor the spine arm emits for a lifted Class-B center.
 * Contains NO live node — the host floats over this measured box. DOM tokens are
 * the garden-reference tokens (id=mn-main-editor, role=main, [data-center-slot],
 * position:relative) so the float math + aria lift are unchanged.
 *
 * SHELL SIZING CONTRACT (the second half of the invariant editor-host.ts's
 * POSITIONING doc names): being EMPTY means this anchor has NO natural content
 * height. computeHostVars reads its getBoundingClientRect() verbatim into
 * --editor-h with no clamping, so an anchor with no explicit height measures
 * 0px, and sh-editor-host's :host box (height: var(--editor-h)) collapses to
 * 0px right along with it — .editor-mount's overflow:auto then legitimately
 * clips its real, correctly-mounted content to nothing visible. The toolbar
 * survives regardless (it never sets overflow, so flexbox's automatic-minimum-
 * size lets it paint at content height), which makes "the toolbar renders"
 * LOOK like proof the body would too — it isn't. Any shell hosting this anchor
 * MUST give `.panel.center` (or whatever selector matches these DOM tokens) a
 * real height — typically `height: 100%` against an ancestor that itself
 * resolves to a definite height (see apps/organism/index.html's `.panel.center`
 * rule). Found the hard way (multi-agent investigation, 2026-07-01) after the
 * companion `.main { position: relative }` contract (mount.ts's other half,
 * documented at editor-host.ts's POSITIONING comment) was already satisfied —
 * fixing containing-block correctness does not fix sizing correctness; check
 * both when a shell's live editor mounts with a toolbar but an empty body.
 */
export function renderCenterSlotAnchor(regionId: string): TemplateResult {
  return html`<div
    class="panel center"
    style="position: relative;"
    role="main"
    id="mn-main-editor"
    data-center-slot
    data-region=${regionId}
  ></div>`
}

/**
 * The ONE live <sh-editor-host>, mounted via a literal-constant keyed() part so
 * Lit reuses the SAME ChildPart — hence the SAME DOM node — across every
 * re-render. The binding flows in as a PROP (.binding); a binding VALUE change
 * re-renders the placeholder but never re-creates the node.
 *
 * Returns `nothing` when no binding is provided, so a host with no editorHost is
 * byte-identical to the inert-stamp path (back-compat).
 *
 * `kernelOptions` (optional, 2nd arg) is the assembled wikilink callback set the
 * shell threads to the kernel slot, set as a SECOND prop beside `.binding` (never
 * grown into the binding — the binding stays the lit+nucleus-only reactive STATE
 * seam). Built ONCE per provider claim by the shell and passed by stable reference,
 * so a re-render never spuriously rebuilds the live editor (undo-survival anchor).
 */
export function mountEditorHost(
  binding: EditorHostBinding | null | undefined,
  kernelOptions?: EditorKernelOptions | null,
  options: EditorHostMountOptions = {},
): unknown {
  if (!binding) return nothing
  return keyed(
    HOST_KEY,
    html`<sh-editor-host
      id="mn-editor-host"
      class="editor-host-singleton"
      aria-owns="mn-main-editor"
      .binding=${binding}
      .kernelOptions=${kernelOptions ?? null}
      .initialZoomBlockId=${options.initialZoomBlockId ?? null}
      .focusRequest=${options.focusRequest ?? null}
      .wireBundle=${options.wireBundle ?? null}
      .wireRadialContexts=${options.wireRadialContexts ?? null}
      .salienceBundle=${options.salienceBundle ?? null}
      .imageInserter=${options.imageInserter ?? null}
      .documentAccess=${options.documentAccess ?? null}
      .ttsStatus=${options.ttsStatus ?? 'idle'}
      .ttsAvailable=${options.ttsAvailable ?? false}
    ></sh-editor-host>`,
  )
}
