'use client'

import { createDiContext } from '@fitnessos/ui'
import type { ExecutionPorts } from '../application/ports/index'

const { Provider, useDi } = createDiContext<ExecutionPorts>('Execution')

export { Provider as ExecutionPortsProvider, useDi as useExecutionPorts }
