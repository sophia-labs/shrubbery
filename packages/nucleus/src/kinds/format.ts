/**
 * format.ts — the ONE timestamp register + formatter (R4c).
 *
 * DOCTRINE (the three timestamp layers, reconciled):
 *   - CARRIERS hold epoch ms (`Attributed.observedAt` is the anchor; a view-model
 *     timestamp field is a number, never a preformatted string).
 *   - THE RDF WIRE holds xsd:dateTime ISO strings, derived via `epochMsToIso`
 *     at the face boundary (Emporium's dateTime token accepts epoch-ms → ISO).
 *   - DISPLAY STRINGS come only from `formatTimestamp` / `formatAge` — the
 *     deterministic UTC formatter. Face-stable, locale-free; DOM layers may
 *     localize on top, but the face default never does.
 *
 * Pure: zero imports, no globals beyond Date/Number/Math.
 */

/** True iff (y, m, d) is a real Gregorian calendar date — rejects "2026-02-30"
 *  and similar overflow dates `Date.parse`/`Date.UTC` would otherwise
 *  silently NORMALIZE (e.g. to 2026-03-02) rather than reject (LOW-1: no
 *  calendar leniency). `m` is 1-indexed (matches the ISO string it's parsed
 *  from), converted to `Date.UTC`'s 0-indexed month internally. */
function isValidCalendarDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/**
 * Normalize a timestamp carrier to epoch ms, or null on garbage — honest, no
 * guessing:
 *   - a finite number is taken as epoch ms (truncated to integer),
 *   - an all-digit string is epoch ms,
 *   - an ISO-8601 date ("2026-07-11", UTC midnight per ECMA-262) or a date-time
 *     WITH an explicit offset ("2026-07-11T19:20:00Z", "…+02:00") parses,
 *   - a zone-NAIVE date-time is REJECTED (parsing it would guess a timezone),
 *   - a CALENDAR-INVALID date ("2026-02-30") is REJECTED — round-trip
 *     validated against the calendar fields as WRITTEN, never silently
 *     normalized by `Date.parse` into the following month (LOW-1),
 *   - anything else → null.
 */
export function toEpochMs(value: string | number): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value) : null
  }
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^-?\d+$/.test(trimmed)) {
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : null
  }
  const isoDateOnly = /^(\d{4})-(\d{2})-(\d{2})$/
  const isoWithZone = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/
  const m = isoDateOnly.exec(trimmed) ?? isoWithZone.exec(trimmed)
  if (!m) return null
  if (!isValidCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]))) return null
  const parsed = Date.parse(trimmed)
  return Number.isNaN(parsed) ? null : parsed
}

/** Epoch ms → the xsd:dateTime ISO string the RDF wire carries. Throws on non-finite input (errors surface verbatim). */
export function epochMsToIso(ms: number): string {
  return new Date(ms).toISOString()
}

/**
 * THE display formatter — deterministic UTC, locale-free, face-stable:
 *   `2026-07-04 15:00 UTC`; when `opts.now` is supplied and falls on the same
 *   UTC calendar day, the date is elided: `15:00 UTC`.
 */
export function formatTimestamp(epochMs: number, opts?: { readonly now?: number }): string {
  const iso = epochMsToIso(epochMs)
  const date = iso.slice(0, 10)
  const time = iso.slice(11, 16)
  if (opts?.now !== undefined && epochMsToIso(opts.now).slice(0, 10) === date) {
    return `${time} UTC`
  }
  return `${date} ${time} UTC`
}

/** The capture-age chip's helper — "3m ago", deterministic given (epochMs, now). */
export function formatAge(epochMs: number, now: number): string {
  const deltaMs = now - epochMs
  if (deltaMs < 0) return 'in the future'
  const seconds = Math.floor(deltaMs / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}
