export type { DashboardPorts, DashboardReadPort, DashboardWritePort, Loaded } from './ports/index'
// A value, not a type: `infra` throws it and the hook narrows with `instanceof`, so it has to survive
// to runtime.
export { DashboardConflictError } from './ports/index'
export { currentDashboardQuery, dashboardKeys, type QueryDefinition } from './queries/dashboardKeys'
