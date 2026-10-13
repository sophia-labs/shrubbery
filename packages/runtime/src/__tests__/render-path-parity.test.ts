/**
 * render-path-parity.test.ts — the spine and the surface must offer the same
 * features.
 *
 * WHY THIS FILE EXISTS. Three features were found dead in production because
 * they were built into one render path while the app runs the other, and
 * nothing failed:
 *
 *   - the pane-header mini table of contents (shipped July, never on screen)
 *   - the empty-pane / live-editor overlap fix (shipped the day before this)
 *   - the sidebar outline mode (toggle went active, files tree stayed)
 *
 * Every one had passing tests. `center-panes-host.test.ts` mounts
 * `sh-center-panes` directly and drives it, which is an honest test of a
 * component that `center-panes-layout-adapter.ts` documents production no
 * longer mounting. Green forever, feature dead.
 *
 * There will be a fourth. These tests are the trip-wire.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { GARDEN_DEFAULT } from '@shrubbery/nucleus'
import { createCenterPanesState, projectCenterPanes } from '../center-panes-model.js'
import { renderWorkspace, workspaceSurfaceReady, type WorkspaceCenterPanesOptions } from '../index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const SPECIMEN = resolve(HERE, '../center-panes-host.ts')
const PRODUCTION = resolve(HERE, '../render-workspace.ts')

function centerOptions(): WorkspaceCenterPanesOptions {
  const state = createCenterPanesState({ graphId: 'graph-a' })
  return { projection: projectCenterPanes(state), editorHosts: new Map() }
}

const outlinePanel = {
  documentOpen: true,
  headings: [{ id: 'block-h1', level: 1, text: 'Intro' }],
  activeHeadingId: null,
  onNavigate: () => {},
  onCommand: () => {},
}

/** Both render modes, driven through the one public entry point. */
async function renderBothWays(
  options: Parameters<typeof renderWorkspace>[1],
): Promise<{ readonly spine: HTMLElement; readonly surface: HTMLElement }> {
  const spine = renderWorkspace(GARDEN_DEFAULT, { ...options, surface: false })
  const surface = renderWorkspace(GARDEN_DEFAULT, { ...options, surface: true })
  await workspaceSurfaceReady(surface)
  return { spine, surface }
}

describe('render-path parity — sidebar modes', () => {
  it('renders the outline panel on BOTH paths when leftPanelMode is outline', async () => {
    // REGRESSION: the spine grew this branch in July; the surface path kept
    // only graph-vs-files, so the toggle went active and nothing changed.
    const { spine, surface } = await renderBothWays({
      centerPanes: centerOptions(),
      outlinePanel,
      chrome: { leftPanelMode: 'outline' },
    })
    expect(spine.querySelector('mn-document-outline'), 'spine').not.toBeNull()
    expect(surface.querySelector('mn-document-outline'), 'surface').not.toBeNull()
  })

  it('renders the files sidebar on BOTH paths by default', async () => {
    const { spine, surface } = await renderBothWays({
      centerPanes: centerOptions(),
      chrome: { leftPanelMode: 'files' },
    })
    expect(spine.querySelector('mn-sidebar-panel'), 'spine').not.toBeNull()
    expect(surface.querySelector('mn-sidebar-panel'), 'surface').not.toBeNull()
  })

  it('renders neither the files tree nor the outline on BOTH paths in graph mode', async () => {
    const { spine, surface } = await renderBothWays({
      centerPanes: centerOptions(),
      outlinePanel,
      chrome: { leftPanelMode: 'graph' },
    })
    for (const [name, root] of [['spine', spine], ['surface', surface]] as const) {
      expect(root.querySelector('mn-document-outline'), `${name} outline`).toBeNull()
      expect(root.querySelector('mn-sidebar-panel'), `${name} sidebar`).toBeNull()
    }
  })
})

describe('render-path parity — the compatibility specimen must not grow features alone', () => {
  /**
   * `sh-center-panes` is a compatibility specimen: production renders the
   * surface faces in render-workspace.ts instead. Any DOM hook the specimen
   * emits and production does not is a feature that will never reach a user.
   *
   * Differences that are genuinely intentional are listed below. Adding to
   * this list is a deliberate act — it means "production does not need this",
   * not "the test was in the way".
   */
  const INTENTIONALLY_SPECIMEN_ONLY = new Set([
    // Structural chrome the surface path renders under its own names
    // (surface-pane-header, surface-pane-stage, surface-pane-empty, and the
    // interpreter's own wrappers).
    'center-panes', 'pane', 'pane-header', 'pane-stage', 'empty-pane', 'divider',
    // The specimen owns its own split geometry and divider drag; on the
    // surface path those belong to the layout interpreter and surface-host.
    'data-split', 'data-posture', 'data-active-pane', 'data-position',
    'data-pane-id', 'data-dragging', 'data-active',
    // Not an emitted hook: the specimen READS it, in `:host([data-skin='98'])`,
    // from the attribute skin-aware.ts sets. Production reads the same skin
    // attribute at the document root (`:root[data-skin='98'] #host
    // .surface-pane-header` in apps/organism/index.html), so the 98 pane-header
    // treatment already exists on the path production mounts. Rendering a
    // data-skin attribute from render-workspace.ts would only satisfy this
    // regex, not port anything.
    'data-skin',
  ])

  const CLASS = /class="([a-z0-9 _-]+)"/g
  const DATA_ATTR = /\b(data-[a-z-]+)=\$?\{?/g

  function hooks(text: string): Set<string> {
    const out = new Set<string>()
    for (const m of text.matchAll(CLASS)) {
      for (const cls of m[1].split(/\s+/)) if (cls) out.add(cls)
    }
    for (const m of text.matchAll(DATA_ATTR)) out.add(m[1])
    return out
  }

  it('emits no DOM hook that production lacks and this file has not sanctioned', () => {
    const specimen = hooks(readFileSync(SPECIMEN, 'utf8'))
    const production = hooks(readFileSync(PRODUCTION, 'utf8'))
    const orphans = [...specimen]
      .filter(hook => !production.has(hook))
      .filter(hook => !INTENTIONALLY_SPECIMEN_ONLY.has(hook))
      .sort()

    expect(
      orphans,
      'These exist only in sh-center-panes, which production does not mount. '
      + 'Either port them to render-workspace.ts or sanction them in '
      + 'INTENTIONALLY_SPECIMEN_ONLY with a reason.',
    ).toEqual([])
  })
})
