import type { ProgramSnapshot, ReviseProgramInput } from '@fitnessos/ctx-prescription'
import { ProgramSchema, ReviseProgramBodySchema, type components } from '@fitnessos/contracts'
import { idFrom } from '@fitnessos/kernel'
import type { z } from 'zod'
import { parseContract, type FieldsAgree } from './parse'

/**
 * Program mappers.
 *
 * The one thing worth noting: `ratePercent` becomes `null` when absent rather than being
 * dropped. The application type declares it `number | null`, so an absent key would leave
 * `undefined` there — and `undefined` and `null` render differently, compare differently, and
 * serialise differently. Normalising at the boundary means nothing downstream has to know
 * which the wire used.
 */

type ContractProgram = components['schemas']['Program']
type ValidatedProgram = z.infer<typeof ProgramSchema>
type ContractReviseBody = components['schemas']['ReviseProgramBody']
type ValidatedReviseBody = z.infer<typeof ReviseProgramBodySchema>

export const programFrom = (raw: unknown): ProgramSnapshot => {
  const c = parseContract(ProgramSchema, raw, 'Program')
  const v = c.currentVersion

  return {
    id: idFrom<'ProgramId'>(c.id),
    athleteId: idFrom<'AthleteId'>(c.athleteId),
    title: c.title,
    currentVersion: {
      id: idFrom<'ProgramVersionId'>(v.id),
      programId: idFrom<'ProgramId'>(v.programId),
      versionNumber: v.versionNumber,
      // Sorted here as well as in the aggregate. The contract does not promise an order, and
      // a read path that renders whatever order arrived would show two clients different
      // programmes for the same data.
      blocks: [...v.blocks]
        .sort((a, b) => a.order - b.order)
        .map((block) => ({
          id: block.id,
          name: block.name,
          order: block.order,
          progression: {
            kind: block.progressionIntent.kind,
            ratePercent: block.progressionIntent.ratePercent ?? null,
          },
        })),
      servesGoal:
        v.servesGoal === undefined
          ? null
          : {
              goalId: idFrom<'GoalId'>(v.servesGoal.goalId),
              rationale: v.servesGoal.rationale ?? null,
            },
      authoredBy: {
        decidedBy: v.authoringDecision.decidedBy,
        proposedBy: v.authoringDecision.proposedBy,
      },
    },
  }
}

export const PROGRAM_COVERAGE: Record<keyof ContractProgram, true> = {
  id: true,
  athleteId: true,
  title: true,
  currentVersion: true,
}

const _programFieldsAgree: FieldsAgree<ContractProgram, ValidatedProgram> = true
void _programFieldsAgree

/**
 * The outbound half. Validated on the way out, not only on the way in.
 *
 * Three shape differences from the application type, all of them the same kind of thing —
 * `null` is the application's way of saying "absent", and the contract's is an absent key:
 *
 *   `ratePercent: null`  dropped, because the contract constrains it to `> 0` and a literal
 *                        `null` would fail validation on every fixed block.
 *   `servesGoal: null`   dropped for the same reason: the field is optional, not nullable.
 *   `rationale: null`    dropped.
 *
 * Sending `null` for any of them is the bug this function exists to make impossible, and the
 * `parseContract` call at the end is what catches it if the mapping ever drifts.
 */
export const reviseProgramBodyFrom = (input: ReviseProgramInput): ValidatedReviseBody => {
  const body = {
    id: input.id,
    baseVersionId: input.baseVersionId,
    blocks: input.blocks.map((block) => ({
      id: block.id,
      name: block.name,
      order: block.order,
      progressionIntent: {
        kind: block.progression.kind,
        ...(block.progression.ratePercent === null
          ? {}
          : { ratePercent: block.progression.ratePercent }),
      },
    })),
    ...(input.servesGoal === null
      ? {}
      : {
          servesGoal: {
            goalId: input.servesGoal.goalId,
            ...(input.servesGoal.rationale === null
              ? {}
              : { rationale: input.servesGoal.rationale }),
          },
        }),
    authoringDecision: {
      decidedBy: input.authoredBy.decidedBy,
      proposedBy: input.authoredBy.proposedBy,
    },
  }

  return parseContract(ReviseProgramBodySchema, body, 'ReviseProgramBody (request)')
}

export const REVISE_BODY_COVERAGE: Record<keyof ContractReviseBody, true> = {
  id: true,
  baseVersionId: true,
  blocks: true,
  servesGoal: true,
  authoringDecision: true,
}

const _reviseFieldsAgree: FieldsAgree<ContractReviseBody, ValidatedReviseBody> = true
void _reviseFieldsAgree
