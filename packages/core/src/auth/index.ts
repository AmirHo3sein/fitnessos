/**
 * Auth — the identity boundary.
 *
 * Un-graduated: a folder in `packages/core` because it has no editor and no owning
 * team (handbook §2.1).
 *
 * Presentation is NOT re-exported here; it is reached through the package's
 * `./presentation` subpath. Re-exporting it would pull React into the graph of every
 * framework-free consumer of `@fitnessos/core`, transitively.
 */
export * from './domain/PhoneNumber'
export * from './application/index'
