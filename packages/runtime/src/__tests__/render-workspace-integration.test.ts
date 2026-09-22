/**
 * INTEGRATION test — the headline triples → shell path.
 *
 * This is the end-to-end seam the cell / gateway feeds: the REAL committed
 * N-Triples seed (nucleus's garden-default.ux.nt — the body the Rust ux_seed.rs
 * inserts into a cell's :ux:config graph) is parsed back into a WorkspaceConfig,
 * the plan is computed, the host renders it into a real (happy-dom) container,
 * and we assert the rendered DOM reflects the REAL region tree.
 *
 * NO MOCKS: every function under test is the real one —
 *   parseNT (nucleus rdf-model) → parseTriplesToConfig (nucleus ux-rdf) →
 *   planFor (nucleus interpreter) → renderWorkspace (this package) →
 *   happy-dom DOM.
 *
 * The .nt artifact is read from the LINKED nucleus package (not re-fabricated),
 * so this test breaks if the seed and the host's reading of it ever diverge.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { parseNT, parseTriplesToConfig, type WorkspaceConfig } from '@shrubbery/nucleus'
import { renderWorkspace } from '../render-workspace.js'
import { createCenterPanesState, projectCenterPanes } from '../center-panes-model.js'
import type {
  PinnedWireBlock,
  PinnedWireBlockContextMap,
  PinnedWireDocument,
  PinnedWireNode,
  PinnedWireNodeContextMap,
  ShEditorHost,
  ShWirePinnedLayer,
  ShWiresPanel,
  ArtifactEditorGenerateDetail,
  ArtifactEditorSaveDetail,
  ArtifactHistoryRevisionDetail,
  ArtifactViewIntentDetail,
  ArtifactViewOpenDocumentDetail,
  DocHistoryCursorDetail,
  DocHistoryDiffStyleDetail,
  DocHistoryRestoreDetail,
  DocHistorySnapshotDetail,
  GraphPanelNodeOpenDetail,
  GraphPanelRefreshDetail,
  SidebarActionDetail,
  SidebarNodeDetail,
  SidebarNodeDropDetail,
  SidebarSection,
  TagLensOpenBlockDetail,
  TagLensRefreshDetail,
  WireBundle,
  WireContextMap,
  WireRadialContextMap,
  DailyNoteCalendarAnchorDetail,
  DailyNoteOpenDetail,
  ZoteroSourceAnnotation,
  ZoteroSourceBaseDetail,
  ZoteroSourceIncomingWire,
  ZoteroSourceOpenDocumentDetail,
  ZoteroSourceOpenTagDetail,
  ZoteroSourceOpenZoteroDetail,
  ZoteroSourcePromoteAnnotationDetail,
  WorkspaceComment,
  WorkspaceCommentDetail,
  WorkspaceCommentEditDetail,
  WorkspaceCommentHoverDetail,
  WorkspaceCommentResolveDetail,
  WorkspaceInspectorAction,
  WorkspaceInspectorActionDetail,
  WorkspaceInspectorModel,
  WorkspaceInspectorRelationOpenDetail,
  WorkspacePanelRepositionDetail,
  CenterPaneCloseIntentDetail,
  CenterPaneFocusIntentDetail,
  CenterPaneNavigateIntentDetail,
  CenterPaneOpenIntentDetail,
  CenterPaneResizeIntentDetail,
} from '../index.js'

// Anchor on the LINKED nucleus package so the seed path is correct under the
// pnpm workspace symlink. createRequire(import.meta.url) resolves the package
// entry; the seed sits alongside it in src/workspace/__generated__.
const require_ = createRequire(import.meta.url)
const nucleusEntry = require_.resolve('@shrubbery/nucleus') // .../nucleus/src/index.ts
const nucleusSrcDir = dirname(nucleusEntry) // .../nucleus/src
const SEED_NT_PATH = resolve(nucleusSrcDir, 'workspace/__generated__/garden-default.ux.nt')

/** Parse the real seed end-to-end into a config (the production read path). */
function loadSeedConfig(): WorkspaceConfig {
  const ntBody = readFileSync(SEED_NT_PATH, 'utf8')
  const triples = parseNT(ntBody) // parseNT skips '#' header lines itself
  return parseTriplesToConfig(triples)
}

describe('INTEGRATION — real seed .nt → config → plan → renderWorkspace → DOM', () => {
  it('the seed file exists and parses to a non-trivial triple set', () => {
    const ntBody = readFileSync(SEED_NT_PATH, 'utf8')
    const triples = parseNT(ntBody)
    // The committed seed header records 275 triples; assert we recovered them.
    expect(triples.length).toBe(275)
  })

  it('parseTriplesToConfig recovers the GardenDefault workspace shape', () => {
    const config = loadSeedConfig()
    expect(config.id).toBe('GardenDefault')
    expect(config.renderedByComponent).toBe('app-shell')
    // The 6 real regions of the garden default + choreo center.
    expect(Object.keys(config.regions).sort()).toEqual([
      'region-bottom-bar',
      'region-center',
      'region-choreo-center',
      'region-left-rail',
      'region-right-rail',
      'region-top-bar',
    ])
    // The childRegion spine the host will walk: left-rail → center → right-rail.
    expect(config.regions['region-left-rail'].childRegion).toBe('region-center')
    expect(config.regions['region-center'].childRegion).toBe('region-right-rail')
    expect(config.regions['region-right-rail'].childRegion).toBeNull()
  })

  describe('rendered DOM reflects the real region tree', () => {
    const config = loadSeedConfig()
    const container = renderWorkspace(config)
    const appContainer = container.querySelector('.app-container')!

    it('renders an .app-container with a .main', () => {
      expect(appContainer).not.toBeNull()
      expect(appContainer.querySelector('.main')).not.toBeNull()
    })

    it('chrome: top bar AND bottom bar are present (both in the seed rootRegions)', () => {
      const top = appContainer.querySelector('header[data-region="region-top-bar"]')
      const bottom = appContainer.querySelector('footer[data-region="region-bottom-bar"]')
      expect(top).not.toBeNull()
      expect(bottom).not.toBeNull()
      // chrome bodies are the resolved inert tags from config.
      expect(top!.querySelector('mn-top-bar')).not.toBeNull()
      expect(bottom!.querySelector('mn-bottom-bar')).not.toBeNull()
    })

    it('spine: nested split-panels exist (left-rail outer split, center inner right-split)', () => {
      const splits = appContainer.querySelectorAll('sl-split-panel')
      // Two splits for the 3-deep spine (left→center→right): outer + inner.
      expect(splits.length).toBe(2)
      const inner = appContainer.querySelector('sl-split-panel.right-split')
      expect(inner).not.toBeNull()
      // The inner split is nested inside the outer (slot="end").
      expect(inner!.getAttribute('slot')).toBe('end')
    })

    it('split orientation/positions: outer position is 20, inner is 75 (the real fractions)', () => {
      const outer = Array.from(appContainer.querySelectorAll('sl-split-panel'))
        .find(s => !s.classList.contains('right-split'))!
      const inner = appContainer.querySelector('sl-split-panel.right-split')!
      // left-rail 0.2 / 1.0 → 20 ; center 0.6 / (0.6+0.2) → 75
      expect(outer.getAttribute('position')).toBe('20')
      expect(inner.getAttribute('position')).toBe('75')
    })

    it('the three spine regions each render a [data-region] pane in spine order', () => {
      const panes = Array.from(appContainer.querySelectorAll('.split-pane[data-region]'))
        .map(el => el.getAttribute('data-region'))
      expect(panes).toEqual(['region-left-rail', 'region-center', 'region-right-rail'])
    })

    it('expected panel tags appear in the DOM (sidebar, editor, selected chat) — all INERT placeholders', () => {
      // sidebar region resolves to mn-sidebar-panel (left rail).
      expect(appContainer.querySelector('mn-sidebar-panel')).not.toBeNull()
      // center region resolves to mn-document-editor (its first docked panel),
      // stamped INERT — no live editor, no children.
      const editor = appContainer.querySelector('mn-document-editor')
      expect(editor).not.toBeNull()
      expect(editor!.children.length).toBe(0) // inert placeholder, not faked content
      // right rail resolves to its first docked panel: panel-chat → mn-chat-panel.
      expect(appContainer.querySelector('mn-chat-panel')).not.toBeNull()
    })

    it('spine roles are classified from config (sidebar / center / right)', () => {
      const roleOf = (region: string) =>
        appContainer.querySelector(`.split-pane[data-region="${region}"]`)!.getAttribute('data-role')
      expect(roleOf('region-left-rail')).toBe('sidebar')
      expect(roleOf('region-center')).toBe('center')
      expect(roleOf('region-right-rail')).toBe('right')
    })
  })

  describe('collapse options drop regions from the rendered spine', () => {
    const config = loadSeedConfig()

    it('leftCollapsed omits the sidebar pane', () => {
      const c = renderWorkspace(config, { leftCollapsed: true })
      expect(c.querySelector('.split-pane[data-region="region-left-rail"]')).toBeNull()
      // center + right still present.
      expect(c.querySelector('.split-pane[data-region="region-center"]')).not.toBeNull()
      expect(c.querySelector('.split-pane[data-region="region-right-rail"]')).not.toBeNull()
    })

    it('both collapsed → a single bare center pane (no split-panels)', () => {
      const c = renderWorkspace(config, { leftCollapsed: true, rightCollapsed: true })
      expect(c.querySelectorAll('sl-split-panel').length).toBe(0)
      const panes = c.querySelectorAll('.split-pane[data-region]')
      expect(panes.length).toBe(1)
      expect(panes[0].getAttribute('data-region')).toBe('region-center')
    })
  })

  // ── Slice 10 — confess-absence for an undeclared app dimension ─────────────
  // `06-observatory-app-dimension-defect.md` D2b: the REAL seed already
  // declares `appRootRegions.choreograph` (`region-choreo-center`, P0), so an
  // app id that is neither `undefined`, `'garden'`, nor `'choreograph'` is
  // genuinely undeclared for THIS config — the live bug on `?graph=observatory`
  // (whose authored config declares none at all) is the same shape one app
  // narrower. This is the workspace-level proof: real config, real
  // `renderWorkspace`, real DOM — never the default spine.
  describe('Slice 10 — an undeclared app renders confess-absence, never the default spine', () => {
    const config = loadSeedConfig()

    it('a DECLARED app (choreograph) renders normally — not the absent frame', () => {
      const c = renderWorkspace(config, { app: 'choreograph' })
      expect(c.querySelector('[data-workspace-renderer="app-absent"]')).toBeNull()
      expect(c.querySelector('mn-empty-state')).toBeNull()
    })

    it('no app selected (the ordinary default) renders the real spine — not the absent frame', () => {
      const c = renderWorkspace(config)
      expect(c.querySelector('[data-workspace-renderer="app-absent"]')).toBeNull()
      expect(c.querySelector('.split-pane[data-region="region-center"]')).not.toBeNull()
    })

    it('an UNDECLARED app renders the honest empty state, naming the missing app', () => {
      const c = renderWorkspace(config, { app: 'not-a-real-app' })
      const absent = c.querySelector('[data-workspace-renderer="app-absent"]')
      expect(absent).not.toBeNull()
      expect(absent!.getAttribute('data-missing-app')).toBe('not-a-real-app')

      const empty = c.querySelector('mn-empty-state')
      expect(empty).not.toBeNull()
      expect(empty!.getAttribute('title')).toContain('not-a-real-app')
      expect(empty!.getAttribute('description')).toContain('not-a-real-app')
    })

    it('an UNDECLARED app renders NONE of the default spine\'s structural markers', () => {
      const c = renderWorkspace(config, { app: 'not-a-real-app' })
      // The default GardenDefault spine's own signatures (asserted present
      // for a real render earlier in this file) — every one absent here.
      expect(c.querySelectorAll('sl-split-panel').length).toBe(0)
      expect(c.querySelector('.split-pane[data-region]')).toBeNull()
      expect(c.querySelector('mn-sidebar-panel')).toBeNull()
      expect(c.querySelector('mn-document-editor')).toBeNull()
      expect(c.querySelector('mn-chat-panel')).toBeNull()
    })

    it('chrome still renders for an UNDECLARED app, with the REAL config-derived tabs (never a hardcoded pair)', () => {
      const c = renderWorkspace(config, { app: 'not-a-real-app' })
      const top = c.querySelector('mn-top-bar') as (HTMLElement & { apps?: readonly { id: string }[] }) | null
      expect(top).not.toBeNull()
      // A property binding (not an attribute) — readable even pre-upgrade.
      expect(top!.apps?.map(tab => tab.id)).toEqual(['garden', 'choreograph'])
    })
  })

  describe('controlled panel widths, snap modes, and collapse intents', () => {
    const config = loadSeedConfig()

    it('does not collapse an uncontrolled companion track to zero', () => {
      const c = renderWorkspace(config, { panelLayout: { rightWidth: 420 } })
      const app = c.querySelector<HTMLElement>('.app-container')!
      expect(app.style.getPropertyValue('--mn-left-panel-width')).not.toBe('0px')
    })

    it('uses physical primary panes and keeps inner reposition events out of left state', () => {
      const moves: WorkspacePanelRepositionDetail[] = []
      const expanded: boolean[] = []
      const leftCollapsed: boolean[] = []
      const rightCollapsed: boolean[] = []
      const c = renderWorkspace(config, {
        panelLayout: {
          leftWidth: 280,
          rightWidth: 420,
          leftSnap: '180px 280px 500px',
          rightSnap: '240px 420px 500px',
          snapThreshold: 24,
          onReposition: detail => moves.push(detail),
          onLeftExpandedChange: value => expanded.push(value),
          onLeftCollapsedChange: value => leftCollapsed.push(value),
          onRightCollapsedChange: value => rightCollapsed.push(value),
        },
      })
      const outer = c.querySelector('sl-split-panel[data-split-role="left"]') as HTMLElement & {
        position: number
        positionInPixels: number
        size: number
      }
      const inner = c.querySelector('sl-split-panel[data-split-role="right"]') as HTMLElement & {
        position: number
        positionInPixels: number
        size: number
      }

      expect(outer.getAttribute('primary')).toBe('start')
      expect(outer.getAttribute('snap')).toBe('180px 280px 500px')
      expect(outer.getAttribute('snap-threshold')).toBe('24')
      expect(inner.getAttribute('primary')).toBe('end')
      expect(inner.getAttribute('position')).toBe('25')
      expect(inner.getAttribute('snap')).toBe('240px 420px 500px')

      outer.size = 1_000
      outer.position = 70
      outer.positionInPixels = 700
      outer.dispatchEvent(new CustomEvent('sl-reposition', { bubbles: true, composed: true }))
      expect(moves).toEqual([{ role: 'left', width: 500, position: 50, size: 1_000 }])
      expect(outer.position).toBe(50)
      expect(c.querySelector<HTMLElement>('.app-container')?.style.getPropertyValue('--mn-left-panel-width')).toBe('500px')

      inner.size = 1_000
      inner.position = 50
      inner.positionInPixels = 526 // stale after an ancestor resize; must be ignored
      inner.dispatchEvent(new CustomEvent('sl-reposition', { bubbles: true, composed: true }))
      expect(moves.at(-1)).toEqual({ role: 'right', width: 500, position: 50, size: 1_000 })
      expect(moves).toHaveLength(2)
      expect(c.querySelector<HTMLElement>('.app-container')?.style.getPropertyValue('--mn-right-panel-width')).toBe('500px')

      ;(c.querySelector('[data-panel-controls="left"] [data-panel-mode="expanded"]') as HTMLButtonElement).click()
      ;(c.querySelector('[data-panel-controls="left"] [data-panel-mode="collapsed"]') as HTMLButtonElement).click()
      ;(c.querySelector('[data-panel-controls="right"]') as HTMLButtonElement).click()
      expect(expanded).toEqual([true])
      expect(leftCollapsed).toEqual([true])
      expect(rightCollapsed).toEqual([true])
    })

    it('renders keyboard-reachable restore rails without mounting the editor in a pane', () => {
      const restores: string[] = []
      const c = renderWorkspace(config, {
        leftCollapsed: true,
        rightCollapsed: true,
        panelLayout: {
          onLeftCollapsedChange: collapsed => restores.push(`left:${collapsed}`),
          onRightCollapsedChange: collapsed => restores.push(`right:${collapsed}`),
        },
      })
      const left = c.querySelector('[data-panel-restore="left"]') as HTMLButtonElement
      const right = c.querySelector('[data-panel-restore="right"]') as HTMLButtonElement
      expect(left.getAttribute('aria-expanded')).toBe('false')
      expect(right.getAttribute('aria-expanded')).toBe('false')
      left.click()
      right.click()
      expect(restores).toEqual(['left:false', 'right:false'])
    })
  })

  describe('controlled chrome + scalar right-panel options', () => {
    const config = loadSeedConfig()

    it('rightPanel selects the configured right-rail panel instead of the default chat panel', () => {
      const c = renderWorkspace(config, { chrome: { rightPanel: 'wires' } })
      const rightPane = c.querySelector('.split-pane[data-region="region-right-rail"]')!
      expect(rightPane.querySelector('.right-panel[data-panel="wires"] sh-wires-panel')).not.toBeNull()
      expect(rightPane.querySelector('mn-chat-panel')).toBeNull()
    })

    it('legacy multi-panel input is reduced to its most recently selected panel', () => {
      const c = renderWorkspace(config, { chrome: { rightPanels: ['chat', 'wires'] } })
      const panels = Array.from(c.querySelectorAll('.right-panel'))
        .map((el) => el.getAttribute('data-panel'))
      expect(panels).toEqual(['wires'])
      expect(c.querySelector('.right-panel[data-panel="chat"] mn-chat-panel')).toBeNull()
      expect(c.querySelector('.right-panel[data-panel="wires"] sh-wires-panel')).not.toBeNull()
    })

    it('rightPanel places the configured Garden graph in its persistent Class-C host', async () => {
      const refreshes: GraphPanelRefreshDetail[] = []
      const opens: GraphPanelNodeOpenDetail[] = []
      const nodes = [
        { id: 'graph:g', label: 'g', kind: 'graph' as const },
        { id: 'doc:a', label: 'A', kind: 'document' as const, documentId: 'a' },
      ]
      const edges = [{ from: 'graph:g', to: 'doc:a', predicate: 'contains' }]
      const graphPanel = {
        title: 'Graph',
        subtitle: 'Controlled graph',
        status: 'ready' as const,
        nodes,
        edges,
        onRefresh: (detail: GraphPanelRefreshDetail) => refreshes.push(detail),
        onOpenNode: (detail: GraphPanelNodeOpenDetail) => opens.push(detail),
      }
      const c = renderWorkspace(config, {
        chrome: { rightPanel: 'graph' },
        graphPanel,
      })
      document.body.appendChild(c)

      const anchor = c.querySelector('.right-panel[data-panel="graph"] [data-graph-panel-anchor]')
      const host = c.querySelector('sh-graph-host') as HTMLElement
      expect(anchor).not.toBeNull()
      expect(host).not.toBeNull()
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      const panel = host.shadowRoot?.querySelector('mn-graph-panel') as HTMLElement & {
        title?: string
        subtitle?: string
        status?: string
        nodes?: unknown[]
        edges?: unknown[]
      }
      expect(panel).not.toBeNull()
      expect(getComputedStyle(panel).display).toBe('flex')
      expect(panel.title).toBe('Graph')
      expect(panel.subtitle).toBe('Controlled graph')
      expect(panel.status).toBe('ready')
      expect(panel.nodes).toBe(nodes)
      expect(panel.edges).toBe(edges)

      panel.dispatchEvent(
        new CustomEvent<GraphPanelRefreshDetail>('mn-graph-panel-refresh', {
          bubbles: true,
          composed: true,
          detail: { reason: 'manual' },
        }),
      )
      panel.dispatchEvent(
        new CustomEvent<GraphPanelNodeOpenDetail>('mn-graph-panel-node-open', {
          bubbles: true,
          composed: true,
          detail: { id: 'doc:a', node: nodes[1] },
        }),
      )

      expect(refreshes).toEqual([{ reason: 'manual' }])
      expect(opens).toEqual([{ id: 'doc:a', node: nodes[1] }])

      // Changing the declarative right-panel selection must move only the
      // measured anchor. The Class-C host and its WebGL-owning panel survive intact.
      renderWorkspace(config, {
        container: c,
        chrome: { rightPanel: 'graph' },
        graphPanel,
      })
      const movedHost = c.querySelector('sh-graph-host') as HTMLElement
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(movedHost).toBe(host)
      expect(movedHost.shadowRoot?.querySelector('mn-graph-panel')).toBe(panel)
      expect(c.querySelector('.right-panel[data-panel="graph"] [data-graph-panel-anchor]')).not.toBeNull()

      // Garden's Files/Graph control changes the actual left surface. The
      // graph's Class-C owner follows a new measured anchor; it is not
      // re-parented or recreated, and no second graph anchor remains at right.
      renderWorkspace(config, {
        container: c,
        chrome: { leftPanelMode: 'graph', rightPanel: 'wires' },
        graphPanel,
      })
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      const leftAnchor = c.querySelector(
        '.split-pane[data-role="sidebar"] [data-graph-panel-anchor][data-graph-panel-location="left"]',
      )
      const leftHost = c.querySelector('sh-graph-host') as HTMLElement
      expect(leftAnchor).not.toBeNull()
      expect(c.querySelector('.split-pane[data-role="sidebar"] mn-sidebar-panel')).toBeNull()
      expect(c.querySelector('.right-panel [data-graph-panel-anchor]')).toBeNull()
      expect(leftHost).toBe(host)
      expect(leftHost.shadowRoot?.querySelector('mn-graph-panel')).toBe(panel)

      renderWorkspace(config, {
        container: c,
        chrome: { leftPanelMode: 'files', rightPanel: 'graph' },
        graphPanel,
      })
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(c.querySelector('.split-pane[data-role="sidebar"] mn-sidebar-panel')).not.toBeNull()
      expect(c.querySelector('[data-graph-panel-location="right"]')).not.toBeNull()
      expect(c.querySelector('sh-graph-host')).toBe(host)
      expect(host.shadowRoot?.querySelector('mn-graph-panel')).toBe(panel)
    })

    it('leftPanelMode "outline" mounts mn-document-outline in the sidebar slot and threads headings/commands', async () => {
      const navigations: Array<{ blockId: string }> = []
      const commands: Array<{ command: string }> = []
      const headings = [
        { id: 'block-h1', level: 1, text: 'Intro' },
        { id: 'block-h2', level: 2, text: 'Details' },
      ]
      const outlinePanel = {
        documentOpen: true,
        headings,
        activeHeadingId: 'block-h2',
        onNavigate: (detail: { blockId: string }) => navigations.push(detail),
        onCommand: (detail: { command: string }) => commands.push(detail),
      }
      const c = renderWorkspace(config, {
        chrome: { leftPanelMode: 'outline' },
        outlinePanel,
      })
      document.body.appendChild(c)

      expect(c.querySelector('.split-pane[data-role="sidebar"] mn-sidebar-panel')).toBeNull()
      const panel = c.querySelector(
        '.split-pane[data-role="sidebar"] mn-document-outline',
      ) as HTMLElement & {
        documentOpen?: boolean
        headings?: unknown[]
        activeHeadingId?: string | null
      }
      expect(panel).not.toBeNull()
      expect(panel.documentOpen).toBe(true)
      expect(panel.headings).toBe(headings)
      expect(panel.activeHeadingId).toBe('block-h2')

      panel.dispatchEvent(
        new CustomEvent('mn-outline-navigate', {
          bubbles: true,
          composed: true,
          detail: { blockId: 'block-h1' },
        }),
      )
      panel.dispatchEvent(
        new CustomEvent('mn-outline-command', {
          bubbles: true,
          composed: true,
          detail: { command: 'zoomIn' },
        }),
      )
      expect(navigations).toEqual([{ blockId: 'block-h1' }])
      expect(commands).toEqual([{ command: 'zoomIn' }])

      // Switching back to files restores the normal file tree and drops the outline panel.
      renderWorkspace(config, {
        container: c,
        chrome: { leftPanelMode: 'files' },
        outlinePanel,
      })
      expect(c.querySelector('.split-pane[data-role="sidebar"] mn-document-outline')).toBeNull()
      expect(c.querySelector('.split-pane[data-role="sidebar"] mn-sidebar-panel')).not.toBeNull()
    })

    it('threads controlled daily-note home row, popover state, and intents', () => {
      const opened: DailyNoteOpenDetail[] = []
      const anchors: DailyNoteCalendarAnchorDetail[] = []
      let closed = 0
      const c = renderWorkspace(config, {
        leftCollapsed: true,
        rightCollapsed: true,
        dailyNotes: {
          todayKey: '2026-06-23',
          todayDoc: { id: 'daily-note-2026-06-23', updatedAt: 1782216000000 },
          showHomeRow: true,
          datesWithNotes: new Set(['2026-06-22', '2026-06-23']),
          popover: { x: 12, y: 34, viewedKey: '2026-06-23' },
          onOpenDate: detail => opened.push(detail),
          onCalendarAnchor: detail => anchors.push(detail),
          onClosePopover: () => { closed++ },
        },
      })

      const row = c.querySelector('mn-daily-note-row') as HTMLElement & {
        doc?: { id: string; updatedAt?: number } | null
      }
      const popover = c.querySelector('mn-month-popover') as HTMLElement & {
        datesWithNotes?: Set<string>
      }
      expect(c.querySelector('[data-daily-note-home]')).not.toBeNull()
      expect(row).not.toBeNull()
      expect(row.getAttribute('displayed-date')).toBe('2026-06-23')
      expect(row.doc).toEqual({ id: 'daily-note-2026-06-23', updatedAt: 1782216000000 })
      expect(c.querySelector('mn-daily-note-header')).toBeNull()
      expect(popover).not.toBeNull()
      expect(popover.getAttribute('x')).toBe('12')
      expect(popover.getAttribute('viewed-key')).toBe('2026-06-23')
      expect(popover.datesWithNotes?.has('2026-06-22')).toBe(true)

      row.dispatchEvent(new CustomEvent<DailyNoteOpenDetail>('daily-note-open-request', {
        bubbles: true,
        composed: true,
        detail: { dateKey: '2026-06-24' },
      }))
      row.dispatchEvent(new CustomEvent<DailyNoteCalendarAnchorDetail>('daily-note-calendar-anchor-request', {
        bubbles: true,
        composed: true,
        detail: { anchor: row },
      }))
      popover.dispatchEvent(new CustomEvent<DailyNoteOpenDetail>('date-select', {
        bubbles: true,
        composed: true,
        detail: { dateKey: '2026-06-25' },
      }))
      popover.dispatchEvent(new CustomEvent('mn-close', { bubbles: true, composed: true }))

      expect(opened).toEqual([{ dateKey: '2026-06-24' }, { dateKey: '2026-06-25' }])
      expect(anchors).toEqual([{ anchor: row }])
      expect(closed).toBe(1)
    })

    it('renders the daily-note header above the lifted editor anchor', () => {
      const radialContexts: WireRadialContextMap = new Map([
        ['wire-wire-a', { status: 'loading' }],
      ])
      const c = renderWorkspace(config, {
        leftCollapsed: true,
        rightCollapsed: true,
        editorHost: {
          get: () => ({
            centerMode: 'document',
            graphId: 'graph-a',
            documentId: 'daily-note-2026-06-23',
            status: 'idle',
            error: null,
            provider: null,
          }),
          subscribe: () => () => {},
        },
        editorWireRadialContexts: radialContexts,
        dailyNotes: {
          todayKey: '2026-06-23',
          activeDateKey: '2026-06-23',
          activeAdjacency: { before: 1, after: 0 },
        },
      })

      const frame = c.querySelector('[data-daily-note-editor-frame]')!
      expect(frame).not.toBeNull()
      expect(frame.querySelector('mn-daily-note-header')?.getAttribute('date-key')).toBe('2026-06-23')
      expect(frame.querySelector('#mn-main-editor')).not.toBeNull()
      expect((c.querySelector('#mn-editor-host') as ShEditorHost | null)?.wireRadialContexts).toBe(radialContexts)
    })

    it('rightPanels can select the configured Garden comments panel tag', () => {
      const c = renderWorkspace(config, { chrome: { rightPanels: ['comments'] } })
      const rightPane = c.querySelector('.split-pane[data-region="region-right-rail"]')!
      expect(rightPane.querySelector('.right-panel[data-panel="comments"] mn-comments-panel')).not.toBeNull()
      expect(rightPane.querySelector('mn-chat-panel')).toBeNull()
    })

    it('threads controlled comments panel state and intents through the render host', () => {
      const comments: readonly WorkspaceComment[] = [
        {
          id: 'comment-a',
          author: 'Vera',
          text: 'Tighten this phrasing.',
          quotedText: 'Selected passage',
          createdAt: 1700000000000,
          resolved: false,
          documentPosition: 42,
        },
      ]
      const selected: WorkspaceCommentDetail[] = []
      const hovered: WorkspaceCommentHoverDetail[] = []
      const edited: WorkspaceCommentEditDetail[] = []
      const resolved: WorkspaceCommentResolveDetail[] = []
      const deleted: WorkspaceCommentDetail[] = []

      const c = renderWorkspace(config, {
        chrome: { rightPanels: ['comments'] },
        comments: {
          comments,
          hoveredCommentId: 'comment-a',
          emptyShortcut: 'Ctrl+Shift+.',
          onSelect: (detail) => selected.push(detail),
          onHover: (detail) => hovered.push(detail),
          onEdit: (detail) => edited.push(detail),
          onResolve: (detail) => resolved.push(detail),
          onDelete: (detail) => deleted.push(detail),
        },
      })

      const panel = c.querySelector('.right-panel[data-panel="comments"] mn-comments-panel') as
        | (HTMLElement & {
            comments?: readonly WorkspaceComment[]
            hoveredCommentId?: string | null
            emptyShortcut?: string | null
          })
        | null
      expect(panel).not.toBeNull()
      expect(panel?.comments).toBe(comments)
      expect(panel?.hoveredCommentId).toBe('comment-a')
      expect(panel?.emptyShortcut).toBe('Ctrl+Shift+.')

      panel!.dispatchEvent(new CustomEvent<WorkspaceCommentDetail>('mn-comment-select', {
        bubbles: true,
        composed: true,
        detail: { id: 'comment-a', comment: comments[0] },
      }))
      panel!.dispatchEvent(new CustomEvent<WorkspaceCommentHoverDetail>('mn-comment-hover', {
        bubbles: true,
        composed: true,
        detail: { id: 'comment-a', comment: comments[0] },
      }))
      panel!.dispatchEvent(new CustomEvent<WorkspaceCommentEditDetail>('mn-comment-edit', {
        bubbles: true,
        composed: true,
        detail: { id: 'comment-a', comment: comments[0], text: 'Updated note' },
      }))
      panel!.dispatchEvent(new CustomEvent<WorkspaceCommentResolveDetail>('mn-comment-resolve', {
        bubbles: true,
        composed: true,
        detail: { id: 'comment-a', comment: comments[0], resolved: true },
      }))
      panel!.dispatchEvent(new CustomEvent<WorkspaceCommentDetail>('mn-comment-delete', {
        bubbles: true,
        composed: true,
        detail: { id: 'comment-a', comment: comments[0] },
      }))

      expect(selected).toEqual([{ id: 'comment-a', comment: comments[0] }])
      expect(hovered).toEqual([{ id: 'comment-a', comment: comments[0] }])
      expect(edited).toEqual([{ id: 'comment-a', comment: comments[0], text: 'Updated note' }])
      expect(resolved).toEqual([{ id: 'comment-a', comment: comments[0], resolved: true }])
      expect(deleted).toEqual([{ id: 'comment-a', comment: comments[0] }])
    })

    it('rightPanels can select the configured Garden inspector panel tag', () => {
      const c = renderWorkspace(config, { chrome: { rightPanels: ['inspector'] } })
      const rightPane = c.querySelector('.split-pane[data-region="region-right-rail"]')!
      expect(rightPane.querySelector('.right-panel[data-panel="inspector"] mn-inspector')).not.toBeNull()
      expect(rightPane.querySelector('mn-chat-panel')).toBeNull()
    })

    it('threads controlled inspector model, actions, and intents through the render host', () => {
      const model: WorkspaceInspectorModel = {
        identity: {
          kind: 'document',
          icon: 'file-text',
          title: 'Garden parity plan',
          typeLabel: 'Document',
          chips: [{ label: 'Document', value: 'doc-a', mono: true }],
        },
        relations: {
          scope: 'active',
          groups: [
            {
              key: 'comments',
              label: 'Comments',
              icon: 'message-square',
              items: [{ id: 'comment-a', primary: 'Needs a citation', secondary: 'Vera' }],
            },
          ],
        },
      }
      const inspectorActions: readonly WorkspaceInspectorAction[] = [
        { type: 'header', content: 'Document' },
        { id: 'inspect-comment', label: 'Inspect comment', icon: 'message-square' },
      ]
      const closes: number[] = []
      const actions: WorkspaceInspectorActionDetail[] = []
      const relations: WorkspaceInspectorRelationOpenDetail[] = []
      const c = renderWorkspace(config, {
        chrome: { rightPanels: ['inspector'] },
        inspector: {
          model,
          actions: inspectorActions,
          onClose: () => closes.push(1),
          onAction: (detail) => actions.push(detail),
          onRelationOpen: (detail) => relations.push(detail),
        },
      })

      const panel = c.querySelector('.right-panel[data-panel="inspector"] mn-inspector') as
        | (HTMLElement & {
            model?: WorkspaceInspectorModel | null
            actions?: readonly WorkspaceInspectorAction[]
          })
        | null
      expect(panel).not.toBeNull()
      expect(panel?.model).toBe(model)
      expect(panel?.actions).toBe(inspectorActions)

      panel!.dispatchEvent(new CustomEvent('mn-inspector-close', { bubbles: true, composed: true }))
      panel!.dispatchEvent(new CustomEvent<WorkspaceInspectorActionDetail>('mn-inspector-action', {
        bubbles: true,
        composed: true,
        detail: {
          id: 'inspect-comment',
          action: inspectorActions[1] as Extract<WorkspaceInspectorAction, { id: string }>,
          modifiers: { shiftKey: false, altKey: false, ctrlKey: false, metaKey: true },
        },
      }))
      panel!.dispatchEvent(new CustomEvent<WorkspaceInspectorRelationOpenDetail>('mn-inspector-relation-open', {
        bubbles: true,
        composed: true,
        detail: {
          groupKey: 'comments',
          id: 'comment-a',
          item: model.relations!.groups![0].items[0],
        },
      }))

      expect(closes).toEqual([1])
      expect(actions[0]).toMatchObject({ id: 'inspect-comment', modifiers: { metaKey: true } })
      expect(relations).toEqual([{ groupKey: 'comments', id: 'comment-a', item: model.relations!.groups![0].items[0] }])
    })

    it('threads controlled sidebar data and intents through the render host without component coupling', () => {
      const sections: readonly SidebarSection[] = [
        {
          id: 'documents',
          label: 'Documents',
          nodes: [
            { id: 'doc-a', label: 'A', kind: 'document', active: true },
            { id: 'doc-b', label: 'B', kind: 'document' },
          ],
        },
      ]
      const opened: SidebarNodeDetail[] = []
      const selected: SidebarNodeDetail[] = []
      const intended: SidebarNodeDetail[] = []
      const intentEnded: SidebarNodeDetail[] = []
      const dropped: SidebarNodeDropDetail[] = []
      const actions: SidebarActionDetail[] = []
      const searches: string[] = []
      const c = renderWorkspace(config, {
        sidebar: {
          sections,
          activeId: 'doc-a',
          selectedId: 'doc-b',
          searchQuery: 'A',
          onNodeOpen: (detail) => opened.push(detail),
          onNodeSelect: (detail) => selected.push(detail),
          onNodeIntent: (detail) => intended.push(detail),
          onNodeIntentEnd: (detail) => intentEnded.push(detail),
          onNodeDrop: (detail) => dropped.push(detail),
          onAction: (detail) => actions.push(detail),
          onSearchChange: (detail) => searches.push(detail.query),
        },
      })
      const sidebar = c.querySelector('mn-sidebar-panel') as HTMLElement & {
        sections?: readonly SidebarSection[]
        activeId?: string | null
        selectedId?: string | null
        searchQuery?: string
      }
      expect(sidebar).not.toBeNull()
      expect(sidebar.sections).toBe(sections)
      expect(sidebar.activeId).toBe('doc-a')
      expect(sidebar.selectedId).toBe('doc-b')
      expect(sidebar.searchQuery).toBe('A')

      sidebar.dispatchEvent(
        new CustomEvent<SidebarNodeDetail>('mn-sidebar-node-intent', {
          bubbles: true,
          composed: true,
          detail: { id: 'doc-b', node: sections[0].nodes![1] },
        }),
      )
      sidebar.dispatchEvent(
        new CustomEvent<SidebarNodeDetail>('mn-sidebar-node-intent-end', {
          bubbles: true,
          composed: true,
          detail: { id: 'doc-b', node: sections[0].nodes![1] },
        }),
      )
      sidebar.dispatchEvent(
        new CustomEvent<SidebarNodeDetail>('mn-sidebar-node-open', {
          bubbles: true,
          composed: true,
          detail: { id: 'doc-b', node: sections[0].nodes![1] },
        }),
      )
      sidebar.dispatchEvent(
        new CustomEvent<SidebarNodeDetail>('mn-sidebar-node-select', {
          bubbles: true,
          composed: true,
          detail: { id: 'doc-b', node: sections[0].nodes![1] },
        }),
      )
      sidebar.dispatchEvent(
        new CustomEvent<SidebarActionDetail>('mn-sidebar-action', {
          bubbles: true,
          composed: true,
          detail: { action: 'new-document' },
        }),
      )
      sidebar.dispatchEvent(
        new CustomEvent<{ query: string }>('mn-sidebar-search-change', {
          bubbles: true,
          composed: true,
          detail: { query: 'wire' },
        }),
      )
      sidebar.dispatchEvent(
        new CustomEvent<SidebarNodeDropDetail>('mn-sidebar-node-drop', {
          bubbles: true,
          composed: true,
          detail: {
            sourceId: 'doc-b',
            source: sections[0].nodes![1],
            targetId: 'doc-a',
            target: sections[0].nodes![0],
            position: 'before',
          },
        }),
      )

      expect(opened).toEqual([{ id: 'doc-b', node: sections[0].nodes![1] }])
      expect(selected).toEqual([{ id: 'doc-b', node: sections[0].nodes![1] }])
      expect(intended).toEqual([{ id: 'doc-b', node: sections[0].nodes![1] }])
      expect(intentEnded).toEqual([{ id: 'doc-b', node: sections[0].nodes![1] }])
      expect(dropped).toEqual([{
        sourceId: 'doc-b',
        source: sections[0].nodes![1],
        targetId: 'doc-a',
        target: sections[0].nodes![0],
        position: 'before',
      }])
      expect(actions).toEqual([{ action: 'new-document' }])
      expect(searches).toEqual(['wire'])
    })

    it('threads Wires panel context state through the render host without backend coupling', () => {
      const wireBundle: WireBundle = {
        outgoingWires: [
          {
            id: 'wire-a',
            predicate: 'http://mnemosyne.ai/vocab#supports',
            predicateLabel: 'supports',
            otherDocumentId: 'doc-target',
            otherGraphId: 'graph-a',
            otherTitle: 'Target',
            bidirectional: false,
          },
        ],
        incomingWires: [],
        wiredBlockIds: [],
      }
      const wireContexts: WireContextMap = new Map([
        ['wire-a', {
          status: 'ready',
          data: {
            mode: 'context',
            title: 'Target context',
            blocks: [],
          },
        }],
      ])
      const c = renderWorkspace(config, {
        chrome: { rightPanels: ['wires'] },
        editorWireBundle: wireBundle,
        wirePanelContexts: wireContexts,
        wirePanelLocalContext: {
          graphId: 'graph-a',
          documentId: 'doc-source',
          title: 'Source document',
        },
      })

      const panel = c.querySelector('.right-panel[data-panel="wires"] sh-wires-panel') as ShWiresPanel | null
      expect(panel?.bundle).toBe(wireBundle)
      expect(panel?.wireContexts).toBe(wireContexts)
      expect(panel?.localGraphId).toBe('graph-a')
      expect(panel?.localDocumentId).toBe('doc-source')
      expect(panel?.localDocumentTitle).toBe('Source document')
    })

    it('threads canonical Wires panel state, capabilities, and close intent through the render host', async () => {
      let closes = 0
      const c = renderWorkspace(config, {
        chrome: { rightPanels: ['wires'] },
        wirePanel: {
          status: 'error',
          error: 'Projection is unavailable',
          capabilities: { refresh: false, delete: false },
          localGraphId: 'graph-a',
          localDocumentId: 'doc-source',
          localDocumentTitle: 'Source document',
          onClose: () => { closes += 1 },
        },
      })
      document.body.appendChild(c)

      const panel = c.querySelector('.right-panel[data-panel="wires"] sh-wires-panel') as ShWiresPanel
      await panel.updateComplete
      expect(panel.status).toBe('error')
      expect(panel.error).toBe('Projection is unavailable')
      expect(panel.capabilities).toEqual({ refresh: false, delete: false })
      expect(panel.localDocumentTitle).toBe('Source document')
      expect(panel.shadowRoot!.querySelector('[data-wire-panel-refresh-all]')).toBeNull()
      ;(panel.shadowRoot!.querySelector('[data-wire-panel-close]') as HTMLButtonElement).click()
      expect(closes).toBe(1)
      c.remove()
    })

    it('threads shell-owned pinned wire cards through the render host overlay', () => {
      const pinnedDocs: PinnedWireDocument[] = [
        {
          id: 'pindoc-graph-a-doc-target',
          graphId: 'graph-a',
          documentId: 'doc-target',
          title: 'Target document',
          x: 32,
          y: 72,
        },
      ]
      const pinnedBlocks: PinnedWireBlock[] = [
        {
          id: 'pinblock-graph-a-doc-source-block-source',
          graphId: 'graph-a',
          documentId: 'doc-source',
          blockId: 'block-source',
          text: 'Source block text',
          documentTitle: 'Source document',
          x: 260,
          y: 72,
        },
      ]
      const pinnedNodes: PinnedWireNode[] = [
        {
          id: 'pinwire-graph-a-wire-out',
          wireId: 'wire-out',
          graphId: 'graph-a',
          predicate: 'http://mnemosyne.ai/vocab#supports',
          predicateLabel: 'supports',
          bidirectional: false,
          sourceGraphId: 'graph-a',
          sourceDocumentId: 'doc-source',
          sourceBlockId: 'block-source',
          sourceTitle: 'Source document',
          sourceText: 'Source block text',
          targetGraphId: 'graph-a',
          targetDocumentId: 'doc-target',
          targetBlockId: 'block-target',
          targetTitle: 'Target document',
          targetText: 'Target block text',
          x: 32,
          y: 72,
        },
      ]
      const pinnedBlockContexts: PinnedWireBlockContextMap = new Map([
        ['pinblock-graph-a-doc-source-block-source', {
          status: 'ready',
          data: {
            blocks: [
              { id: 'block-source', text: 'Source block text', isTarget: true },
            ],
          },
        }],
      ])
      const pinnedNodeContexts: PinnedWireNodeContextMap = new Map([
        ['pinwire-graph-a-wire-out:source', {
          status: 'ready',
          data: {
            blocks: [
              { id: 'block-source', text: 'Source block text', isTarget: true },
            ],
          },
        }],
      ])
      const c = renderWorkspace(config, {
        wirePinnedDocs: pinnedDocs,
        wirePinnedNodes: pinnedNodes,
        wirePinnedBlocks: pinnedBlocks,
        wirePinnedBlockContexts: pinnedBlockContexts,
        wirePinnedNodeContexts: pinnedNodeContexts,
      })

      const layer = c.querySelector('sh-wire-pinned-layer') as ShWirePinnedLayer | null
      expect(layer?.docs).toBe(pinnedDocs)
      expect(layer?.nodes).toBe(pinnedNodes)
      expect(layer?.blocks).toBe(pinnedBlocks)
      expect(layer?.blockContexts).toBe(pinnedBlockContexts)
      expect(layer?.nodeContexts).toBe(pinnedNodeContexts)
    })

    it('renders a controlled tag lens in the center and forwards tag view intents', () => {
      const refreshes: TagLensRefreshDetail[] = []
      const opens: TagLensOpenBlockDetail[] = []
      const c = renderWorkspace(config, {
        tagLens: {
          tagName: 'pragma',
          status: 'ready',
          blocks: [
            {
              id: 'doc-a:block-a',
              documentId: 'doc-a',
              documentTitle: 'A',
              blockId: 'block-a',
              text: 'Tagged block',
            },
          ],
          onRefresh: (detail) => refreshes.push(detail),
          onOpenBlock: (detail) => opens.push(detail),
        },
      })

      const center = c.querySelector('.split-pane[data-region="region-center"]')!
      const tagView = center.querySelector('mn-tag-view') as HTMLElement & {
        tag?: string
        status?: string
        blocks?: unknown[]
        error?: string
      }
      expect(tagView).not.toBeNull()
      expect(tagView.tag).toBe('pragma')
      expect(tagView.status).toBe('ready')
      expect(tagView.blocks).toEqual([
        {
          id: 'doc-a:block-a',
          documentId: 'doc-a',
          documentTitle: 'A',
          blockId: 'block-a',
          text: 'Tagged block',
        },
      ])
      expect(center.querySelector('mn-document-editor')).toBeNull()
      expect(c.querySelector('#mn-editor-host')).toBeNull()

      tagView.dispatchEvent(
        new CustomEvent<TagLensRefreshDetail>('mn-tag-view-refresh', {
          bubbles: true,
          composed: true,
          detail: { tagName: 'pragma' },
        }),
      )
      tagView.dispatchEvent(
        new CustomEvent<TagLensOpenBlockDetail>('mn-tag-view-open-block', {
          bubbles: true,
          composed: true,
          detail: {
            tagName: 'pragma',
            documentId: 'doc-a',
            blockId: 'block-a',
            block: {
              id: 'doc-a:block-a',
              documentId: 'doc-a',
              documentTitle: 'A',
              blockId: 'block-a',
              text: 'Tagged block',
            },
          },
        }),
      )

      expect(refreshes).toEqual([{ tagName: 'pragma' }])
      expect(opens).toEqual([
        {
          tagName: 'pragma',
          documentId: 'doc-a',
          blockId: 'block-a',
          block: {
            id: 'doc-a:block-a',
            documentId: 'doc-a',
            documentTitle: 'A',
            blockId: 'block-a',
            text: 'Tagged block',
          },
        },
      ])
    })

    it('renders a controlled Zotero source workbench in the center and forwards source intents', () => {
      const annotation: ZoteroSourceAnnotation = {
        key: 'ann-1',
        kind: 'highlight',
        text: 'Knowledge is situated.',
        page: '42',
      }
      const wire: ZoteroSourceIncomingWire = {
        id: 'wire-1',
        predicateLabel: 'quotes from',
        otherDocumentId: 'doc-reading',
        otherSnippet: 'A grounded reading note.',
      }
      const reloads: ZoteroSourceBaseDetail[] = []
      const zoteroOpens: ZoteroSourceOpenZoteroDetail[] = []
      const tags: ZoteroSourceOpenTagDetail[] = []
      const documents: ZoteroSourceOpenDocumentDetail[] = []
      const promotions: ZoteroSourcePromoteAnnotationDetail[] = []
      const c = renderWorkspace(config, {
        zoteroSource: {
          artifactId: 'zot-A1',
          zoteroKey: 'A1',
          graphId: 'graph-a',
          item: {
            key: 'A1',
            title: 'Situated Cognition',
            creatorSummary: 'Brown et al.',
            year: '1989',
            tags: ['cognition'],
          },
          annotations: [annotation],
          incomingWires: [wire],
          promotedAnnotationKeys: new Set(['ann-2']),
          loading: true,
          error: 'Could not reach Zotero.',
          onReload: detail => reloads.push(detail),
          onOpenZotero: detail => zoteroOpens.push(detail),
          onOpenTag: detail => tags.push(detail),
          onOpenDocument: detail => documents.push(detail),
          onPromoteAnnotation: detail => promotions.push(detail),
        },
      })

      const center = c.querySelector('.split-pane[data-region="region-center"]')!
      const source = center.querySelector('mn-zotero-source-workbench') as HTMLElement & {
        artifactId?: string
        zoteroKey?: string
        graphId?: string
        item?: unknown
        annotations?: unknown[]
        incomingWires?: unknown[]
        promotedAnnotationKeys?: Set<string>
        loading?: boolean
        error?: string
      }
      expect(source).not.toBeNull()
      expect(source.artifactId).toBe('zot-A1')
      expect(source.zoteroKey).toBe('A1')
      expect(source.graphId).toBe('graph-a')
      expect(source.item).toMatchObject({ title: 'Situated Cognition' })
      expect(source.annotations).toEqual([annotation])
      expect(source.incomingWires).toEqual([wire])
      expect(source.promotedAnnotationKeys?.has('ann-2')).toBe(true)
      expect(source.loading).toBe(true)
      expect(source.error).toBe('Could not reach Zotero.')
      expect(center.querySelector('mn-document-editor')).toBeNull()
      expect(c.querySelector('#mn-editor-host')).toBeNull()

      source.dispatchEvent(new CustomEvent<ZoteroSourceBaseDetail>('mn-zotero-source-reload', {
        bubbles: true,
        composed: true,
        detail: { artifactId: 'zot-A1', zoteroKey: 'A1', graphId: 'graph-a' },
      }))
      source.dispatchEvent(new CustomEvent<ZoteroSourceOpenZoteroDetail>('mn-zotero-source-open-zotero', {
        bubbles: true,
        composed: true,
        detail: { artifactId: 'zot-A1', zoteroKey: 'A1', graphId: 'graph-a', url: 'zotero://select/library/items/A1' },
      }))
      source.dispatchEvent(new CustomEvent<ZoteroSourceOpenTagDetail>('mn-zotero-source-open-tag', {
        bubbles: true,
        composed: true,
        detail: { artifactId: 'zot-A1', zoteroKey: 'A1', graphId: 'graph-a', tag: 'Cognition', normalizedTag: 'cognition' },
      }))
      source.dispatchEvent(new CustomEvent<ZoteroSourceOpenDocumentDetail>('mn-zotero-source-open-document', {
        bubbles: true,
        composed: true,
        detail: { artifactId: 'zot-A1', zoteroKey: 'A1', graphId: 'graph-a', documentId: 'doc-reading', wire },
      }))
      source.dispatchEvent(new CustomEvent<ZoteroSourcePromoteAnnotationDetail>('mn-zotero-source-promote-annotation', {
        bubbles: true,
        composed: true,
        detail: {
          artifactId: 'zot-A1',
          zoteroKey: 'A1',
          graphId: 'graph-a',
          annotation,
          annotationKey: 'ann-1',
          citation: 'Brown et al. (1989)',
        },
      }))

      expect(reloads).toEqual([{ artifactId: 'zot-A1', zoteroKey: 'A1', graphId: 'graph-a' }])
      expect(zoteroOpens).toEqual([
        { artifactId: 'zot-A1', zoteroKey: 'A1', graphId: 'graph-a', url: 'zotero://select/library/items/A1' },
      ])
      expect(tags).toEqual([
        { artifactId: 'zot-A1', zoteroKey: 'A1', graphId: 'graph-a', tag: 'Cognition', normalizedTag: 'cognition' },
      ])
      expect(documents).toEqual([
        { artifactId: 'zot-A1', zoteroKey: 'A1', graphId: 'graph-a', documentId: 'doc-reading', wire },
      ])
      expect(promotions).toEqual([
        {
          artifactId: 'zot-A1',
          zoteroKey: 'A1',
          graphId: 'graph-a',
          annotation,
          annotationKey: 'ann-1',
          citation: 'Brown et al. (1989)',
        },
      ])
    })

    it('renders a controlled artifact view in the center and forwards artifact intents', () => {
      const refreshes: ArtifactViewIntentDetail[] = []
      const historyOpens: ArtifactViewIntentDetail[] = []
      const editOpens: ArtifactViewIntentDetail[] = []
      const downloads: ArtifactViewIntentDetail[] = []
      const opens: ArtifactViewOpenDocumentDetail[] = []
      const historyCloses: ArtifactViewIntentDetail[] = []
      const historyRefreshes: ArtifactViewIntentDetail[] = []
      const historyRestores: ArtifactHistoryRevisionDetail[] = []
      const c = renderWorkspace(config, {
        artifact: {
          graphId: 'graph-a',
          artifactId: 'artifact-a',
          title: 'diagram.png',
          mimeType: 'image/png',
          fileType: 'png',
          artifactStatus: 'ready',
          ingestedDocumentId: 'doc-a',
          previewUrl: 'blob:artifact-a',
          status: 'ready',
          onRefresh: (detail) => refreshes.push(detail),
          onHistoryOpen: (detail) => historyOpens.push(detail),
          onEditOpen: (detail) => editOpens.push(detail),
          onDownload: (detail) => downloads.push(detail),
          onOpenDocument: (detail) => opens.push(detail),
          history: {
            graphId: 'graph-a',
            artifactId: 'artifact-a',
            status: 'ready',
            restoringRevisionId: 'rev-b',
            revisions: [
              {
                revisionId: 'rev-a',
                createdAt: '2026-06-23T10:00:00Z',
                label: 'Current',
                mimeType: 'image/png',
              },
              {
                revisionId: 'rev-b',
                createdAt: '2026-06-22T10:00:00Z',
                label: 'Before',
                filename: 'diagram.png',
              },
            ],
            onClose: (detail) => historyCloses.push(detail),
            onRefresh: (detail) => historyRefreshes.push(detail),
            onRestore: (detail) => historyRestores.push(detail),
          },
        },
      })

      const center = c.querySelector('.split-pane[data-region="region-center"]')!
      const shell = center.querySelector('[data-artifact-history-shell]')
      expect(shell).not.toBeNull()
      const artifact = center.querySelector('mn-artifact-view') as HTMLElement & {
        graphId?: string
        artifactId?: string
        title?: string
        mimeType?: string
        fileType?: string
        artifactStatus?: string
        ingestedDocumentId?: string
        previewUrl?: string
        status?: string
      }
      const history = center.querySelector('mn-artifact-history') as HTMLElement & {
        graphId?: string
        artifactId?: string
        status?: string
        revisions?: unknown[]
        restoringRevisionId?: string
      }
      expect(artifact).not.toBeNull()
      expect(history).not.toBeNull()
      expect(artifact.graphId).toBe('graph-a')
      expect(artifact.artifactId).toBe('artifact-a')
      expect(artifact.title).toBe('diagram.png')
      expect(artifact.mimeType).toBe('image/png')
      expect(artifact.fileType).toBe('png')
      expect(artifact.artifactStatus).toBe('ready')
      expect(artifact.ingestedDocumentId).toBe('doc-a')
      expect(artifact.previewUrl).toBe('blob:artifact-a')
      expect(artifact.status).toBe('ready')
      expect(history.graphId).toBe('graph-a')
      expect(history.artifactId).toBe('artifact-a')
      expect(history.status).toBe('ready')
      expect(history.revisions).toHaveLength(2)
      expect(history.restoringRevisionId).toBe('rev-b')
      expect(center.querySelector('mn-document-editor')).toBeNull()
      expect(c.querySelector('#mn-editor-host')).toBeNull()

      artifact.dispatchEvent(
        new CustomEvent<ArtifactViewIntentDetail>('mn-artifact-refresh', {
          bubbles: true,
          composed: true,
          detail: { graphId: 'graph-a', artifactId: 'artifact-a' },
        }),
      )
      artifact.dispatchEvent(
        new CustomEvent<ArtifactViewIntentDetail>('mn-artifact-history-open', {
          bubbles: true,
          composed: true,
          detail: { graphId: 'graph-a', artifactId: 'artifact-a' },
        }),
      )
      artifact.dispatchEvent(
        new CustomEvent<ArtifactViewIntentDetail>('mn-artifact-edit-open', {
          bubbles: true,
          composed: true,
          detail: { graphId: 'graph-a', artifactId: 'artifact-a' },
        }),
      )
      artifact.dispatchEvent(
        new CustomEvent<ArtifactViewIntentDetail>('mn-artifact-download', {
          bubbles: true,
          composed: true,
          detail: { graphId: 'graph-a', artifactId: 'artifact-a' },
        }),
      )
      artifact.dispatchEvent(
        new CustomEvent<ArtifactViewOpenDocumentDetail>('mn-artifact-open-document', {
          bubbles: true,
          composed: true,
          detail: { graphId: 'graph-a', artifactId: 'artifact-a', documentId: 'doc-a' },
        }),
      )
      history.dispatchEvent(
        new CustomEvent<ArtifactViewIntentDetail>('mn-artifact-history-close', {
          bubbles: true,
          composed: true,
          detail: { graphId: 'graph-a', artifactId: 'artifact-a' },
        }),
      )
      history.dispatchEvent(
        new CustomEvent<ArtifactViewIntentDetail>('mn-artifact-history-refresh', {
          bubbles: true,
          composed: true,
          detail: { graphId: 'graph-a', artifactId: 'artifact-a' },
        }),
      )
      history.dispatchEvent(
        new CustomEvent<ArtifactHistoryRevisionDetail>('mn-artifact-history-restore', {
          bubbles: true,
          composed: true,
          detail: { graphId: 'graph-a', artifactId: 'artifact-a', revisionId: 'rev-b' },
        }),
      )

      expect(refreshes).toEqual([{ graphId: 'graph-a', artifactId: 'artifact-a' }])
      expect(historyOpens).toEqual([{ graphId: 'graph-a', artifactId: 'artifact-a' }])
      expect(editOpens).toEqual([{ graphId: 'graph-a', artifactId: 'artifact-a' }])
      expect(downloads).toEqual([{ graphId: 'graph-a', artifactId: 'artifact-a' }])
      expect(opens).toEqual([{ graphId: 'graph-a', artifactId: 'artifact-a', documentId: 'doc-a' }])
      expect(historyCloses).toEqual([{ graphId: 'graph-a', artifactId: 'artifact-a' }])
      expect(historyRefreshes).toEqual([{ graphId: 'graph-a', artifactId: 'artifact-a' }])
      expect(historyRestores).toEqual([{ graphId: 'graph-a', artifactId: 'artifact-a', revisionId: 'rev-b' }])
    })

    it('renders the controlled artifact editor and forwards editor intents', () => {
      const cancels: ArtifactViewIntentDetail[] = []
      const saves: ArtifactEditorSaveDetail[] = []
      const generates: ArtifactEditorGenerateDetail[] = []
      const c = renderWorkspace(config, {
        artifact: {
          graphId: 'graph-a',
          artifactId: 'artifact-a',
          title: 'diagram.png',
          mimeType: 'image/png',
          fileType: 'png',
          artifactStatus: 'ready',
          previewUrl: 'blob:artifact-a',
          status: 'ready',
          editor: {
            open: true,
            srcUrl: 'data:image/png;base64,source',
            mimeType: 'image/png',
            prompt: 'make it blue',
            generationTarget: 'artifact',
            onCancel: (detail) => cancels.push(detail),
            onSave: (detail) => saves.push(detail),
            onGenerate: (detail) => generates.push(detail),
          },
        },
      })

      const center = c.querySelector('.split-pane[data-region="region-center"]')!
      const editor = center.querySelector('mn-artifact-editor') as HTMLElement & {
        srcUrl?: string
        mimeType?: string
        prompt?: string
        generationTarget?: string
      }
      expect(editor).not.toBeNull()
      expect(editor.srcUrl).toBe('data:image/png;base64,source')
      expect(editor.mimeType).toBe('image/png')
      expect(editor.prompt).toBe('make it blue')
      expect(editor.generationTarget).toBe('artifact')
      expect(center.querySelector('mn-artifact-view')).toBeNull()
      expect(center.querySelector('mn-artifact-history')).toBeNull()

      editor.dispatchEvent(new CustomEvent('mn-artifact-editor-cancel', { bubbles: true, composed: true }))
      editor.dispatchEvent(
        new CustomEvent('mn-artifact-editor-save', {
          bubbles: true,
          composed: true,
          detail: { dataUrl: 'data:image/png;base64,edited', mimeType: 'image/png' },
        }),
      )
      editor.dispatchEvent(
        new CustomEvent('mn-artifact-editor-generate', {
          bubbles: true,
          composed: true,
          detail: {
            dataUrl: 'data:image/png;base64,edited',
            mimeType: 'image/png',
            prompt: 'make it blue',
            target: 'artifact',
          },
        }),
      )

      expect(cancels).toEqual([{ graphId: 'graph-a', artifactId: 'artifact-a' }])
      expect(saves).toEqual([
        {
          graphId: 'graph-a',
          artifactId: 'artifact-a',
          dataUrl: 'data:image/png;base64,edited',
          mimeType: 'image/png',
        },
      ])
      expect(generates).toEqual([
        {
          graphId: 'graph-a',
          artifactId: 'artifact-a',
          dataUrl: 'data:image/png;base64,edited',
          mimeType: 'image/png',
          prompt: 'make it blue',
          target: 'artifact',
        },
      ])
    })

    it('renders the controlled document-history overlay and forwards history intents', () => {
      const cursors: DocHistoryCursorDetail[] = []
      const bookmarks: DocHistorySnapshotDetail[] = []
      const deletes: DocHistorySnapshotDetail[] = []
      const restores: DocHistoryRestoreDetail[] = []
      const styles: DocHistoryDiffStyleDetail[] = []
      let saves = 0
      let refreshes = 0
      let closes = 0

      const c = renderWorkspace(config, {
        docHistory: {
          title: 'Version History',
          subtitle: '2 captured snapshots for doc-a',
          status: 'ready',
          snapshots: [
            {
              id: 'snap-a',
              graphId: 'graph-a',
              documentId: 'doc-a',
              createdAt: '2026-06-23T10:00:00Z',
              label: 'Before edit',
              tier: '20min',
              isManual: true,
            },
          ],
          olderId: 'snap-a',
          newerId: 'live',
          focusedSide: 'older',
          olderText: 'before',
          newerText: 'after',
          diffStatus: 'ready',
          diffStyle: 'split',
          onCursorChange: (detail) => cursors.push(detail),
          onSaveCurrent: () => saves++,
          onBookmark: (detail) => bookmarks.push(detail),
          onDelete: (detail) => deletes.push(detail),
          onRestore: (detail) => restores.push(detail),
          onRefresh: () => refreshes++,
          onClose: () => closes++,
          onDiffStyleChange: (detail) => styles.push(detail),
        },
      })

      const host = c.querySelector('[data-doc-history-overlay]')
      expect(host).not.toBeNull()
      const history = host!.querySelector('mn-doc-history-panel') as HTMLElement & {
        title?: string
        subtitle?: string
        status?: string
        olderId?: string
        newerId?: string
        olderText?: string
        newerText?: string
      }
      expect(history).not.toBeNull()
      expect(history.title).toBe('Version History')
      expect(history.subtitle).toBe('2 captured snapshots for doc-a')
      expect(history.status).toBe('ready')
      expect(history.olderId).toBe('snap-a')
      expect(history.newerId).toBe('live')
      expect(history.olderText).toBe('before')
      expect(history.newerText).toBe('after')

      history.dispatchEvent(new CustomEvent<DocHistoryCursorDetail>('mn-doc-history-cursor-change', {
        bubbles: true,
        composed: true,
        detail: { olderId: 'snap-a', newerId: 'live', focusedSide: 'newer' },
      }))
      history.dispatchEvent(new CustomEvent('mn-doc-history-save-current', { bubbles: true, composed: true }))
      history.dispatchEvent(new CustomEvent<DocHistorySnapshotDetail>('mn-doc-history-bookmark', {
        bubbles: true,
        composed: true,
        detail: { snapshotId: 'snap-a' },
      }))
      history.dispatchEvent(new CustomEvent<DocHistorySnapshotDetail>('mn-doc-history-delete', {
        bubbles: true,
        composed: true,
        detail: { snapshotId: 'snap-a' },
      }))
      history.dispatchEvent(new CustomEvent<DocHistoryRestoreDetail>('mn-doc-history-restore', {
        bubbles: true,
        composed: true,
        detail: { snapshotId: 'snap-a' },
      }))
      history.dispatchEvent(new CustomEvent('mn-doc-history-refresh', { bubbles: true, composed: true }))
      history.dispatchEvent(new CustomEvent('mn-doc-history-close', { bubbles: true, composed: true }))
      history.dispatchEvent(new CustomEvent<DocHistoryDiffStyleDetail>('mn-doc-history-diff-style-change', {
        bubbles: true,
        composed: true,
        detail: { diffStyle: 'unified' },
      }))

      expect(cursors).toEqual([{ olderId: 'snap-a', newerId: 'live', focusedSide: 'newer' }])
      expect(saves).toBe(1)
      expect(bookmarks).toEqual([{ snapshotId: 'snap-a' }])
      expect(deletes).toEqual([{ snapshotId: 'snap-a' }])
      expect(restores).toEqual([{ snapshotId: 'snap-a' }])
      expect(refreshes).toBe(1)
      expect(closes).toBe(1)
      expect(styles).toEqual([{ diffStyle: 'unified' }])
    })

    it('chrome options reflect controlled shell state into the top and bottom bars', () => {
      const c = renderWorkspace(config, {
        app: 'choreograph',
        leftCollapsed: true,
        rightCollapsed: true,
        chrome: {
          activeApp: 'choreograph',
          leftPanelMode: 'graph',
          rightPanel: 'wires',
          isDark: true,
          activeSkin: '98',
          breadcrumbs: [
            { id: 'graph-a', label: 'Graph A', kind: 'graph' },
            { id: 'doc-a', label: 'Doc A', kind: 'document', current: true },
          ],
          itemCount: 7,
          documentStats: { words: 21, characters: 99 },
          presence: [{ id: 'user-a', name: 'User A', color: '#2563eb' }],
          syncState: 'synced',
          runtimeMode: 'hosted',
        },
      })
      const top = c.querySelector('mn-top-bar') as HTMLElement & {
        activeApp?: string
        isDark?: boolean
        activeSkin?: string
        breadcrumbs?: unknown[]
      }
      const bottom = c.querySelector('mn-bottom-bar') as HTMLElement & {
        leftCollapsed?: boolean
        rightCollapsed?: boolean
        leftPanelMode?: string
        panel?: string
        itemCount?: number | null
        documentStats?: unknown
        presence?: unknown[]
        syncState?: string
        runtimeMode?: string | null
      }
      expect(top.activeApp).toBe('choreograph')
      expect(top.isDark).toBe(true)
      expect(top.activeSkin).toBe('98')
      expect(top.breadcrumbs).toHaveLength(2)
      expect(bottom.leftCollapsed).toBe(true)
      expect(bottom.rightCollapsed).toBe(true)
      expect(bottom.leftPanelMode).toBe('graph')
      expect(bottom.panel).toBe('wires')
      expect(bottom.itemCount).toBe(7)
      expect(bottom.documentStats).toEqual({ words: 21, characters: 99 })
      expect(bottom.presence).toHaveLength(1)
      expect(bottom.syncState).toBe('synced')
      expect(bottom.runtimeMode).toBe('hosted')
    })

    it('renders the controlled dual-document center and forwards every pane intent', async () => {
      const opens: CenterPaneOpenIntentDetail[] = []
      const focuses: CenterPaneFocusIntentDetail[] = []
      const closes: CenterPaneCloseIntentDetail[] = []
      const navigations: CenterPaneNavigateIntentDetail[] = []
      const resizes: CenterPaneResizeIntentDetail[] = []
      const state = createCenterPanesState({
        primaryLocation: {
          kind: 'document', graphId: 'graph-a', documentId: 'doc-a', title: 'Doc A',
        },
        secondaryLocation: {
          kind: 'document', graphId: 'graph-a', documentId: 'doc-b', title: 'Doc B',
        },
      })

      const c = renderWorkspace(config, {
        centerPanes: {
          projection: projectCenterPanes(state),
          editorHosts: new Map(),
          onOpen: detail => opens.push(detail),
          onFocus: detail => focuses.push(detail),
          onClose: detail => closes.push(detail),
          onNavigate: detail => navigations.push(detail),
          onResize: detail => resizes.push(detail),
        },
      })
      const center = c.querySelector('.split-pane[data-role="center"]')!
      const host = center.querySelector('sh-center-panes') as HTMLElement
      expect(host).not.toBeNull()
      expect(center.querySelector('mn-document-editor')).toBeNull()
      expect(c.querySelector(':scope > sh-editor-host')).toBeNull()

      const emit = <T>(name: string, detail: T) => host.dispatchEvent(new CustomEvent<T>(name, {
        bubbles: true,
        composed: true,
        detail,
      }))
      emit<CenterPaneOpenIntentDetail>('mn-center-pane-open', {
        paneId: 'center-primary', placement: 'active', reason: 'choose-document', activate: true,
      })
      emit<CenterPaneFocusIntentDetail>('mn-center-pane-focus', {
        paneId: 'center-secondary', reason: 'pointer',
      })
      emit<CenterPaneCloseIntentDetail>('mn-center-pane-close', {
        paneId: 'center-secondary', reason: 'pane-command',
      })
      emit<CenterPaneNavigateIntentDetail>('mn-center-pane-navigate', {
        paneId: 'center-primary', direction: 'back',
      })
      emit<CenterPaneResizeIntentDetail>('mn-center-pane-resize', {
        dividerPercent: 61, source: 'keyboard',
      })

      expect(opens).toHaveLength(1)
      expect(focuses).toEqual([{ paneId: 'center-secondary', reason: 'pointer' }])
      expect(closes).toEqual([{ paneId: 'center-secondary', reason: 'pane-command' }])
      expect(navigations).toEqual([{ paneId: 'center-primary', direction: 'back' }])
      expect(resizes).toEqual([{ dividerPercent: 61, source: 'keyboard' }])
    })
  })

  describe('choreograph app spine (the 4th app dimension)', () => {
    const config = loadSeedConfig()

    it('app="choreograph" renders the wf-studio-shell leaf, not the garden split-tree', () => {
      const c = renderWorkspace(config, { app: 'choreograph' })
      // choreo spine head is region-choreo-center, a resizable LEAF → no splits.
      expect(c.querySelectorAll('sl-split-panel').length).toBe(0)
      // its resolved tag is the Choreograph Studio shell.
      expect(c.querySelector('wf-studio-shell')).not.toBeNull()
      // and the garden sidebar/editor do NOT appear in this app's spine.
      expect(c.querySelector('mn-sidebar-panel')).toBeNull()
      // shared chrome still present (top + bottom bar in the choreo set).
      expect(c.querySelector('header[data-region="region-top-bar"]')).not.toBeNull()
      expect(c.querySelector('footer[data-region="region-bottom-bar"]')).not.toBeNull()
    })
  })
})
