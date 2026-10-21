/**
 * Typed object faces, the pure part (typed objects architecture D6/D7, `plans/2026-10-20-typed-objects/README.md`):
 * the field model `card.object` and the typed face share, the read of a typed resource, the class catalogue
 * (`emporium_vocab`'s `classCatalog`), `typedObjectModel`, and `resolveObjectFace`. Each target draws the model:
 * web = `<sh-object-view>` (runtime), agent = `emporium_describe` (gardend).
 *
 * Pure: no DOM, no network, no Lit.
 */

export * from './catalog.js'
export * from './field-model.js'
export * from './model.js'
export * from './resolver.js'
export * from './terms.js'
export * from './being.js'
