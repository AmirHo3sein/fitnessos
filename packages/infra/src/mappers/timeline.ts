import type { Phase, PlanSnapshot } from '@fitnessos/ctx-timeline'
import { PlanSchema, type components } from '@fitnessos/contracts'
import { idFrom, type PlainDate } from '@fitnessos/kernel'
import type { z } from 'zod'
import { parseContract, type FieldsAgree } from './parse'

/**
 * Plan mappers.
 *
 * The date arithmetic never goes through `Date`. A plain date parsed by `Date` becomes UTC
 * midnight and renders as the previous day west of Greenwich — and here that would shift the
 * epoch, which every phase offset is relative to, so a whole plan would move by a day for some
 * athletes and not others.
 */
type ContractPlan = components['schemas']['Plan']
type ValidatedPlan = z.infer<typeof PlanSchema>

const plainDateFrom = (iso: string): PlainDate => {
  const [year, month, day] = iso.split('-').map(Number)
  return { year: year ?? 0, month: month ?? 1, day: day ?? 1 }
}

const isoFrom = (d: PlainDate): string =>
  `${String(d.year).padStart(4, '0')}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`

export const planFrom = (raw: unknown): PlanSnapshot => {
  const c = parseContract(PlanSchema, raw, 'Plan')
  return {
    id: c.id,
    title: c.title,
    epoch: plainDateFrom(c.epoch),
    // Sorted here as well as in the aggregate: the contract does not promise an order, and a plan
    // rendered in arrival order reads out of sequence.
    phases: [...c.phases]
      .sort((a, b) => a.start - b.start)
      .map(
        (p): Phase => ({
          id: p.id,
          label: p.label,
          start: p.start,
          length: p.length,
          programId: p.programId ?? null,
          servesGoal: p.servesGoal === undefined ? null : idFrom<'GoalId'>(p.servesGoal),
        }),
      ),
  }
}

export const planBodyFrom = (plan: PlanSnapshot): ValidatedPlan => {
  const body = {
    id: plan.id,
    title: plan.title,
    epoch: isoFrom(plan.epoch),
    phases: plan.phases.map((p) => ({
      id: p.id,
      label: p.label,
      start: p.start,
      length: p.length,
      // Absent, not null: both are `format: uuid`, so a literal null would be refused for a field
      // the coach simply left unset.
      ...(p.programId === null ? {} : { programId: p.programId }),
      ...(p.servesGoal === null ? {} : { servesGoal: p.servesGoal }),
    })),
  }
  return parseContract(PlanSchema, body, 'Plan (request)')
}

export const PLAN_COVERAGE: Record<keyof ContractPlan, true> = {
  id: true,
  title: true,
  epoch: true,
  phases: true,
}

const _agrees: FieldsAgree<ContractPlan, ValidatedPlan> = true
void _agrees
