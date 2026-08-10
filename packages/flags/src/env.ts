import { FLAGS, type FlagName } from './vocabulary'
import type { FlagsPort } from './port'

/**
 * Flags from the environment, evaluated on the SERVER.
 *
 * `FLAG_LIVE_INVALIDATION=off` — the name upper-snake-cased with a `FLAG_` prefix. Deliberately not
 * `NEXT_PUBLIC_`: a public env var is inlined into the client bundle at build time, which would make
 * a flag a property of the BUILD rather than of the deployment. The point of a kill switch is that it
 * can be thrown without one.
 *
 * ## What counts as off
 *
 * Only an explicit `off`, `false` or `0` (any case). Anything else — including an empty string, a
 * typo, or a value someone meant as a comment — leaves the flag at its declared fallback.
 *
 * That asymmetry is deliberate and it is the opposite of the usual `Boolean(value)` reflex. A
 * misspelled value must not silently disable a shipped feature; and for a flag that defaults off,
 * a misspelled value must not silently enable an unfinished one. Unrecognised means "nobody has
 * decided", and the declared fallback is what somebody already decided.
 */
const OFF = new Set(['off', 'false', '0'])
const ON = new Set(['on', 'true', '1'])

export const envVarFor = (name: FlagName): string =>
  `FLAG_${name.toUpperCase().replace(/-/g, '_')}`

export const flagsFromEnv = (env: Record<string, string | undefined>): FlagsPort => ({
  isEnabled: (name) => {
    const raw = env[envVarFor(name)]
    if (raw === undefined) return FLAGS[name].fallback
    const value = raw.trim().toLowerCase()
    if (OFF.has(value)) return false
    if (ON.has(value)) return true
    return FLAGS[name].fallback
  },
})
