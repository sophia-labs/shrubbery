/**
 * define-element-face.ts — S1 item 4: `defineElementFace` is sugar over
 * `guest-app.ts`'s `GuestAppModule` for a Web-Components guest — Vera,
 * 2026-08-24 18:26: "Shrubbery should be flexible enough that the same core
 * concepts can render a Web Components app or a React app." `mount` creates
 * the named element inside the container the host handed it, assigns props
 * as PROPERTIES (not attributes — the same idiom `sh-guest-island.ts` and
 * every other host-lift element in this package use), `update` reassigns
 * them, `unmount` removes the element. The registry cannot tell this apart
 * from a `defineReactFace` guest — both build the exact same `GuestAppModule`
 * shape (`{ id, framework, styles?, mount }`); only `framework` differs.
 */
import type { GuestAppModule, GuestHostContext, GuestMount } from './guest-app.js'

export interface DefineElementFaceOptions {
  readonly id: string
  readonly tagName: string
  /** Registers the custom element, if it isn't already (`customElements.define(...)`) — called once, at mount, before the element is created. Idempotent callers (checking `customElements.get(tagName)` first) may call this more than once safely; `defineElementFace` itself calls it on every mount. */
  readonly define?: () => void
  /** Computes this render's properties from the current `GuestHostContext` — called on mount and on every `update()`. */
  readonly props?: (ctx: GuestHostContext) => Record<string, unknown>
  readonly styles?: { css: string; sha256: string }
}

function assignProps(element: Element, props: Record<string, unknown>): void {
  const target = element as unknown as Record<string, unknown>
  for (const [key, value] of Object.entries(props)) {
    target[key] = value
  }
}

function mountElement(ctx: GuestHostContext, options: DefineElementFaceOptions): GuestMount {
  options.define?.()
  const element = document.createElement(options.tagName)
  let currentCtx = ctx
  assignProps(element, options.props?.(currentCtx) ?? {})
  ctx.container.replaceChildren(element)

  return {
    update(next: Partial<GuestHostContext>): void {
      currentCtx = { ...currentCtx, ...next }
      assignProps(element, options.props?.(currentCtx) ?? {})
    },
    unmount(): void {
      element.remove()
    },
  }
}

/** Builds a `GuestAppModule` (`framework: 'web-components'`) that mounts a named custom element through the same `GuestHostContext`/`GuestMount` contract a React guest uses. */
export function defineElementFace(options: DefineElementFaceOptions): GuestAppModule {
  return {
    id: options.id,
    framework: 'web-components',
    styles: options.styles,
    mount: (ctx) => mountElement(ctx, options),
  }
}
