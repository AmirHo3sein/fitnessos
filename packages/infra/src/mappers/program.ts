import type { ProgramSnapshot } from '@fitnessos/core/prescription'
import { ProgramSchema, type components } from '@fitnessos/contracts'
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
