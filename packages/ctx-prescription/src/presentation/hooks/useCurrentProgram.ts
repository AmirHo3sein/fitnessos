'use client'

import { useSubject } from '@fitnessos/ui'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { currentProgramQuery, type ProgramSnapshot } from '../../application/index'
import { usePrescriptionPorts } from '../di'

/**
 * The athlete's current programme, or `null` when they have none.
 *
 * `null` is data, not absence — so `isPending` genuinely means "still loading" and a
 * newly-onboarded athlete with no programme gets a deliberate empty state rather than a
 * spinner that never resolves.
 */
export const useCurrentProgram = (): UseQueryResult<ProgramSnapshot | null> =>
  useQuery(currentProgramQuery(usePrescriptionPorts(), useSubject()))
