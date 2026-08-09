'use client'

import { createDiContext } from '@fitnessos/ui'
import type { DashboardPorts } from '../application/ports/index'

const { Provider, useDi } = createDiContext<DashboardPorts>('DashboardLayout')

export { Provider as DashboardPortsProvider, useDi as useDashboardPorts }
