import { unsafeCSS } from 'lit'

/**
 * The skins whose chrome the components' "98" blocks bevel: skin-98 itself and Hotdog Stand
 * (Windows 3.1's colour scheme wears the same raised and sunken, square, framed controls).
 *
 * Those blocks read only tokens — the `--mn-98-*` vocabulary (face, raised, sunken, selection…)
 * and the semantic roles — so admitting a skin is two things and nothing else: add its id here,
 * and have its skin file answer the `--mn-98-*` names from its own palette. A component keys a
 * block on the list with `:host(${BEVELLED}) …`; it never names a skin.
 *
 * Not admitted, on purpose: a menu's CONTAINER. Windows 3.1 drew menus in the Menu colour (white,
 * framed), not Button Face, so those blocks stay 98's own and Hotdog Stand takes the popover roles.
 */
export const BEVELLED_SKIN_IDS = ['98', 'hotdog-stand'] as const

/** `:is([data-skin='98'], [data-skin='hotdog-stand'])`, ready to sit inside `:host(…)`. */
export const BEVELLED = unsafeCSS(`:is(${BEVELLED_SKIN_IDS.map(id => `[data-skin='${id}']`).join(', ')})`)

/**
 * The skins that paint their LISTS as list boxes: Window on Window Text on silver chrome (Windows 3.1's
 * File Manager and list boxes), selection Highlight on Highlighted Text. A block keyed on this list
 * reads the `--mn-list-*` roles and re-scopes the shared ink roles inside the list to them — the same
 * device the editor host uses for a coloured page. Skins not on the list render exactly as before.
 */
export const WINDOW_LISTED_SKIN_IDS = ['hotdog-stand'] as const

/** `:is([data-skin='hotdog-stand'])`, ready to sit inside `:host(…)`. */
export const WINDOW_LISTED = unsafeCSS(`:is(${WINDOW_LISTED_SKIN_IDS.map(id => `[data-skin='${id}']`).join(', ')})`)
