'use client'

import { createDiContext } from '@fitnessos/ui'
import type { GoalPorts } from '../application/ports/index'

/** Mounted by the `(app)` route group. `'use client'` is required — see the Athlete note. */
const { Provider, useDi } = createDiContext<GoalPorts>('Goal')

export { Provider as GoalPortsProvider, useDi as useGoalPorts }
