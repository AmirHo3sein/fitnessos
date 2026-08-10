'use client'

import { Button, Card } from '@fitnessos/ui'
import { formatPlainDate, newEntityId, type Locale } from '@fitnessos/kernel'
import type { EditorAction, NodeId } from '@fitnessos/editor-engine'
import {
  EditorStoreProvider,
  createEditorStore,
  useChildIds,
  useEditorStore,
  useEphemeral,
  useHistoryControls,
  useNode,
} from '@fitnessos/editor-react'
import { useMemo, useRef, useState } from 'react'
import {
  DAYS_PER_WEEK,
  firstFreeStart,
  placeSpan,
  resizeSpan,
  toPlainDate,
} from '../../topology/temporal'
import {
  PHASE_NODE,
  commit,
  hydrate,
  otherSpans,
  spanOfNode,
  type PlanSnapshot,
} from '../../editor/schema'

export interface TimelineBuilderLabels {
  readonly heading: string
  readonly addPhase: string
  readonly removePhase: string
  readonly undo: string
  readonly redo: string
  readonly save: string
  readonly phaseLabel: string
  readonly newPhaseLabel: string
  readonly empty: string
  readonly weeks: string
  /** Shown when a drag or resize is refused, because silence reads as a broken canvas. */
  readonly refused: string
  /** How to move and resize a phase without a pointer — see the note on `onKeyDown`. */
  readonly keyboardHint: string
  /** The accessible name of a focusable phase: "<label>, movable with the arrow keys". */
  readonly phaseMovable: string
}

export interface TimelineBuilderProps {
  plan: PlanSnapshot
  locale: Locale
  labels: TimelineBuilderLabels
  onSave: (plan: PlanSnapshot) => boolean | Promise<boolean>
  isSaving?: boolean
}

/** Pixels per day. A week is 84px, which is wide enough to label and narrow enough to see a year. */
const PX_PER_DAY = 12
/** Weeks always visible, so an empty plan is still a timeline rather than a line. */
const MIN_WEEKS = 16

export const TimelineBuilder = ({
  plan,
  locale,
  labels,
  onSave,
  isSaving = false,
}: TimelineBuilderProps) => {
  const store = useMemo(() => {
    const draft = hydrate(plan)
    return { editor: createEditorStore({ document: draft.document }), preserved: draft.preserved }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on identity, see the other builders
  }, [plan.id])

  return (
    <EditorStoreProvider value={store.editor}>
      <BuilderShell
        epoch={store.preserved.epoch}
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
  epoch,
  locale,
  labels,
  isSaving,
  onSave,
}: {
  epoch: PlanSnapshot['epoch']
  locale: Locale
  labels: TimelineBuilderLabels
  isSaving: boolean
  onSave: () => Promise<void>
}) => {
  const store = useEditorStore()
  const phaseIds = useChildIds(null)
  const history = useHistoryControls()
  const track = useRef<HTMLDivElement>(null)
  const [refused, setRefused] = useState(false)

  const state = store.getState()
  const preserved = { id: '', title: '', epoch }
  const draft = { document: state.document, preserved }

  /**
   * Pointer position as a day offset, measured from the track's inline START.
   *
   * Later time is FURTHER ALONG THE READING DIRECTION — to the left in Persian. A timeline that
   * ran left-to-right in an RTL layout would put the future behind the past, which is not a
   * styling preference: it inverts the only axis the screen has.
   */
  const dayAt = (clientX: number): number | null => {
    const box = track.current?.getBoundingClientRect()
    if (box === undefined) return null
    const rtl = getComputedStyle(track.current as Element).direction === 'rtl'
    return (rtl ? box.right - clientX : clientX - box.left) / PX_PER_DAY
  }

  /** A refusal has to be visible: a phase that snaps back with no explanation reads as a bug. */
  const refuse = () => {
    setRefused(true)
    setTimeout(() => {
      setRefused(false)
    }, 1600)
  }

  const addPhase = () => {
    const id = newEntityId() as NodeId
    const others = phaseIds.map((other) => spanOfNode(state.document.nodes[other]?.props ?? {}))
    const length = 4 * DAYS_PER_WEEK

    store.dispatch(
      {
        type: 'InsertNode',
        node: {
          id,
          type: PHASE_NODE,
          props: {
            label: labels.newPhaseLabel,
            // Appended after the last phase, which is what a coach means by "add a phase" —
            // and `firstFreeStart` finds a gap instead if the plan is not contiguous.
            start: firstFreeStart(others, length),
            length,
            programId: '',
            servesGoal: '',
          },
        },
        parentId: null,
        index: phaseIds.length,
      },
      { label: 'add phase' },
    )
    store.setEphemeral({ selected: [id] })
  }

  const beginGesture = (event: React.PointerEvent, id: NodeId, mode: 'move' | 'resize') => {
    event.stopPropagation()
    const grabbedAt = dayAt(event.clientX)
    if (grabbedAt === null) return

    const span = spanOfNode(state.document.nodes[id]?.props ?? {})
    const offset = grabbedAt - span.start
    store.setEphemeral({ selected: [id] })

    const move = (pointer: PointerEvent) => {
      const day = dayAt(pointer.clientX)
      if (day === null) return
      const others = otherSpans(draft, id)
      // Previewed through the same topology functions that will decide the commit, so the phase
      // never shows the user a position the drop would refuse.
      const candidate =
        mode === 'move'
          ? placeSpan(span, others, day - offset)
          : resizeSpan(span, others, day)
      if (candidate !== null) store.setEphemeral({ dragOffset: { x: candidate.start, y: candidate.length } })
    }

    const finish = (pointer: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      store.setEphemeral({ dragOffset: null })

      const day = dayAt(pointer.clientX)
      if (day === null) return
      const others = otherSpans(draft, id)
      const placed =
        mode === 'move' ? placeSpan(span, others, day - offset) : resizeSpan(span, others, day)

      if (placed === null) {
        // Refused, not clamped. Time has no "below" to push a phase into, and moving a
        // neighbour to make room would reschedule training the athlete may already have done.
        refuse()
        return
      }
      if (placed.start === span.start && placed.length === span.length) return

      const actions: EditorAction[] = [
        { type: 'SetProperty', nodeId: id, key: 'start', value: placed.start },
        { type: 'SetProperty', nodeId: id, key: 'length', value: placed.length },
      ]
      // One gesture, one entry. Two `SetProperty` calls on one node coalesce anyway, but the
      // batch says the intent rather than relying on the window.
      store.dispatchBatch(actions, { label: mode === 'move' ? 'move phase' : 'resize phase' })
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
  }

  /**
   * A keyboard move or resize, in whole weeks, through the same two functions a drag uses.
   *
   * `placeSpan` and `resizeSpan` REFUSE rather than displace, so a press that would overlap a
   * neighbour changes nothing and says why — identical to a refused drop, because it is the same
   * rule being applied to a different input device.
   */
  const nudgePhase = (id: NodeId, weeks: number, mode: 'move' | 'resize') => {
    const draft = { document: store.getState().document, preserved }
    const node = store.getState().document.nodes[id]
    if (node === undefined) return

    const span = spanOfNode(node.props)
    const others = otherSpans(draft, id)
    const delta = weeks * DAYS_PER_WEEK
    const placed =
      mode === 'move'
        ? placeSpan(span, others, span.start + delta)
        : resizeSpan(span, others, span.start + span.length + delta)

    if (placed === null) {
      refuse()
      return
    }
    if (placed.start === span.start && placed.length === span.length) return

    store.setEphemeral({ selected: [id] })
    // Two dispatches rather than a batch, so a burst of presses coalesces into one undo — see the
    // note in the Report Builder's nudge. Move and resize carry different labels, so a run of moves
    // never merges with a run of resizes.
    const label = mode === 'move' ? 'nudge phase' : 'nudge phase length'
    store.dispatch({ type: 'SetProperty', nodeId: id, key: 'start', value: placed.start }, { label })
    store.dispatch({ type: 'SetProperty', nodeId: id, key: 'length', value: placed.length }, { label })
  }

  const weeks = Math.max(
    MIN_WEEKS,
    phaseIds.reduce((max, id) => {
      const span = spanOfNode(state.document.nodes[id]?.props ?? {})
      return Math.max(max, Math.ceil((span.start + span.length) / DAYS_PER_WEEK) + 2)
    }, 0),
  )

  return (
    <div className="space-y-4">
      {/*
        The heading is on its OWN row, not sharing a flex line with the controls.
        
        With `me-auto` pushing five buttons against a heading, a 412px screen wraps them into
        overlapping lines — Playwright reported the toolbar intercepting pointer events on its own
        button, which means a finger would miss it too. A phone-first product cannot have its
        editor controls arranged for a desktop and wrapped for everything else.
      */}
      <h2 className="text-display text-xl">{labels.heading}</h2>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" isDisabled={!history.canUndo} onPress={history.undo}>
          {labels.undo}
        </Button>
        <Button type="button" variant="secondary" size="sm" isDisabled={!history.canRedo} onPress={history.redo}>
          {labels.redo}
        </Button>
        <Button type="button" variant="secondary" size="sm" onPress={addPhase}>
          {labels.addPhase}
        </Button>
        <Button type="button" size="sm" isDisabled={isSaving} onPress={() => void onSave()}>
          {labels.save}
        </Button>
      </div>

      {/* `role="status"`, not `alert`: a refusal is information, and an assertive region would
          interrupt a screen-reader user mid-sentence for a phase that simply did not move. */}
      {refused && (
        <p role="status" className="text-warning-fg text-sm">
          {labels.refused}
        </p>
      )}

      {/*
        The scroll container is identified, because a test measuring the TRACK measures its full
        width — 1344px for sixteen weeks — most of which is outside a phone's viewport. Pointer
        coordinates derived from that land off-screen and get clamped by the browser, so a drag
        appears to work while going somewhere nobody asked for.
      */}
      {/*
        `min-w-0 max-w-full` alongside `overflow-x-auto`, and both are load-bearing.
        
        Without them the 1344px track propagated its width up through the layout and the PAGE
        scrolled horizontally — measured at a scrollX of -91 on a phone. A body that scrolls
        sideways is a defect in its own right: every other screen shifts under the reader, and
        `position: sticky` and hit-testing both stop agreeing with what is on screen.
        
        `overflow-x-auto` alone does not clip, because a block inside a sized parent still takes
        its content width unless it is told it may be narrower.
      */}
      <div data-testid="timeline-viewport" className="min-w-0 max-w-full overflow-x-auto">
        <div
          ref={track}
      /*
        `role="application"`, and it is load-bearing rather than decorative.
 
        This is a direct-manipulation surface: the objects inside are focusable and respond to the
        arrow keys, which is not something ARIA has a role for. `application` is the sanctioned way
        to say "the author owns the keyboard in here" — inside it a screen reader stops intercepting
        arrow keys for browse mode and passes them through, which is exactly what has to happen for
        a nudge to work at all.
 
        It is also why the items below need an eslint-disable: `jsx-a11y` models a `group` as
        non-interactive and objects to a key handler on one. The rule is right about a page and
        wrong about a canvas, and `application` is how the platform expresses the difference.
      */
          role="application"
          aria-label={labels.heading}
          data-testid="timeline-track"
          style={{ width: weeks * DAYS_PER_WEEK * PX_PER_DAY, height: 132 }}
          className="border-default bg-surface-sunken relative rounded-xl border"
        >
          {/* Week gridlines, so a span's length is readable without measuring it. */}
          {Array.from({ length: weeks + 1 }, (_, week) => (
            <div
              key={week}
              aria-hidden="true"
              className={week % 4 === 0 ? 'bg-strong absolute' : 'bg-subtle absolute'}
              style={{
                insetInlineStart: week * DAYS_PER_WEEK * PX_PER_DAY,
                top: 0,
                width: 1,
                height: '100%',
              }}
            />
          ))}

          {phaseIds.length === 0 && <p className="text-muted p-6 text-sm">{labels.empty}</p>}

          {phaseIds.map((id) => (
            <PhaseView
              key={id}
              id={id}
              epoch={epoch}
              locale={locale}
              labels={labels}
              onGesture={beginGesture}
              onKeys={nudgePhase}
              onRemove={() => {
                store.dispatch({ type: 'RemoveNode', nodeId: id }, { label: 'remove phase' })
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

const PhaseView = ({
  id,
  epoch,
  locale,
  labels,
  onGesture,
  onKeys,
  onRemove,
}: {
  id: NodeId
  epoch: PlanSnapshot['epoch']
  locale: Locale
  labels: TimelineBuilderLabels
  onGesture: (event: React.PointerEvent, id: NodeId, mode: 'move' | 'resize') => void
  onKeys: (id: NodeId, weeks: number, mode: 'move' | 'resize') => void
  onRemove: () => void
}) => {
  const node = useNode(id)
  const selected = useEphemeral((s) => s.selected.includes(id))
  // The ephemeral channel carries a SPAN here — `x` is the start day and `y` the length — because
  // a resize changes the extent, not a position. Reusing the field beats a second channel.
  const preview = useEphemeral((s) => (s.selected.includes(id) ? s.dragOffset : null))

  if (node === null) return null

  const span = spanOfNode(node.props)
  const start = preview?.x ?? span.start
  const length = preview?.y ?? span.length
  const label = typeof node.props['label'] === 'string' ? node.props['label'] : ''
  const nf = new Intl.NumberFormat(locale)

  /**
   * Arrow keys move a phase; Shift+arrows resize it. In WEEKS.
   *
   * A week rather than a day, because a week is the unit this editor snaps to — a coach dragging a
   * boundary is choosing which week a block starts in, not which Tuesday. A per-day keyboard step
   * would let the keyboard author positions the pointer cannot, which is the same drift in the
   * opposite direction from a keyboard that cannot author at all.
   *
   * Direction is logical: later time runs ALONG the reading direction, so in Persian `ArrowLeft`
   * moves a phase later. Mapping arrows physically would make the keyboard disagree with the track.
   *
   * Refusal is unchanged and shared: `placeSpan` and `resizeSpan` refuse rather than displace, and a
   * refused key press says so in the same message a refused drag does.
   */
  const onKeyDown = (event: React.KeyboardEvent) => {
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl'
    const later = rtl ? -1 : 1
    const weeks =
      event.key === 'ArrowLeft' ? -later : event.key === 'ArrowRight' ? later : 0
    if (weeks === 0) return
    event.preventDefault()
    onKeys(id, weeks, event.shiftKey ? 'resize' : 'move')
  }

  return (
    /*
      Inside `role="application"` — see the canvas container for why `jsx-a11y`'s model of a
      non-interactive element does not fit a direct-manipulation surface.
    */
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      data-testid={`phase-${id}`}
      data-start={start}
      data-length={length}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      role="group"
      aria-label={`${label} — ${labels.phaseMovable}`}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        onGesture(event, id, 'move')
      }}
      style={{
        position: 'absolute',
        // Logical: later time runs along the reading direction, which is leftward in Persian.
        insetInlineStart: start * PX_PER_DAY,
        top: 12,
        width: length * PX_PER_DAY,
        height: 108,
        padding: 2,
      }}
    >
      <Card className={selected ? 'border-brand-border h-full border-2' : 'h-full'}>
        <div className="flex items-start justify-between gap-1">
          <span className="text-primary truncate text-sm font-medium">{label}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`${labels.removePhase} ${label}`}
            onPress={onRemove}
          >
            ✕
          </Button>
        </div>
        <p className="text-muted mt-1 text-xs">
          <span className="nums">{nf.format(length / DAYS_PER_WEEK)}</span> {labels.weeks}
        </p>
        <p className="text-muted truncate text-xs">{formatPlainDate(toPlainDate(epoch, start), locale)}</p>
      </Card>

      {/*
        The resize handle sits at the inline END — the later edge, which is the left one in
        Persian. `insetInlineEnd` keeps it on the correct side without the component knowing which
        side that is.
      */}
      <div
        data-testid={`resize-${id}`}
        aria-hidden="true"
        onPointerDown={(event) => {
          onGesture(event, id, 'resize')
        }}
        className="bg-brand-border absolute top-3 h-[100px] w-1.5 cursor-col-resize rounded"
        style={{ insetInlineEnd: 0 }}
      />
    </div>
  )
}
