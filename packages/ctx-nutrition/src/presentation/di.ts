'use client'

import { createDiContext } from '@fitnessos/ui'
import type { NutritionPorts } from '../application/ports/index'

const { Provider, useDi } = createDiContext<NutritionPorts>('Nutrition')

export { Provider as NutritionPortsProvider, useDi as useNutritionPorts }
