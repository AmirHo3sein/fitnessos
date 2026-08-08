'use client'

import { Button, Card } from '@fitnessos/ui'
import { newEntityId, type Locale } from '@fitnessos/kernel'
import type { NodeId } from '@fitnessos/editor-engine'
import {
  EditorStoreProvider,
  createEditorStore,
  useChildIds,
  useEditorStore,
  useHistoryControls,
  useIsSelected,
  useNode,
} from '@fitnessos/editor-react'
import { useMemo, useState } from 'react'
import type { ProgramVersionSnapshot } from '../../application/index'
import { BLOCK_NODE, commit, hydrate } from '../../editor/schema'

export interface BuilderLabels {
  readonly heading: string
  readonly addBlock: string
  readonly removeBlock: string
  readonly undo: string
  readonly redo: string
  readonly save: string
  readonly blockName: string
  readonly progression: Readonly<Record<string, string>>
  readonly rate: string
  readonly newBlockName: string
  readonly empty: string
}

export interface ProgramBuilderProps {
  version: ProgramVersionSnapshot
  locale: Locale
  labels: BuilderLabels
  /**
   * Persist the version, and report whether it landed.
   *
   * The return value is what moves the commit boundary, so it is not optional politeness: a
   * builder that assumed success would block undo past a save that failed, stranding the coach
   * with edits they can neither retry nor reverse.
   */
  onSave: (version: ProgramVersionSnapshot) => boolean | Promise<boolean>
  isSaving?: boolean
}

/**
 * The Program Builder — the first real consumer of the editor engine.
 *
 * Its job here is as much to VALIDATE the engine's API as to edit programmes: five more builders
 * will depend on these bindings, and the cheapest moment to find that the API is wrong is with one
 * consumer rather than six.
 *
 * Note what this component does NOT do. It never touches the document directly, never computes a
 * block's order, and never manages undo state — those are `dispatch`, `rootIds` position, and
 * `useHistoryControls`. A builder that reached past the store for any of them would be a builder
 * whose undo is subtly wrong.
 */
export const ProgramBuilder = ({
  version,
  locale,
  labels,
  onSave,
  isSaving = false,
}: ProgramBuilderProps) => {
  /*
   * The store is created ONCE per programme version, in `useMemo`, not rebuilt on render.
   *
   * A store rebuilt on every render throws away the undo history on every keystroke — the editor
   * appears to work and undo silently does nothing, which is the kind of bug that survives review
   * because nobody undoes during a demo.
   *
   * Keyed on `version.id`, so opening a different version genuinely starts a new editing session
   * with its own history rather than inheriting the previous programme's.
   */
  const store = useMemo(() => {
    const draft = hydrate(version)
    return { editor: createEditorStore({ document: draft.document }), preserved: draft.preserved }
    // Keyed on identity, not contents: a refetch producing an equal-but-new object must not
    // discard the coach's in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [version.id])

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
          // The commit boundary is pushed only once the save LANDED (D-01). Pushing it on the
          // button press instead would be the worse bug of the two available: undoing past it
          // would put the document in a state the server has never seen, and a failed save would
          // leave the coach unable to reverse the edits it refused.
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
  labels: BuilderLabels
  isSaving: boolean
  onSave: () => Promise<void>
}) => {
  const store = useEditorStore()
  const blockIds = useChildIds(null)
  const history = useHistoryControls()

  const addBlock = () => {
    const id = newEntityId() as NodeId
    store.dispatch(
      {
        type: 'InsertNode',
        node: {
          id,
          type: BLOCK_NODE,
          props: { name: labels.newBlockName, progressionKind: 'fixed', ratePercent: null },
        },
        parentId: null,
        index: blockIds.length,
      },
      { label: 'add block' },
    )
    store.setEphemeral({ selected: [id] })
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
        <Button
          type="button"
          size="sm"
          isDisabled={isSaving}
          onPress={() => {
            void onSave()
          }}
        >
          {labels.save}
        </Button>
      </div>

      {blockIds.length === 0 ? (
        <Card>
          <p className="text-muted text-sm">{labels.empty}</p>
        </Card>
      ) : (
        <ol className="space-y-3">
          {blockIds.map((id, index) => (
            <BlockRow key={id} id={id} index={index} locale={locale} labels={labels} />
          ))}
        </ol>
      )}

      <Button type="button" variant="secondary" className="w-full" onPress={addBlock}>
        {labels.addBlock}
      </Button>
    </div>
  )
}

/**
 * One block.
 *
 * Subscribes to its OWN node only, so editing one block in a long programme re-renders one row —
 * the property `useNode` exists to provide, and the reason the document is flat and normalised.
 */
const BlockRow = ({
  id,
  index,
  locale,
  labels,
}: {
  id: NodeId
  index: number
  locale: Locale
  labels: BuilderLabels
}) => {
  const store = useEditorStore()
  const node = useNode(id)
  const isSelected = useIsSelected(id)
  const [nameDraft, setNameDraft] = useState<string | null>(null)

  if (node === null) return null

  const name = typeof node.props['name'] === 'string' ? node.props['name'] : ''
  const kind = typeof node.props['progressionKind'] === 'string' ? node.props['progressionKind'] : 'fixed'
  const nf = new Intl.NumberFormat(locale)

  return (
    <li>
      {/*
        Spread rather than `className={cond ? x : undefined}`. Under
        `exactOptionalPropertyTypes` an explicit `undefined` is not the same as an absent prop, and
        the conditional form does not typecheck against an optional string.
      */}
      <Card {...(isSelected ? { className: 'border-brand-border border-2' } : {})}>
        <div className="flex items-center gap-2">
          <span className="text-muted nums w-6 shrink-0 text-xs">{nf.format(index + 1)}</span>

          <label className="sr-only" htmlFor={`${id}-name`}>
            {labels.blockName}
          </label>
          <input
            id={`${id}-name`}
            value={nameDraft ?? name}
            onFocus={() => {
              store.setEphemeral({ selected: [id] })
            }}
            onChange={(event) => {
              setNameDraft(event.target.value)
              // Dispatched per keystroke, and coalesced by the history engine into ONE undo entry
              // — a user typing "Accumulation" means one change, not twelve. The local draft state
              // exists only so the input stays responsive if a dispatch is ever made async.
              store.dispatch(
                { type: 'SetProperty', nodeId: id, key: 'name', value: event.target.value },
                { label: 'rename block' },
              )
            }}
            onBlur={() => {
              setNameDraft(null)
            }}
            className="border-default bg-surface-elevated text-primary focus:border-brand-border h-10 w-full rounded-md border px-3"
          />

          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`${labels.removeBlock} ${name}`}
            onPress={() => {
              store.dispatch({ type: 'RemoveNode', nodeId: id }, { label: 'remove block' })
            }}
          >
            ✕
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {(['fixed', 'linear', 'autoregulated'] as const).map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={kind === option ? 'primary' : 'secondary'}
              aria-pressed={kind === option}
              onPress={() => {
                store.dispatch(
                  { type: 'SetProperty', nodeId: id, key: 'progressionKind', value: option },
                  { label: 'change progression' },
                )
                // Changing away from `linear` clears the rate in the same gesture. Leaving a stale
                // rate on a fixed block would read as meaningful to whoever opens the programme
                // next, and the domain constructor would reject it on save — a validation error
                // for something the user never typed.
                store.dispatch(
                  {
                    type: 'SetProperty',
                    nodeId: id,
                    key: 'ratePercent',
                    value: option === 'linear' ? 2.5 : null,
                  },
                  { label: 'change progression' },
                )
              }}
            >
              {labels.progression[option] ?? option}
            </Button>
          ))}
        </div>
      </Card>
    </li>
  )
}
