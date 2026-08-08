/**
 * Prescription — programme authoring and structure.
 *
 * ADR-0008: `Program` (lineage, mutable) and `ProgramVersion` (structure, immutable) are
 * separate aggregates. A structure that has been followed cannot be edited without making
 * every `PerformedSession` against it unreadable, so `revise()` produces a new version.
 *
 * ADR-0013: progression is a domain SERVICE, not aggregate behaviour. A `Block` holds a
 * `ProgressionIntent`; resolving it consumes published derived indicators from Measurement
 * and stamps the resolved dose on an immutable `PrescribedSession`.
 *
 * This context has GRADUATED to its own package (handbook §2.1) because it acquired an editor.
 * The Program Builder lives in `presentation/`, built on `@fitnessos/editor-engine` and its React
 * bindings; the hydrate/commit pair and its D-09 round-trip tests live in `editor/`.
 */
export * from './domain/ProgressionIntent'
export * from './domain/ServesGoal'
export * from './domain/ProgramVersion'
export * from './application/index'

export * from './editor/schema'
