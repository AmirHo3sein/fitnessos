/**
 * Dashboard — the screen an athlete opens, arranged on a grid.
 *
 * The fourth editor on `editor-engine` and its third topology: row index for a programme and a
 * form, pixels for a report, CELLS here. The engine needed one additive module for it
 * (`geometry/grid`) and no change to anything existing — the document is the same flat record of
 * nodes, and what the numbers in `props` mean stays the builder's business.
 *
 * ## Why this is not the Report Builder with different units
 *
 * A report is read like a document — printed, reviewed, sent. A dashboard is lived in, and must
 * reflow at a phone's width without a coach re-authoring it, which free pixel positioning cannot
 * do. That single requirement produces every difference: integer coordinates, a column count on
 * the document, and the rule that widgets may not overlap. Overlapping is a layout choice on a
 * canvas and a rendering error on a grid.
 */
export * from './domain/Dashboard'
export * from './editor/schema'
