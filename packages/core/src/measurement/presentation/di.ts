'use client'

import { createDiContext } from '@fitnessos/ui'
import type { MeasurementPorts } from '../application/ports/index'

const { Provider, useDi } = createDiContext<MeasurementPorts>('Measurement')

export { Provider as MeasurementPortsProvider, useDi as useMeasurementPorts }
