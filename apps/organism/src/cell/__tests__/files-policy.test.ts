// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { FILES_DEFAULT_MAX_UPLOAD_BYTES, filesPreviewKind, formatFileSize, planUploads, typeCaption } from '../files-policy.js'

/** A File of exactly `size` bytes without allocating them: a sparse Blob is enough for the size check. */
function sized(name: string, size: number, type = 'application/octet-stream'): File {
  const file = new File([], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

describe('upload policy: any file, one cap per file', () => {
  it('is the contract cap: 52,428,800 bytes (50 MiB)', () => {
    expect(FILES_DEFAULT_MAX_UPLOAD_BYTES).toBe(52_428_800)
  })

  it('accepts exactly 50 MiB and refuses one byte more, with a sentence that names the file and the limit', () => {
    const exact = sized('exact.bin', 52_428_800)
    const over = sized('Field recording.mov', 52_428_801, 'video/quicktime')
    const plan = planUploads([exact, over], FILES_DEFAULT_MAX_UPLOAD_BYTES)
    expect(plan.accepted).toEqual([exact])
    expect(plan.refused).toEqual([{ file: over, code: 'file_too_large',
      message: '“Field recording.mov” is 50.0 MB, over the 50 MB limit for one file. It was not uploaded.' }])
  })

  it('takes any type: archives, executables, documents, files without an extension', () => {
    const files = [sized('a.zip', 10), sized('b.exe', 10), sized('c.docx', 10), sized('Makefile', 10), sized('d.heic', 10, 'image/heic')]
    expect(planUploads(files, FILES_DEFAULT_MAX_UPLOAD_BYTES)).toEqual({ accepted: files, refused: [] })
  })

  it('refuses an empty file (the cell would answer empty_file)', () => {
    const empty = sized('empty.txt', 0)
    expect(planUploads([empty], FILES_DEFAULT_MAX_UPLOAD_BYTES).refused).toEqual([
      { file: empty, code: 'empty_file', message: '“empty.txt” is empty. It was not uploaded.' },
    ])
  })

  it('a cell may advertise another cap; the plan uses the cap it is given', () => {
    const plan = planUploads([sized('a.bin', 2048)], 1024)
    expect(plan.refused[0]?.message).toBe('“a.bin” is 2 KB, over the 1 KB limit for one file. It was not uploaded.')
  })

  it('formats sizes the way the refusal speaks', () => {
    expect([0, 999, 1024, 1536, 5 * 1024 * 1024, 52_428_800, 63_000_000].map(formatFileSize))
      .toEqual(['0 bytes', '999 bytes', '1 KB', '1.5 KB', '5 MB', '50 MB', '60.1 MB'])
  })
})

describe('preview routing by type (Vera\'s decision 2)', () => {
  it('a PDF opens in the original-page viewer', () => {
    expect(filesPreviewKind({ mimeType: 'application/pdf' })).toBe('pdf')
    expect(filesPreviewKind({ mimeType: 'application/octet-stream', fileType: 'pdf' })).toBe('pdf')
    expect(filesPreviewKind({ mimeType: null, originalFilename: 'Report.PDF' })).toBe('pdf')
  })

  it('an image previews', () => {
    for (const mimeType of ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif']) {
      expect(filesPreviewKind({ mimeType })).toBe('image')
    }
    expect(filesPreviewKind({ mimeType: '', fileType: 'jpg' })).toBe('image')
  })

  it('everything else downloads, whatever its name claims', () => {
    for (const file of [{ mimeType: 'application/zip' }, { mimeType: 'text/html' }, { mimeType: 'video/mp4' },
      { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, { mimeType: 'text/plain', fileType: 'txt' },
      { mimeType: 'application/x-msdownload', originalFilename: 'setup.exe' }, {}]) {
      expect(filesPreviewKind(file)).toBe('download')
    }
  })

  it('a declared type wins over the extension: a PDF name on an HTML body downloads', () => {
    expect(filesPreviewKind({ mimeType: 'text/html', originalFilename: 'invoice.pdf' })).toBe('download')
  })

  it('captions the glyph with the short type', () => {
    expect(typeCaption({ fileType: 'pdf' })).toBe('PDF')
    expect(typeCaption({ fileType: 'unknown', mimeType: 'application/zip' })).toBe('ZIP')
    expect(typeCaption({ fileType: 'jpeg' })).toBe('JPEG')
    expect(typeCaption({ fileType: 'verylongext' })).toBe('')
    expect(typeCaption({})).toBe('')
  })
})
