/** Pure helpers for the hoja app. The first line of a note IS its title. */

/** First non-empty line, markdown heading/list tokens stripped, truncated. */
export function firstLineTitle(markdown: string, fallback = 'New leaf'): string {
  for (const raw of markdown.split('\n')) {
    const line = raw
      .replace(/^#{1,6}\s+/, '')
      .replace(/^(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?/, '')
      .replace(/^>\s+/, '')
      .trim()
    if (line.length > 0) {
      return line.length > 64 ? `${line.slice(0, 63)}…` : line
    }
  }
  return fallback
}

/** The line after the title line, lightly de-markdowned, for the list row. */
export function snippetOf(markdown: string): string {
  let seenTitle = false
  for (const raw of markdown.split('\n')) {
    const line = raw
      .replace(/^#{1,6}\s+/, '')
      .replace(/^(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?/, '')
      .replace(/^>\s+/, '')
      .replace(/[*_`~]/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .trim()
    if (line.length === 0) continue
    if (!seenTitle) {
      seenTitle = true
      continue
    }
    return line.length > 96 ? `${line.slice(0, 95)}…` : line
  }
  return ''
}

/** Quiet relative timestamps in the Bear register: 'now', '12m', '3h', 'ayer'-free. */
export function relativeTime(modifiedMs: number, nowMs: number = Date.now()): string {
  const delta = Math.max(0, nowMs - modifiedMs)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (delta < minute) return 'now'
  if (delta < hour) return `${Math.floor(delta / minute)}m`
  if (delta < day) return `${Math.floor(delta / hour)}h`
  if (delta < 7 * day) return `${Math.floor(delta / day)}d`
  const date = new Date(modifiedMs)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[date.getMonth()]} ${date.getDate()}`
}
