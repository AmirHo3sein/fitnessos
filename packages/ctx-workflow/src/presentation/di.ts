'use client'

import { createDiContext } from '@fitnessos/ui'
import type { WorkflowPorts } from '../application/ports/index'

const { Provider, useDi } = createDiContext<WorkflowPorts>('Workflow')

export { Provider as WorkflowPortsProvider, useDi as useWorkflowPorts }
