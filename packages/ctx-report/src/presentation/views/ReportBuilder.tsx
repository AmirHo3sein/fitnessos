'use client'

import { Button, Card } from '@fitnessos/ui'
import { newEntityId, type Locale } from '@fitnessos/kernel'
import {
  SpatialHash,
  align,
  applySnap,
  clientPoint,
  documentPoint,
  documentRect,
  fromClient,
  distribute,
  hitPoint,
  screenPixels,
  snap,
  toDocument,
  type Alignment,
  type DocumentPoint,
  type EditorAction,
  type GuideLine,
  type NodeId,
  type Viewport,
} from '@fitnessos/editor-engine'
import {
  EditorStoreProvider,
  createEditorStore,
  useChildIds,
  useEditorStore,
  useEphemeral,
  useHistoryControls,
  useNode,
  useSelection,
} from '@fitnessos/editor-react'
import { useMemo, useRef, useState } from 'react'
import { TILE_NODE, commit, hydrate, rectOfNode, type ReportSnapshot } from '../../editor/schema'

export interface ReportBuilderLabels {
  readonly heading: string
  readonly addTile: string
  readonly removeTile: string
  readonly undo: string
  readonly redo: string
  readonly save: string
  readonly multiSelect: string
  readonly alignLeft: string
  readonly alignTop: string
  readonly distributeX: string
  readonly newTileLabel: string
  readonly empty: string
}

export interface ReportBuilderProps {
  report: ReportSnapshot
  locale: Locale
  labels: ReportBuilderLabels
  onSave: (report: ReportSnapshot) => boolean | Promise<boolean>
  isSaving?: boolean
}

/**
 * The Report Builder — the first SPATIAL editor, and the third consumer of `editor-engine`.
 *
 * Everything geometric here comes from the engine: `SpatialHash` for the index, `hitPoint` for
 * selection, `snap` for alignment while dragging, and the branded space converters for turning a
 * pointer event into a document coordinate. None of that arithmetic is written at this call site,
 * which is the point of D-04 — the conversions are where the bugs live, and they live in one
 * place.
 */

/** Snapping tolerance, ON SCREEN. See the header of the engine's `snapping.ts`. */
const SNAP_THRESHOLD = screenPixels(8)
const GRID = 20
/** Per-editor, per D-03: Report 128, Program 64. Tiles here are large. */
const CELL_SIZE = 128

export const ReportBuilder = ({
  report,
  locale,
  labels,
  onSave,
  isSaving = false,
}: ReportBuilderProps) => {
  const store = useMemo(() => {
    const draft = hydrate(report)
    return { editor: createEditorStore({ document: draft.document }), preserved: draft.preserved }
    // Keyed on identity, so a refetch producing an equal-but-new object does not discard
    // in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [report.id])

  return (
    <EditorStoreProvider value={store.editor}>
      <BuilderShell
        locale={locale}
        labels={labels}
        isSaving={isSaving}
        onSave={async () => {
          const state = store.editor.getState()
          const persisted = await onSave(
            commit({ document: state.document, preserved: store.preserved }),
          )
          if (persisted) store.editor.commit()
        }}
      />
    </EditorStoreProvider>
  )
}

const BuilderShell = ({
  locale,
  labels,
  isSaving,
  onSave,
}: {
  locale: Locale
  labels: ReportBuilderLabels
  isSaving: boolean
  onSave: () => Promise<void>
}) => {
  const store = useEditorStore()
  const tileIds = useChildIds(null)
  const selected = useSelection()
  const history = useHistoryControls()
  const canvas = useRef<HTMLDivElement>(null)
  const [guides, setGuides] = useState<readonly GuideLine[]>([])

  /*
   * Multi-select as a MODE, not only as a modifier key.
   *
   * Shift-click is the desktop habit and it stays. It is also unreachable on a touch device,
   * which has no shift key — so on a phone, align and distribute were disabled forever. That is
   * not an acceptable limitation in a product whose primary experience is Persian on mobile; it
   * was a feature that existed only for people on laptops.
   *
   * A mode rather than long-press: long-press competes with the drag this canvas is built
   * around, and the two are told apart by a timer, which is exactly the interaction that feels
   * broken when a finger moves slightly. A visible toggle is discoverable, says what state you
   * are in, and behaves identically with a mouse.
   *
   * While it is on, a tap toggles membership and nothing drags. Modal, deliberately: a canvas
   * where a tap sometimes selects and sometimes starts a drag is a canvas where every tap is a
   * small gamble.
   */
  const [multiSelect, setMultiSelect] = useState(false)

  /*
   * The viewport is fixed at 1:1 for now — pan and zoom are a later interaction, and the code
   * that would consume them is already written against `Viewport` rather than against raw
   * numbers. Adding zoom therefore changes this constant and nothing else, which is what D-04's
   * converters bought.
   */
  const viewport: Viewport = { pan: documentPoint(0, 0), zoom: 1 }

  /*
   * The index is DERIVED from the document, rebuilt when it changes.
   *
   * Not incrementally patched here, deliberately: the alternative is a second source of truth
   * for every tile's position, and it drifts the first time an undo restores a rect without the
   * index hearing about it. `SpatialHash.move` exists for the drag itself, where the cost of a
   * rebuild per pointer event would be real; a rebuild per committed change is not.
   */
  const state = store.getState()
  const index = useMemo(() => {
    const hash = new SpatialHash(CELL_SIZE)
    for (const id of state.document.rootIds) {
      const node = state.document.nodes[id]
      if (node !== undefined) hash.insert(id, rectOfNode(node.props))
    }
    return hash
  }, [state.document])

  const pointFrom = (event: React.PointerEvent): DocumentPoint | null => {
    const box = canvas.current?.getBoundingClientRect()
    if (box === undefined) return null
    return toDocument(viewport, fromClient(box, clientPoint(event.clientX, event.clientY)))
  }

  /**
   * Align or distribute the selection as ONE undo entry.
   *
   * `dispatchBatch`, not a loop of `dispatch`. Aligning six tiles is one thing the user did;
   * one entry per tile would mean a single undo reversed only the last, and the user watched
   * most of their command stay applied. That primitive did not exist until this builder needed
   * it — see the note on `pushBatch`.
   *
   * The engine returns POSITIONS rather than moving anything, which is what makes assembling one
   * entry possible at all.
   */
  const arrange = (compute: (items: { id: NodeId; rect: ReturnType<typeof rectOfNode> }[]) => readonly { id: NodeId; rect: ReturnType<typeof rectOfNode> }[]) => {
    const items = selected
      .map((id) => ({ id, node: state.document.nodes[id] }))
      .filter((entry): entry is { id: NodeId; node: NonNullable<typeof entry.node> } => entry.node !== undefined)
      .map((entry) => ({ id: entry.id, rect: rectOfNode(entry.node.props) }))

    // Fewer than two is not an error, it is a no-op — and the engine already returns the input
    // unchanged. Dispatching nothing keeps an empty entry out of history.
    if (items.length < 2) return

    const actions: EditorAction[] = []
    for (const placed of compute(items)) {
      const before = items.find((item) => item.id === placed.id)
      // Only what actually moved. A tile already in position contributes no action, so the entry
      // is the size of the change rather than the size of the selection.
      if (before?.rect.x !== placed.rect.x) {
        actions.push({ type: 'SetProperty', nodeId: placed.id, key: 'x', value: placed.rect.x })
      }
      if (before?.rect.y !== placed.rect.y) {
        actions.push({ type: 'SetProperty', nodeId: placed.id, key: 'y', value: placed.rect.y })
      }
    }
    if (actions.length > 0) store.dispatchBatch(actions, { label: 'arrange tiles' })
  }

  const addTile = () => {
    const id = newEntityId() as NodeId
    store.dispatch(
      {
        type: 'InsertNode',
        node: {
          id,
          type: TILE_NODE,
          props: {
            x: 20,
            y: 20,
            width: 220,
            height: 140,
            contentKind: 'indicator',
            text: '',
            indicatorKind: 'estimated-1rm',
            fallbackLabel: labels.newTileLabel,
          },
        },
        parentId: null,
        // Appended, so a new tile paints ON TOP of what is already there — which is where the
        // user expects the thing they just made to be.
        index: tileIds.length,
      },
      { label: 'add tile' },
    )
    store.setEphemeral({ selected: [id] })
  }

  /**
   * A drag, start to finish.
   *
   * The document is NOT touched while the pointer moves. Position updates go to the EPHEMERAL
   * channel, which no document subscriber listens to — that is the two-channel design earning
   * itself: a drag fires sixty times a second, and routing it through the document would both
   * re-render the tree on every frame and leave the user needing two hundred undos to reverse
   * one drag.
   *
   * On release, two `SetProperty` dispatches. They coalesce into one history entry because they
   * share an action type and a target, so one drag is one undo with no special case.
   */
  const onPointerDown = (event: React.PointerEvent) => {
    const point = pointFrom(event)
    if (point === null) return

    const [top] = hitPoint(index, state.document.rootIds, point)
    if (top === undefined) {
      // A tap on empty canvas clears the selection — but not in multi-select mode, where it
      // would undo a careful selection with one stray finger.
      if (!multiSelect) store.setEphemeral({ selected: [] })
      return
    }

    /*
     * Read from the STORE, not from the render-time `selected`.
     *
     * The handler closes over the selection as it was when this render happened. Two taps in
     * quick succession both run against that closure before React has re-rendered, so the second
     * overwrites the first and one of the two tiles is silently dropped — which is exactly how a
     * person taps when selecting things, and exactly what made align stay disabled.
     *
     * The store always holds the current value, so reading it here makes the update functional
     * in effect without needing a functional API.
     */
    const current = store.getEphemeral().selected

    if (multiSelect) {
      // Toggle membership. Tapping a selected tile removes it, which is the only way to correct
      // a mis-tap without starting the selection again.
      store.setEphemeral({
        selected: current.includes(top) ? current.filter((id) => id !== top) : [...current, top],
      })
      return
    }

    // Shift extends the selection on a keyboard-and-pointer device.
    const extended = event.shiftKey && !current.includes(top) ? [...current, top] : [top]
    store.setEphemeral({ selected: extended })

    const node = state.document.nodes[top]
    if (node === undefined) return

    const start = rectOfNode(node.props)
    const grabbed = documentPoint(point.x - start.x, point.y - start.y)
    event.currentTarget.setPointerCapture(event.pointerId)

    const others = state.document.rootIds
      .filter((id) => id !== top)
      .map((id) => rectOfNode(state.document.nodes[id]?.props ?? {}))

    const move = (moveEvent: PointerEvent) => {
      const box = canvas.current?.getBoundingClientRect()
      if (box === undefined) return
      const at = toDocument(viewport, fromClient(box, clientPoint(moveEvent.clientX, moveEvent.clientY)))
      const proposed = documentRect(at.x - grabbed.x, at.y - grabbed.y, start.width, start.height)
      const snapped = snap(proposed, others, viewport, { threshold: SNAP_THRESHOLD, gridSize: GRID })
      const placed = applySnap(proposed, snapped)

      setGuides(snapped.guides)
      store.setEphemeral({ dragOffset: { x: placed.x, y: placed.y } })
    }

    const finish = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      setGuides([])

      const box = canvas.current?.getBoundingClientRect()
      if (box === undefined) return
      const at = toDocument(viewport, fromClient(box, clientPoint(upEvent.clientX, upEvent.clientY)))
      const proposed = documentRect(at.x - grabbed.x, at.y - grabbed.y, start.width, start.height)
      const placed = applySnap(
        proposed,
        snap(proposed, others, viewport, { threshold: SNAP_THRESHOLD, gridSize: GRID }),
      )

      store.setEphemeral({ dragOffset: null })
      store.dispatch({ type: 'SetProperty', nodeId: top, key: 'x', value: placed.x }, { label: 'move tile' })
      store.dispatch({ type: 'SetProperty', nodeId: top, key: 'y', value: placed.y }, { label: 'move tile' })
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-display me-auto text-xl">{labels.heading}</h2>
        <Button type="button" variant="secondary" size="sm" isDisabled={!history.canUndo} onPress={history.undo}>
          {labels.undo}
        </Button>
        <Button type="button" variant="secondary" size="sm" isDisabled={!history.canRedo} onPress={history.redo}>
          {labels.redo}
        </Button>
        <Button type="button" variant="secondary" size="sm" onPress={addTile}>
          {labels.addTile}
        </Button>
        <Button
          type="button"
          variant={multiSelect ? 'primary' : 'secondary'}
          size="sm"
          aria-pressed={multiSelect}
          onPress={() => {
            setMultiSelect((on) => !on)
          }}
        >
          {labels.multiSelect}
        </Button>
        {/* Disabled below two, because aligning one thing to itself does nothing visible and a
            button that appears to do nothing reads as broken. */}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          isDisabled={selected.length < 2}
          onPress={() => {
            arrange((items) => align(items, 'left' satisfies Alignment))
          }}
        >
          {labels.alignLeft}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          isDisabled={selected.length < 2}
          onPress={() => {
            arrange((items) => align(items, 'top' satisfies Alignment))
          }}
        >
          {labels.alignTop}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          isDisabled={selected.length < 3}
          onPress={() => {
            arrange((items) => distribute(items, 'x'))
          }}
        >
          {labels.distributeX}
        </Button>
        <Button type="button" size="sm" isDisabled={isSaving} onPress={() => void onSave()}>
          {labels.save}
        </Button>
      </div>

      <div
        ref={canvas}
        data-testid="report-canvas"
        onPointerDown={onPointerDown}
        className="border-default bg-surface-sunken relative h-[520px] w-full touch-none overflow-hidden rounded-xl border"
      >
        {tileIds.length === 0 && (
          <p className="text-muted p-6 text-sm">{labels.empty}</p>
        )}
        {tileIds.map((id) => (
          <TileView key={id} id={id} locale={locale} labels={labels} />
        ))}
        {guides.map((guide) => (
          <div
            key={`${guide.axis}-${String(guide.at)}-${guide.kind}`}
            aria-hidden="true"
            className="bg-brand-border pointer-events-none absolute"
            style={
              guide.axis === 'x'
                ? { left: guide.at, top: 0, width: 1, height: '100%' }
                : { top: guide.at, left: 0, height: 1, width: '100%' }
            }
          />
        ))}
      </div>
    </div>
  )
}

const TileView = ({
  id,
  locale,
  labels,
}: {
  id: NodeId
  locale: Locale
  labels: ReportBuilderLabels
}) => {
  const store = useEditorStore()
  const node = useNode(id)
  // Both read from the ephemeral channel, so a drag re-renders this and nothing else.
  const selected = useEphemeral((state) => state.selected.includes(id))
  const dragOffset = useEphemeral((state) => (state.selected.includes(id) ? state.dragOffset : null))

  if (node === null) return null

  const rect = rectOfNode(node.props)
  // Narrowed rather than stringified. Props are `Record<string, unknown>` by design, and
  // `String(unknown)` yields "[object Object]" for anything non-primitive — a tile whose label
  // read that would look like a rendering bug with no clue where it came from.
  const text = (key: string) => (typeof node.props[key] === 'string' ? node.props[key] : '')
  const label = text('fallbackLabel') !== '' ? text('fallbackLabel') : text('text')

  return (
    <div
      data-testid={`tile-${id}`}
      style={{
        position: 'absolute',
        // The ephemeral position wins while dragging, so the tile follows the pointer without
        // the document knowing anything has happened yet.
        left: dragOffset?.x ?? rect.x,
        top: dragOffset?.y ?? rect.y,
        width: rect.width,
        height: rect.height,
      }}
    >
      <Card className={selected ? 'border-brand-border h-full border-2' : 'h-full'}>
        <div className="flex items-start justify-between gap-2">
          <span className="text-primary text-sm font-medium">{label}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`${labels.removeTile} ${label}`}
            onPress={() => {
              store.dispatch({ type: 'RemoveNode', nodeId: id }, { label: 'remove tile' })
            }}
          >
            ✕
          </Button>
        </div>
        <p className="text-muted mt-1 text-xs" lang={locale}>
          {text('indicatorKind')}
        </p>
      </Card>
    </div>
  )
}
