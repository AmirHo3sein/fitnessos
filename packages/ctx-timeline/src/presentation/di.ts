'use client'

import { createDiContext } from '@fitnessos/ui'
import type { TimelinePorts } from '../application/ports/index'

const { Provider, useDi } = createDiContext<TimelinePorts>('Timeline')

export { Provider as TimelinePortsProvider, useDi as useTimelinePorts }
