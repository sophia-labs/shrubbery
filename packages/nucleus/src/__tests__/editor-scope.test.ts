/**
 * editor-scope.test.ts — exercises the EditorScope projection (milestone step 4:
 * EditorContext-as-narrowing-of-BranchContext) against REAL BranchContext +
 * anchor values. Pure functions over real values; no mocks.
 */
import { describe, it, expect } from 'vitest'
import {
  NULL_EDITOR_SCOPE,
  narrowToEditorScope,
  type BranchContext,
  type EditorAnchor,
  type EditorScope,
} from '../index.js'

describe('NULL_EDITOR_SCOPE — the inert default a shell mounts with', () => {
  it('is home mode, no branch, nothing open (never fake content)', () => {
    expect(NULL_EDITOR_SCOPE.centerMode).toBe('home')
    expect(NULL_EDITOR_SCOPE.app).toBeUndefined()
    expect(NULL_EDITOR_SCOPE.graphId).toBeNull()
    expect(NULL_EDITOR_SCOPE.documentId).toBeNull()
  })

  it('is frozen (a shared immutable default)', () => {
    expect(Object.isFrozen(NULL_EDITOR_SCOPE)).toBe(true)
  })
})

describe('narrowToEditorScope — total projection of BranchContext', () => {
  it('no anchor ⇒ home scope carrying just the branch app (no throw)', () => {
    const branch: BranchContext = { app: 'choreograph' }
    const scope = narrowToEditorScope(branch)
    expect(scope).toEqual<EditorScope>({
      app: 'choreograph',
      centerMode: 'home',
      graphId: null,
      documentId: null,
    })
  })

  it('default branch ({}) + no anchor ⇒ home scope with undefined app', () => {
    const scope = narrowToEditorScope({})
    expect(scope.app).toBeUndefined()
    expect(scope.centerMode).toBe('home')
    expect(scope.graphId).toBeNull()
    expect(scope.documentId).toBeNull()
  })

  it('document anchor ⇒ carries the open graph/document + the branch app', () => {
    const branch: BranchContext = { app: 'garden' }
    const anchor: EditorAnchor = { centerMode: 'document', graphId: 'g-123', documentId: 'doc-7' }
    const scope = narrowToEditorScope(branch, anchor)
    expect(scope).toEqual<EditorScope>({
      app: 'garden',
      centerMode: 'document',
      graphId: 'g-123',
      documentId: 'doc-7',
    })
  })

  it('artifact anchor ⇒ artifact center mode with its ids', () => {
    const scope = narrowToEditorScope({}, { centerMode: 'artifact', graphId: 'g-1', documentId: 'art-9' })
    expect(scope.centerMode).toBe('artifact')
    expect(scope.graphId).toBe('g-1')
    expect(scope.documentId).toBe('art-9')
    expect(scope.app).toBeUndefined()
  })

  it('is a NARROWING: every EditorScope is assignable as a BranchContext slice (app preserved)', () => {
    const branch: BranchContext = { app: 'choreograph' }
    const scope = narrowToEditorScope(branch, { centerMode: 'document', graphId: 'g', documentId: 'd' })
    // The narrowed scope still exposes the branch's app — the projection
    // preserves the BranchContext field it narrows from.
    const recoveredBranch: BranchContext = { app: scope.app }
    expect(recoveredBranch.app).toBe(branch.app)
  })
})
