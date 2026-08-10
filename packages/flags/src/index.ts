/**
 * @fitnessos/flags — feature flags as a closed vocabulary behind a port.
 *
 * Zero dependencies, like `@fitnessos/telemetry`, and for the same reasons: it is a seam rather than
 * an integration, and nothing here should make a vendor choice on anyone's behalf.
 *
 * Flags are evaluated on the SERVER and passed down as plain booleans, the same way labels are. A
 * client that read flags itself would need the vocabulary in its bundle and would flash the wrong
 * branch before hydration.
 */
export { FLAGS, FLAG_NAMES, type FlagDefinition, type FlagName } from './vocabulary'
export { defaultFlags, fixedFlags, type FlagsPort } from './port'
export { envVarFor, flagsFromEnv } from './env'
