/**
 * The Files pane's policy, pure: what may be uploaded, and how an opened file is shown.
 *
 * Vera's decisions of 2026-10-05: any file type, a cap of 50 MB per file for everyone signed in; a PDF opens in the
 * original-page viewer, an image previews, everything else downloads. No parsing. The cap is the cell's
 * (`files.maxUploadBytes` in its capabilities, CONTRACT-files §1); the shell checks it before sending so a refused file
 * never leaves the machine (§3: "pre-check `file.size > maxUploadBytes` and do not send").
 */

/** 52,428,800 bytes = 50 MiB: exactly this is accepted, one byte more is refused (CONTRACT-files §3). */
export const FILES_DEFAULT_MAX_UPLOAD_BYTES = 52_428_800

export interface UploadRefusal {
  readonly file: File
  readonly code: 'file_too_large' | 'empty_file'
  readonly message: string
}

export interface UploadPlan {
  readonly accepted: readonly File[]
  readonly refused: readonly UploadRefusal[]
}

const KB = 1024
const MB = 1024 * 1024

/** Sizes the way people read them: whole units without decimals, otherwise one decimal (MiB spoken as MB, like the cell). */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < KB) return `${Math.max(0, Math.round(bytes || 0))} bytes`
  const [value, unit] = bytes < MB ? [bytes / KB, 'KB'] : [bytes / MB, 'MB']
  const text = Number.isInteger(value) ? String(value) : value.toFixed(1)
  return `${text} ${unit}`
}

/** Sort a batch into what is sent and what is refused here, each refusal a sentence that names the file and the limit. */
export function planUploads(files: ArrayLike<File>, maxBytes: number): UploadPlan {
  const accepted: File[] = []
  const refused: UploadRefusal[] = []
  for (const file of Array.from(files)) {
    if (file.size > maxBytes) {
      refused.push({ file, code: 'file_too_large',
        message: `“${file.name}” is ${formatFileSize(file.size)}, over the ${formatFileSize(maxBytes)} limit for one file. It was not uploaded.` })
    } else if (file.size === 0) {
      refused.push({ file, code: 'empty_file', message: `“${file.name}” is empty. It was not uploaded.` })
    } else accepted.push(file)
  }
  return { accepted, refused }
}

export type FilesPreviewKind = 'pdf' | 'image' | 'download'

export interface FilesTypeFacts {
  readonly mimeType?: string | null
  readonly fileType?: string | null
  readonly originalFilename?: string | null
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg', 'ico'])

function extensionOf(facts: FilesTypeFacts): string {
  const declared = facts.fileType?.trim().toLowerCase()
  if (declared && declared !== 'unknown') return declared
  const name = facts.originalFilename?.trim() ?? ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/**
 * How an opened file is shown (CONTRACT-files §2): `application/pdf` in the original-page viewer, `image/*` as a preview,
 * anything else downloads. A declared type wins; only a file stored without a meaningful type falls back to its extension.
 */
export function filesPreviewKind(facts: FilesTypeFacts): FilesPreviewKind {
  const mime = facts.mimeType?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  if (mime === 'application/pdf') return 'pdf'
  if (mime.startsWith('image/')) return 'image'
  if (mime && mime !== 'application/octet-stream') return 'download'
  const extension = extensionOf(facts)
  if (extension === 'pdf') return 'pdf'
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  return 'download'
}

/** The glyph's short type caption ('PDF', 'ZIP'); empty when nothing short and honest can be said. */
export function typeCaption(facts: FilesTypeFacts): string {
  let extension = extensionOf(facts)
  if (!extension) {
    const subtype = facts.mimeType?.split(';', 1)[0]?.split('/')[1]?.split(/[+.-]/)[0]?.toLowerCase() ?? ''
    extension = subtype === 'octet' ? '' : subtype
  }
  return extension && extension.length <= 4 && /^[a-z0-9]+$/.test(extension) ? extension.toUpperCase() : ''
}
