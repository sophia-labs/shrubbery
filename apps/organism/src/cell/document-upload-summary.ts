import type { UploadBatchResult } from './document-transfer.js'

/** Keep extraction warnings visible after the transient per-file progress ends. */
export function documentUploadSummary(result: UploadBatchResult): string {
  const sourceOnly = result.succeeded.filter(item => item.extractionStatus === 'no-text').length
  const imported = result.succeeded.length - sourceOnly
  const parts = [`imported ${imported} document${imported === 1 ? '' : 's'}`]
  if (sourceOnly) parts.push(`${sourceOnly} original${sourceOnly === 1 ? '' : 's'} retained without extracted text`)
  if (result.failed.length) parts.push(`failed ${result.failed.length}`)
  if (result.skipped.length) parts.push(`skipped ${result.skipped.length} system files`)
  if (result.cancelled) parts.push('cancelled')
  const details = [
    ...result.succeeded.flatMap(item => item.warnings.map(warning => `${item.file.name}: ${warning}`)),
    ...result.failed.map(item => `${item.file.name}: ${item.error.message}`),
  ]
  return `${parts.join(', ')}${details.length ? `:\n${details.join('\n')}` : ''}`
}
