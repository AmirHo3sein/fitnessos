import type { MeasurementPorts } from '@fitnessos/ctx-measurement'
import { createMeasurementAdapter } from '@fitnessos/infra'
import type { AuthContext, HttpClient } from './container'

/** Measurement ports. Imported by the `(app)` route group only. */
export const createMeasurementPorts = (
  http: HttpClient,
  auth: AuthContext,
): MeasurementPorts => ({
  measurement: createMeasurementAdapter(http, auth),
})
