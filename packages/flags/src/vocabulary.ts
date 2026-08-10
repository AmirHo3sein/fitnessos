/**
 * Every feature flag this application has, as a CLOSED vocabulary.
 *
 * The same shape as the telemetry event vocabulary (ADR-0032) and for the same reason: an open
 * `isEnabled(string)` cannot be reviewed. A typo produces a flag that is silently off forever, which
 * for a kill switch means the switch does nothing at the moment it is needed — and nothing anywhere
 * reports that the name was never recognised.
 *
 * A union type makes the typo a compile error, and makes this file the list somebody can read before
 * a release.
 *
 * ## Every flag is a temporary thing with an owner and an exit
 *
 * A flag that nobody plans to remove is a permanent branch in the product, and two branches means
 * half the paths are exercised half as often. So each entry records WHY it exists and what has to be
 * true before it goes. A flag with no removal condition should not be added.
 */

export type FlagName = 'live-invalidation'

export interface FlagDefinition {
  /** What turning it OFF does. Written from the operator's side, because that is who reads this. */
  readonly disables: string
  /** What has to be true before this flag is deleted. */
  readonly removeWhen: string
  /**
   * The value when nothing says otherwise.
   *
   * A kill switch defaults to ON — the feature ships, and the flag exists to withdraw it. A flag
   * guarding something unfinished defaults to OFF. Both kinds are honest; what is not honest is a
   * default nobody chose.
   */
  readonly fallback: boolean
}

export const FLAGS: Readonly<Record<FlagName, FlagDefinition>> = {
  /*
   * The SSE event stream and everything it invalidates.
   *
   * A kill switch, not a rollout gate: live invalidation is finished and tested, and it is also the
   * newest subsystem, the only one holding a long-lived connection, and the one whose correctness
   * depends on four server behaviours that fail SILENTLY if the backend gets them wrong
   * (BACKEND-CONTRACT §5). If a deployment produces a storm of reconnects or an event flood, the
   * useful response at 3 a.m. is to stop opening streams — not to ship a build.
   *
   * Turning it off degrades to exactly the behaviour before it existed: data refreshes when a screen
   * mounts or a mutation completes. Nothing breaks; updates stop being live.
   */
  'live-invalidation': {
    disables: 'the event stream — screens then refresh on mount and after a save, as before',
    removeWhen:
      'the stream has run in production for a full release cycle without an operator needing to disable it',
    fallback: true,
  },
}

export const FLAG_NAMES: readonly FlagName[] = Object.keys(FLAGS) as FlagName[]
