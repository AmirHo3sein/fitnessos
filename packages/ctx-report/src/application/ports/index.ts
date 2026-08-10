import type { ReportSnapshot } from '../../editor/schema'

/**
 * Report — ports.
 *
 * One read, one write, and no query beyond "the current one". A report owns a layout; there is
 * nothing here to filter, aggregate or derive, and a richer port would be inventing a use case
 * the product does not have.
 */
export interface ReportReadPort {
  /** The current report, or null when a coach has not made one. */
  readonly current: (signal?: AbortSignal) => Promise<ReportSnapshot | null>
}

export interface ReportWritePort {
  /**
   * Create or replace it.
   *
   * A replace, not a revision: nothing references a tile, so replacing a report cannot make
   * anything else unreadable. That is why this needs no client-generated id and no conflict
   * handling — the same reasoning as a check-in form, and the opposite of a programme version.
   */
  readonly save: (report: ReportSnapshot, signal?: AbortSignal) => Promise<ReportSnapshot>
}

export interface ReportPorts {
  readonly report: ReportReadPort & ReportWritePort
}
