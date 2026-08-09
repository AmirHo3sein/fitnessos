'use client'

import { Button, Card } from '@fitnessos/ui'
import { newEntityId, type Locale } from '@fitnessos/kernel'
import { documentRect, type EditorAction, type NodeId } from '@fitnessos/editor-engine'
import {
  EditorStoreProvider,
  createEditorStore,
  useChildIds,
  useEditorStore,
  useEphemeral,
  useHistoryControls,
  useNode,
} from '@fitnessos/editor-react'
import { useMemo, useRef } from 'react'
import {
  WIDGET_NODE,
  commit,
  compactionFor,
  hydrate,
  movesFor,
  rectOfNode,
  type DashboardSnapshot,
} from '../../editor/schema'

export interface DashboardBuilderLabels {
  readonly heading: string
  readonly addWidget: string
  readonly removeWidget: string
  readonly undo: string
  readonly redo: string
  readonly save: string
  readonly newWidgetLabel: string
  readonly empty: string
  readonly content: Readonly<Record<string, string>>
}

export interface DashboardBuilderProps {
  dashboard: DashboardSnapshot
  locale: Locale
  labels: DashboardBuilderLabels
  onSave: (dashboard: DashboardSnapshot) => boolean | Promise<boolean>
  isSaving?: boolean
}

/** Row height in CSS pixels. Columns are fluid; rows are not, so a widget's height is stable. */
const ROW_HEIGHT = 88
const ROW_GAP = 8

export const DashboardBuilder = ({
  dashboard,
  locale,
  labels,
  onSave,
  isSaving = false,
}: DashboardBuilderProps) => {
  const store = useMemo(() => {
    const draft = hydrate(dashboard)
    return { editor: createEditorStore({ document: draft.document }), preserved: draft.preserved }
    // Keyed on identity, so a refetch producing an equal-but-new object does not discard edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [dashboard.id])

  return (
    <EditorStoreProvider value={store.editor}>
      <BuilderShell
        columns={store.preserved.columns}
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
  columns,
  locale,
  labels,
  isSaving,
  onSave,
}: {
  columns: number
  locale: Locale
  labels: DashboardBuilderLabels
  isSaving: boolean
  onSave: () => Promise<void>
}) => {
  const store = useEditorStore()
  const widgetIds = useChildIds(null)
  const history = useHistoryControls()
  const grid = useRef<HTMLDivElement>(null)

  const state = store.getState()

  /**
   * Pointer position, in CELLS, measured from the grid's inline START.
   *
   * `inline start` rather than `left`, and this is the part a spatial editor gets wrong in a
   * right-to-left product. Column 0 is the column the reader begins at — the right-hand edge in
   * Persian, the left in English. Measuring from `box.left` unconditionally would mirror every
   * dashboard the moment the language changed, so a layout authored in Persian would arrive
   * backwards for an English-reading coach looking at the same athlete.
   */
  const cellFrom = (clientX: number, clientY: number): { col: number; row: number } | null => {
    const box = grid.current?.getBoundingClientRect()
    if (box === undefined) return null

    const rtl = getComputedStyle(grid.current as Element).direction === 'rtl'
    const fromStart = rtl ? box.right - clientX : clientX - box.left
    const cellWidth = box.width / columns

    return {
      col: Math.floor(fromStart / cellWidth),
      row: Math.floor((clientY - box.top) / (ROW_HEIGHT + ROW_GAP)),
    }
  }

  const addWidget = () => {
    const id = newEntityId() as NodeId
    // Placed BELOW everything, so a new widget never displaces what the coach already arranged.
    const lowest = widgetIds.reduce((max, other) => {
      const rect = rectOfNode(state.document.nodes[other]?.props ?? {})
      return Math.max(max, rect.y + rect.height)
    }, 0)

    store.dispatch(
      {
        type: 'InsertNode',
        node: {
          id,
          type: WIDGET_NODE,
          props: {
            x: 0,
            y: lowest,
            width: Math.min(4, columns),
            height: 2,
            contentKind: 'indicator',
            indicatorKind: 'estimated-1rm',
            fallbackLabel: labels.newWidgetLabel,
          },
        },
        parentId: null,
        index: widgetIds.length,
      },
      { label: 'add widget' },
    )
    store.setEphemeral({ selected: [id] })
  }

  const removeWidget = (id: NodeId) => {
    /*
     * Removal and compaction as ONE entry, so undo brings the widget back AND puts the others
     * down again. Two entries would mean the first undo restored the widget on top of whatever
     * had risen into its place.
     */
    const draft = { document: state.document, preserved: { id: '', title: '', columns } }
    const lifted = compactionFor(draft, id)

    const actions: EditorAction[] = [{ type: 'RemoveNode', nodeId: id }]
    for (const move of lifted) {
      actions.push({ type: 'SetProperty', nodeId: move.id, key: 'y', value: move.rect.y })
    }
    store.dispatchBatch(actions, { label: 'remove widget' })
  }

  const onPointerDown = (event: React.PointerEvent) => {
    const target = (event.target as HTMLElement).closest('[data-widget]')
    // `getAttribute` returns `string | null`, never `undefined` — so one check, not two.
    const id = (target?.getAttribute('data-widget') ?? null) as NodeId | null
    if (id === null) {
      store.setEphemeral({ selected: [] })
      return
    }

    const start = cellFrom(event.clientX, event.clientY)
    if (start === null) return

    const rect = rectOfNode(state.document.nodes[id]?.props ?? {})
    const grab = { col: start.col - rect.x, row: start.row - rect.y }
    store.setEphemeral({ selected: [id] })

    const move = (pointer: PointerEvent) => {
      const cell = cellFrom(pointer.clientX, pointer.clientY)
      if (cell === null) return
      // Ephemeral only: a drag must not touch the document or fill history.
      store.setEphemeral({
        dragOffset: { x: Math.max(0, cell.col - grab.col), y: Math.max(0, cell.row - grab.row) },
      })
    }

    const finish = (pointer: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      store.setEphemeral({ dragOffset: null })

      const cell = cellFrom(pointer.clientX, pointer.clientY)
      if (cell === null) return

      const to = documentRect(
        Math.max(0, cell.col - grab.col),
        Math.max(0, cell.row - grab.row),
        rect.width,
        rect.height,
      )

      const moves = movesFor({ document: store.getState().document, preserved: { id: '', title: '', columns } }, id, to)
      // Nothing changed — a click that moved nothing must not consume an undo.
      if (moves.length === 0) return

      const actions: EditorAction[] = []
      for (const m of moves) {
        actions.push({ type: 'SetProperty', nodeId: m.id, key: 'x', value: m.rect.x })
        actions.push({ type: 'SetProperty', nodeId: m.id, key: 'y', value: m.rect.y })
      }
      // One gesture, one entry — even though it moved three widgets.
      store.dispatchBatch(actions, { label: 'move widget' })
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
  }

  const rows = widgetIds.reduce((max, id) => {
    const rect = rectOfNode(state.document.nodes[id]?.props ?? {})
    return Math.max(max, rect.y + rect.height)
  }, 4)

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
        <Button type="button" variant="secondary" size="sm" onPress={addWidget}>
          {labels.addWidget}
        </Button>
        <Button type="button" size="sm" isDisabled={isSaving} onPress={() => void onSave()}>
          {labels.save}
        </Button>
      </div>

      <div
        ref={grid}
        data-testid="dashboard-grid"
        onPointerDown={onPointerDown}
        style={{ height: rows * (ROW_HEIGHT + ROW_GAP) }}
        className="border-default bg-surface-sunken relative w-full touch-none rounded-xl border"
      >
        {widgetIds.length === 0 && <p className="text-muted p-6 text-sm">{labels.empty}</p>}
        {widgetIds.map((id) => (
          <WidgetView
            key={id}
            id={id}
            columns={columns}
            locale={locale}
            labels={labels}
            onRemove={() => {
              removeWidget(id)
            }}
          />
        ))}
      </div>
    </div>
  )
}

const WidgetView = ({
  id,
  columns,
  locale,
  labels,
  onRemove,
}: {
  id: NodeId
  columns: number
  locale: Locale
  labels: DashboardBuilderLabels
  onRemove: () => void
}) => {
  const node = useNode(id)
  const selected = useEphemeral((s) => s.selected.includes(id))
  const dragOffset = useEphemeral((s) => (s.selected.includes(id) ? s.dragOffset : null))

  if (node === null) return null

  const rect = rectOfNode(node.props)
  const x = dragOffset?.x ?? rect.x
  const y = dragOffset?.y ?? rect.y
  const text = (key: string) => (typeof node.props[key] === 'string' ? node.props[key] : '')
  const kind = text('contentKind')
  const label = kind === 'indicator' ? text('fallbackLabel') : (labels.content[kind] ?? kind)

  return (
    <div
      data-widget={id}
      data-testid={`widget-${id}`}
      style={{
        position: 'absolute',
        // Logical, not physical: column 0 is where the reader starts, which is the right-hand
        // edge in Persian. `left` would mirror every dashboard when the language changed.
        insetInlineStart: `${String((x / columns) * 100)}%`,
        top: y * (ROW_HEIGHT + ROW_GAP),
        width: `${String((rect.width / columns) * 100)}%`,
        height: rect.height * (ROW_HEIGHT + ROW_GAP) - ROW_GAP,
        padding: 4,
      }}
    >
      <Card className={selected ? 'border-brand-border h-full border-2' : 'h-full'}>
        <div className="flex items-start justify-between gap-2">
          <span className="text-primary text-sm font-medium">{label}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`${labels.removeWidget} ${label}`}
            onPress={onRemove}
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
