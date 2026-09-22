/**
 * Browser acceptance for the controlled public-shell graph journey.
 *
 * The fixture is an in-memory HOST, not a pretend public API: it swaps the same
 * nav/document/wire props a real public-shell controller would supply after an
 * emitted open-document intent. The component remains backend-free, while the
 * play function exercises the real nested SVG and shadow DOM in Chromium.
 */

import { html } from 'lit'
import type { Meta, StoryObj } from '@storybook/web-components'
import '@shrubbery/components'
import type {
  MnPublicDocument,
  MnPublicNav,
  MnPublicShell,
  MnPublicShellOpenDocumentDetail,
  MnPublicWires,
} from '@shrubbery/components'

const nav: MnPublicNav = {
  graphId: 'graph-public-journey',
  title: 'Published Systems Garden',
  folders: [{ id: 'folder-notes', label: 'Notes', order: 1 }],
  documents: [
    { id: 'doc-overview', title: 'Overview', order: 0 },
    { id: 'doc-wires', title: 'Wire notes', parentId: 'folder-notes', order: 0 },
  ],
}

const overview: MnPublicDocument = {
  id: 'doc-overview',
  title: 'Overview',
  blocks: [
    { id: 'overview-title', type: 'heading', level: 2, order: 0, content: 'A connected public workspace' },
    { id: 'overview-wire', type: 'paragraph', order: 1, content: 'This note supports the wire audit.' },
  ],
}

const wireNotes: MnPublicDocument = {
  id: 'doc-wires',
  title: 'Wire notes',
  blocks: [
    { id: 'wire-title', type: 'heading', level: 2, order: 0, content: 'Visible connection evidence' },
    { id: 'wire-back', type: 'paragraph', order: 1, content: 'Follow the incoming wire back to Overview.' },
  ],
}

const overviewWires: MnPublicWires = {
  wiredBlockIds: ['overview-wire'],
  outgoing: [{
    id: 'wire-supports',
    predicateLabel: 'supports',
    otherDocumentId: 'doc-wires',
    otherTitle: 'Wire notes',
    otherBlockId: 'wire-back',
    otherSnippet: 'Visible connection evidence',
    localBlockId: 'overview-wire',
  }],
  incoming: [],
}

const wireNotesWires: MnPublicWires = {
  wiredBlockIds: ['wire-back'],
  outgoing: [],
  incoming: [{
    id: 'wire-supports',
    predicateLabel: 'supports',
    otherDocumentId: 'doc-overview',
    otherTitle: 'Overview',
    otherBlockId: 'overview-wire',
    otherSnippet: 'A connected public workspace',
    localBlockId: 'wire-back',
  }],
}

const documents = new Map([
  [overview.id, { document: overview, wires: overviewWires }],
  [wireNotes.id, { document: wireNotes, wires: wireNotesWires }],
])

function openDocument(event: CustomEvent<MnPublicShellOpenDocumentDetail>): void {
  const shell = event.currentTarget as MnPublicShell
  const next = documents.get(event.detail.documentId)
  shell.dataset.lastOpenSource = event.detail.source
  shell.dataset.lastOpenDocument = event.detail.documentId
  if (!next) return
  shell.document = next.document
  shell.wires = next.wires
}

const meta: Meta = {
  title: 'Journeys/Public Shell',
  tags: ['public-shell-graph'],
  parameters: { layout: 'fullscreen' },
}

export default meta
type Story = StoryObj

export const ConnectedGraphNavigation: Story = {
  render: () => html`
    <div style="height:720px;overflow:hidden;">
      <mn-public-shell
        status="ready"
        .nav=${nav}
        .document=${overview}
        .wires=${overviewWires}
        @mn-public-shell-open-document=${openDocument}
      ></mn-public-shell>
    </div>
  `,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const shell = canvasElement.querySelector('mn-public-shell') as MnPublicShell | null
    if (!shell) throw new Error('PublicShellGraph.play: public shell did not mount')
    await shell.updateComplete

    const root = shell.shadowRoot
    if (!root) throw new Error('PublicShellGraph.play: public shell has no render root')
    if (root.querySelector('.doc-title')?.textContent !== 'Overview') {
      throw new Error('PublicShellGraph.play: the Overview document was not the initial view')
    }

    const graphToggle = root.querySelector('[aria-label="Show graph view"]') as HTMLButtonElement | null
    if (!graphToggle) throw new Error('PublicShellGraph.play: graph view control is missing')
    graphToggle.click()
    await shell.updateComplete

    const region = root.querySelector('[role="region"][aria-label="Public graph"]')
    const panel = root.querySelector('mn-graph-panel') as HTMLElement & {
      updateComplete: Promise<boolean>
      nodes: readonly unknown[]
      edges: readonly unknown[]
    } | null
    if (!region || !panel) throw new Error('PublicShellGraph.play: graph region did not render')
    await panel.updateComplete
    if (panel.nodes.length !== 4 || panel.edges.length !== 4) {
      throw new Error(`PublicShellGraph.play: expected 4 nodes/4 edges, got ${panel.nodes.length}/${panel.edges.length}`)
    }
    if (!panel.getAttribute('subtitle')?.includes('2 documents · 1 visible connection')) {
      throw new Error('PublicShellGraph.play: graph summary does not describe the controlled projection')
    }

    const graph = panel.shadowRoot?.querySelector('mn-graph') as HTMLElement & { updateComplete: Promise<boolean> } | null
    if (!graph) throw new Error('PublicShellGraph.play: SVG graph did not mount')
    await graph.updateComplete
    const graphRoot = graph.shadowRoot
    const svg = graphRoot?.querySelector('svg[role="img"]') as SVGSVGElement | null
    const connected = graphRoot?.querySelector(
      '[role="button"][aria-label="Wire notes"][data-node="document:doc-wires"]',
    ) as SVGElement | null
    if (!svg || svg.getBoundingClientRect().width <= 0 || svg.getBoundingClientRect().height <= 0) {
      throw new Error('PublicShellGraph.play: graph SVG is present but not visibly laid out')
    }
    if (!connected || graphRoot?.querySelectorAll('.edge.wire').length !== 1) {
      throw new Error('PublicShellGraph.play: connected document node or visible wire edge is missing')
    }
    connected.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
    await shell.updateComplete

    if (String(shell.dataset.lastOpenSource) !== 'graph' || String(shell.dataset.lastOpenDocument) !== 'doc-wires') {
      throw new Error('PublicShellGraph.play: graph node did not emit the connected document intent')
    }
    if (shell.view !== 'document' || root.querySelector('.doc-title')?.textContent !== 'Wire notes') {
      throw new Error('PublicShellGraph.play: controlled host did not navigate to Wire notes')
    }

    const backWire = root.querySelector('.wire-card') as HTMLButtonElement | null
    if (!backWire || !backWire.textContent?.includes('Overview')) {
      throw new Error('PublicShellGraph.play: incoming Overview wire is not available')
    }
    backWire.click()
    await shell.updateComplete

    if (String(shell.dataset.lastOpenSource) !== 'wire' || String(shell.dataset.lastOpenDocument) !== 'doc-overview') {
      throw new Error('PublicShellGraph.play: wire card did not emit the return navigation intent')
    }
    if (root.querySelector('.doc-title')?.textContent !== 'Overview') {
      throw new Error('PublicShellGraph.play: wire navigation did not return to Overview')
    }
    shell.dataset.journeyComplete = 'true'
  },
}
