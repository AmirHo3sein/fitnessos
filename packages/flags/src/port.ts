import { FLAGS, type FlagName } from './vocabulary'

/**
 * The seam. Consumers ask this and nothing else, so the source of truth can change without touching
 * a single call site — the same stance ADR-0032 takes for telemetry.
 */
export interface FlagsPort {
  readonly isEnabled: (name: FlagName) => boolean
}

/** Every flag at its declared fallback. What a test uses, and what the server falls back to. */
export const defaultFlags: FlagsPort = {
  isEnabled: (name) => FLAGS[name].fallback,
}

/**
 * A fixed set, for tests and for a story where an operator has decided.
 *
 * Takes a PARTIAL record: an unspecified flag keeps its declared fallback rather than becoming
 * `undefined` and therefore falsy. A test that meant to override one flag must not silently disable
 * every other one.
 */
export const fixedFlags = (overrides: Partial<Record<FlagName, boolean>>): FlagsPort => ({
  isEnabled: (name) => overrides[name] ?? FLAGS[name].fallback,
})
