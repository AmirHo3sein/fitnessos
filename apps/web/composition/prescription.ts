import type { PrescriptionPorts } from '@fitnessos/core/prescription'
import { createPrescriptionAdapter } from '@fitnessos/infra'
import type { AuthContext, HttpClient } from './container'

/** Prescription ports. Imported by the `(app)` route group only. */
export const createPrescriptionPorts = (
  http: HttpClient,
  auth: AuthContext,
): PrescriptionPorts => ({
  prescription: createPrescriptionAdapter(http, auth),
})
