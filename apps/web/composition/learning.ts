import type { LearningPorts } from '@fitnessos/core/learning'
import { createLearningAdapter } from '@fitnessos/infra'
import type { AuthContext, HttpClient } from './container'

/** Learning ports. Imported by the `(app)` route group only. */
export const createLearningPorts = (http: HttpClient, auth: AuthContext): LearningPorts => ({
  learning: createLearningAdapter(http, auth),
})
