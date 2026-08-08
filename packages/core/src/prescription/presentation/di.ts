'use client'

import { createDiContext } from '@fitnessos/ui'
import type { PrescriptionPorts } from '../application/ports/index'

const { Provider, useDi } = createDiContext<PrescriptionPorts>('Prescription')

export { Provider as PrescriptionPortsProvider, useDi as usePrescriptionPorts }
