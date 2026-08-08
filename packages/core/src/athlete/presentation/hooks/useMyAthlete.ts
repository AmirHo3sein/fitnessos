'use client'

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { myAthleteQuery, type AthleteSnapshot } from '../../application/index'
import { useAthletePorts } from '../di'

/**
 * The authenticated person's athlete.
 *
 * Under the 40-line cap (D-05) with room to spare, and it should stay that way:
 * a hook that grows past it is hiding a use case that belongs in the application
 * layer, where it can be tested without a renderer.
 *
 * The query *definition* comes from the application layer, so this hook and the
 * server-side prefetch in `apps/web` pass the identical object to TanStack Query.
 * That is what makes the prefetch reliable — the key and the fetcher cannot drift
 * apart, because there is only one of each.
 */
export const useMyAthlete = (): UseQueryResult<AthleteSnapshot> =>
  useQuery(myAthleteQuery(useAthletePorts()))
