import type { DashboardSnapshot } from '../../editor/schema'

/** Dashboard — ports. One read, one write; a dashboard owns a layout and nothing to query. */
export interface DashboardReadPort {
  readonly current: (signal?: AbortSignal) => Promise<DashboardSnapshot | null>
}

export interface DashboardWritePort {
  /** A replace, not a revision: nothing references a widget. Same reasoning as a report. */
  readonly save: (
    dashboard: DashboardSnapshot,
    signal?: AbortSignal,
  ) => Promise<DashboardSnapshot>
}

export interface DashboardPorts {
  readonly dashboard: DashboardReadPort & DashboardWritePort
}
