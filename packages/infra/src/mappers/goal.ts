import type { GoalSnapshot } from '@fitnessos/core/goal'
import { DeclareGoalBodySchema, GoalSchema, type components } from '@fitnessos/contracts'
import { idFrom, type PlainDate } from '@fitnessos/kernel'
import type { z } from 'zod'
import { parseContract, type FieldsAgree } from './parse'

/**
 * Goal mappers.
 *
 * The interesting part is the date handling. The contract carries ISO `date` strings —
 * `"2026-08-08"`, no time, no zone — and the application carries `PlainDate`. Those are
 * the same *kind* of thing, which is exactly why the conversion has to be explicit and
 * exactly where it goes wrong.
 *
 * `new Date("2026-08-08")` parses as UTC midnight, so in Tehran (+03:30) it is already
 * the 8th, but in any negative-offset zone it renders as the 7th. A goal declared on the
 * 8th would display as declared the day before, and a horizon would silently shift by a
 * day for some users and not others. So the string is decomposed arithmetically and
 * never passed through `Date` at all.
 */

type ContractGoal = components['schemas']['Goal']
type ContractDeclareBody = components['schemas']['DeclareGoalBody']
type ValidatedGoal = z.infer<typeof GoalSchema>
type ValidatedDeclareBody = z.infer<typeof DeclareGoalBodySchema>

/** `YYYY-MM-DD` → PlainDate, with no `Date` anywhere near it. */
const plainDateFrom = (iso: string): PlainDate => {
  const [year, month, day] = iso.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) {
    // Unreachable via the validator, which enforces `format: date`. Kept because a
    // silent NaN here would produce a date that renders as "NaN" months from now.
    throw new Error(`malformed ISO date from the contract: ${iso}`)
  }
  return { year, month, day }
}

const isoFrom = (date: PlainDate): string =>
  `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`

export const goalFrom = (raw: unknown): GoalSnapshot => {
  const c = parseContract(GoalSchema, raw, 'Goal')
  return {
    id: idFrom<'GoalId'>(c.id),
    athleteId: idFrom<'AthleteId'>(c.athleteId),
    // Verbatim. The athlete's phrasing is the point (ADR-0004); normalising it here
    // would discard what the goal actually says.
    intent: c.intent,
    declaredOn: plainDateFrom(c.declaredOn),
    horizon: c.horizon === undefined ? null : plainDateFrom(c.horizon),
    cadenceDays: c.cadenceDays,
  }
}

export const goalsFrom = (raw: unknown): readonly GoalSnapshot[] => {
  if (!Array.isArray(raw)) {
    throw new Error('Goal list response was not an array')
  }
  // Each element validated individually, so a violation names the index and field rather
  // than failing the whole list with one opaque message.
  return raw.map((item) => goalFrom(item))
}

export interface DeclareGoalRequest {
  readonly intent: string
  readonly horizon: PlainDate | null
  readonly cadenceDays: number
}

export const declareGoalBodyFrom = (input: DeclareGoalRequest): ValidatedDeclareBody =>
  parseContract(
    DeclareGoalBodySchema,
    {
      intent: input.intent,
      // Absent key, not null: the contract marks horizon optional rather than nullable,
      // and JSON has no undefined.
      ...(input.horizon === null ? {} : { horizon: isoFrom(input.horizon) }),
      cadenceDays: input.cadenceDays,
    },
    'DeclareGoalBody (request)',
  )

export const GOAL_COVERAGE: Record<keyof ContractGoal, true> = {
  id: true,
  athleteId: true,
  intent: true,
  declaredOn: true,
  horizon: true,
  cadenceDays: true,
}

export const DECLARE_GOAL_BODY_COVERAGE: Record<keyof ContractDeclareBody, true> = {
  intent: true,
  horizon: true,
  cadenceDays: true,
}

const _goalFieldsAgree: FieldsAgree<ContractGoal, ValidatedGoal> = true
const _declareFieldsAgree: FieldsAgree<ContractDeclareBody, ValidatedDeclareBody> = true
void _goalFieldsAgree
void _declareFieldsAgree
