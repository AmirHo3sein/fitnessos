/**
 * Nutrition — meals, and what is in them.
 *
 * The sixth editor on `editor-engine`, and the first with a genuinely nested document. Every
 * builder before this was flat: a programme's blocks, a form's fields, a report's tiles, a
 * dashboard's widgets and a plan's phases all live in `rootIds` and nothing else. A meal CONTAINS
 * items, so `childIds` finally carries something — and with it `parentOf`, `descendantsOf`, and
 * `RemoveNode`'s subtree capture into `InsertSubtree`, which had existed since the engine was
 * written with no consumer outside its own unit tests.
 *
 * ## Nutrients are not computed, and that is a decision
 *
 * An item names a food and an amount, and stops. Totalling protein or energy needs a food
 * catalogue, and ADR-0012 makes catalogue versioning a prerequisite for historical display
 * fidelity — still pending. Without it, a plan authored today would silently change meaning when a
 * catalogue entry was corrected: same plan, same foods, different numbers, nothing recording which
 * version produced which total.
 */
export * from './domain/NutritionPlan'
export * from './editor/schema'
export * from './application/index'
