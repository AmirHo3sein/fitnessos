/**
 * @fitnessos/kernel — the shared kernel.
 *
 * Contains only value objects that are genuinely cross-cutting: identity,
 * measurement, time, money, locale, and the Result error model.
 *
 * Deliberately absent, and must stay absent:
 *   - any aggregate
 *   - any repository or port interface
 *   - any business rule
 *   - any enumeration owned by a single bounded context
 *   - React, Next, or any framework
 *
 * A shared Person or Athlete type here would recreate V1's `users` god-entity.
 * Each context models its own participant and references the id.
 */

export * from './ids/index'
export * from './result/index'
export * from './quantity/index'
export * from './temporal/index'
export * from './money/index'
export * from './locale/index'
