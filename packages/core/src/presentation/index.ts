/**
 * `@fitnessos/core/presentation` — the React-aware surface of every un-graduated
 * context in this package.
 *
 * A separate entry point from the main barrel on purpose: re-exporting these from
 * `src/index.ts` would pull React into the dependency graph of every
 * framework-free consumer of `@fitnessos/core`, transitively, and
 * `no-react-in-logic` would fire on code that never mentioned React.
 *
 * When a context graduates to `packages/ctx-{name}`, its line leaves this file
 * and the import in `apps/web` changes package name. Nothing else moves.
 */

export * from '../athlete/presentation/index'
