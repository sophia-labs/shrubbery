/**
 * focus-binding.ts — bind a SESSION's focus into a graph-authored layout
 * document (el Despacho W1, plans/2026-09-15-despacho-design.md §4/§7).
 *
 * A focus-driven surface is a layout whose resources name the subject under
 * the cursor as the `{{focus}}` placeholder rather than a literal IRI: a
 * `graph` locator's `subjectIri`, an `iri` locator's `iri`, or a query (raw
 * or `urn:sophia:query:*` named) whose text carries the placeholder. The
 * document is authored ONCE; every page load binds the current focus into a
 * fresh copy here, before the document reaches the interpreter.
 *
 * Two binding shapes, on purpose:
 *   - `graph`/`iri` locators get the focus SUBSTITUTED (their resource IS the
 *     focus subject);
 *   - `query` locators get the focus STAMPED as `QueryLocator.focus` (the
 *     resolver splices it through its own embeddability gate, and the
 *     resource key includes it, so two focuses are two resources).
 *
 * With NO focus, a focus-bearing locator is left as authored: the resolver
 * then refuses with `missing-focus` and the face paints an honest "this room
 * has no cursor" error — never a query over the literal placeholder text.
 * Returns the SAME document object when nothing needed binding, so a shell
 * that compares by identity sees no churn.
 */
import {
  deepFreeze,
  type GridChildrenSource,
  type LayoutDocument,
  type LayoutNode,
  type ResourceLocator,
  type ViewDescriptor,
} from '@shrubbery/nucleus/layout'
import { FOCUS_PLACEHOLDER, isNamedQueryRef, queryTextUsesFocus } from './named-query-registry.js'

export interface FocusBindingOptions {
  /** Does the NAMED query `name` carry `{{focus}}`? (`NamedQueryRegistry.usesFocus` — injected so this module stays registry-agnostic.) */
  readonly namedQueryUsesFocus: (name: string) => boolean
}

/** True when `locator` names the focus in any of the three supported ways. */
export function resourceLocatorUsesFocus(locator: ResourceLocator, options: FocusBindingOptions): boolean {
  switch (locator.kind) {
    case 'graph':
      return locator.subjectIri === FOCUS_PLACEHOLDER
    case 'iri':
      return locator.iri === FOCUS_PLACEHOLDER
    case 'query':
      return isNamedQueryRef(locator.queryId)
        ? options.namedQueryUsesFocus(locator.queryId)
        : queryTextUsesFocus(locator.queryId)
    default:
      return false
  }
}

function bindLocator(locator: ResourceLocator, focus: string, options: FocusBindingOptions): ResourceLocator {
  if (!resourceLocatorUsesFocus(locator, options)) return locator
  switch (locator.kind) {
    case 'graph':
      return { ...locator, subjectIri: focus }
    case 'iri':
      return { ...locator, iri: focus }
    case 'query':
      return locator.focus === focus ? locator : { ...locator, focus }
    default:
      return locator
  }
}

function bindDescriptor(descriptor: ViewDescriptor, focus: string, options: FocusBindingOptions): ViewDescriptor {
  const resource = bindLocator(descriptor.resource, focus, options)
  return resource === descriptor.resource ? descriptor : { ...descriptor, resource }
}

function bindChildren(children: GridChildrenSource, focus: string, options: FocusBindingOptions): GridChildrenSource {
  if (children.kind === 'fixed') {
    let changed = false
    const cells = children.cells.map((cell) => {
      const descriptor = bindDescriptor(cell.descriptor, focus, options)
      if (descriptor === cell.descriptor) return cell
      changed = true
      return { ...cell, descriptor }
    })
    return changed ? { ...children, cells } : children
  }
  const collection = bindLocator(children.collection, focus, options)
  return collection === children.collection ? children : { ...children, collection }
}

function bindNode(node: LayoutNode, focus: string, options: FocusBindingOptions): LayoutNode {
  switch (node.kind) {
    case 'leaf': {
      const descriptor = bindDescriptor(node.descriptor, focus, options)
      return descriptor === node.descriptor ? node : { ...node, descriptor }
    }
    case 'grid': {
      const children = bindChildren(node.children, focus, options)
      return children === node.children ? node : { ...node, children }
    }
    default:
      return node
  }
}

/**
 * Bind `focus` into every focus-bearing locator of `doc`. `null` focus binds
 * nothing (see the module header). The result is deep-frozen like every
 * document the interpreter receives; identity is preserved when unchanged.
 */
export function bindLayoutFocus(doc: LayoutDocument, focus: string | null, options: FocusBindingOptions): LayoutDocument {
  if (focus === null) return doc
  let changed = false
  const nodes: Record<string, LayoutNode> = {}
  for (const [id, node] of Object.entries(doc.nodes)) {
    const bound = bindNode(node, focus, options)
    if (bound !== node) changed = true
    nodes[id] = bound
  }
  return changed ? deepFreeze({ ...doc, nodes }) : doc
}

/** True when ANY node of `doc` names the focus — a shell uses this to decide whether a focus change must reload the fragment. */
export function layoutDocumentUsesFocus(doc: LayoutDocument, options: FocusBindingOptions): boolean {
  for (const node of Object.values(doc.nodes)) {
    if (node.kind === 'leaf' && resourceLocatorUsesFocus(node.descriptor.resource, options)) return true
    if (node.kind === 'grid') {
      if (node.children.kind === 'collection' && resourceLocatorUsesFocus(node.children.collection, options)) return true
      if (node.children.kind === 'fixed' && node.children.cells.some((cell) => resourceLocatorUsesFocus(cell.descriptor.resource, options))) return true
    }
  }
  return false
}
