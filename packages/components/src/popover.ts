/**
 * popover.ts — re-export of the shared native top-layer helper.
 *
 * The implementation moved to @shrubbery/nucleus so packages/runtime can
 * use the same controller: runtime has no dependency on this package (and
 * should not gain one), and nucleus is the seam both already share. This
 * module path stays put so existing component imports keep working.
 */

export {
  showPopover,
  hidePopover,
  isPopoverOpen,
  positionPopover,
  PopoverController,
} from '@shrubbery/nucleus'
export type {
  PopoverPlacement,
  PositionOptions,
  PopoverControllerOptions,
} from '@shrubbery/nucleus'
