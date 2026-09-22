/**
 * Catalog — the Storybook FACE of the one catalog (iteration 3c).
 *
 * This file is NOT a hand-written list of stories. It GENERATES one story per
 * `CATALOG_ENTRIES` row (which is itself derived from the component-library
 * MANIFEST + the built-chrome set in catalog-model.ts). So the rule "every
 * manifested component has a story" holds BY CONSTRUCTION here, and the coherence
 * test (catalog-coherence.test.ts) reads the same model to PROVE it.
 *
 * Each entry renders its REAL custom element:
 *   - built chrome and controlled lifted panels upgrade and render live;
 *   - manifested-but-unbuilt panels (mn-document-editor) render as inert,
 *     clearly-labeled placeholders — never faked content.
 * The card around each shows the manifest face (persistence class, manifested?,
 * built?) so the two faces are visible side by side. Flip the Skin/Theme toolbar
 * globals to re-skin the whole catalog via the RDF-dimension cascade.
 */

import { html, type TemplateResult } from 'lit'
import type { Meta, StoryObj } from '@storybook/web-components'

// Side-effect import = the custom-element upgrade seam. After this, isBuilt() is
// true for the registered chrome tags.
import '@shrubbery/components'
// mn-vtuber (the WebGL/VRM avatar puppet) is registered by its own package —
// carved out of @shrubbery/components for its heavier @pixiv/three-vrm
// dependency. Same upgrade seam, separate side-effect import.
import '@shrubbery/atelier-vtuber'

import {
  CATALOG_ENTRIES,
  catalogEntryFor,
  isBuilt,
  type CatalogEntry,
} from '../catalog/catalog-model.js'

const meta: Meta = {
  title: 'Catalog/Components',
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj

/** Render the entry's REAL element, or a labeled inert placeholder if unbuilt. */
function renderMember(entry: CatalogEntry): TemplateResult {
  if (isBuilt(entry.tag)) {
    // Real, registered element. Chrome bars render zero-prop (inert slots). The
    // general primitives get REAL illustrative props (a real label / real number
    // series / real segments) so the card SHOWS the component working — these are
    // genuine props on the real element, not mock/faked content.
    const primitive = renderPrimitive(entry.tag)
    if (primitive) return html`<div class="member-live">${primitive}</div>`
    return html`<div class="member-live">${unsafeElement(entry.tag)}</div>`
  }
  // Manifested but not lifted in shrubbery yet → inert, clearly-labeled stand-in.
  return html`
    <div
      class="member-placeholder"
      data-placeholder-for=${entry.tag}
      style="display:flex;align-items:center;justify-content:center;min-height:56px;
             color:var(--mn-color-text-tertiary);font-family:ui-monospace,monospace;
             font-size:12px;border:1px dashed var(--mn-color-border-default);
             border-radius:var(--mn-radius-surface);"
    >
      ⟨ ${entry.tag} — inert placeholder (manifested, not yet lifted) ⟩
    </div>
  `
}

/**
 * Stamp a custom element by tag without a static literal (the catalog is
 * data-driven). Lit's `html` does not template a dynamic tag name, so we build
 * the element imperatively — this is still the REAL @customElement, not a mock.
 */
function unsafeElement(tag: string): HTMLElement {
  return document.createElement(tag)
}

/**
 * REAL illustrative renders for the general primitives — the actual custom
 * elements with genuine props (no mock arg bags). Returns null for tags that
 * aren't a general primitive (chrome bars render zero-prop). Flip the Skin/Theme
 * toolbar globals to see each primitive re-skin via the token cascade.
 */
function renderPrimitive(tag: string): TemplateResult | null {
  switch (tag) {
    case 'mn-chip':
      return html`
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
          <mn-chip glyph="◆" label="tokens" tone="neutral"></mn-chip>
          <mn-chip glyph="●" label="done" tone="success"></mn-chip>
          <mn-chip glyph="⚠" label="failed" tone="danger"></mn-chip>
          <mn-chip label="replay" tone="muted" dashed></mn-chip>
        </div>
      `
    case 'mn-badge':
      return html`
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
          <mn-badge state="active" glyph="●" label="active"></mn-badge>
          <mn-badge state="success" glyph="✓" label="verified" settle></mn-badge>
          <mn-badge state="danger" glyph="⚠" label="drifted"></mn-badge>
          <mn-badge state="neutral" glyph="◌" label="checking…" interactive spin></mn-badge>
          <mn-badge variant="primary" size="sm" pill>GCAL</mn-badge>
          <mn-badge variant="filetype" filetype="pdf" size="sm">PDF</mn-badge>
        </div>
      `
    case 'mn-sparkline':
      return html`
        <div style="display:flex;gap:12px;align-items:center;">
          <mn-sparkline .values=${[3, 7, 4, 9, 6, 11, 8]} hint="tokens/run"></mn-sparkline>
          <mn-sparkline .values=${[8, 6, 7, 4, 5, 2]} tone="danger" hint="errors"></mn-sparkline>
        </div>
      `
    case 'mn-ribbon':
      return html`
        <mn-ribbon
          .segments=${[
            { label: 'Perceive', title: 'observe' },
            { label: 'Refine', title: 'middle' },
            { label: 'Judge', title: 'review' },
            { label: 'Emit', title: 'output' },
          ]}
          .active=${2}
          showLabels
        ></mn-ribbon>
      `
    case 'mn-card':
      return html`
        <mn-card>
          <span slot="header">Card header</span>
          A general catalogue card — header/body/footer slots, skin-aware frame.
          <span slot="footer"><mn-chip label="footer chip" tone="accent"></mn-chip></span>
        </mn-card>
      `
    case 'mn-relations':
      return html`
        <mn-relations
          .relations=${[
            { from: 'AgentNode', to: 'Workflow', predicate: 'wf:partOfWorkflow', kind: 'predicate', note: 'workflow doc URI' },
            { from: 'Variant', to: 'Archetype', predicate: 'wf:optimizesArchetype', kind: 'predicate' },
            { from: 'node doc', to: 'node doc', predicate: 'flowsInto', kind: 'wire', note: 'trace edges' },
          ]}
          interactive
        ></mn-relations>
      `
    case 'mn-graph':
      // The SAME relationship read-model mn-relations consumes, drawn as a layered
      // DAG: classes as nodes, predicate-range edges (solid) + a CRDT wire (dashed).
      return html`
        <mn-graph
          .nodes=${[
            { id: 'AgentNode' },
            { id: 'Workflow' },
            { id: 'Variant' },
            { id: 'Archetype' },
          ]}
          .edges=${[
            { from: 'AgentNode', to: 'Workflow', predicate: 'wf:partOfWorkflow', kind: 'predicate', note: 'workflow doc URI' },
            { from: 'Variant', to: 'Archetype', predicate: 'wf:optimizesArchetype', kind: 'predicate' },
            { from: 'AgentNode', to: 'AgentNode', predicate: 'flowsInto', kind: 'wire', note: 'trace edges' },
          ]}
          interactive
        ></mn-graph>
      `
    case 'mn-graph-three':
      // The same graph substrate, rendered through the Garden-derived Three/WebGL
      // network viewer: flat z=0 force layout, raycast selection, wire particles.
      return html`
        <div style="height:360px;border:1px solid var(--mn-color-border-default);overflow:hidden;">
          <mn-graph-three
            style="height:100%;"
            .nodes=${[
              { id: 'agent', label: 'Agent' },
              { id: 'prompt', label: 'System Prompt' },
              { id: 'tools', label: 'Tools' },
              { id: 'graph', label: 'Graph' },
              { id: 'journal', label: 'Journal' },
              { id: 'session', label: 'Session' },
            ]}
            .edges=${[
              { from: 'agent', to: 'prompt', predicate: 'runs with', kind: 'predicate' },
              { from: 'agent', to: 'tools', predicate: 'has tools', kind: 'wire' },
              { from: 'agent', to: 'graph', predicate: 'writes graph', kind: 'predicate' },
              { from: 'agent', to: 'journal', predicate: 'records', kind: 'wire' },
              { from: 'session', to: 'agent', predicate: 'hosts', kind: 'predicate' },
            ]}
            interactive
            fullscreenable
            hint="Agent graph network"
          ></mn-graph-three>
        </div>
      `
    case 'mn-graph-panel':
      return html`
        <div style="height:360px;border:1px solid var(--mn-color-border-default);overflow:hidden;">
          <mn-graph-panel
            title="Workspace Graph"
            status="ready"
            .nodes=${[
              { id: 'graph:catalog', label: 'catalog', kind: 'graph' },
              { id: 'doc:plan', label: 'Garden parity plan', kind: 'document', documentId: 'plan' },
              { id: 'doc:wires', label: 'Wire notes', kind: 'document', documentId: 'wires' },
              { id: 'artifact:diagram', label: 'diagram.png', kind: 'artifact', artifactId: 'diagram' },
            ]}
            .edges=${[
              { from: 'graph:catalog', to: 'doc:plan', predicate: 'contains' },
              { from: 'graph:catalog', to: 'artifact:diagram', predicate: 'contains' },
              { from: 'doc:plan', to: 'doc:wires', predicate: 'supports', kind: 'wire' },
            ]}
          ></mn-graph-panel>
        </div>
      `
    case 'mn-spinner':
      return html`
        <div style="display:flex;gap:14px;align-items:center;">
          <mn-spinner size="sm" label="Loading small"></mn-spinner>
          <mn-spinner size="md" label="Loading medium"></mn-spinner>
          <mn-spinner size="lg" label="Loading large"></mn-spinner>
        </div>
      `
    case 'mn-loading':
      return html`
        <div style="display:flex;flex-direction:column;gap:10px;align-items:flex-start;">
          <mn-loading text="Loading graph"></mn-loading>
          <mn-loading variant="dots" size="sm" text="Syncing"></mn-loading>
          <mn-loading variant="skeleton" size="md"></mn-loading>
        </div>
      `
    case 'mn-empty-state':
      return html`
        <mn-empty-state
          icon="inbox"
          title="No blocks yet"
          description="Create a document or open a graph to populate this panel."
          variant="compact"
        >
          <mn-chip slot="action" label="ready" tone="muted"></mn-chip>
        </mn-empty-state>
      `
    case 'mn-continuity-status':
      return html`
        <div style="display:flex;flex-direction:column;gap:10px;min-width:min(520px, 100%);">
          <mn-continuity-status
            state="reconnecting"
            detail="Recent work remains available."
          ></mn-continuity-status>
          <mn-continuity-status
            state="error"
            label="Could not refresh this view"
            action-label="Try again"
            variant="inline"
          ></mn-continuity-status>
        </div>
      `
    case 'mn-artifact-view':
      return html`
        <div style="height:360px;border:1px solid var(--mn-color-border-default);overflow:hidden;">
          <mn-artifact-view
            graphId="graph-catalog"
            artifactId="artifact-image"
            title="diagram.png"
            mimeType="image/png"
            artifactStatus="ready"
            status="ready"
            previewUrl="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='360' viewBox='0 0 640 360'%3E%3Crect width='640' height='360' fill='%23f8fafc'/%3E%3Ccircle cx='210' cy='180' r='70' fill='%23bfdbfe'/%3E%3Crect x='310' y='120' width='140' height='120' rx='12' fill='%2386efac'/%3E%3Cpath d='M280 180h30' stroke='%23111827' stroke-width='6' stroke-linecap='round'/%3E%3Ctext x='320' y='292' font-family='system-ui' font-size='22' fill='%23374151'%3Eartifact preview%3C/text%3E%3C/svg%3E"
          ></mn-artifact-view>
        </div>
      `
    case 'mn-artifact-editor':
      return html`
        <div style="height:380px;border:1px solid var(--mn-color-border-default);overflow:hidden;">
          <mn-artifact-editor
            mimeType="image/png"
            prompt="turn this into an annotated blueprint"
            srcUrl="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='360' viewBox='0 0 640 360'%3E%3Crect width='640' height='360' fill='%23f8fafc'/%3E%3Ccircle cx='210' cy='180' r='70' fill='%23bfdbfe'/%3E%3Crect x='310' y='120' width='140' height='120' rx='12' fill='%2386efac'/%3E%3Cpath d='M280 180h30' stroke='%23111827' stroke-width='6' stroke-linecap='round'/%3E%3Ctext x='320' y='292' font-family='system-ui' font-size='22' fill='%23374151'%3Eeditable artifact%3C/text%3E%3C/svg%3E"
          ></mn-artifact-editor>
        </div>
      `
    case 'mn-excalidraw-canvas':
      return html`
        <div style="height:460px;border:1px solid var(--mn-color-border-default);overflow:hidden;">
          <mn-excalidraw-canvas
            graphId="graph-catalog"
            artifactId="artifact-scene"
            title="System Map"
            status="ready"
            save-status="saved"
            projection-status="ready"
            sync-status="idle"
            hydrate-status="idle"
            previewUrl="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='720' height='420' viewBox='0 0 720 420'%3E%3Crect width='720' height='420' fill='%23f8fafc'/%3E%3Crect x='92' y='120' width='180' height='96' rx='12' fill='%23dbeafe' stroke='%232563eb' stroke-width='3'/%3E%3Crect x='448' y='128' width='176' height='88' rx='12' fill='%23dcfce7' stroke='%2316a34a' stroke-width='3'/%3E%3Cpath d='M276 168 C340 132 390 132 444 168' fill='none' stroke='%23111827' stroke-width='4' stroke-linecap='round'/%3E%3Cpath d='M434 158 L448 168 L434 178' fill='none' stroke='%23111827' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/%3E%3Ccircle cx='360' cy='282' r='46' fill='%23fef3c7' stroke='%23d97706' stroke-width='3'/%3E%3Cpath d='M182 216 C220 288 274 302 314 286' fill='none' stroke='%236b7280' stroke-width='3' stroke-dasharray='8 8'/%3E%3Ctext x='136' y='176' font-family='system-ui' font-size='20' fill='%23111827'%3EPlan%3C/text%3E%3Ctext x='488' y='180' font-family='system-ui' font-size='20' fill='%23111827'%3ERuntime%3C/text%3E%3Ctext x='336' y='289' font-family='system-ui' font-size='18' fill='%23111827'%3EWire%3C/text%3E%3C/svg%3E"
            .projection=${{
              anchors: 2,
              arrows: 2,
              wireCandidates: 1,
              text: 3,
              frames: 0,
              diagnostics: 1,
              searchText: 'Plan Runtime Wire',
            }}
            .wireSummary=${{
              missing: 1,
              hydratable: 2,
              created: 6,
              hydrated: 4,
              lastMessage: 'One scene arrow is ready to sync.',
            }}
            .selectedElement=${{
              id: 'el-plan',
              type: 'rectangle',
              label: 'Plan',
              linkKind: 'document',
              linkTargetId: 'doc-plan',
              linkTitle: 'Garden parity plan',
              predicate: 'supports',
              canRecreateTarget: false,
            }}
            .predicateOptions=${[
              { value: 'supports', label: 'supports' },
              { value: 'critiques', label: 'critiques' },
              { value: 'references', label: 'references' },
            ]}
            .diagnostics=${[
              { code: 'link-title-stale', message: 'Scene label differs from linked document title.', severity: 'warning', sceneElementId: 'el-plan' },
            ]}
            .linkCandidates=${[
              { kind: 'document', id: 'doc-plan', title: 'Garden parity plan', iconName: 'file-text' },
              { kind: 'artifact', id: 'artifact-reference', title: 'Reference diagram', mimeType: 'image/png', iconName: 'package' },
            ]}
          ></mn-excalidraw-canvas>
        </div>
      `
    case 'mn-doc-history-panel':
      return html`
        <div style="height:430px;border:1px solid var(--mn-color-border-default);overflow:hidden;">
          <mn-doc-history-panel
            title="Document History"
            subtitle="Garden parity plan"
            status="ready"
            olderId="snap-2h"
            newerId="live"
            focusedSide="older"
            diffStyle="split"
            olderText=${'## Plan\n\n- Port chat\n- Port editor\n- Check graph'}
            newerText=${'## Plan\n\n- Port chat\n- Port editor ergonomics\n- Check graph\n- Ship history panel'}
            .snapshots=${[
              { id: 'snap-20m', createdAt: Date.now() - 20 * 60_000, tier: '20min', snapshotCount: 1 },
              { id: 'snap-2h', label: 'Before editor pass', createdAt: Date.now() - 2 * 60 * 60_000, tier: '2h', isManual: true, snapshotCount: 2 },
              { id: 'snap-day', createdAt: Date.now() - 26 * 60 * 60_000, tier: 'daily', blocksModified: 4 },
            ]}
          ></mn-doc-history-panel>
        </div>
      `
    case 'mn-original-viewer':
      return html`
        <div style="height:430px;border:1px solid var(--mn-color-border-default);overflow:hidden;">
          <mn-original-viewer
            status="ready"
            kind="epub"
            graphId="graph-catalog"
            documentId="doc-original"
            title="Original Source"
            filename="source.epub"
            mimeType="application/epub+zip"
            downloadable
            .chapters=${[
              { id: 'intro', title: 'Intro', text: 'Original source text rendered from a shell-owned EPUB preview.' },
              { id: 'notes', title: 'Notes', text: 'Second chapter preview text.' },
            ]}
            .annotations=${[
              { id: 'ann-a', label: 'Source comment', quote: 'Highlighted source evidence', pageNumber: 4 },
            ]}
          ></mn-original-viewer>
        </div>
      `
    case 'mn-comment-popover':
      return html`
        <div style="position:relative;min-height:250px;overflow:hidden;border:1px solid var(--mn-color-border-default);border-radius:8px;">
          <mn-comment-popover
            mode="pinned"
            editable
            quoted-text="Selected document text that anchors this comment."
            style="position:relative;display:block;min-height:250px;--mn-comment-popover-position:absolute;"
            .x=${16}
            .y=${16}
            .zIndex=${1}
            .comment=${{
              id: 'comment-catalog',
              author: 'Vera',
              text: 'Check this claim against the source before resolving.',
              createdAt: Date.now() - 12 * 60_000,
            }}
          ></mn-comment-popover>
        </div>
      `
    case 'wf-choreograph-view':
      return html`
        <div style="height:360px;border:1px solid var(--mn-color-border-default);overflow:hidden;">
          <wf-choreograph-view
            mode="history"
            graphId="graph-catalog"
            status="ready"
            .history=${[
              { runId: 'run-draft-review', workflowName: 'Draft review', status: 'finished', startedAt: Date.now() - 15 * 60_000, durationMs: 4200 },
              { runId: 'run-gate-check', workflowName: 'Gate check', status: 'running', startedAt: Date.now() - 3 * 60_000 },
            ]}
          ></wf-choreograph-view>
        </div>
      `
    case 'wf-mission-control':
      return html`
        <div style="height:360px;border:1px solid var(--mn-color-border-default);overflow:hidden;">
          <wf-mission-control
            mode="history"
            graphId="graph-catalog"
            status="ready"
            .history=${[
              { runId: 'run-draft-review', workflowName: 'Draft review', status: 'finished', startedAt: Date.now() - 15 * 60_000, durationMs: 4200 },
              { runId: 'run-gate-check', workflowName: 'Gate check', status: 'running', startedAt: Date.now() - 3 * 60_000 },
            ]}
          ></wf-mission-control>
        </div>
      `
    case 'wf-studio-shell':
      return html`
        <div style="height:430px;border:1px solid var(--mn-color-border-default);overflow:hidden;">
          <wf-studio-shell
            screen="run"
            graphId="graph-catalog"
            runId="run-draft-review"
            monitor-status="ready"
            .provenance=${{
              runId: 'run-draft-review',
              workflowName: 'Draft review',
              status: 'running',
              agentRuns: [
                { id: 'agent-reviewer', label: 'Reviewer', status: 'finished', durationMs: 1200, resultRef: 'doc:review' },
              ],
            }}
            .telemetry=${{
              runId: 'run-draft-review',
              workflowName: 'Draft review',
              status: 'running',
              phases: [
                {
                  phaseIndex: 0,
                  label: 'Review',
                  status: 'active',
                  nodes: [
                    { id: 'node-reviewer', label: 'Reviewer', status: 'running', outputFragment: 'Checking evidence.' },
                  ],
                },
              ],
            }}
          ></wf-studio-shell>
        </div>
      `
    case 'mn-input':
      return html`
        <mn-input
          label="Document title"
          value="Garden parity plan"
          helper-text="Controlled text input with Garden events."
          clearable
        ></mn-input>
      `
    case 'mn-textarea':
      return html`
        <mn-textarea
          label="Notes"
          value="Port core primitives, then replace one-off controls."
          helper-text="Multiline Garden primitive."
          maxlength="96"
          rows="3"
        ></mn-textarea>
      `
    case 'mn-search-input':
      return html`
        <mn-search-input value="outliner" placeholder="Search blocks" shortcut="Mod+K"></mn-search-input>
      `
    case 'mn-tooltip':
      return html`
        <mn-tooltip label="Save document" shortcut="Mod+S">
          <mn-button label="Hover for tooltip" icon="check" variant="secondary" size="sm"></mn-button>
        </mn-tooltip>
      `
    case 'mn-avatar':
      return html`
        <div style="display:flex;align-items:center;padding-left:8px;">
          <mn-avatar initials="VC" presence="online" ring></mn-avatar>
          <mn-avatar icon-name="bot" presence="away" group></mn-avatar>
          <mn-avatar icon-name="user" presence="offline" group></mn-avatar>
        </div>
      `
    case 'mn-vtuber':
      return html`
        <div style="width:220px;height:292px;border:1px solid var(--mn-color-border-default);border-radius:8px;overflow:hidden;">
          <mn-vtuber
            label="Catalog VTuber"
            expression="excited"
            .mouth=${0.42}
            .lookX=${0.18}
            .lookY=${0.08}
            camera-frame="bust"
            .animated=${false}
          ></mn-vtuber>
        </div>
      `
    case 'mn-panel-header':
      return html`
        <div style="border:1px solid var(--mn-color-border-default);border-radius:8px;overflow:hidden;">
          <mn-panel-header title="Wires" count="5" collapsible>
            <span slot="icon">#</span>
            <mn-icon-button slot="actions" icon="more-horizontal" label="More actions" size="sm"></mn-icon-button>
          </mn-panel-header>
        </div>
      `
    case 'mn-dropdown-button':
      return html`
        <mn-dropdown-button
          label="Actions"
          icon-name="more-horizontal"
          variant="toolbar"
          selected-id="doc.open"
          .entries=${[
            { type: 'header', content: 'Document' },
            { id: 'doc.open', label: 'Open', icon: 'file-text', shortcut: 'Enter', checked: true },
            { type: 'divider' },
            { id: 'doc.delete', label: 'Delete', icon: 'trash', variant: 'danger' },
          ]}
        ></mn-dropdown-button>
      `
    case 'mn-inline-edit':
      return html`<mn-inline-edit value="Garden parity plan"></mn-inline-edit>`
    case 'mn-toast':
      return html`
        <mn-toast
          visible
          type="success"
          position="bottom-right"
          message="Saved"
          description="Document updated"
          action-text="Undo"
          duration="0"
          auto-remove="false"
          style="position:relative;right:auto;bottom:auto;max-width:360px;"
        ></mn-toast>
      `
    case 'mn-modal':
      return html`
        <div style="min-height:240px;position:relative;">
          <mn-modal
            open
            .lockBodyScroll=${false}
            style="position:relative;inset:auto;z-index:0;display:flex;min-height:240px;"
          >
            <span slot="header">Rename Document</span>
            <p style="margin:0;">A general Garden modal shell with slots and composed close intents.</p>
            <span slot="footer">
              <mn-button label="Cancel" variant="secondary" size="sm"></mn-button>
              <mn-button label="Save" variant="primary" size="sm"></mn-button>
            </span>
          </mn-modal>
        </div>
      `
    case 'mn-dialog':
      return html`
        <div style="min-height:220px;position:relative;">
          <mn-dialog open size="md" style="display:block;">
            <span slot="header">Comment</span>
            <p style="margin:0;">Native Garden dialog primitive for rich editor flows.</p>
            <span slot="footer">
              <mn-button label="Cancel" variant="secondary" size="sm"></mn-button>
              <mn-button label="Save" variant="primary" size="sm"></mn-button>
            </span>
          </mn-dialog>
        </div>
      `
    case 'mn-toolbar-overflow':
      return html`
        <div style="width:190px;max-width:100%;padding:4px;border:1px solid var(--mn-color-border-default);border-radius:8px;">
          <mn-toolbar-overflow style="width:100%;">
            <mn-button data-priority="4" label="Bold" icon="bold" shortcut="Mod+B" variant="toolbar" size="sm"></mn-button>
            <mn-button data-priority="3" label="Italic" icon="italic" shortcut="Mod+I" variant="toolbar" size="sm"></mn-button>
            <mn-button data-priority="2" label="Link" icon="link" shortcut="Mod+K" variant="toolbar" size="sm"></mn-button>
            <mn-button data-priority="1" label="Quote" icon="quote" variant="toolbar" size="sm"></mn-button>
          </mn-toolbar-overflow>
        </div>
      `
    case 'mn-tag-chip-specimen':
      return html`
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
          <mn-tag-chip-specimen .attrs=${{ name: 'todo', date: '2026-06-23' }}></mn-tag-chip-specimen>
          <mn-tag-chip-specimen .attrs=${{ name: 'decision', date: null }} selected></mn-tag-chip-specimen>
          <mn-tag-chip-specimen name="research"></mn-tag-chip-specimen>
        </div>
      `
    case 'mn-tag-autocomplete-popover':
      return html`
        <mn-tag-autocomplete-popover
          style="position:relative;"
          .selectedIndex=${1}
          .items=${[
            { name: 'event', description: 'A scheduled happening.', isCore: true },
            { name: 'todo', description: 'An action item.', isCore: true },
            { name: 'research', description: 'Custom graph tag.', isCore: false },
          ]}
        ></mn-tag-autocomplete-popover>
      `
    case 'mn-calendar-event-specimen':
      return html`
        <mn-calendar-event-specimen
          .attrs=${{
            id: 'event-catalog',
            timeStart: '2026-06-23T14:00',
            timeEnd: '2026-06-23T14:45',
            allDay: false,
            title: 'Garden parity review',
            location: 'Studio',
            annotation: 'Check calendar atoms against the port plan.',
            source: 'gcal',
            externalEventId: 'gcal-catalog',
          }}
        ></mn-calendar-event-specimen>
      `
    case 'mn-daily-note-header':
      return html`
        <mn-daily-note-header
          date-key="2026-06-23"
          today-key="2026-06-23"
          .adjacency=${{ before: 3, after: 2 }}
        ></mn-daily-note-header>
      `
    case 'mn-daily-note-row':
      return html`
        <mn-daily-note-row
          displayed-date="2026-06-23"
          today-key="2026-06-23"
          .doc=${{ id: 'daily-note-2026-06-23', updatedAt: Date.now() - 2 * 60 * 60 * 1000 }}
        ></mn-daily-note-row>
      `
    case 'mn-month-popover':
      return html`
        <div style="position:relative;min-height:400px;">
          <mn-month-popover
            x="0"
            y="0"
            today-key="2026-06-23"
            viewed-key="2026-06-23"
            .datesWithNotes=${new Set(['2026-06-21', '2026-06-23', '2026-06-28'])}
            style="position:absolute;"
          ></mn-month-popover>
        </div>
      `
    case 'mn-context-menu':
      return html`
        <mn-context-menu
          open
          style="position:relative;left:auto;top:auto;opacity:1;transform:none;pointer-events:auto;"
          .items=${[
            { type: 'header', content: 'Document' },
            { id: 'doc.open', label: 'Open', icon: 'file-text', shortcut: 'Enter' },
            { id: 'doc.rename', label: 'Rename', icon: 'edit-3' },
            { type: 'divider' },
            { id: 'doc.delete', label: 'Delete', icon: 'trash', variant: 'danger' },
          ]}
        ></mn-context-menu>
      `
    case 'mn-input-dialog':
      return html`
        <div style="min-height:240px;position:relative;">
          <mn-input-dialog
            open
            title="Rename Document"
            message="Enter a new name for this document."
            value="Garden parity plan"
            placeholder="Document name"
            confirm-text="Rename"
            style="position:relative;inset:auto;z-index:0;display:flex;min-height:240px;"
          ></mn-input-dialog>
        </div>
      `
    case 'mn-confirmation-dialog':
      return html`
        <div style="min-height:240px;position:relative;">
          <mn-confirmation-dialog
            open
            title="Delete Document"
            message="This action cannot be undone."
            confirm-text="Delete"
            variant="danger"
            style="position:relative;inset:auto;z-index:0;display:flex;min-height:240px;"
          ></mn-confirmation-dialog>
        </div>
      `
    case 'mn-shortcuts-dialog':
      return html`
        <div style="min-height:360px;position:relative;">
          <mn-shortcuts-dialog
            open
            platform="mac"
            .commands=${[
              { id: 'panel.toggle.chat', label: 'Toggle Chat Panel', category: 'View', shortcut: 'Mod+Shift+C', keywords: ['assistant'] },
              { id: 'editor.footnote', label: 'Insert Footnote', category: 'Editor', shortcut: 'Mod+Shift+F', keywords: ['citation'] },
              { id: 'document.open', label: 'Open Document', category: 'Document', shortcut: 'Enter' },
            ]}
            style="position:relative;inset:auto;z-index:0;display:flex;min-height:360px;"
          ></mn-shortcuts-dialog>
        </div>
      `
    case 'mn-advanced-wire-menu':
      return html`
        <div style="min-height:420px;position:relative;">
          <mn-advanced-wire-menu
            open
            direction="bidirectional"
            style="position:relative;inset:auto;z-index:0;display:grid;min-height:420px;"
          ></mn-advanced-wire-menu>
        </div>
      `
    case 'mn-wire-menu-dropdown':
      return html`
        <mn-wire-menu-dropdown
          open
          showAdd
          .outgoingWires=${[
            {
              id: 'wire-billing',
              predicateLabel: 'supports',
              otherDocumentId: 'doc-billing',
              otherTitle: 'Billing',
              otherBlockId: 'block-b',
              otherSnippet: 'Invoice review notes',
            },
          ]}
          .incomingWires=${[
            {
              id: 'wire-review',
              predicateLabel: 'critiques',
              otherDocumentId: 'doc-review',
              otherTitle: 'Review',
              otherSnippet: 'Follow-up questions from the review pass',
            },
          ]}
        ></mn-wire-menu-dropdown>
      `
    case 'mn-wire-picker':
      return html`
        <div style="min-height:420px;position:relative;">
          <mn-wire-picker
            open
            phase="options"
            direction="bidirectional"
            style="position:relative;display:block;"
            .source=${{
              graphId: 'graph-catalog',
              documentId: 'doc-source',
              blockId: 'block-source',
              text: 'Source block: connect this claim to supporting evidence.',
            }}
            .selectedPredicate=${{ uri: 'http://mnemosyne.ai/vocab#supports', label: 'supports', category: 'Ground', icon: 'scale' }}
            .documents=${[
              { id: 'doc-architecture', label: 'Architecture', path: 'Workspace / Notes' },
              { id: 'doc-billing', label: 'Billing', path: 'Workspace / Finance' },
              { id: 'doc-review', label: 'Review', path: 'Workspace / Review' },
            ]}
            .blocks=${[
              { id: 'block-h1', type: 'heading', level: 2, text: 'Evidence', preview: 'Evidence' },
              { id: 'block-p', type: 'paragraph', text: 'Invoice review notes', preview: 'Detailed support for the selected claim.' },
            ]}
            .predicates=${[
              { uri: 'http://mnemosyne.ai/vocab#relatedTo', label: 'is related to', category: 'Default', icon: 'link' },
              { uri: 'http://mnemosyne.ai/vocab#supports', label: 'supports', category: 'Ground', icon: 'scale' },
              { uri: 'http://mnemosyne.ai/vocab#critiques', label: 'critiques', category: 'Review', icon: 'alert-triangle' },
            ]}
          ></mn-wire-picker>
        </div>
      `
    case 'mn-wikilink-picker':
      return html`
        <div style="min-height:360px;position:relative;">
          <mn-wikilink-picker
            open
            query="arch"
            style="position:relative;display:block;"
            .documents=${[
              { id: 'doc-architecture', label: 'Architecture', type: 'document' },
              { id: 'doc-arch-notes', label: 'Arch Notes', type: 'document' },
              { id: 'doc-billing', label: 'Billing', type: 'document' },
            ]}
          ></mn-wikilink-picker>
        </div>
      `
    case 'mn-node-link-picker':
      return html`
        <div style="min-height:340px;position:relative;">
          <mn-node-link-picker
            open
            style="position:relative;inset:auto;z-index:0;display:flex;min-height:320px;"
            .candidates=${[
              { kind: 'document', id: 'doc-architecture', title: 'Architecture', iconName: 'file-text' },
              { kind: 'artifact', id: 'artifact-diagram', title: 'System Diagram', mimeType: 'image/png', iconName: 'package' },
              { kind: 'document', id: 'doc-billing', title: 'Billing', iconName: 'file-text' },
            ]}
          ></mn-node-link-picker>
        </div>
      `
    case 'mn-citation-picker':
      return html`
        <div style="min-height:340px;position:relative;">
          <mn-citation-picker
            open
            query="mind"
            style="position:relative;inset:auto;z-index:0;display:flex;min-height:320px;padding:16px;align-items:flex-start;"
            .results=${[
              {
                key: 'A1',
                title: 'Situated Cognition',
                citation: 'Brown, Collins, and Duguid (1989)',
                itemType: 'journalArticle',
              },
              {
                key: 'B2',
                title: 'The Extended Mind',
                citation: 'Clark and Chalmers (1998)',
                itemType: 'article',
              },
            ]}
          ></mn-citation-picker>
        </div>
      `
    case 'mn-zotero-library-panel':
      return html`
        <div style="height:420px;border:1px solid var(--mn-color-border-default);overflow:hidden;">
          <mn-zotero-library-panel
            .collections=${[
              { key: 'c-reading', name: 'Reading Notes', itemCount: 1 },
              { key: 'c-mind', name: 'Embodied Mind', parentKey: 'c-reading', itemCount: 1 },
            ]}
            .expandedCollectionKeys=${new Set(['c-reading', 'c-mind'])}
            .collectionItems=${new Map([
              ['c-mind', [
                { key: 'A1', title: 'Situated Cognition', creatorSummary: 'Brown et al.', year: '1989', itemType: 'journalArticle' },
              ]],
            ])}
            .topItems=${[
              { key: 'A1', title: 'Situated Cognition', creatorSummary: 'Brown et al.', year: '1989', itemType: 'journalArticle' },
              { key: 'B2', title: 'The Extended Mind', creatorSummary: 'Clark and Chalmers', year: '1998', itemType: 'article' },
            ]}
          ></mn-zotero-library-panel>
        </div>
      `
    case 'mn-zotero-source-workbench':
      return html`
        <div style="height:560px;border:1px solid var(--mn-color-border-default);overflow:auto;">
          <mn-zotero-source-workbench
            artifactId="zot-A1"
            graphId="graph-a"
            .item=${{
              key: 'A1',
              title: 'Situated Cognition and the Culture of Learning',
              creatorSummary: 'Brown et al.',
              year: '1989',
              itemType: 'journalArticle',
              abstractNote: 'Learning and cognition are fundamentally situated in activity, context, and culture.',
              tags: ['cognition', 'learning', 'practice'],
            }}
            .annotations=${[
              {
                key: 'ann-1',
                kind: 'highlight',
                text: 'Knowledge is situated, being in part a product of the activity, context, and culture in which it is developed.',
                comment: 'Useful grounding quote for the practice notes.',
                color: '#facc15',
                page: '33',
              },
              {
                key: 'ann-2',
                kind: 'note',
                comment: 'Connect this to apprenticeship and participation.',
                page: '36',
              },
            ]}
            .incomingWires=${[
              {
                id: 'wire-reading-note',
                predicateLabel: 'quotes from',
                otherDocumentId: 'doc-reading-note',
                otherTitle: 'Reading Notes',
                otherSnippet: 'The note grounds situated learning in a source quote.',
              },
            ]}
            .promotedAnnotationKeys=${new Set(['ann-2'])}
          ></mn-zotero-source-workbench>
        </div>
      `
    case 'mn-research-source-chip':
      return html`
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <mn-research-source-chip sourceId="s1" label="arXiv" kind="preprint" status="ready" .score=${0.86}></mn-research-source-chip>
          <mn-research-source-chip sourceId="s2" label="Zotero" kind="zotero" status="selected" .score=${0.74}></mn-research-source-chip>
          <mn-research-source-chip sourceId="s3" label="Adapter" kind="dataset" status="searching"></mn-research-source-chip>
        </div>
      `
    case 'mn-research-source-card':
      return html`
        <div style="max-width:440px;">
          <mn-research-source-card
            selected
            .source=${{
              id: 'paper-wrapper-survey',
              title: 'Paper Adapter Survey for Agent Research Workflows',
              kind: 'preprint',
              status: 'ready',
              adapter: 'papers.search',
              authors: ['SRS stub'],
              year: '2026',
              venue: 'Research service note',
              abstract: 'A host-owned source record standing in for arXiv, Zotero, Paperpile, or another paper adapter.',
              tags: ['papers', 'adapter', 'srs'],
              score: 0.88,
              citationCount: 12,
              url: '#paper',
            }}
          ></mn-research-source-card>
        </div>
      `
    case 'mn-research-run-trace':
      return html`
        <div style="max-width:420px;">
          <mn-research-run-trace
            title="Paper trail"
            activeId="search"
            .steps=${[
              { id: 'scope', label: 'Scope question', status: 'completed', description: 'Constrain the research pass.', tool: 'research.plan' },
              { id: 'search', label: 'Search sources', status: 'running', description: 'Query paper adapters and graph notes.', tool: 'papers.search', meta: '3 candidates' },
              { id: 'synthesize', label: 'Synthesize brief', status: 'idle', description: 'Prepare claim/evidence/action output.' },
            ]}
          ></mn-research-run-trace>
        </div>
      `
    case 'mn-research-workspace':
      return html`
        <div style="height:440px;border:1px solid var(--mn-color-border-default);overflow:hidden;">
          <mn-research-workspace subtitle="Catalog specimen" mode="source">
            <div slot="sidebar" style="height:100%;padding:12px;background:var(--mn-color-surface-sunken);box-sizing:border-box;">Research</div>
            <div slot="chat" style="height:100%;padding:12px;box-sizing:border-box;">SRS chat surface</div>
            <mn-research-source-card
              slot="source"
              compact
              .source=${{
                id: 'source-a',
                title: 'Adapter-shaped paper retrieval',
                kind: 'paper',
                adapter: 'papers.search',
                year: '2026',
                tags: ['stub', 'source'],
              }}
            ></mn-research-source-card>
            <div slot="workflow" style="height:100%;padding:12px;box-sizing:border-box;">Workflow canvas</div>
            <mn-research-run-trace
              slot="trace"
              .steps=${[
                { id: 'scope', label: 'Scope', status: 'completed' },
                { id: 'search', label: 'Search', status: 'running' },
              ]}
            ></mn-research-run-trace>
          </mn-research-workspace>
        </div>
      `
    case 'mn-wire-radial-overlay':
      return html`
        <div style="position:relative;min-height:360px;overflow:hidden;border:1px solid var(--mn-color-border-default);border-radius:8px;">
          <div style="position:absolute;left:300px;top:180px;width:10px;height:10px;border-radius:50%;background:var(--mn-color-wire-400,var(--mn-color-border-accent));"></div>
          <mn-wire-radial-overlay
            anchorX="300"
            anchorY="180"
            graphId="graph-a"
            localGraphId="graph-a"
            localDocumentId="doc-source"
            localTitle="Source document"
            style="position:absolute;inset:0;"
            .outgoingWireIds=${new Set(['wire-billing'])}
            .wires=${[
              {
                id: 'wire-billing',
                predicate: 'http://mnemosyne.ai/vocab#supports',
                predicateLabel: 'supports',
                otherDocumentId: 'doc-billing',
                otherGraphId: 'graph-a',
                otherBlockId: 'block-b',
                localBlockId: 'block-a',
                otherTitle: 'Billing',
                otherSnippet: 'Invoice review notes',
                localSnippet: 'Source block text',
                bidirectional: true,
              },
              {
                id: 'wire-review',
                predicate: 'http://mnemosyne.ai/vocab#critiques',
                predicateLabel: 'critiques',
                otherDocumentId: 'doc-review',
                otherGraphId: 'graph-a',
                otherTitle: 'Review',
                otherSnippet: 'Follow-up questions from the review pass',
                bidirectional: false,
              },
            ]}
            .suggestions=${[
              { docId: 'doc-architecture', blockId: null, title: 'Architecture', snippet: 'Suggested nearby connection' },
            ]}
          ></mn-wire-radial-overlay>
        </div>
      `
    case 'mn-document-switcher':
      return html`
        <div style="position:relative;min-height:520px;overflow:hidden;border:1px solid var(--mn-color-border-default);border-radius:8px;">
          <mn-document-switcher
            open
            query="arch"
            graphId="graph-catalog"
            style="position:absolute;inset:0;"
            .items=${[
              { kind: 'document', id: 'doc-architecture', label: 'Architecture', path: 'Workspace / Notes' },
              { kind: 'block', id: 'doc-billing:block-1', documentId: 'doc-billing', blockId: 'block-1', label: 'Billing', snippet: 'Architecture notes for invoice review.', path: 'Workspace / Billing', matchSource: 'semantic' },
              { kind: 'document', id: 'doc-garden-port', label: 'Garden Port Plan', path: 'Workspace / Shrubbery' },
            ]}
            .actions=${[
              { id: 'doc.new', label: 'New Document', category: 'Document', icon: 'file-text', shortcut: 'Mod+N' },
              { id: 'view.toggle-wires', label: 'Toggle Wires Panel', category: 'View', icon: 'wire', shortcut: 'Mod+Shift+W' },
            ]}
          ></mn-document-switcher>
        </div>
      `
    case 'mn-settings-page':
      return html`
        <div style="height:520px;border:1px solid var(--mn-color-border-default);overflow:hidden;">
          <mn-settings-page
            status="ready"
            activeSection="local-ai"
            .sections=${[
              {
                id: 'account',
                title: 'Account',
                description: 'Profile and authentication state.',
                metrics: [
                  { id: 'plan', label: 'Plan', value: 'Pro', detail: 'Hosted gateway enabled', tone: 'accent' },
                ],
              },
              {
                id: 'local-ai',
                title: 'Local AI',
                description: 'Semantic model, embedding index, Docling, and PDF pipeline runtime.',
                wide: true,
                metrics: [
                  { id: 'model', label: 'Model', value: 'Ready', detail: 'bge-small-en-v1.5', tone: 'success' },
                  { id: 'index', label: 'Index', value: 'Refreshing', detail: '42% complete', tone: 'accent' },
                ],
                toggles: [
                  { id: 'local-semantic', label: 'Local Semantic Search', description: 'Use the local embedding index for graph search.', checked: true },
                ],
                selects: [
                  {
                    id: 'pdf-engine',
                    label: 'PDF Engine',
                    description: 'Preferred local ingestion engine.',
                    value: 'docling',
                    options: [
                      { value: 'docling', label: 'Docling' },
                      { value: 'legacy', label: 'Legacy' },
                    ],
                  },
                ],
                jobs: [
                  { id: 'semantic-index', label: 'Semantic Index', status: 'running', detail: 'Refreshing graph-catalog', progress: 42, actionLabel: 'Cancel' },
                  { id: 'docling-runtime', label: 'Docling Runtime', status: 'succeeded', detail: 'Runtime prepared', actionLabel: 'Prepare' },
                ],
                actions: [
                  { id: 'prepare-model', label: 'Prepare Model', description: 'Download local embedding model files.', icon: 'download' },
                ],
              },
            ]}
          ></mn-settings-page>
        </div>
      `
    case 'mn-ops-health-page':
      return html`
        <div style="height:560px;border:1px solid var(--mn-color-border-default);overflow:auto;">
          <mn-ops-health-page
            status="ready"
            .snapshot=${{
              overall_status: 'degraded',
              generated_at: new Date(Date.now() - 3 * 60_000).toISOString(),
              alerts: [
                {
                  severity: 'warning',
                  code: 'queue_depth_high',
                  message: 'Core queue is above threshold',
                  suggested_action: 'Scale workers or inspect stuck leases.',
                },
              ],
              k8s: { available: true, metrics_available: true },
              sections: {
                services: { collected_at: new Date(Date.now() - 4 * 60_000).toISOString() },
                queue: { collected_at: new Date(Date.now() - 5 * 60_000).toISOString() },
                k8s: { collected_at: new Date(Date.now() - 6 * 60_000).toISOString() },
              },
              queue: {
                mode: 'priority',
                unclaimed_high: 4,
                unclaimed_medium: 8,
                unclaimed_low: 1,
                depth: 13,
                core: { unclaimed_queue: 'core', unclaimed_high: 2, unclaimed_medium: 5, unclaimed_low: 0, depth: 7 },
                embeddings: { unclaimed_queue: 'embeddings', unclaimed_high: 1, unclaimed_medium: 3, unclaimed_low: 1, depth: 5 },
                worker_pressure: {
                  available: true,
                  reason: 'fresh',
                  collected_at: new Date(Date.now() - 7 * 60_000).toISOString(),
                  summary: {
                    workers_total: 3,
                    heartbeat_workers_total: 2,
                    held_leases_total: 6,
                    core_inbox_high_total: 2,
                    core_inbox_medium_total: 5,
                    core_inbox_low_total: 0,
                    core_inbox_depth_total: 7,
                    embeddings_inbox_high_total: 1,
                    embeddings_inbox_medium_total: 3,
                    embeddings_inbox_low_total: 1,
                    embeddings_inbox_depth_total: 5,
                  },
                  workers: [
                    { worker_id: 'worker-a', heartbeat_ttl_seconds: 28, held_leases: 2, core_inbox_depth: 4, embeddings_inbox_depth: 1, inbox_depth_total: 5 },
                  ],
                },
              },
              services: [
                { name: 'gateway', status: 'ok', latency_ms: 12 },
                { name: 'embeddings', status: 'degraded', latency_ms: 140, error: 'slow response' },
              ],
              workloads: [
                {
                  name: 'api-abc',
                  node: 'node-a',
                  workload: 'api',
                  ready_containers: 1,
                  container_count: 1,
                  phase: 'Running',
                  restart_count: 0,
                  memory_bytes: 134217728,
                  memory_limit_bytes: 268435456,
                  memory_limit_pct: 50,
                  cpu_millicores: 140,
                  cpu_limit_millicores: 500,
                },
                {
                  name: 'worker-def',
                  node: 'node-a',
                  workload: 'worker',
                  ready_containers: 0,
                  container_count: 1,
                  phase: 'CrashLoopBackOff',
                  restart_count: 3,
                  memory_bytes: 67108864,
                  memory_limit_bytes: 268435456,
                  memory_limit_pct: 25,
                  cpu_millicores: 80,
                  cpu_limit_millicores: 500,
                },
              ],
              controllers: [
                {
                  kind: 'Deployment',
                  name: 'api',
                  status: 'degraded',
                  ready_replicas: 1,
                  desired_replicas: 2,
                  updated_replicas: 2,
                  available_replicas: 1,
                },
              ],
            }}
          ></mn-ops-health-page>
        </div>
      `
    case 'mn-consent-banner':
      return html`
        <div style="min-height:96px;position:relative;border:1px solid var(--mn-color-border-default);border-radius:8px;overflow:hidden;">
          <mn-consent-banner
            privacy-href="/privacy"
            style="position:relative;right:auto;bottom:auto;margin:16px;display:block;"
          ></mn-consent-banner>
        </div>
      `
    case 'mn-upgrade-banner':
      return html`
        <div style="min-height:92px;position:relative;border:1px solid var(--mn-color-border-default);border-radius:8px;overflow:hidden;">
          <mn-upgrade-banner visible style="display:block;"></mn-upgrade-banner>
        </div>
      `
    case 'mn-storage-banner':
      return html`
        <div style="display:flex;flex-direction:column;gap:10px;border:1px solid var(--mn-color-border-default);border-radius:8px;overflow:hidden;padding-bottom:10px;">
          <mn-storage-banner .threshold=${{ level: 90 }}></mn-storage-banner>
          <mn-storage-banner .threshold=${{ level: 100 }}></mn-storage-banner>
        </div>
      `
    case 'mn-cloud-mode-pill':
      return html`
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
          <mn-cloud-mode-pill mode="local" status="local"></mn-cloud-mode-pill>
          <mn-cloud-mode-pill mode="hosted" status="connected"></mn-cloud-mode-pill>
          <mn-cloud-mode-pill mode="hosted" status="stale"></mn-cloud-mode-pill>
          <mn-cloud-mode-pill mode="hosted" status="signed-out"></mn-cloud-mode-pill>
        </div>
      `
    case 'mn-cloud-mode-panel':
      return html`
        <div style="min-height:420px;position:relative;border:1px solid var(--mn-color-border-default);border-radius:8px;overflow:hidden;">
          <mn-cloud-mode-panel
            open
            mode="hosted"
            sign-in-state="connected"
            user-email="vera@example.com"
            os="mac"
            style="position:relative;inset:auto;display:flex;min-height:420px;z-index:0;"
            .expiresAt=${Date.now() + 80 * 60_000}
          ></mn-cloud-mode-panel>
        </div>
      `
    case 'mn-tts-player':
      return html`
        <div style="min-height:96px;position:relative;border:1px solid var(--mn-color-border-default);border-radius:8px;overflow:hidden;">
          <mn-tts-player
            status="playing"
            current-block-index="1"
            total-blocks="4"
            current-block-text="Previewing the current paragraph through the controlled TTS playback bar."
            stop-shortcut="Cmd+Opt+L"
            style="position:relative;display:block;min-height:96px;--mn-tts-player-position:absolute;--mn-z-overlay:0;"
          ></mn-tts-player>
        </div>
      `
    case 'mn-feedback-form':
      return html`
        <div style="min-height:460px;position:relative;border:1px solid var(--mn-color-border-default);border-radius:8px;overflow:hidden;">
          <mn-feedback-form
            open
            content="The export preview looks good, but the toolbar copy could be clearer."
            feedback-type="feature"
            rating="4"
            style="position:relative;display:block;min-height:460px;--mn-feedback-form-modal-position:absolute;--mn-feedback-form-modal-z-index:0;"
          ></mn-feedback-form>
        </div>
      `
    case 'mn-export-dialog':
      return html`
        <div style="min-height:520px;position:relative;border:1px solid var(--mn-color-border-default);border-radius:8px;overflow:hidden;">
          <mn-export-dialog
            open
            document-title="Garden parity plan"
            html-content="<main><h1>Garden parity plan</h1><p>Host-rendered export preview supplied to the controlled dialog.</p></main>"
            selected-theme="garden"
            style="position:relative;inset:auto;display:flex;min-height:520px;z-index:0;"
          ></mn-export-dialog>
        </div>
      `
    case 'mn-mobile-tabs':
      return html`
        <div style="max-width:420px;border:1px solid var(--mn-color-border-default);border-radius:8px;overflow:hidden;">
          <mn-mobile-tabs activeTab="home"></mn-mobile-tabs>
        </div>
      `
    case 'mn-mobile-file-list':
      return html`
        <div style="height:520px;max-width:420px;border:1px solid var(--mn-color-border-default);border-radius:8px;overflow:hidden;">
          <mn-mobile-file-list
            currentGraphTitle="Garden Workspace"
            activeGraphId="graph-garden"
            activeDocumentId="doc-plan"
            .expandedFolderIds=${['folder-projects']}
            .workspaces=${[
              { graphId: 'graph-garden', title: 'Garden Workspace' },
              { graphId: 'graph-shrubbery', title: 'Shrubbery Lab' },
            ]}
            .nodes=${[
              {
                id: 'folder-projects',
                label: 'Projects',
                type: 'folder',
                children: [
                  { id: 'doc-plan', label: 'Garden parity plan', type: 'document' },
                  { id: 'doc-wire', label: 'Wire audit', type: 'document', readOnly: true },
                ],
              },
              { id: 'doc-inbox', label: 'Inbox notes', type: 'document' },
            ]}
            .recents=${[
              { docId: 'doc-plan', title: 'Garden parity plan', graphId: 'graph-garden', timestamp: Date.now() - 12 * 60_000 },
              { docId: 'doc-wire', title: 'Wire audit', graphId: 'graph-garden', readOnly: true, timestamp: Date.now() - 3 * 60 * 60_000 },
            ]}
          ></mn-mobile-file-list>
        </div>
      `
    case 'mn-error-boundary':
      return html`
        <mn-error-boundary
          variant="network"
          title=""
          message="The workspace could not be reached. Check the host connection and retry."
          action-text="Retry"
          secondary-action-text="Go Home"
          show-details
          error-stack="GET /graphs/garden timed out after 10000ms"
        ></mn-error-boundary>
      `
    case 'mn-public-shell':
      return html`
        <div style="height:520px;border:1px solid var(--mn-color-border-default);overflow:hidden;">
          <mn-public-shell
            status="ready"
            .nav=${{
              graphId: 'graph-public',
              title: 'Published Garden',
              folders: [{ id: 'folder-notes', label: 'Notes', order: 1 }],
              documents: [
                { id: 'doc-home', title: 'Welcome', order: 0, updatedAt: Date.now() - 86_400_000 },
                { id: 'doc-notes', title: 'Wire notes', parentId: 'folder-notes', order: 0 },
              ],
            }}
            .document=${{
              id: 'doc-home',
              title: 'Welcome',
              updatedAt: Date.now() - 86_400_000,
              blocks: [
                { id: 'block-title', type: 'heading', level: 2, order: 0, content: 'Public brief' },
                {
                  id: 'block-body',
                  type: 'paragraph',
                  order: 1,
                  content: 'Read the linked note and source.',
                  marks: [
                    { type: 'bold', start: 0, end: 4 },
                    { type: 'wikilink', start: 9, end: 20, targetDocumentId: 'doc-notes' },
                    { type: 'link', start: 25, end: 31, href: 'https://sophia-labs.com' },
                  ],
                },
                { id: 'block-code', type: 'code', order: 2, content: 'const publicGraph = true' },
              ],
            }}
            .wires=${{
              wiredBlockIds: ['block-body'],
              outgoing: [
                {
                  id: 'wire-1',
                  predicateLabel: 'supports',
                  otherDocumentId: 'doc-notes',
                  otherTitle: 'Wire notes',
                  otherBlockId: 'block-target',
                  otherSnippet: 'A related public note.',
                  localBlockId: 'block-body',
                },
              ],
              incoming: [],
            }}
          ></mn-public-shell>
        </div>
      `
    case 'mn-auth-page':
      return html`
        <div style="height:540px;border:1px solid var(--mn-color-border-default);overflow:hidden;">
          <mn-auth-page
            mode="verify"
            brand="Sophia Labs"
            success-message="Account created. Verify your email to continue."
            pending-identity="vera@example.com"
            delivery-destination="vera@example.com"
          ></mn-auth-page>
        </div>
      `
    case 'mn-sign-in-form':
      return html`
        <div style="max-width:420px;padding:24px;border:1px solid var(--mn-color-border-default);border-radius:8px;background:var(--mn-color-surface-base);">
          <mn-sign-in-form identity="vera@example.com"></mn-sign-in-form>
        </div>
      `
    case 'mn-sign-up-form':
      return html`
        <div style="max-width:420px;padding:24px;border:1px solid var(--mn-color-border-default);border-radius:8px;background:var(--mn-color-surface-base);">
          <mn-sign-up-form
            username="vera"
            email="vera@example.com"
            name="Vera"
            password="GoodPass1"
            confirm-password="GoodPass1"
            accepted-privacy
            accepted-terms
          ></mn-sign-up-form>
        </div>
      `
    case 'mn-verify-email-form':
      return html`
        <div style="max-width:420px;padding:24px;border:1px solid var(--mn-color-border-default);border-radius:8px;background:var(--mn-color-surface-base);">
          <mn-verify-email-form
            identity="vera@example.com"
            delivery-destination="vera@example.com"
            code="123456"
            success="A new code was sent."
          ></mn-verify-email-form>
        </div>
      `
    case 'garden-hero-canvas':
      return html`
        <div style="position:relative;height:280px;overflow:hidden;background:#faf8f3;">
          <garden-hero-canvas .animated=${false} .blobCount=${10}></garden-hero-canvas>
        </div>
      `
    case 'sophia-hero-canvas':
      return html`
        <div style="position:relative;height:280px;overflow:hidden;background:#f8f9fc;">
          <sophia-hero-canvas .animated=${false} .nodeCount=${8}></sophia-hero-canvas>
        </div>
      `
    case 'garden-landing':
      return html`
        <div style="height:520px;overflow:auto;border:1px solid var(--mn-color-border-default);">
          <garden-landing
            appHref="#garden-app"
            discordHref="#discord"
            emailHref="mailto:vera@sophia-labs.com"
            screenshotSrc="/marcy_screenshot_0.jpg"
            mobileScreenshotSrc="/mobilemarcyss.jpg"
            graphScreenshotSrc="/graphviewss.png"
          ></garden-landing>
        </div>
      `
    case 'sophia-labs-landing':
      return html`
        <div style="height:520px;overflow:auto;border:1px solid var(--mn-color-border-default);">
          <sophia-labs-landing gardenHref="#garden"></sophia-labs-landing>
        </div>
      `
    default:
      return null
  }
}

/** A catalog card — the component (or placeholder) above its manifest metadata. */
function card(entry: CatalogEntry): TemplateResult {
  const built = isBuilt(entry.tag)
  return html`
    <article
      data-catalog-tag=${entry.tag}
      data-face=${entry.face}
      data-built=${String(built)}
      data-manifested=${String(entry.manifested)}
      data-persistence=${entry.persistence}
      style="border:1px solid var(--mn-color-border-default);
             border-radius:var(--mn-radius-surface);overflow:hidden;
             background:var(--mn-color-surface-base);"
    >
      <div style="padding:12px;">${renderMember(entry)}</div>
      <footer
        style="border-top:1px solid var(--mn-color-border-default);
               padding:8px 12px;font-family:var(--mn-font-chrome);"
      >
        <div style="font-weight:600;font-family:var(--mn-font-mono);font-size:13px;">
          ${entry.tag}
        </div>
        <div style="font-size:11px;color:var(--mn-color-text-secondary);margin-top:2px;">
          ${entry.blurb}
        </div>
        <div
          style="font-size:10px;color:var(--mn-color-text-tertiary);margin-top:4px;
                 display:flex;gap:8px;text-transform:uppercase;letter-spacing:0.06em;"
        >
          <span>face: ${entry.face}</span>
          <span>manifested: ${entry.manifested ? 'yes' : 'no'}</span>
          <span>built: ${built ? 'yes' : 'no'}</span>
        </div>
      </footer>
    </article>
  `
}

/**
 * Index — the WHOLE catalog at a glance, generated from CATALOG_ENTRIES. This is
 * the catalog-from-manifest the brief asks for: it is impossible for a manifested
 * component to be missing here, because the grid maps over the derived list.
 */
export const Index: Story = {
  render: () => html`
    <div style="font-family:var(--mn-font-chrome);">
      <h2 style="margin:0 0 4px;">Component catalog — one catalog, two faces</h2>
      <p style="margin:0 0 16px;color:var(--mn-color-text-secondary);font-size:13px;">
        Generated from the component-library MANIFEST + the built-chrome set.
        Built chrome and controlled lifted panels render live; manifested-but-unbuilt
        panels show as inert placeholders. Flip Skin/Theme to re-skin the catalog.
      </p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;">
        ${CATALOG_ENTRIES.map(card)}
      </div>
    </div>
  `,
}

/**
 * Per-entry stories — one named CSF story PER catalog row, so each manifested /
 * built component has its OWN addressable story (the literal "every manifested
 * component has a story" requirement, beyond the index grid).
 *
 * The BODIES are generated from the single catalog model (`memberStory` over the
 * derived entry) — NO hand-written mock arg bags. Storybook's CSF requires each
 * story to be a STATIC named export, so the export-name list is spelled out here;
 * the coherence test re-derives the expected names from the manifest via
 * `storyExportName` and asserts each is present, so a manifest row added without
 * its matching export here is caught (the two faces can't drift silently).
 *
 * IMPORTANT: a `.stories.ts` file may export ONLY the default meta + story
 * objects — every other named export would be auto-discovered as a (broken)
 * story. The shared helpers (`storyExportName`, the entry lookup) therefore live
 * in catalog-model.ts, not here.
 */
function memberStory(tag: string): Story {
  const entry = catalogEntryFor(tag)!
  return {
    name: entry.tag,
    render: () => html`<div style="max-width:520px;">${card(entry)}</div>`,
  }
}

export const MnTopBar: Story = memberStory('mn-top-bar')
export const MnBottomBar: Story = memberStory('mn-bottom-bar')
// General primitives (iter-4a) — lifted + generalized, skin-aware, catalogued.
export const MnChip: Story = memberStory('mn-chip')
export const MnBadge: Story = memberStory('mn-badge')
export const MnSparkline: Story = memberStory('mn-sparkline')
export const MnRibbon: Story = memberStory('mn-ribbon')
export const MnCard: Story = memberStory('mn-card')
export const MnRelations: Story = memberStory('mn-relations')
export const MnGraph: Story = memberStory('mn-graph')
export const MnGraphThree: Story = memberStory('mn-graph-three')
export const MnSpinner: Story = memberStory('mn-spinner')
export const MnLoading: Story = memberStory('mn-loading')
export const MnEmptyState: Story = memberStory('mn-empty-state')
export const MnContinuityStatus: Story = memberStory('mn-continuity-status')
export const MnArtifactView: Story = memberStory('mn-artifact-view')
export const MnArtifactEditor: Story = memberStory('mn-artifact-editor')
export const MnExcalidrawCanvas: Story = memberStory('mn-excalidraw-canvas')
export const MnDocHistoryPanel: Story = memberStory('mn-doc-history-panel')
export const MnOriginalViewer: Story = memberStory('mn-original-viewer')
export const MnCommentPopover: Story = memberStory('mn-comment-popover')
export const WfChoreographView: Story = memberStory('wf-choreograph-view')
export const WfMissionControl: Story = memberStory('wf-mission-control')
export const WfStudioShell: Story = memberStory('wf-studio-shell')
export const MnInput: Story = memberStory('mn-input')
export const MnTextarea: Story = memberStory('mn-textarea')
export const MnSearchInput: Story = memberStory('mn-search-input')
export const MnTooltip: Story = memberStory('mn-tooltip')
export const MnAvatar: Story = memberStory('mn-avatar')
export const MnVtuber: Story = memberStory('mn-vtuber')
export const MnPanelHeader: Story = memberStory('mn-panel-header')
export const MnDropdownButton: Story = memberStory('mn-dropdown-button')
export const MnInlineEdit: Story = memberStory('mn-inline-edit')
export const MnToast: Story = memberStory('mn-toast')
export const MnModal: Story = memberStory('mn-modal')
export const MnDialog: Story = memberStory('mn-dialog')
export const MnToolbarOverflow: Story = memberStory('mn-toolbar-overflow')
export const MnTagChipSpecimen: Story = memberStory('mn-tag-chip-specimen')
export const MnTagAutocompletePopover: Story = memberStory('mn-tag-autocomplete-popover')
export const MnCalendarEventSpecimen: Story = memberStory('mn-calendar-event-specimen')
export const MnDailyNoteHeader: Story = memberStory('mn-daily-note-header')
export const MnDailyNoteRow: Story = memberStory('mn-daily-note-row')
export const MnMonthPopover: Story = memberStory('mn-month-popover')
export const MnContextMenu: Story = memberStory('mn-context-menu')
export const MnInputDialog: Story = memberStory('mn-input-dialog')
export const MnConfirmationDialog: Story = memberStory('mn-confirmation-dialog')
export const MnShortcutsDialog: Story = memberStory('mn-shortcuts-dialog')
export const MnAdvancedWireMenu: Story = memberStory('mn-advanced-wire-menu')
export const MnWireMenuDropdown: Story = memberStory('mn-wire-menu-dropdown')
export const MnWirePicker: Story = memberStory('mn-wire-picker')
export const MnWikilinkPicker: Story = memberStory('mn-wikilink-picker')
export const MnNodeLinkPicker: Story = memberStory('mn-node-link-picker')
export const MnCitationPicker: Story = memberStory('mn-citation-picker')
export const MnZoteroLibraryPanel: Story = memberStory('mn-zotero-library-panel')
export const MnZoteroSourceWorkbench: Story = memberStory('mn-zotero-source-workbench')
export const MnWireRadialOverlay: Story = memberStory('mn-wire-radial-overlay')
export const MnResearchSourceChip: Story = memberStory('mn-research-source-chip')
export const MnResearchSourceCard: Story = memberStory('mn-research-source-card')
export const MnResearchRunTrace: Story = memberStory('mn-research-run-trace')
export const MnResearchWorkspace: Story = memberStory('mn-research-workspace')
export const MnDocumentSwitcher: Story = memberStory('mn-document-switcher')
export const MnSettingsPage: Story = memberStory('mn-settings-page')
export const MnOpsHealthPage: Story = memberStory('mn-ops-health-page')
export const MnConsentBanner: Story = memberStory('mn-consent-banner')
export const MnUpgradeBanner: Story = memberStory('mn-upgrade-banner')
export const MnStorageBanner: Story = memberStory('mn-storage-banner')
export const MnCloudModePill: Story = memberStory('mn-cloud-mode-pill')
export const MnCloudModePanel: Story = memberStory('mn-cloud-mode-panel')
export const MnTtsPlayer: Story = memberStory('mn-tts-player')
export const MnFeedbackForm: Story = memberStory('mn-feedback-form')
export const MnExportDialog: Story = memberStory('mn-export-dialog')
export const MnMobileTabs: Story = memberStory('mn-mobile-tabs')
export const MnMobileFileList: Story = memberStory('mn-mobile-file-list')
export const MnErrorBoundary: Story = memberStory('mn-error-boundary')
export const MnPublicShell: Story = memberStory('mn-public-shell')
export const MnAuthPage: Story = memberStory('mn-auth-page')
export const MnSignInForm: Story = memberStory('mn-sign-in-form')
export const MnSignUpForm: Story = memberStory('mn-sign-up-form')
export const MnVerifyEmailForm: Story = memberStory('mn-verify-email-form')
export const GardenHeroCanvas: Story = memberStory('garden-hero-canvas')
export const SophiaHeroCanvas: Story = memberStory('sophia-hero-canvas')
export const GardenLanding: Story = memberStory('garden-landing')
export const SophiaLabsLanding: Story = memberStory('sophia-labs-landing')
// Engine-manifested panels.
export const MnDocumentEditor: Story = memberStory('mn-document-editor')
export const MnGraphPanel: Story = memberStory('mn-graph-panel')
