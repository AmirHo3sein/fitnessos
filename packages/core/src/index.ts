/**
 * @fitnessos/core — bounded contexts that have not graduated to their own package.
 *
 * A context graduates to `packages/ctx-{name}` when it acquires either an editor
 * or an owning team (handbook §2.1). Until then it lives here as a folder.
 *
 * Known weakness, recorded deliberately: `package.json` dependencies cannot
 * enforce isolation between contexts inside one package, so `no-cross-context`
 * is held here by path rules alone. That is weaker than a package boundary and
 * easier to erode. It is the main reason to graduate early rather than late.
 */

// <<< contexts >>>
export * from './athlete/index'
export * from './auth/index'
// Goal is reached through '@fitnessos/core/goal'. It is NOT re-exported here: its
// vocabulary overlaps the Athlete context's (both have an 'Invalidator'), and a flat
// re-export would silently pick one.
