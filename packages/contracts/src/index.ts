/**
 * @fitnessos/contracts — generated from spec/openapi.json. Do not hand-edit.
 *
 * ADR-0026: the specification is the contract and is authored before the handler.
 * Regenerate with `pnpm --filter @fitnessos/contracts contracts:generate`;
 * CI fails on any diff.
 *
 * ADR-0011 / handbook §5: nothing outside `infra/mappers` may import this package.
 * Enforced by `no-contracts-escape`. If a contract type reaches presentation, a
 * backend field rename becomes a UI change — which is the whole failure mode the
 * mapper layer exists to prevent.
 *
 * Note the shape of what's exported: `components['schemas'][...]`, not tidy
 * aliases. That is deliberate. Contract types are meant to be awkward to hold, so
 * that mapping to an application type is the path of least resistance.
 */

export type { components, paths, operations } from './api.gen'

/**
 * Runtime validators for the same schemas (ADR-0031), generated from the same spec
 * file as the types above — so the two cannot come to describe different shapes.
 *
 * These exist because a compile-time type is a *claim* about a response, not a check
 * on it. `(await response.json()) as Athlete` stops being true the moment the
 * backend disagrees, and the resulting `undefined` surfaces as a blank cell three
 * layers away from the cause, or as a TypeError inside a mapper.
 */
export * from './schemas.gen'
