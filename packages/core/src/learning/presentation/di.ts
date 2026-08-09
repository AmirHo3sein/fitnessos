'use client'

import { createDiContext } from '@fitnessos/ui'
import type { LearningPorts } from '../application/ports/index'

const { Provider, useDi } = createDiContext<LearningPorts>('Learning')

export { Provider as LearningPortsProvider, useDi as useLearningPorts }
