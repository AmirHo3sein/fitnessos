'use client'

import { createDiContext } from '@fitnessos/ui'
import type { ReportPorts } from '../application/ports/index'

const { Provider, useDi } = createDiContext<ReportPorts>('Report')

export { Provider as ReportPortsProvider, useDi as useReportPorts }
