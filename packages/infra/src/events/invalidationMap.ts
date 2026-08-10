/**
 * Which query keys an event invalidates — handbook §3.2's rule, as data.
 *
 * The map is here and not in a component for the reason the handbook gives about query keys
 * generally: invalidation bugs are the least diagnosable class of bug in a TanStack Query app,
 * because the symptom is stale data on a screen far from the mutation that caused it. As a table
 * it can be read, reviewed and tested; as a `queryClient.invalidateQueries` call inside an event
 * handler it can only be found by grep.
 *
 * ## Keys are strings here, not the key factories
 *
 * Each context owns its own key factory and `infra` must not import from a context — the dependency
 * runs the other way. So the map holds the FIRST SEGMENT of each key, which is the segment those
 * factories all derive from (`['programme', …]`, `['sync-issues']`), and invalidation is by prefix.
 *
 * That is a real coupling and it is worth naming: this table and those factories agree by
 * convention, not by type. The test asserts the segments exist, which is the cheapest thing that
 * fails when a factory is renamed.
 */

/** An event kind, and the key prefixes it makes stale. */
export const INVALIDATIONS: Readonly<Record<string, readonly string[]>> = {
  /*
   * A coach published a new programme version. Both the programme itself and the athlete's upcoming
   * sessions derive from it — the sessions list is the one that matters, because an athlete looking
   * at today's session while their coach changes it is the case this whole mechanism exists for.
   */
  'programme-revised': ['programme', 'sessions'],

  /* A session was logged elsewhere (another device, or the offline queue draining). */
  'session-logged': ['sessions', 'indicators'],

  /* A measurement arrived, so every derived indicator may have moved. */
  'observation-recorded': ['indicators'],

  /* Learning produced something to judge. */
  'proposal-raised': ['proposals'],

  /*
   * A sync issue was recorded by a background drain. The record is already durable — this only
   * shortens the wait before the athlete sees it, which is why it is the least urgent entry here and
   * the only one that would be harmless to drop.
   */
  'sync-issue-recorded': ['sync-issues'],
}

export const keysFor = (kind: string): readonly string[] => INVALIDATIONS[kind] ?? []

/**
 * Whether an event kind is one we act on.
 *
 * An unknown kind is IGNORED rather than treated as "invalidate everything". A newer server will
 * publish kinds this client has never heard of, and the safe-looking choice — refetch the world —
 * turns every unrecognised event into a thundering herd from every open tab.
 */
export const isKnownKind = (kind: string): boolean => kind in INVALIDATIONS
