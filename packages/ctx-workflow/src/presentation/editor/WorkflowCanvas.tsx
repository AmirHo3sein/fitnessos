'use client'

import {
  Background,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type IsValidConnection,
  type Node as FlowNode,
  type NodeChange,
} from '@xyflow/react'
import { useEffect, useMemo, useRef } from 'react'
/*
 * React Flow's stylesheet, imported by the canvas module rather than globally.
 *
 * It has to load or the canvas has no layout at all — nodes stack at the origin and handles have no
 * hit area. Importing it here means it travels with the lazy chunk below, so a page that never
 * mounts the canvas never fetches it, and the other twelve routes never see it in their stylesheet.
 */
import '@xyflow/react/dist/style.css'
// After React Flow's own, so it wins. Contains the attribution contrast fix and a touch-sized
// handle — see the file for both.
import './canvas.css'
import { makeStepNode, type StepNodeLabels } from './nodes/StepNode'
import type { WorkflowFlowNode } from './flowAdapter/toFlow'

/**
 * The React Flow canvas, isolated so it can be loaded LAZILY.
 *
 * ## Why this file exists at all
 *
 * React Flow is 55 kB gzipped. The route budget is 15 kB of route-exclusive JS, and raising the
 * number to 65 would have been the easy move and the wrong one — the budget exists to make exactly
 * this kind of weight a decision rather than an accident.
 *
 * What made deferring correct rather than a way of hiding the bytes: **the canvas is not the only
 * way to author a workflow.** The step list in `WorkflowBuilder` can add every kind of step, edit
 * every detail, make every connection and delete anything — it is the route by which someone using
 * a keyboard or a screen reader works, and it was built for that reason, not for this one. So the
 * page is fully usable before this chunk arrives, which is the actual definition of a legitimate
 * lazy boundary.
 *
 * The bytes are still downloaded by anyone who looks at the canvas. What changes is that they are
 * not on the path to interactivity, and `tools/bundle-budget.mjs` records the deferred weight so it
 * cannot become invisible.
 *
 * Everything in here is presentation. It holds no state of its own, decides nothing about legality,
 * and receives its nodes and edges already derived from the document.
 */

export interface WorkflowCanvasProps {
  readonly nodes: readonly WorkflowFlowNode[]
  readonly edges: readonly Edge[]
  readonly labels: StepNodeLabels
  readonly canvasLabel: string
  readonly onNodesChange: (changes: NodeChange<FlowNode>[]) => void
  readonly onNodeDragStop: (event: unknown, node: FlowNode) => void
  readonly onConnect: (connection: Connection) => void
  readonly isValidConnection: IsValidConnection
}

/**
 * Bring the view back to the whole graph when a step is ADDED or removed.
 *
 * `fitView` as a prop runs once, on mount. That was a real defect and a screenshot found it: a coach
 * opens a new workflow (one node, fitted), presses "add action", and the new node is placed outside
 * the fitted view — visible only as a clipped edge at the bottom of the canvas, with its own "never
 * runs" warning cut in half. Every assertion about the graph passed, because the node was there and
 * correctly unconnected.
 *
 * Keyed on the COUNT, deliberately, and not on the nodes themselves. Re-fitting whenever a position
 * changed would yank the viewport back after every drag — fighting the person using it, which is
 * worse than the bug being fixed. Adding or deleting a step is a moment where a recentre is what
 * someone expects; moving one is emphatically not.
 */
const FitWhenStepsChange = ({ count }: { count: number }) => {
  const { fitView } = useReactFlow()
  const previous = useRef(count)

  useEffect(() => {
    if (previous.current === count) return
    previous.current = count
    /*
     * Instant, NOT animated, and that was a test failure before it was a decision.
     *
     * With `duration: 200` the viewport was still moving while the next gesture began: a connection
     * drag started immediately after adding a step landed nowhere, because the target handle had
     * moved between the pointer going down and coming up. An end-to-end test caught it, and it is
     * not only a test problem — a coach who adds a step and reaches straight for its handle is
     * fighting an animation for a fifth of a second.
     *
     * A recentre of this size does not need easing to be understood.
     */
    void fitView({ padding: 0.25, maxZoom: 1 })
  }, [count, fitView])

  return null
}

export const WorkflowCanvas = ({
  nodes,
  edges,
  labels,
  canvasLabel,
  onNodesChange,
  onNodeDragStop,
  onConnect,
  isValidConnection,
}: WorkflowCanvasProps) => {
  // Registered once. A new object here would remount every node on every render, which loses focus
  // and restarts any transition mid-flight.
  const nodeTypes = useMemo(() => {
    const Step = makeStepNode(labels)
    return { trigger: Step, condition: Step, action: Step }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- labels are stable for the locale
  }, [])

  return (
    <div
      data-testid="workflow-canvas"
      // A fixed height, because React Flow measures its container and a canvas inside a
      // `height: auto` parent collapses to nothing. The Report Builder's `h-[520px]` learned that
      // the hard way when the stylesheet lost the class entirely.
      className="border-border h-[480px] w-full min-w-0 max-w-full overflow-hidden rounded-md border"
      role="application"
      aria-label={canvasLabel}
    >
      {/* React Flow's own provider, per canvas rather than per app. */}
      <ReactFlowProvider>
        <ReactFlow
          nodes={[...nodes]}
          edges={[...edges]}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStop={onNodeDragStop}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          // Off. The document decides what exists, and React Flow's own delete would remove a node
          // without its edges — the exact dangling-edge state `deleteStepActions` prevents.
          deleteKeyCode={null}
          nodesConnectable
          fitView
          /*
           * Capped at 1:1, and this was a visual-regression finding rather than a preference.
           *
           * `fitView` scales until the nodes fill the viewport, which with two nodes means roughly
           * 2× — text at double size, and the second node clipped by the canvas edge with its
           * "never runs" warning cut in half. A coach's first ever workflow has exactly two nodes,
           * so the default's worst case is also the most common one.
           *
           * Nothing but a screenshot would have caught it: every assertion about the graph passed,
           * because the nodes were all present and correctly connected — just unreadably large.
           */
          fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        >
          <Background />
          <FitWhenStepsChange count={nodes.length} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  )
}

export default WorkflowCanvas
