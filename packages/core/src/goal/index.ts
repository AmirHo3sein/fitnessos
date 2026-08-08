/**
 * Goal — the psychological centre of the domain (ADR-0004).
 *
 * Un-graduated: a folder in `packages/core` because it has no editor and no owning team
 * (handbook §2.1).
 *
 * Two ADRs shape everything here, and both are tempting to break:
 *   ADR-0018  a Goal may never reference a Program, PerformedSession, Observation or
 *             Proposal. The link runs the other way — ProgramVersion carries ServesGoal.
 *   ADR-0006  staleness, horizon expiry and closure are DERIVED, not stored. There is no
 *             status field, and there are tests asserting it stays absent.
 */
export * from './domain/GoalIntent'
export * from './domain/EvaluationPolicy'
export * from './domain/Goal'
export * from './application/index'
