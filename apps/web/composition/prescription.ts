import type { PrescriptionPorts } from '@fitnessos/ctx-prescription'
import type { GoalPorts } from '@fitnessos/core/goal'
import {
  createPrescriptionAdapter,
  createPrescriptionWriteAdapter,
  createReferenceResolver,
} from '@fitnessos/infra'
import type { AuthContext, HttpClient } from './container'

/**
 * Prescription ports. Imported by the `(app)` route group only.
 *
 * The goal ports come in as an argument, and that is the D-08 boundary made concrete: Prescription
 * declares a `ReferenceResolver` and never learns what a goal is. Only this file — the composition
 * root — sees both contexts, which is exactly the one place allowed to.
 */
export const createPrescriptionPorts = (
  http: HttpClient,
  auth: AuthContext,
  goals: GoalPorts,
): PrescriptionPorts => ({
  references: createReferenceResolver({
    goal: goals.goal,
    // The route table is the app's business, not infra's.
    hrefFor: (_kind, id) => `/goals/${id}`,
  }),
  prescription: {
    ...createPrescriptionAdapter(http, auth),
    ...createPrescriptionWriteAdapter(http, auth),
  },
})
