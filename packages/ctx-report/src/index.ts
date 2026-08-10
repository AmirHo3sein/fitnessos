/**
 * Report — a coach-authored arrangement of published views.
 *
 * Graduated because it has an editor (handbook §2.1), and the FIRST spatial one: document units
 * are pixels (D-04), positions live in props rather than in `rootIds`, and `rootIds` order
 * carries paint order instead of sequence.
 *
 * A report owns a layout and nothing else. Every tile points at another context's published
 * language through a D-08 reference and is resolved at render time, which is what lets this
 * context exist without being a seventh centre of the domain (ADR-0004). The practical
 * consequence: if the indicator a tile charts is deleted, that tile renders broken and the rest
 * of the report is fine, because nothing here holds a copy of anything.
 */
export * from './domain/Report'
export * from './editor/schema'
export * from './application/index'
