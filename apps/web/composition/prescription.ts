import type { PrescriptionPorts } from '@fitnessos/ctx-prescription'
import { createPrescriptionAdapter, createPrescriptionWriteAdapter } from '@fitnessos/infra'
import type { AuthContext, HttpClient } from './container'

/** Prescription ports. Imported by the `(app)` route group only. */
export const createPrescriptionPorts = (
  http: HttpClient,
  auth: AuthContext,
): PrescriptionPorts => ({
  prescription: {
    ...createPrescriptionAdapter(http, auth),
    ...createPrescriptionWriteAdapter(http, auth),
  },
})
