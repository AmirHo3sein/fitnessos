import { uuidv7 } from 'uuidv7'

declare const brand: unique symbol

/** Nominal typing over a primitive. Two branded strings are never interchangeable. */
export type Branded<T, B extends string> = T & { readonly [brand]: B }

/**
 * ADR-0010 — the client generates every id it creates, including offline.
 * UUIDv7 is time-ordered, so it indexes well server-side and sorts naturally.
 *
 * Backend contract requirement: all POST bodies accept a client-supplied id and
 * return 409 on collision.
 */
const make = <B extends string>(): Branded<string, B> => uuidv7() as Branded<string, B>

/**
 * A UUIDv7 with no brand, for entities that are identified but not first-class aggregates —
 * a set within a session, a block within a programme version.
 *
 * Unbranded because there is nothing to confuse it with: these ids never cross a boundary on
 * their own. Still a real UUIDv7 rather than a composed string, because the contract requires
 * `format: uuid` and because time-ordering makes them sort correctly for free.
 */
export const newEntityId = (): string => uuidv7()

/** Parse an id received from the wire. Does not validate UUID shape — the contract layer does. */
const from = <B extends string>(raw: string): Branded<string, B> => raw as Branded<string, B>

// --- Identity & access -------------------------------------------------------
export type PersonId = Branded<string, 'PersonId'>
export type AthleteId = Branded<string, 'AthleteId'>
export type OrganizationId = Branded<string, 'OrganizationId'>
export type MembershipId = Branded<string, 'MembershipId'>
export type EngagementId = Branded<string, 'EngagementId'>

// --- Development -------------------------------------------------------------
export type GoalId = Branded<string, 'GoalId'>
export type IndicatorId = Branded<string, 'IndicatorId'>

// --- Measurement -------------------------------------------------------------
export type ObservationId = Branded<string, 'ObservationId'>

// --- Prescription ------------------------------------------------------------
export type ProgramId = Branded<string, 'ProgramId'>
export type ProgramVersionId = Branded<string, 'ProgramVersionId'>
export type PrescribedSessionId = Branded<string, 'PrescribedSessionId'>

// --- Execution ---------------------------------------------------------------
export type PerformedSessionId = Branded<string, 'PerformedSessionId'>

// --- Learning ----------------------------------------------------------------
export type ProposalId = Branded<string, 'ProposalId'>
export type DecisionOutcomeId = Branded<string, 'DecisionOutcomeId'>

// --- Athlete constraints -----------------------------------------------------
export type InjuryId = Branded<string, 'InjuryId'>
export type PractitionerRestrictionId = Branded<string, 'PractitionerRestrictionId'>

// --- Catalogue ---------------------------------------------------------------
export type MovementId = Branded<string, 'MovementId'>

// --- Editor engine -----------------------------------------------------------
export type NodeId = Branded<string, 'NodeId'>
export type EntryId = Branded<string, 'EntryId'>

export const newPersonId = make<'PersonId'>
export const newAthleteId = make<'AthleteId'>
export const newOrganizationId = make<'OrganizationId'>
export const newMembershipId = make<'MembershipId'>
export const newEngagementId = make<'EngagementId'>
export const newGoalId = make<'GoalId'>
export const newObservationId = make<'ObservationId'>
export const newProgramId = make<'ProgramId'>
export const newProgramVersionId = make<'ProgramVersionId'>
export const newPrescribedSessionId = make<'PrescribedSessionId'>
export const newPerformedSessionId = make<'PerformedSessionId'>
export const newProposalId = make<'ProposalId'>
export const newDecisionOutcomeId = make<'DecisionOutcomeId'>
export const newInjuryId = make<'InjuryId'>
export const newPractitionerRestrictionId = make<'PractitionerRestrictionId'>
export const newNodeId = make<'NodeId'>
export const newEntryId = make<'EntryId'>

export const idFrom = from
