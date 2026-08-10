import { flagsFromEnv, type FlagsPort } from '@fitnessos/flags'

/**
 * Feature flags for this deployment, read from the process environment.
 *
 * Server-side only, and called per request rather than memoised at module load. A flag is a property
 * of the DEPLOYMENT, and the point of a kill switch is that changing it takes effect without a
 * rebuild — a value captured once at import time would survive until the process restarted, which is
 * the one moment an operator does not want to have to arrange.
 *
 * `process.env` rather than a config object because that is what a container gives you at 3 a.m.
 */
export const createFlags = (): FlagsPort => flagsFromEnv(process.env)
