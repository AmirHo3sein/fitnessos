/**
 * Timeline — a periodisation laid out on time.
 *
 * The fifth editor on `editor-engine`, and the one that owns its own topology: D-12 keeps
 * `topology/temporal` out of the engine, for the same reason it deleted `topology/graph`. Grid
 * collision belongs in the engine because "two things cannot share a cell" is true of any grid.
 * Nothing in `topology/temporal` is like that — snapping to Monday, refusing a phase shorter than
 * a week, and treating overlap as unanswerable rather than ugly are facts about how training is
 * organised, and an engine that knew them would be an engine with opinions about periodisation.
 *
 * ## A recorded deviation
 *
 * D-04 gives Timeline milliseconds. This uses whole DAYS, and the reasoning is in
 * `topology/temporal.ts`: milliseconds are right for a timeline of events, where two things can
 * happen within a second of each other. A training plan's smallest meaningful unit is a day and
 * its natural unit is a week, so milliseconds would carry nine digits of precision the domain
 * cannot use and force the arithmetic through `Date` — which shifts a plain date by a day west of
 * Greenwich, a bug this codebase has already fixed four times.
 */
export * from './topology/temporal'
export * from './domain/Plan'
export * from './editor/schema'
