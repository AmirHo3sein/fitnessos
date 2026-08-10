import type { PlanSnapshot } from '../../editor/schema'

/** Timeline — ports. One read, one write: a plan owns its phases and there is nothing to query. */
export interface TimelineReadPort {
  readonly current: (signal?: AbortSignal) => Promise<PlanSnapshot | null>
}

export interface TimelineWritePort {
  /** A replace: nothing references a phase. Same reasoning as the form, report and dashboard. */
  readonly save: (plan: PlanSnapshot, signal?: AbortSignal) => Promise<PlanSnapshot>
}

export interface TimelinePorts {
  readonly timeline: TimelineReadPort & TimelineWritePort
}
