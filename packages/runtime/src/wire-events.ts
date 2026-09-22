export const WIRE_HIGHLIGHT_BLOCK_EVENT = 'wire-highlight-block'
export const WIRE_DOCUMENT_REQUEST_EVENT = 'mn-document-wire-request'
export const WIRE_PIN_BLOCK_REQUEST_EVENT = 'mn-wire-pin-block-request'
export const WIRE_PIN_DOCUMENT_REQUEST_EVENT = 'mn-wire-pin-document-request'
export const WIRE_PIN_WIRE_REQUEST_EVENT = 'mn-wire-pin-wire-request'
export const WIRE_RADIAL_CONTEXT_REQUEST_EVENT = 'mn-wire-radial-context-request'
export const WIRE_PINNED_BLOCK_OPEN_EVENT = 'mn-wire-pinned-block-open'
export const WIRE_PINNED_BLOCK_CLOSE_EVENT = 'mn-wire-pinned-block-close'
export const WIRE_PINNED_BLOCK_CONTEXT_REQUEST_EVENT = 'mn-wire-pinned-block-context-request'
export const WIRE_PINNED_BLOCK_MOVE_EVENT = 'mn-wire-pinned-block-move'
export const WIRE_PINNED_BLOCK_REFRESH_EVENT = 'mn-wire-pinned-block-refresh'
export const WIRE_PINNED_DOC_OPEN_EVENT = 'mn-wire-pinned-doc-open'
export const WIRE_PINNED_DOC_CLOSE_EVENT = 'mn-wire-pinned-doc-close'
export const WIRE_PINNED_DOC_MOVE_EVENT = 'mn-wire-pinned-doc-move'
export const WIRE_PINNED_WIRE_OPEN_EVENT = 'mn-wire-pinned-wire-open'
export const WIRE_PINNED_WIRE_CLOSE_EVENT = 'mn-wire-pinned-wire-close'
export const WIRE_PINNED_WIRE_MOVE_EVENT = 'mn-wire-pinned-wire-move'
export const WIRE_PINNED_WIRE_UPDATE_REQUEST_EVENT = 'mn-wire-pinned-wire-update-request'
export const WIRE_PINNED_WIRE_CONTEXT_REQUEST_EVENT = 'mn-wire-pinned-wire-context-request'

export interface WireHighlightBlockDetail {
  readonly blockId: string | null
}

export interface DocumentWireRequestDetail {
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly metaKey: boolean
  readonly ctrlKey: boolean
}

export interface WirePinDocumentRequestDetail {
  readonly graphId: string
  readonly documentId: string
  readonly title: string
}

export interface WirePinBlockRequestDetail {
  readonly graphId: string
  readonly documentId: string
  readonly blockId: string
  readonly text: string
  readonly documentTitle: string
}

export interface WirePinWireRequestDetail {
  readonly wireId: string
  readonly graphId: string
  readonly predicate: string
  readonly predicateLabel: string
  readonly bidirectional: boolean
  readonly sourceGraphId: string
  readonly sourceDocumentId: string
  readonly sourceBlockId?: string | null
  readonly sourceTitle: string
  readonly sourceText: string
  readonly targetGraphId: string
  readonly targetDocumentId: string
  readonly targetBlockId?: string | null
  readonly targetTitle: string
  readonly targetText: string
  readonly x?: number
  readonly y?: number
}

export interface WireRadialContextRequestDetail {
  readonly nodeId: string
  readonly wireId?: string
  readonly graphId: string
  readonly documentId: string
  readonly blockId?: string
}

export interface WirePinnedBlockOpenDetail {
  readonly graphId: string
  readonly documentId: string
  readonly blockId: string
}

export interface WirePinnedBlockCloseDetail {
  readonly id: string
}

export interface WirePinnedBlockContextRequestDetail {
  readonly id: string
  readonly graphId: string
  readonly documentId: string
  readonly blockId: string
}

export interface WirePinnedBlockMoveDetail {
  readonly id: string
  readonly x: number
  readonly y: number
}

export interface WirePinnedBlockRefreshDetail {
  readonly id: string
  readonly graphId: string
  readonly documentId: string
  readonly blockId: string
}

export interface WirePinnedDocOpenDetail {
  readonly graphId: string
  readonly documentId: string
}

export interface WirePinnedDocCloseDetail {
  readonly id: string
}

export interface WirePinnedDocMoveDetail {
  readonly id: string
  readonly x: number
  readonly y: number
}

export interface WirePinnedWireOpenDetail {
  readonly graphId: string
  readonly documentId: string
  readonly blockId?: string | null
}

export interface WirePinnedWireCloseDetail {
  readonly id: string
}

export interface WirePinnedWireMoveDetail {
  readonly id: string
  readonly x: number
  readonly y: number
}

export interface WirePinnedWireUpdateRequestDetail {
  readonly id: string
  readonly wireId: string
  readonly predicate: string
  readonly bidirectional: boolean
  readonly swap: boolean
}

export interface WirePinnedWireContextRequestDetail {
  readonly id: string
  readonly side: 'source' | 'target'
  readonly graphId: string
  readonly documentId: string
  readonly blockId: string
}
