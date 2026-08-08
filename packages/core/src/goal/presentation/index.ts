/**
 * Goal — presentation. Mounted by the `(app)` route group.
 */

export { GoalPortsProvider, useGoalPorts } from './di'
export { useDeclareGoal, type UseDeclareGoal } from './hooks/useDeclareGoal'
export { GoalDeclarationForm, type GoalDeclarationFormProps, type GoalLabels } from './views/GoalDeclarationForm'
