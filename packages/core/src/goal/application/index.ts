export type { GoalPorts, GoalReadPort, GoalSnapshot, GoalWritePort } from './ports/index'

export {
  DeclareGoalValidationError,
  declareGoal,
  type DeclareGoalError,
  type GoalDraft,
} from './declareGoal'

export {
  goalInvalidations,
  goalKeys,
  myGoalsQuery,
  type Invalidator,
  type QueryDefinition,
} from './queries/goalKeys'
