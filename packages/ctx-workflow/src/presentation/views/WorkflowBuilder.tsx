'use client'

import { Button, Card } from '@fitnessos/ui'
import { newEntityId, type Locale } from '@fitnessos/kernel'
import type { NodeId } from '@fitnessos/editor-engine'
import {
  EditorStoreProvider,
  createEditorStore,
  useDocument,
  useEditorStore,
  useHistoryControls,
} from '@fitnessos/editor-react'
import type {
  Connection,
  IsValidConnection,
  Node as FlowNode,
  NodeChange,
} from '@xyflow/react'
import { Suspense, lazy, useCallback, useMemo, useState } from 'react'
import {
  acceptsInput,
  isRunnable,
  outputsOf,
  problemsOf,
  type OutputPort,
  type WorkflowNodeKind,
} from '../../domain/Workflow'
import { canConnect, freeOutputs } from '../../topology/graph'
import { commit, hydrate, type WorkflowSnapshot } from '../../editor/schema'
import {
  connectionActions,
  deleteStepActions,
  moveActions,
} from '../editor/flowAdapter/fromFlow'
import { graphOf, toFlow } from '../editor/flowAdapter/toFlow'
import type { StepNodeLabels } from '../editor/nodes/StepNode'
import type { ConnectionRefusal } from '../../topology/graph'

/**
 * React Flow, behind a lazy boundary.
 *
 * 55 kB gzipped against a 15 kB route budget. Raising the number was the easy move and the wrong
 * one; deferring is correct here for a specific reason — the step list below authors a workflow
 * completely on its own, so the page is usable before this arrives. See `WorkflowCanvas` for the
 * full reasoning, and `tools/bundle-budget.mjs` for the recorded deferred weight.
 *
 * `lazy` rather than `next/dynamic`: this package must not depend on Next. It is rendered in a
 * client component, so Suspense is available.
 */
const WorkflowCanvas = lazy(() => import('../editor/WorkflowCanvas'))

/**
 * The Workflow Builder — the seventh editor, and the only one where a library owns interaction.
 *
 * `react-grid-layout` was evaluated for the Dashboard and rejected; the Timeline's dragging is
 * hand-rolled. React Flow is different in kind, and handbook D-11 says so: edge routing, viewport
 * transform, handle hit-testing and connection preview are a large amount of geometry with no
 * product opinion in them. Writing that again would be writing a worse React Flow.
 *
 * The division it draws is the whole point:
 *
 *   React Flow      rendering, panning, zooming, node dragging, connection preview
 *   editor-engine   the document, every action, and the history
 *   topology/graph  whether an edge is legal
 *
 * React Flow's internal state is **never** read as truth. `onNodesChange` handles only what it must
 * (see below); position arrives once per gesture on `onNodeDragStop`; a connection arrives on
 * `onConnect` and is validated before anything is dispatched.
 *
 * ## Connecting without a pointer
 *
 * Dragging between two handles is the canvas gesture, and it is unavailable to anyone using a
 * keyboard or a screen reader — React Flow's own keyboard support moves and selects nodes but does
 * not draw edges. So every node also appears in a list below the canvas with a select for its free
 * ports, and both routes funnel through the same `connectionActions`. This is the same position
 * taken for align/distribute on touch in the Report Builder: the canvas gesture is the fast path,
 * never the only path.
 */

export interface WorkflowBuilderLabels {
  readonly heading: string
  readonly addTrigger: string
  readonly addCondition: string
  readonly addAction: string
  readonly removeStep: string
  readonly undo: string
  readonly redo: string
  readonly save: string
  readonly detail: string
  readonly connectFrom: string
  readonly connectTo: string
  readonly connect: string
  readonly disconnect: string
  readonly empty: string
  readonly newTrigger: string
  readonly newCondition: string
  readonly newAction: string
  readonly steps: string
  readonly canvas: string
  readonly enable: string
  readonly disable: string
  readonly notRunnable: string
  readonly noTrigger: string
  readonly node: StepNodeLabels
  /** One message per refusal, so the reason is never a generic "that did not work". */
  readonly refusal: Record<ConnectionRefusal, string>
}

export interface WorkflowBuilderProps {
  workflow: WorkflowSnapshot
  locale: Locale
  labels: WorkflowBuilderLabels
  onSave: (workflow: WorkflowSnapshot) => boolean | Promise<boolean>
  isSaving?: boolean
}

export const WorkflowBuilder = ({
  workflow,
  locale,
  labels,
  onSave,
  isSaving = false,
}: WorkflowBuilderProps) => {
  const store = useMemo(() => {
    const draft = hydrate(workflow)
    return { editor: createEditorStore({ document: draft.document }), preserved: draft.preserved }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on identity, see the other builders
  }, [workflow.id])

  const [enabled, setEnabled] = useState(workflow.enabled)

  return (
    <EditorStoreProvider value={store.editor}>
      <BuilderShell
          locale={locale}
          labels={labels}
          isSaving={isSaving}
          enabled={enabled}
          onToggleEnabled={setEnabled}
          onSave={async (nextEnabled) => {
            const state = store.editor.getState()
            const persisted = await onSave(
              commit({
                document: state.document,
                preserved: { ...store.preserved, enabled: nextEnabled },
              }),
            )
            if (persisted) store.editor.commit()
          }}
      />
    </EditorStoreProvider>
  )
}

/** The `detail` a freshly added step starts with — a placeholder the coach replaces. */
const newDetailFor = (kind: WorkflowNodeKind, labels: WorkflowBuilderLabels): string => {
  switch (kind) {
    case 'trigger':
      return labels.newTrigger
    case 'condition':
      return labels.newCondition
    case 'action':
      return labels.newAction
  }
}

const BuilderShell = ({
  locale,
  labels,
  isSaving,
  enabled,
  onToggleEnabled,
  onSave,
}: {
  locale: Locale
  labels: WorkflowBuilderLabels
  isSaving: boolean
  enabled: boolean
  onToggleEnabled: (next: boolean) => void
  onSave: (enabled: boolean) => Promise<void>
}) => {
  const store = useEditorStore()
  const document = useDocument()
  const history = useHistoryControls()
  const [refusal, setRefusal] = useState<ConnectionRefusal | null>(null)

  // Derived from the document on every change, which is what makes the document the source of
  // truth rather than one of two.
  const graph = useMemo(() => graphOf(document), [document])
  const problems = useMemo(() => problemsOf(graph), [graph])
  const unreachable = useMemo(
    () =>
      new Set(
        problems.flatMap((problem) => (problem.kind === 'unreachable' ? [problem.nodeId] : [])),
      ),
    [problems],
  )
  const view = useMemo(() => toFlow(graph, unreachable), [graph, unreachable])

  const addStep = (kind: WorkflowNodeKind) => {
    const id = newEntityId() as NodeId
    store.dispatch(
      {
        type: 'InsertNode',
        node: {
          id,
          type: kind,
          props: {
            detail: newDetailFor(kind, labels),
            /*
             * New steps march ALONG the flow direction, on one line.
             *
             * A workflow reads left to right — that is what the handles and edge arrows say — so a
             * step added after another belongs to its right, not diagonally below it. The first
             * version staggered both axes and produced a descending staircase that looked like an
             * arrangement someone had chosen.
             *
             * The canvas re-fits when the count changes (see `FitWhenStepsChange`), so a step placed
             * beyond the current view is brought into it rather than left off the edge.
             */
            x: 40 + graph.nodes.length * 220,
            y: 40,
          },
        },
        parentId: null,
        index: document.rootIds.length,
      },
      { label: 'add step' },
    )
  }

  /**
   * A finished drag → one history entry.
   *
   * D-11's "controlled document, uncontrolled drag". React Flow has been moving the node itself
   * since pointerdown; this is the first and only thing the document hears about it.
   */
  const onNodeDragStop = useCallback(
    (_event: unknown, node: FlowNode) => {
      store.dispatchBatch(moveActions(node.id, node.position), { label: 'move step' })
    },
    [store],
  )

  /**
   * The only `onNodesChange` we honour, and why the rest are dropped.
   *
   * React Flow reports `position` on every frame of a drag (handled above, once, at the end),
   * `dimensions` from its own measurement, and `select`. Only selection is worth keeping, and it
   * goes to the EPHEMERAL channel — selection is not an edit, and a document action for it would put
   * a history entry behind every click.
   */
  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      const selected = changes.flatMap((change) =>
        change.type === 'select' && change.selected ? [change.id as NodeId] : [],
      )
      if (selected.length > 0) store.setEphemeral({ selected })
    },
    [store],
  )

  const attemptConnection = useCallback(
    (attempt: { source: string | null; target: string | null; sourceHandle: string | null }) => {
      const outcome = connectionActions(
        graph,
        attempt,
        newEntityId(),
        document.rootIds.length,
      )
      if (!outcome.ok) {
        setRefusal(outcome.verdict.ok ? null : outcome.verdict.refusal)
        return
      }
      setRefusal(null)
      store.dispatchBatch(outcome.actions, { label: 'connect' })
    },
    [document.rootIds.length, graph, store],
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      attemptConnection(connection)
    },
    [attemptConnection],
  )

  /**
   * React Flow's own guard, so an illegal drop never shows a connection line snapping into place.
   *
   * NOT the authority — `attemptConnection` is, and it runs on every route including the select
   * below. This exists so the gesture feels wrong before it completes rather than being accepted
   * and then rejected, which is the difference between an affordance and an error message.
   */
  const isValidConnection = useCallback<IsValidConnection>(
    (connection) =>
      canConnect(graph, {
        from: connection.source,
        port: (connection.sourceHandle ?? 'out') as OutputPort,
        to: connection.target,
      }).ok,
    [graph],
  )

  const removeStep = (id: string) => {
    // Edges first, then the node, as one entry — see `deleteStepActions`.
    store.dispatchBatch(deleteStepActions(graph, id), { label: 'remove step' })
  }

  const runnable = isRunnable(graph)

  return (
    <div className="space-y-4">
      <h2 className="text-display text-xl">{labels.heading}</h2>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" isDisabled={!history.canUndo} onPress={history.undo}>
          {labels.undo}
        </Button>
        <Button type="button" variant="secondary" size="sm" isDisabled={!history.canRedo} onPress={history.redo}>
          {labels.redo}
        </Button>
        <Button type="button" variant="secondary" size="sm" onPress={() => {
            addStep('trigger')
          }}>
          {labels.addTrigger}
        </Button>
        <Button type="button" variant="secondary" size="sm" onPress={() => {
            addStep('condition')
          }}>
          {labels.addCondition}
        </Button>
        <Button type="button" variant="secondary" size="sm" onPress={() => {
            addStep('action')
          }}>
          {labels.addAction}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          // Enabling a workflow that cannot run is the one thing genuinely refused here. Saving an
          // incomplete one is fine — authoring is incremental — but a coach must not be able to
          // switch on something with no trigger or an orphaned step.
          isDisabled={!runnable && !enabled}
          onPress={() => {
            const next = !enabled
            onToggleEnabled(next)
            void onSave(next)
          }}
        >
          {enabled ? labels.disable : labels.enable}
        </Button>
        <Button type="button" size="sm" isDisabled={isSaving} onPress={() => {
            void onSave(enabled)
          }}>
          {labels.save}
        </Button>
      </div>

      {/*
        A live region. A refusal happens at the end of a pointer gesture, where a sighted user is
        looking at the canvas and a screen-reader user has no idea anything was rejected.
      */}
      <p aria-live="polite" className="text-warning-fg min-h-5 text-sm">
        {refusal === null ? '' : labels.refusal[refusal]}
      </p>

      {!runnable && (
        <p className="text-muted text-sm">
          {problems.some((problem) => problem.kind === 'no-trigger')
            ? labels.noTrigger
            : labels.notRunnable}
        </p>
      )}

      <Suspense
        fallback={
          <div
            // Same height as the canvas, so the list below does not jump when the chunk lands.
            className="border-border text-muted flex h-[480px] w-full items-center justify-center rounded-md border text-sm"
          >
            {labels.canvas}
          </div>
        }
      >
        <WorkflowCanvas
          nodes={view.nodes}
          edges={view.edges}
          labels={labels.node}
          canvasLabel={labels.canvas}
          onNodesChange={onNodesChange}
          onNodeDragStop={onNodeDragStop}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
        />
      </Suspense>

      {/*
        Every node, as a list. Not a debug view: this is how a workflow is authored without a
        pointer, and it is the only place `detail` can be edited at all.
      */}
      <h3 className="text-display text-base">{labels.steps}</h3>
      {graph.nodes.length === 0 ? (
        <Card>
          <p className="text-muted text-sm">{labels.empty}</p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {graph.nodes.map((node) => (
            <StepRow
              key={node.id}
              nodeId={node.id}
              kind={node.kind}
              detail={node.detail}
              graph={graph}
              locale={locale}
              labels={labels}
              onConnectRequest={attemptConnection}
              onRemove={() => {
                removeStep(node.id)
              }}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

/** One node's editable detail, its free output ports, and its delete control. */
const StepRow = ({
  nodeId,
  kind,
  detail,
  graph,
  labels,
  onConnectRequest,
  onRemove,
}: {
  nodeId: string
  kind: WorkflowNodeKind
  detail: string
  graph: ReturnType<typeof graphOf>
  locale: Locale
  labels: WorkflowBuilderLabels
  onConnectRequest: (attempt: {
    source: string
    target: string
    sourceHandle: string
  }) => void
  onRemove: () => void
}) => {
  const store = useEditorStore()
  const free = freeOutputs(graph, nodeId)
  // The first free port, or the kind's first if all are taken — in which case the select is not
  // rendered at all, so the value is never seen.
  const [port, setPort] = useState<OutputPort>(free[0] ?? outputsOf(kind)[0] ?? 'out')
  const [target, setTarget] = useState('')

  // Anything that accepts input and is not this node. The cycle rule is left to `canConnect` rather
  // than filtered out here: "that would create a loop" is a more useful thing to be told than a
  // silently shorter list.
  const targets = graph.nodes.filter((node) => node.id !== nodeId && acceptsInput(node.kind))

  return (
    <li className="border-border flex flex-wrap items-end gap-2 rounded-md border p-2" data-testid={`row-${nodeId}`}>
      <span className="text-muted w-20 shrink-0 text-xs">{labels.node[kind]}</span>

      <div className="min-w-40 grow">
        <label className="text-muted block text-xs" htmlFor={`${nodeId}-detail`}>
          {labels.detail}
        </label>
        <input
          id={`${nodeId}-detail`}
          className="border-border bg-surface w-full rounded border px-2 py-1 text-sm"
          value={detail}
          onChange={(event) => {
            store.dispatch(
              { type: 'SetProperty', nodeId: nodeId as NodeId, key: 'detail', value: event.target.value },
              // Same label and target on every keystroke, so a burst of typing coalesces into one
              // undo entry.
              { label: 'edit detail' },
            )
          }}
        />
      </div>

      {free.length > 0 && targets.length > 0 && (
        <>
          {/* Only shown when the kind has more than one port. A select with one option is noise. */}
          {outputsOf(kind).length > 1 && (
            <div>
              <label className="text-muted block text-xs" htmlFor={`${nodeId}-port`}>
                {labels.connectFrom}
              </label>
              <select
                id={`${nodeId}-port`}
                className="border-border bg-surface rounded border px-2 py-1 text-sm"
                value={port}
                onChange={(event) => {
                  setPort(event.target.value as OutputPort)
                }}
              >
                {free.map((option) => (
                  <option key={option} value={option}>
                    {option === 'true' ? labels.node.branchTrue : labels.node.branchFalse}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="text-muted block text-xs" htmlFor={`${nodeId}-target`}>
              {labels.connectTo}
            </label>
            <select
              id={`${nodeId}-target`}
              className="border-border bg-surface rounded border px-2 py-1 text-sm"
              value={target}
              onChange={(event) => {
                setTarget(event.target.value)
              }}
            >
              <option value="">—</option>
              {targets.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.detail}
                </option>
              ))}
            </select>
          </div>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            isDisabled={target === ''}
            onPress={() => {
              onConnectRequest({ source: nodeId, target, sourceHandle: port })
            }}
          >
            {labels.connect}
          </Button>
        </>
      )}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`${labels.removeStep} ${detail}`}
        onPress={onRemove}
      >
        ✕
      </Button>
    </li>
  )
}
