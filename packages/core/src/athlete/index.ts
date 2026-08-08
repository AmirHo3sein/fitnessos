/**
 * Athlete — the ownership centre of the Center Map.
 *
 * Un-graduated: lives as a folder in `packages/core` because it has no editor and
 * no owning team yet (handbook §2.1). Graduation to `packages/ctx-athlete` moves
 * these files and changes nothing about their contents.
 *
 * Presentation is NOT re-exported here. Doing so would pull React into the
 * dependency graph of every framework-free consumer of `@fitnessos/core`,
 * transitively, and `no-react-in-logic` would then fire on code that never
 * mentioned React. It is reached through the `./presentation` subpath export.
 */
export * from './application/index'
