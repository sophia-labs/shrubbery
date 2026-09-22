/**
 * TipTap tag recognition.
 *
 * Recognizes inline #tag and #tag:date markers as the user types, replacing the
 * marker with a tagChip atom when that node is loaded. Garden's filesystem store
 * and daily-note materializer calls are severed into an optional host callback.
 */
import { Extension, InputRule } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'

export const SCHEDULED_TAGS = new Set<string>(['event', 'todo'])

export interface ScheduledTagDetail {
  tag: string
  absoluteDate: string
  sourceBlockId: string
  sourceContent: string
}

export type ScheduledTagHandler = (detail: ScheduledTagDetail) => void

export interface TagRecognitionOptions {
  /** Deterministic seam for tests/shells. Defaults to the user's local day. */
  getToday?: () => string
  /** Host seam for daily-note materialization / other scheduled-tag side effects. */
  onScheduledTag?: ScheduledTagHandler
}

// Word-boundary anchored at start (start of paragraph or after whitespace).
// Tag name: letter + word-class chars. Optional date: Nd or YYYY-MM-DD.
// Trigger: trailing whitespace.
export const TAG_INPUT_RE = /(?:^|\s)#([a-zA-Z][a-zA-Z0-9_-]*)(?::(\d+d|\d{4}-\d{2}-\d{2}))?\s$/

export function todayKey(date: Date = new Date()): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970'
  const month = parts.find((part) => part.type === 'month')?.value ?? '01'
  const day = parts.find((part) => part.type === 'day')?.value ?? '01'
  return `${year}-${month}-${day}`
}

function dateFromTodayKey(getToday?: () => string): Date {
  const key = getToday?.()
  if (key && /^\d{4}-\d{2}-\d{2}$/.test(key)) return new Date(`${key}T00:00:00Z`)
  return new Date()
}

/** Resolve a duration string ("Nd" / "YYYY-MM-DD") to an absolute ISO date. */
export function resolveTagExpiration(
  value: string | undefined | null,
  today: Date = new Date(),
): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  const match = /^(\d+)d$/.exec(trimmed)
  if (!match) return null
  const days = Number.parseInt(match[1], 10)
  const date = new Date(today)
  date.setUTCDate(date.getUTCDate() + days)
  const year = date.getUTCFullYear().toString().padStart(4, '0')
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0')
  const day = date.getUTCDate().toString().padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseTagsAttr(raw: unknown): string[] {
  if (typeof raw !== 'string') return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0)
    }
  } catch {
    // fall through
  }
  return []
}

function parseExpirationsAttr(raw: unknown): Record<string, string> {
  if (typeof raw !== 'string') return {}
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {}
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string') out[key.toLowerCase()] = value
      }
      return out
    }
  } catch {
    // fall through
  }
  return {}
}

interface TagApplicationResult {
  tag: string
  date: string | null
  alreadyHadTag: boolean
  alreadyHadDate: boolean
}

/** Pure attr update helper for the no-tagChip fallback path and tests. */
export function applyTagToBlockAttrs(
  blockAttrs: Record<string, unknown>,
  tag: string,
  date: string | null,
): { newAttrs: Record<string, unknown>; result: TagApplicationResult } {
  const tagNorm = tag.trim().replace(/^#/, '').toLowerCase()
  const existingTags = parseTagsAttr(blockAttrs['data-tags'])
  const existingExp = parseExpirationsAttr(blockAttrs['data-tag-expirations'])

  const alreadyHadTag = existingTags.includes(tagNorm)
  const alreadyHadDate = date !== null && existingExp[tagNorm] === date
  const newTags = alreadyHadTag ? existingTags : [...existingTags, tagNorm]
  const newExp = { ...existingExp }
  if (date) newExp[tagNorm] = date

  for (const key of Object.keys(newExp)) {
    if (!newTags.includes(key)) delete newExp[key]
  }

  const newAttrs: Record<string, unknown> = {
    ...blockAttrs,
    'data-tags': JSON.stringify(newTags),
  }
  newAttrs['data-tag-expirations'] =
    Object.keys(newExp).length > 0 ? JSON.stringify(newExp) : null

  return {
    newAttrs,
    result: { tag: tagNorm, date, alreadyHadTag, alreadyHadDate },
  }
}

function scheduledDateFor(
  tagName: string,
  rawDate: string | undefined,
  options: TagRecognitionOptions,
): string | null {
  if (rawDate) return resolveTagExpiration(rawDate, dateFromTodayKey(options.getToday))
  if (SCHEDULED_TAGS.has(tagName)) return options.getToday?.() ?? todayKey()
  return null
}

function notifyScheduledTag(args: {
  options: TagRecognitionOptions
  state: EditorState
  pos: number
  tag: string
  absoluteDate: string | null
  matchedText: string
}): void {
  if (!args.absoluteDate || !SCHEDULED_TAGS.has(args.tag)) return
  const resolved = args.state.doc.resolve(args.pos)
  if (resolved.depth < 1) return
  const blockNode = resolved.node(1)
  const sourceBlockId = (blockNode.attrs['data-block-id'] as string | undefined) ?? ''
  const sourceContent = (blockNode.textContent ?? '').replace(args.matchedText, '').trim()
  args.options.onScheduledTag?.({
    tag: args.tag,
    absoluteDate: args.absoluteDate,
    sourceBlockId,
    sourceContent,
  })
}

export const TagRecognition = Extension.create<TagRecognitionOptions>({
  name: 'tagRecognition',

  addOptions() {
    return {
      getToday: undefined,
      onScheduledTag: undefined,
    }
  },

  addInputRules() {
    const options = this.options
    return [
      new InputRule({
        find: TAG_INPUT_RE,
        handler: ({ state, range, match }) => {
          const tagName = (match[1] || '').toLowerCase()
          if (!tagName) return

          const absoluteDate = scheduledDateFor(tagName, match[2], options)
          const chipType = state.schema.nodes.tagChip
          const leadingLength = match[0].indexOf('#')
          const replaceFrom = range.from + leadingLength
          const replaceTo = range.to - 1
          const matchedText = match[0].trimStart()

          if (!chipType) {
            const resolved = state.doc.resolve(range.from)
            if (resolved.depth < 1) return
            const blockPos = resolved.before(1)
            const blockNode = resolved.node(1)
            const { newAttrs, result } = applyTagToBlockAttrs(
              blockNode.attrs as Record<string, unknown>,
              tagName,
              absoluteDate,
            )
            if (result.alreadyHadTag && result.alreadyHadDate) return
            state.tr.setNodeMarkup(blockPos, undefined, newAttrs)
            notifyScheduledTag({
              options,
              state,
              pos: replaceFrom,
              tag: tagName,
              absoluteDate,
              matchedText,
            })
            return
          }

          state.tr.replaceWith(
            replaceFrom,
            replaceTo,
            chipType.create({
              name: tagName,
              date: absoluteDate,
            }),
          )

          notifyScheduledTag({
            options,
            state,
            pos: replaceFrom,
            tag: tagName,
            absoluteDate,
            matchedText,
          })
        },
      }),
    ]
  },
})

export default TagRecognition
