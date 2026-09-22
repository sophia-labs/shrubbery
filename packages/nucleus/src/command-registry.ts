/**
 * CommandRegistry: one addressable namespace for shell/editor capabilities.
 *
 * Pure module: no component imports. Surfaces such as context menus, palettes,
 * keyboard shortcuts, chrome rails, and inspectors query the same registry.
 */

import type { MenuEntry, MenuItemEntry, MenuSelectModifiers } from './menu-model.js'
import type { SelectedObject } from './selection.js'
import type { PanelId } from './workspace/types.js'

export type Surface = 'palette' | 'context' | 'toolbar' | 'rail' | 'inspector' | 'shortcut'

export type CommandRightPanelMode = PanelId | 'none'

export type Posture = 'manuscript' | 'comfortable' | 'application'

export interface CommandContext {
  /** Inspected object on the current tab or surface, if any. */
  readonly selection: SelectedObject | null
  readonly graphId: string | null
  readonly documentId: string | null
  readonly rightPanelMode: CommandRightPanelMode
  readonly posture: Posture
  readonly modifiers?: MenuSelectModifiers
  readonly [key: string]: unknown
}

export interface Command extends MenuItemEntry {
  readonly category: string
  readonly keywords?: readonly string[]
  readonly when?: (ctx: CommandContext) => boolean
  readonly appliesTo?: (selection: SelectedObject | null) => boolean
  readonly surfaces: readonly Surface[]
  readonly run: (ctx: CommandContext) => void | Promise<void>
}

export interface CommandRegistry {
  register(command: Command): void
  register(commands: readonly Command[]): void
  get(id: string): Command | undefined
  getAll(): Command[]
  available(ctx: CommandContext, surface?: Surface): Command[]
  search(query: string, ctx: CommandContext, surface?: Surface): Command[]
  toMenuEntries(ctx: CommandContext, surface?: Surface): MenuEntry[]
  exec(id: string, ctx: CommandContext): Promise<void>
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function isAvailable(command: Command, ctx: CommandContext): boolean {
  if (command.when && !command.when(ctx)) return false
  if (command.appliesTo && !command.appliesTo(ctx.selection)) return false
  return true
}

function isCommandList(value: Command | readonly Command[]): value is readonly Command[] {
  return Array.isArray(value)
}

export class CommandRegistryImpl implements CommandRegistry {
  private readonly commands = new Map<string, Command>()

  register(commandOrCommands: Command | readonly Command[]): void {
    if (isCommandList(commandOrCommands)) {
      for (const command of commandOrCommands) {
        this.commands.set(command.id, command)
      }
      return
    }
    this.commands.set(commandOrCommands.id, commandOrCommands)
  }

  get(id: string): Command | undefined {
    return this.commands.get(id)
  }

  getAll(): Command[] {
    return Array.from(this.commands.values())
  }

  available(ctx: CommandContext, surface?: Surface): Command[] {
    const results: Command[] = []
    for (const command of this.commands.values()) {
      if (surface !== undefined && !command.surfaces.includes(surface)) continue
      if (!isAvailable(command, ctx)) continue
      results.push(command)
    }
    return results
  }

  search(query: string, ctx: CommandContext, surface?: Surface): Command[] {
    const normalizedQuery = normalize(query)
    if (!normalizedQuery) return this.available(ctx, surface)

    const scored: Array<{ readonly command: Command; readonly score: number }> = []
    for (const command of this.available(ctx, surface)) {
      const label = normalize(command.label)
      let score = 0
      if (label.startsWith(normalizedQuery)) {
        score = 3
      } else if (label.includes(normalizedQuery)) {
        score = 2
      } else if (command.keywords?.some((keyword) => normalize(keyword).includes(normalizedQuery))) {
        score = 1
      }
      if (score > 0) scored.push({ command, score })
    }

    scored.sort((left, right) => right.score - left.score)
    return scored.map(({ command }) => command)
  }

  toMenuEntries(ctx: CommandContext, surface?: Surface): MenuEntry[] {
    const entries: MenuEntry[] = []
    let lastCategory: string | undefined

    for (const command of this.available(ctx, surface)) {
      if (command.category !== lastCategory) {
        if (lastCategory !== undefined) entries.push({ type: 'divider' })
        entries.push({ type: 'header', content: command.category })
        lastCategory = command.category
      }
      const item: MenuItemEntry = {
        id: command.id,
        label: command.label,
        ...(command.icon !== undefined && { icon: command.icon }),
        ...(command.shortcut !== undefined && { shortcut: command.shortcut }),
        ...(command.checked !== undefined && { checked: command.checked }),
        ...(command.disabled !== undefined && { disabled: command.disabled }),
        ...(command.variant !== undefined && { variant: command.variant }),
        ...(command.submenu !== undefined && { submenu: command.submenu }),
      }
      entries.push(item)
    }

    return entries
  }

  async exec(id: string, ctx: CommandContext): Promise<void> {
    const command = this.commands.get(id)
    if (!command) return
    if (!isAvailable(command, ctx)) return
    await command.run(ctx)
  }
}

export const registry: CommandRegistry = new CommandRegistryImpl()
