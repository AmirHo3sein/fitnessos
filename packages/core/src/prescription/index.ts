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
 * NOT here yet, deliberately: the Program Builder editor. It needs `packages/editor-engine`
 * (handbook D-01 to D-04, D-11) — inverse-action history, a spatial index, branded
 * coordinate spaces — which is a phase of work, not a file. Half of it would be worse than
 * none: an editor that can open a programme and cannot reliably undo is a way to lose a
 * coach's work.
 */
export * from './domain/ProgressionIntent'
export * from './domain/ServesGoal'
export * from './domain/ProgramVersion'
export * from './application/index'
