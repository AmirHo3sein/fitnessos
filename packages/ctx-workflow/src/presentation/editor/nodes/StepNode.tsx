'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { acceptsInput, outputsOf } from '../../../domain/Workflow'
import type { WorkflowFlowNode } from '../flowAdapter/toFlow'

/**
 * Our node components, registered as React Flow `nodeTypes` (handbook D-11).
 *
 * React Flow renders these and positions them; everything inside is ours, including the handles —
 * which node kinds get which handles comes from `outputsOf` and `acceptsInput`, the same two
 * functions `topology/graph` validates against. That shared source is what keeps the affordance and
 * the rule from drifting: a kind cannot grow a handle the legality check does not know about.
 *
 * ## The handles carry NO aria-label, and that was a finding rather than a choice
 *
 * The first version labelled every handle. axe rejected it: `aria-prohibited-attr`, serious — React
 * Flow renders a handle as a bare `<div>` with no role, and `aria-label` on a generic element is
 * prohibited because nothing will read it.
 *
 * Adding `role="button"` to satisfy the rule would have been worse: it would announce a control that
 * cannot be operated by keyboard, which is a promise the canvas cannot keep. The handles are a
 * pointer affordance and are left as exactly that. The route that IS operable — a select per node,
 * labelled, listing its free ports and legal targets — lives in `WorkflowBuilder`, and the branch
 * names are written visibly on the node so a sighted pointer user can tell the two outputs apart.
 *
 * ## Direction
 *
 * Handles are placed with `Position.Left`/`Position.Right` and NOT flipped for RTL. React Flow
 * positions handles in its own flow space, and its edge paths are computed from handle geometry —
 * mirroring them would put the arrowheads on the wrong end of every edge. The canvas is a diagram,
 * not prose: a Persian reader reads the labels right-to-left and the arrows left-to-right, which is
 * how flow diagrams work in Persian technical material too. The surrounding UI is fully logical.
 */

export interface StepNodeLabels {
  readonly trigger: string
  readonly condition: string
  readonly action: string
  readonly branchTrue: string
  readonly branchFalse: string
  readonly unreachable: string
}

const TONE: Record<string, string> = {
  trigger: 'border-accent-border bg-accent-surface',
  condition: 'border-warning-border bg-warning-surface',
  action: 'border-border bg-surface',
}

export const makeStepNode =
  (labels: StepNodeLabels) =>
  ({ id, data, selected }: NodeProps<WorkflowFlowNode>) => {
    const outputs = outputsOf(data.kind)

    return (
      <div
        data-testid={`step-${id}`}
        data-kind={data.kind}
        className={[
          'min-w-40 rounded-md border-2 px-3 py-2 text-start',
          TONE[data.kind] ?? TONE['action'],
          // The theme's focus ring, not React Flow's default outline — which is a 1px dotted line
          // that fails the contrast floor the rest of this app is held to.
          selected ? 'ring-focus ring-2 ring-offset-1' : '',
        ].join(' ')}
      >
        {/*
          A target handle for everything that accepts input. A trigger gets none at all — the
          refusal exists in `canConnect` as well, but a handle that is never legal to drop on is an
          affordance that lies, and removing it means the common mistake cannot be made.
        */}
        {acceptsInput(data.kind) && <Handle type="target" position={Position.Left} />}

        <p className="text-muted text-[0.65rem] uppercase tracking-wide">{labels[data.kind]}</p>
        <p className="text-sm font-medium">{data.detail}</p>

        {data.unreachable && (
          <p className="text-warning-fg mt-1 text-[0.65rem]">{labels.unreachable}</p>
        )}

        {outputs.map((port, index) => (
          <Handle
            key={port}
            id={port}
            type="source"
            position={Position.Right}
            // Two handles on one edge of a box need placing by hand; one sits centred by default.
            style={outputs.length > 1 ? { top: `${String(35 + index * 30)}%` } : undefined}
          />
        ))}

        {/* Which branch is which, written on the node rather than on the edge: an edge label sits
            at the midpoint, which is nowhere near the decision it describes. */}
        {outputs.length > 1 && (
          <p className="text-muted mt-1 text-[0.6rem]">
            {labels.branchTrue} / {labels.branchFalse}
          </p>
        )}
      </div>
    )
  }
