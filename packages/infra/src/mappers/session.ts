import type { PrescribedSessionSnapshot } from '@fitnessos/core/execution'
import { PrescribedSessionSchema, type components } from '@fitnessos/contracts'
import { idFrom, type PlainDate } from '@fitnessos/kernel'
import type { z } from 'zod'
import { parseContract, type FieldsAgree } from './parse'

type ContractSession = components['schemas']['PrescribedSession']
type ValidatedSession = z.infer<typeof PrescribedSessionSchema>

/** `YYYY-MM-DD` → PlainDate, never through `Date`. See the note in `goal.ts`. */
const plainDateFrom = (iso: string): PlainDate => {
  const [year, month, day] = iso.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`malformed ISO date from the contract: ${iso}`)
  }
  return { year, month, day }
}

export const sessionFrom = (raw: unknown): PrescribedSessionSnapshot => {
  const c = parseContract(PrescribedSessionSchema, raw, 'PrescribedSession')
  return {
    id: idFrom<'PrescribedSessionId'>(c.id),
    programVersionId: idFrom<'ProgramVersionId'>(c.programVersionId),
    scheduledFor: plainDateFrom(c.scheduledFor),
    items: [...c.items]
      .sort((a, b) => a.order - b.order)
      .map((item) => ({
        id: item.id,
        movementName: item.movementName,
        order: item.order,
        sets: item.sets,
        reps: item.reps,
        // Absent means bodyweight. Normalised to null so nothing downstream has to know
        // whether the wire omitted the key or sent null — they render, compare and serialise
        // differently.
        loadKg: item.loadKg ?? null,
      })),
    screening: {
      level: c.screening.level,
      basis: c.screening.basis ?? null,
      // Carried, not inferred from `basis === null`. Inferring would collapse "no reason" and
      // "you may not see the reason" (ADR-0002/0014), which are different statements to an
      // athlete asking why their session was capped.
      basisWithheld: c.screening.basisWithheld,
    },
  }
}

export const sessionsFrom = (raw: unknown): readonly PrescribedSessionSnapshot[] => {
  if (!Array.isArray(raw)) throw new Error('PrescribedSession list response was not an array')
  return raw.map((item) => sessionFrom(item))
}

export const SESSION_COVERAGE: Record<keyof ContractSession, true> = {
  id: true,
  programVersionId: true,
  scheduledFor: true,
  items: true,
  screening: true,
}

const _sessionFieldsAgree: FieldsAgree<ContractSession, ValidatedSession> = true
void _sessionFieldsAgree
