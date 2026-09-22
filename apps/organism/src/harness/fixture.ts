import type { InMemoryCellSeed } from './in-memory-cell-contract.js'

function paragraph(id: string, text: string, indent = 0): Readonly<Record<string, unknown>> {
  return {
    type: 'paragraph',
    attrs: { indent, collapsed: false, 'data-block-id': id },
    content: [{ type: 'text', text }],
  }
}

function heading(id: string, text: string, level = 1): Readonly<Record<string, unknown>> {
  return {
    type: 'heading',
    attrs: { level, indent: 0, collapsed: false, 'data-block-id': id },
    content: [{ type: 'text', text }],
  }
}

export const BROWSER_HARNESS_SEED: InMemoryCellSeed = Object.freeze({
  graphId: 'browser-harness',
  title: 'Shrubbery Browser Harness',
  documents: Object.freeze([
    {
      id: 'architecture',
      title: 'Architecture',
      order: 0,
      tags: ['decision', 'browser'],
      blocks: [
        { id: 'architecture-title', type: 'heading', level: 1, text: 'Architecture' },
        { id: 'architecture-contract', text: 'The browser talks through one ShrubberyContract.' },
        { id: 'architecture-crdt', text: 'The editor owns a real Y.Doc room.' },
      ],
      content: {
        type: 'doc',
        content: [
          heading('architecture-title', 'Architecture'),
          paragraph('architecture-contract', 'The browser talks through one ShrubberyContract.'),
          paragraph('architecture-crdt', 'The editor owns a real Y.Doc room.'),
        ],
      },
      readOnly: true,
      original: {
        filename: 'architecture-source.md',
        mimeType: 'text/markdown',
        body: '# Architecture Source\n\nThis text came from the authenticated original-file fixture.\n',
      },
    },
    {
      id: 'research-notes',
      title: 'Research Notes',
      order: 1,
      tags: ['browser', 'todo'],
      blocks: [
        { id: 'research-title', type: 'heading', level: 1, text: 'Research Notes' },
        { id: 'research-first', text: 'Exercise behavior in Chromium, not only happy-dom.' },
        { id: 'research-second', text: 'Keep a real-gardend acceptance lane beside this fixture.' },
      ],
      content: {
        type: 'doc',
        content: [
          heading('research-title', 'Research Notes'),
          paragraph('research-first', 'Exercise behavior in Chromium, not only happy-dom.'),
          paragraph('research-second', 'Keep a real-gardend acceptance lane beside this fixture.'),
        ],
      },
    },
    {
      id: 'delivery-plan',
      title: 'Delivery Plan',
      order: 2,
      tags: ['todo'],
      blocks: [
        { id: 'delivery-title', type: 'heading', level: 1, text: 'Delivery Plan' },
        { id: 'delivery-first', text: 'Use the deterministic harness for every frontend tranche.' },
      ],
      content: {
        type: 'doc',
        content: [
          heading('delivery-title', 'Delivery Plan'),
          paragraph('delivery-first', 'Use the deterministic harness for every frontend tranche.'),
        ],
      },
    },
    {
      id: 'browser-harness-dream-journal',
      title: 'Dream Journal',
      order: 3,
      blocks: [
        { id: 'dream-title', type: 'heading', level: 1, text: 'Dream Journal' },
        { id: 'dream-first', text: 'This journal exists because the harness explicitly enables dreaming.' },
      ],
      content: {
        type: 'doc',
        content: [
          heading('dream-title', 'Dream Journal'),
          paragraph('dream-first', 'This journal exists because the harness explicitly enables dreaming.'),
        ],
      },
    },
  ]),
  folders: Object.freeze([]),
  artifacts: Object.freeze([
    {
      id: 'fixture-readme',
      filename: 'fixture-readme.md',
      mimeType: 'text/markdown',
      fileType: 'md',
      order: 0,
    },
  ]),
} satisfies InMemoryCellSeed)

export const BROWSER_HARNESS_SECOND_SEED: InMemoryCellSeed = Object.freeze({
  graphId: 'browser-harness-b',
  title: 'Isolated Workspace B',
  documents: Object.freeze([
    {
      id: 'workspace-b-note',
      title: 'Workspace B Only',
      order: 0,
      blocks: [
        { id: 'workspace-b-title', type: 'heading', level: 1, text: 'Workspace B Only' },
        { id: 'workspace-b-body', text: 'This document must never appear in Workspace A.' },
      ],
      content: {
        type: 'doc',
        content: [
          heading('workspace-b-title', 'Workspace B Only'),
          paragraph('workspace-b-body', 'This document must never appear in Workspace A.'),
        ],
      },
    },
  ]),
  folders: Object.freeze([]),
  artifacts: Object.freeze([]),
} satisfies InMemoryCellSeed)
