/**
 * @shrubbery/components icon system — ported from garden's icon system
 * (garden/frontend/src/lib/icons.ts, READ-ONLY ref). Kept PURE: lit + lucide
 * ONLY — no stores, no Tauri, no host coupling (same island discipline as the
 * rest of this package).
 *
 * Uses Lucide icons for a warm, consistent visual language. Icons render as
 * inline SVG built from each lucide IconNode as a STATIC SVG STRING that we
 * inject as ONE `unsafeHTML(<svg>…</svg>)` at the `html` (HTML) level.
 *
 * ⚠ WHY NOT Lit's `svg` template tag (the previous approach): under happy-dom —
 * which is exactly the runtime the SSR/curl `dom` face (dom-server.ts) and the
 * smokes use — the `svg`-tagged child templates (`<path …>` built with Lit's
 * `svg` tag) land in the SVG FOREIGN NAMESPACE and happy-dom DROPS them: the
 * emitted `<svg class="mn-icon">` has ZERO path children (verified:
 * svg.childElementCount === 0 in the live happy-dom tree, not just .outerHTML).
 * So the verdict glyph, family glyphs, and git-merge ghost icon ALL rendered
 * EMPTY in the SSR/curl face — the redundant "verdict GLYPH" the design promises
 * (P0/A3: "surface + border + the VERDICT GLYPH + offender copy, never colour
 * alone") silently degraded to colour+text-only under curl.
 *
 * The FIX: emit the whole `<svg>…<path/>…</svg>` as a string and render it with
 * `unsafeHTML` in an `html` part. happy-dom's HTML parser handles the full svg
 * element + its children correctly there (verified: childElementCount === 2 for a
 * 2-path glyph), AND real browsers render it identically. The icon content is a
 * fixed, library-internal vocabulary (lucide IconNodes) + caller-controlled
 * size/stroke/class — never untrusted markup — so unsafeHTML is safe here.
 *
 * Usage in Lit components:
 *   import { icon } from './icons.js'
 *   render() { return html`${icon('settings')}` }
 *
 * With custom size/color:
 *   ${icon('eye', { size: 20, class: 'mn-icon-spin' })}
 *
 * ⚠ SHADOW DOM: these components render in Shadow DOM. Garden renders in light
 * DOM and inherits the global `iconStyles` for free; here EACH component that
 * uses `icon()` must add the `iconStyles` rule to its `static styles` so the
 * inline `<svg>` inherits `stroke: currentColor` (otherwise the icon is invisible
 * / black). See iconStyles below.
 */

import { html, type TemplateResult } from 'lit'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import {
  // Theme / skin / chrome actions
  Sun,
  Moon,
  Eye,
  EyeOff,
  Settings,
  Search,
  SearchX,
  X,
  Calendar,
  CalendarDays,

  // Brand / masthead glyphs
  Sprout,
  Leaf,
  Hexagon,
  Diamond,

  // Switcher / layout
  Layers,
  Network,
  Monitor,
  PanelLeft,
  Menu,
  Maximize2,
  Minimize2,

  // Common chrome niceties (useful for shells slotting actions)
  Plus,
  Pin,
  FilePlusCorner,
  Check,
  Folder,
  FolderSearch,
  House,
  FileText,
  BookOpen,
  Hash,
  ImagePlus,
  Upload,
  Download,
  MoreHorizontal,
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  ExternalLink,
  Link,
  Cable,
  RefreshCw,
  Filter,
  Info,
  AlertCircle,
  AlertTriangle,
  WifiOff,
  CircleHelp,
  Share2,
  Inbox,
  MessageSquare,
  MessageCircle,
  Star,
  Bug,
  Lightbulb,
  Clipboard,
  Paperclip,
  Printer,
  Play,
  Pause,
  Volume2,
  Square,
  SkipBack,
  SkipForward,
  RotateCcw,
  Trash2,
  Pencil,
  Unlock,
  Bookmark,
  Save,
  History,
  GitBranch,
  Scale,
  Zap,
  Database,
  Package,
  CornerUpRight,
  Superscript,
  ALargeSmall,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  Highlighter,
  AlignLeft,
  AlignCenter,
  AlignRight,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Heading1,
  Heading2,
  Heading3,
  Table,
  Undo2,
  Redo2,
  Type,
  Circle,
  User,
  Bot,
  CircleCheck,
  LoaderCircle,

  // Greenhouse — the cultivation knobs (climate / judgment / reach / laws / spend)
  Thermometer,
  Gauge,
  Clock,
  GitMerge,
  SlidersHorizontal,
  Wallet,
  Flame,
  Target,
  Coins,

  // Observatory — the instrument-console skin
  Telescope,

  type IconNode,
} from 'lucide'

// Icon registry — maps stable names to Lucide IconNodes. Covers the chrome
// actions the bars need (sun/moon/eye/settings/search/x), the brand glyphs
// (sprout/leaf/hexagon/diamond), the switcher (layers), plus a sensible set of
// common chrome icons a shell may slot.
const iconMap: Record<string, IconNode> = {
  // Theme / skin / settings / search / clear
  'sun': Sun,
  'moon': Moon,
  'eye': Eye,
  'eye-off': EyeOff,
  'settings': Settings,
  'search': Search,
  'search-x': SearchX,
  'x': X,
  'close': X,
  'clear': X,
  'calendar': Calendar,
  'calendar-days': CalendarDays,

  // Brand / masthead glyphs
  'sprout': Sprout,
  'garden': Sprout,
  'leaf': Leaf,
  'hexagon': Hexagon,
  'diamond': Diamond,
  'telescope': Telescope,

  // Switcher / layout
  'layers': Layers,
  'network': Network,
  'graph': Network,
  'monitor': Monitor,
  'computer': Monitor,
  'panel-left': PanelLeft,
  'menu': Menu,
  'maximize': Maximize2,
  'maximize-2': Maximize2,
  'fullscreen': Maximize2,
  'minimize': Minimize2,
  'minimize-2': Minimize2,

  // Common chrome
  'plus': Plus,
  'add': Plus,
  'pin': Pin,
  'file-plus-corner': FilePlusCorner,
  'check': Check,
  'folder': Folder,
  'folder-search': FolderSearch,
  'home': House,
  'house': House,
  'file': FileText,
  'file-text': FileText,
  'document': FileText,
  'book-open': BookOpen,
  'hash': Hash,
  'tag': Hash,
  'image-plus': ImagePlus,
  'insert-image': ImagePlus,
  'upload': Upload,
  'download': Download,
  'more-horizontal': MoreHorizontal,
  'more': MoreHorizontal,
  'chevron-right': ChevronRight,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  'arrow-up': ArrowUp,
  'arrow-down': ArrowDown,
  'external-link': ExternalLink,
  'link': Link,
  'wire': Cable,
  'refresh-cw': RefreshCw,
  'refresh': RefreshCw,
  'filter': Filter,
  'info': Info,
  'alert-circle': AlertCircle,
  'error': AlertCircle,
  'alert-triangle': AlertTriangle,
  'warning': AlertTriangle,
  'wifi-off': WifiOff,
  'help': CircleHelp,
  'help-circle': CircleHelp,
  'share': Share2,
  'share-2': Share2,
  'inbox': Inbox,
  'message-square': MessageSquare,
  'comment': MessageSquare,
  'message-circle': MessageCircle,
  'star': Star,
  'bug': Bug,
  'lightbulb': Lightbulb,
  'clipboard': Clipboard,
  'paperclip': Paperclip,
  'copy': Clipboard,
  'printer': Printer,
  'play': Play,
  'pause': Pause,
  'volume-2': Volume2,
  'stop': Square,
  'square': Square,
  'skip-back': SkipBack,
  'skip-forward': SkipForward,
  'undo': RotateCcw,
  'rotate-ccw': RotateCcw,
  'trash': Trash2,
  'trash-2': Trash2,
  'pencil': Pencil,
  'unlock': Unlock,
  'bookmark': Bookmark,
  'save': Save,
  'history': History,
  'git-branch': GitBranch,
  'branch': GitBranch,
  'scale': Scale,
  'zap': Zap,
  'database': Database,
  'package': Package,
  'corner-up-right': CornerUpRight,
  'superscript': Superscript,
  'footnote': Superscript,
  'plain-text': ALargeSmall,
  'bold': Bold,
  'italic': Italic,
  'underline': Underline,
  'strikethrough': Strikethrough,
  'strike': Strikethrough,
  'code': Code,
  'highlighter': Highlighter,
  'highlight': Highlighter,
  'align-left': AlignLeft,
  'align-center': AlignCenter,
  'align-right': AlignRight,
  'list': List,
  'bullet-list': List,
  'list-ordered': ListOrdered,
  'ordered-list': ListOrdered,
  'list-checks': ListChecks,
  'task-list': ListChecks,
  'quote': Quote,
  'blockquote': Quote,
  'heading-1': Heading1,
  'heading1': Heading1,
  'heading-2': Heading2,
  'heading2': Heading2,
  'heading-3': Heading3,
  'heading3': Heading3,
  'table': Table,
  'undo-2': Undo2,
  'redo-2': Redo2,
  'type': Type,
  'circle': Circle,
  'user': User,
  'bot': Bot,
  'circle-check': CircleCheck,
  'loader-circle': LoaderCircle,

  // Greenhouse — the cultivation knobs. CLIMATE (thermometer/flame), the salience &
  // bench meters (gauge/activity → gauge), JUDGMENT (layers reused for supersession,
  // git-merge for entity-resolution), REACH (clock for the cutoff), METER&SPEND
  // (wallet/coins for the budget), plus sliders (a generic knob) + target (a meter
  // target line). Never emoji — the inline lucide <svg> inherits currentColor.
  'thermometer': Thermometer,
  'gauge': Gauge,
  'clock': Clock,
  'git-merge': GitMerge,
  'merge': GitMerge,
  'sliders': SlidersHorizontal,
  'sliders-horizontal': SlidersHorizontal,
  'wallet': Wallet,
  'flame': Flame,
  'target': Target,
  'coins': Coins,
}

export type IconName = keyof typeof iconMap

export interface IconOptions {
  size?: number
  strokeWidth?: number
  class?: string
  color?: string
}

/**
 * What `icon()` returns: an `unsafeHTML` directive result (the inline <svg>) for a
 * known glyph, or a TemplateResult placeholder span for an unknown one. Both are
 * valid Lit child values, so a caller always writes `${icon('x')}` unchanged.
 *
 * NB the directive is returned DIRECTLY (not wrapped in html`${…}`): under happy-dom
 * a `html`${unsafeHTML(svg)}`` wrapper nested as a child renders the broken `<?>`
 * text — returning the bare directive renders the real <svg> with its path children.
 */
export type IconResult = TemplateResult | ReturnType<typeof unsafeHTML>

// Memo cache so identical icon() calls return the SAME instance across renders.
// Without this, the SVG DOM is re-created on every parent re-render (resetting any
// CSS animation like mn-icon-spin to frame 0). Cache size is bounded by the small,
// stable (name × size × strokeWidth × class × color) product; no eviction needed.
const iconTemplateCache = new Map<string, IconResult>()

/** Escape a value for safe inclusion in a double-quoted SVG/HTML attribute. */
function attr(v: string): string {
  return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** The fixed lucide attribute vocabulary, in a stable order per element type. */
const CHILD_ATTRS: Readonly<Record<string, readonly string[]>> = {
  path: ['d', 'fill'],
  circle: ['cx', 'cy', 'r', 'fill'],
  ellipse: ['cx', 'cy', 'rx', 'ry', 'fill'],
  line: ['x1', 'y1', 'x2', 'y2'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry', 'fill'],
  polygon: ['points', 'fill'],
  polyline: ['points', 'fill'],
}

/**
 * Serialize ONE lucide IconNode child (path / circle / line / rect / ellipse /
 * polygon / polyline) to an SVG element STRING. Lucide's entire library uses only
 * these element types and the fixed attribute vocabulary in CHILD_ATTRS — handled
 * exhaustively here. Unknown element types serialize to '' (never faked). The
 * string is injected into the parent <svg> via one unsafeHTML at the html level
 * (see `icon` below) so happy-dom + browsers both parse the path children.
 */
function childString(tag: string, a: Record<string, string>): string {
  const keys = CHILD_ATTRS[tag]
  if (!keys) return ''
  let out = `<${tag}`
  for (const k of keys) {
    const v = a[k]
    if (v != null) out += ` ${k}="${attr(v)}"`
  }
  return `${out}/>`
}

/**
 * Render a Lucide icon as an inline SVG (built natively from the IconNode via Lit
 * templates).
 *
 * @param name - Icon name (see iconMap for available icons)
 * @param options - Size (default 16), strokeWidth (default 2), class, color
 * @returns A Lit child value: the inline <svg> (unsafeHTML directive) for a known
 *          glyph, or a sized placeholder span (TemplateResult) for an unknown one.
 */
export function icon(name: IconName | string, options: IconOptions = {}): IconResult {
  const { size = 16, strokeWidth = 2, class: className = '', color } = options

  const cacheKey = `${name}|${size}|${strokeWidth}|${className}|${color ?? ''}`
  const cached = iconTemplateCache.get(cacheKey)
  if (cached) return cached

  const iconNode = iconMap[name]

  if (!iconNode) {
    console.warn(`[icons] Unknown icon: "${name}"`)
    // Return an empty, sized placeholder rather than nothing (keeps layout stable).
    const placeholder = html`<span
      class="mn-icon icon-placeholder"
      style="width: ${size}px; height: ${size}px; display: inline-block;"
    ></span>`
    iconTemplateCache.set(cacheKey, placeholder)
    return placeholder
  }

  const children = iconNode.map(([tag, attrs]) => childString(tag, attrs as Record<string, string>)).join('')

  // The lucide SVG envelope (viewBox 0 0 24 24, round caps/joins) with our size /
  // stroke-width / class / color applied, serialized as ONE string and injected via
  // unsafeHTML. `stroke=currentColor` is the default; the iconStyles rule (stroke:
  // currentColor) also enforces it in Shadow DOM. Emitting the full <svg>…<path/>…
  // </svg> as HTML (not Lit's `svg` tag) is what keeps the path children alive under
  // happy-dom (the SSR/curl face) — see the module header for the why.
  const cls = className ? `mn-icon ${className}` : 'mn-icon'
  const svgString =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${attr(String(size))}" height="${attr(String(size))}"` +
    ` viewBox="0 0 24 24" fill="none" stroke="${attr(color ?? 'currentColor')}" stroke-width="${attr(String(strokeWidth))}"` +
    ` stroke-linecap="round" stroke-linejoin="round" class="${attr(cls)}"` +
    ` style="display:inline-block;vertical-align:middle;flex-shrink:0;pointer-events:none">${children}</svg>`
  const result = unsafeHTML(svgString)
  iconTemplateCache.set(cacheKey, result)
  return result
}

/**
 * CSS for icon styling — MUST be included in EACH consuming component's
 * `static styles` (Shadow DOM does not inherit a global stylesheet). This is the
 * rule that makes the inline SVG follow the surrounding text color
 * (`stroke: currentColor`) instead of rendering black/invisible.
 */
export const iconStyles = `
  .mn-icon {
    display: inline-block;
    vertical-align: middle;
    flex-shrink: 0;
    stroke: currentColor;
    fill: none;
  }

  .mn-icon-spin {
    animation: mn-icon-spin 1s linear infinite;
  }

  @keyframes mn-icon-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
`

/** Get the list of all available icon names. */
export function getAvailableIcons(): string[] {
  return Object.keys(iconMap)
}

/** Check whether an icon exists in the registry. */
export function hasIcon(name: string): boolean {
  return name in iconMap
}
