import type { NutritionSnapshot } from '../../editor/schema'

/** Nutrition — ports. A plan owns its meals; there is nothing else to query. */
export interface NutritionReadPort {
  readonly current: (signal?: AbortSignal) => Promise<NutritionSnapshot | null>
}

export interface NutritionWritePort {
  /** A replace: nothing references a meal or an item. Same reasoning as every other artefact. */
  readonly save: (plan: NutritionSnapshot, signal?: AbortSignal) => Promise<NutritionSnapshot>
}

export interface NutritionPorts {
  readonly nutrition: NutritionReadPort & NutritionWritePort
}
