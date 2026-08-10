import type { LogSessionInput } from '@fitnessos/core/execution'
import type { PlainDate } from '@fitnessos/kernel'
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

/**
 * A stored payload or a server record, reduced to what an athlete needs to compare.
 *
 * **Tolerant to the point of never throwing, and that is deliberate.** The input is either a
 * mutation queued by an older build or a body the server sent with a 409; both may be shapes this
 * build does not fully understand. Throwing here would hide the whole issue banner behind one
 * unreadable record — turning "your log did not save" into silence, which is the failure the
 * banner exists to prevent.
 *
 * `null` means "could not be read", which the UI renders as an issue with no detail rather than
 * as no issue.
 */
export const loggedShapeFrom = (
  raw: unknown,
): { readonly performedOn: PlainDate | null; readonly setCount: number } | null => {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as { performedOn?: unknown; sets?: unknown }

  return {
    performedOn: typeof record.performedOn === 'string' ? plainDateFrom(record.performedOn) : null,
    setCount: Array.isArray(record.sets) ? record.sets.length : 0,
  }
}

/**
 * ISO date → PlainDate, WITHOUT going through `Date`.
 *
 * `new Date("2026-08-08")` parses as UTC midnight, so in a negative-offset zone it renders as the
 * 7th — a session performed on Monday shown as Sunday, for some athletes and not others.
 */
const plainDateFrom = (iso: string): PlainDate | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (match === null) return null
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  }
}
