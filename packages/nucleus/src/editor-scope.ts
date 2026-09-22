/**
 * editor-scope.ts — EditorScope: a PROJECTION / NARROWING of BranchContext to
 * the editor's slice (milestone step 4: "EditorContext as a projection/narrowing
 * of BranchContext, with a null/default impl a shell can use").
 *
 * NAMING (reconciliation): the milestone calls this concept "EditorContext", but
 * the ratified naming notes forbid the bare names `Context` / `EditorContext` /
 * `context.ts` — `context.ts` already exists in @shrubbery/render (the JSON-LD
 * @context render vocabulary). So this module is `editor-scope.ts` and the type
 * is `EditorScope`: the same concept (the editor's narrowed view of the active
 * branch) under a collision-safe name, mirroring SE2's StoreScope/BranchContext.
 *
 * It is a NARROWING, not a widening: an EditorScope carries the BranchContext's
 * `app` PLUS the editor's own anchor (which graph/document, and the center mode).
 * The projection `narrowToEditorScope` is TOTAL — it never throws (the ratified
 * design rejects a throwing NotWired narrowToEditor as "surface without an
 * organism"); when nothing is selected it returns NULL_EDITOR_SCOPE, an honest
 * inert default a shell can mount the host with before a document is chosen.
 *
 * No backend coupling: these are plain value types over AppId + ids. The live
 * editor host (CRDT/ProseMirror) is a separate, deferred real-infra concern fed
 * through the contract — NOT declared here.
 */

import type { AppId } from './workspace/types.js'
import type { BranchContext } from './store-scope.js'

/**
 * Which center the editor is anchored to within a branch. Mirrors the garden
 * host's home|document|artifact center modes; 'home' = no document open (the
 * default/inert state).
 */
export type EditorCenterMode = 'home' | 'document' | 'artifact'

/**
 * The editor's narrowed view of the active branch. Carries the BranchContext's
 * `app` (so the editor knows which branch it lives in) plus the editor anchor:
 * the center mode and, when a document/artifact is open, its graph + id.
 *
 * `graphId`/`documentId` are null in 'home' mode (nothing open) — never faked.
 */
export interface EditorScope {
  /** Inherited from BranchContext — which app/branch the editor sits in. */
  readonly app?: AppId
  /** What the editor center is showing. */
  readonly centerMode: EditorCenterMode
  /** The open document's/artifact's graph, or null when nothing is open. */
  readonly graphId: string | null
  /** The open document's/artifact's id, or null when nothing is open. */
  readonly documentId: string | null
}

/**
 * The null/default EditorScope a shell can use to mount the editor host before a
 * document is selected: no branch, 'home' mode, nothing open. An honest inert
 * default — NOT fake content and NOT a throwing boundary.
 */
export const NULL_EDITOR_SCOPE: EditorScope = Object.freeze({
  app: undefined,
  centerMode: 'home',
  graphId: null,
  documentId: null,
})

/** The open document/artifact selection, if any (the shell-supplied anchor). */
export interface EditorAnchor {
  readonly centerMode: Extract<EditorCenterMode, 'document' | 'artifact'>
  readonly graphId: string
  readonly documentId: string
}

/**
 * Project a BranchContext (+ optional open-document anchor) down to an
 * EditorScope. TOTAL: with no anchor it narrows to a 'home' scope carrying just
 * the branch's `app`; with an anchor it carries the open graph/document.
 *
 * Never throws — an un-anchored editor is a real, inert state (home), not a
 * not-yet-wired error.
 */
export function narrowToEditorScope(branch: BranchContext, anchor?: EditorAnchor): EditorScope {
  if (!anchor) {
    return { app: branch.app, centerMode: 'home', graphId: null, documentId: null }
  }
  return {
    app: branch.app,
    centerMode: anchor.centerMode,
    graphId: anchor.graphId,
    documentId: anchor.documentId,
  }
}
