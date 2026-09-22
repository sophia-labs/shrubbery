/**
 * define-react-face.ts — S1 item 3: `defineReactFace` is sugar over
 * `guest-app.ts`'s `GuestAppModule` for the common case — a plain React
 * component, mounted the way `excalidraw-runtime.ts` (this package's one
 * real precedent for hosting a foreign React app, `excalidraw-runtime.ts:
 * 380-410,656-682`) already lazily loads `react`/`react-dom/client`:
 * `Promise.all([import('react'), import('react-dom/client')])`, then
 * `createRoot(container)` and `root.render(createElement(component, props))`.
 *
 * No JSX: this repo has zero `.tsx` files (scout/shrubbery.md §5, "React 19
 * is already a dependency ... Zero `.tsx` files exist in the repo — JSX is
 * never used; React elements are built with `createElement`") — this module
 * follows that convention rather than opening `.tsx`/`"jsx":"react-jsx"` as
 * new ground.
 *
 * `update` re-renders under a FRESH `key` every call
 * (`${graphId}/${docId}/${generation}`, the Excalidraw precedent's own
 * `key: \`${scope.graphId}/${scope.artifactId}/${++this.renderGeneration}\`
 * shape) — forcing React to tear down and rebuild the subtree on every
 * update rather than trusting reconciliation to notice a prop change is the
 * simpler, safer contract for an arbitrary wrapped component this sugar
 * cannot make assumptions about.
 */
import type { ComponentType } from 'react'
import type { GuestAppModule, GuestHostContext, GuestMount } from './guest-app.js'

export interface DefineReactFaceOptions {
  readonly id: string
  readonly component: ComponentType<Record<string, unknown>>
  /** Computes this render's props from the current `GuestHostContext` — called on mount and on every `update()`. */
  readonly props?: (ctx: GuestHostContext) => Record<string, unknown>
  readonly styles?: { css: string; sha256: string }
}

interface ReactRuntime {
  readonly createElement: typeof import('react').createElement
  readonly createRoot: typeof import('react-dom/client').createRoot
}

async function loadReactRuntime(): Promise<ReactRuntime> {
  const [react, reactDomClient] = await Promise.all([import('react'), import('react-dom/client')])
  return { createElement: react.createElement, createRoot: reactDomClient.createRoot }
}

async function mountReact(ctx: GuestHostContext, options: DefineReactFaceOptions): Promise<GuestMount> {
  const { createElement, createRoot } = await loadReactRuntime()
  const root = createRoot(ctx.container)
  let currentCtx = ctx
  let generation = 0

  const renderWith = (context: GuestHostContext): void => {
    generation += 1
    const key = `${context.graphId ?? ''}/${context.docId ?? ''}/${generation}`
    const props: Record<string, unknown> = { key, ...(options.props?.(context) ?? {}) }
    root.render(createElement(options.component, props))
  }
  renderWith(currentCtx)

  return {
    update(next: Partial<GuestHostContext>): void {
      currentCtx = { ...currentCtx, ...next }
      renderWith(currentCtx)
    },
    unmount(): void {
      root.unmount()
    },
  }
}

/** Builds a `GuestAppModule` (`framework: 'react'`) that mounts `component` through the real, lazily-loaded `react`/`react-dom/client` from `packages/runtime` (React 19.2.7). */
export function defineReactFace(options: DefineReactFaceOptions): GuestAppModule {
  return {
    id: options.id,
    framework: 'react',
    styles: options.styles,
    mount: (ctx) => mountReact(ctx, options),
  }
}
