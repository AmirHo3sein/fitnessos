'use client'

import { useSubject } from '@fitnessos/ui'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { upcomingSessionsQuery, type PrescribedSessionSnapshot } from '../../application/index'
import { useExecutionPorts } from '../di'

export const useUpcomingSessions = (): UseQueryResult<readonly PrescribedSessionSnapshot[]> =>
  useQuery(upcomingSessionsQuery(useExecutionPorts(), useSubject()))
