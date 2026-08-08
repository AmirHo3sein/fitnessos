import type { LogSessionInput } from '@fitnessos/core/execution'
import { LogSessionBodySchema, type components } from '@fitnessos/contracts'
import type { z } from 'zod'
import { parseContract, type FieldsAgree } from './parse'

type ContractLogBody = components['schemas']['LogSessionBody']
type ValidatedLogBody = z.infer<typeof LogSessionBodySchema>

const isoFrom = (d: { year: number; month: number; day: number }): string =>
  `${String(d.year).padStart(4, '0')}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`

/**
 * Domain → wire, validated on the way out (ADR-0031).
 *
 * Validating a QUEUED mutation matters more than usual: an invalid body would be discovered on
 * replay, possibly days later, in a basement gym, as a permanent failure that quarantines the
 * athlete's session. Catching it at log time means the error is shown while they are still
 * looking at the screen that produced it.
 */
export const logSessionBodyFrom = (input: LogSessionInput): ValidatedLogBody =>
  parseContract(
    LogSessionBodySchema,
    {
      id: input.id,
      prescribedSessionId: input.prescribedSessionId,
      performedOn: isoFrom(input.performedOn),
      sets: input.sets.map((set) => ({
        id: set.id,
        prescribedItemId: set.prescribedItemId,
        setNumber: set.setNumber,
        reps: set.reps,
        // Absent, not null: the contract marks these optional rather than nullable, and JSON has
        // no undefined.
        ...(set.loadKg === null ? {} : { loadKg: set.loadKg }),
        ...(set.rpe === null ? {} : { rpe: set.rpe }),
      })),
      ...(input.note === null ? {} : { note: input.note }),
    },
    'LogSessionBody (request)',
  )

export const LOG_SESSION_COVERAGE: Record<keyof ContractLogBody, true> = {
  id: true,
  prescribedSessionId: true,
  performedOn: true,
  sets: true,
  note: true,
}

const _logFieldsAgree: FieldsAgree<ContractLogBody, ValidatedLogBody> = true
void _logFieldsAgree
