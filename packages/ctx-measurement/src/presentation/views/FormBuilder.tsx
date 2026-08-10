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
import { FIELD_NODE, commit, hydrate, type FormSnapshot } from '../../editor/schema'

export interface FormBuilderLabels {
  readonly heading: string
  readonly addField: string
  readonly removeField: string
  readonly undo: string
  readonly redo: string
  readonly save: string
  readonly fieldLabel: string
  readonly records: string
  readonly unit: string
  readonly answerKind: Readonly<Record<string, string>>
  readonly newFieldLabel: string
  readonly empty: string
}

export interface FormBuilderProps {
  form: FormSnapshot
  locale: Locale
  labels: FormBuilderLabels
  onSave: (form: FormSnapshot) => boolean | Promise<boolean>
  isSaving?: boolean
}

/**
 * The Form Builder — the SECOND consumer of `editor-engine`.
 *
 * Its job is partly to author check-in forms and partly to answer the question the engine was
 * extracted to answer: does the API hold up when something other than the Program Builder uses
 * it? The result is recorded in `editor/schema.ts` — the engine needed no change — and this file
 * is the other half of that evidence: the bindings, the history controls and the store lifecycle
 * are used here exactly as they are there, with no escape hatches.
 *
 * Where it differs from the Program Builder is what a node's props MEAN, not how any of this
 * works. That is the property `props: Record<string, unknown>` exists to provide.
 */
export const FormBuilder = ({
  form,
  locale,
  labels,
  onSave,
  isSaving = false,
}: FormBuilderProps) => {
  // Created ONCE per form, keyed on identity. A store rebuilt on render throws away the undo
  // history on every keystroke: the editor appears to work and undo silently does nothing.
  const store = useMemo(() => {
    const draft = hydrate(form)
    return { editor: createEditorStore({ document: draft.document }), preserved: draft.preserved }
    // Keyed on identity, not contents: a refetch producing an equal-but-new object must not
    // discard the coach's in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [form.id])

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
          // The commit boundary moves only once the save LANDED (D-01). Moving it on the button
          // press would leave a coach whose save failed unable to reverse the edits it refused.
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
  labels: FormBuilderLabels
  isSaving: boolean
  onSave: () => Promise<void>
}) => {
  const store = useEditorStore()
  const fieldIds = useChildIds(null)
  const history = useHistoryControls()

  const addField = () => {
    const id = newEntityId() as NodeId
    store.dispatch(
      {
        type: 'InsertNode',
        node: {
          id,
          type: FIELD_NODE,
          props: {
            label: labels.newFieldLabel,
            records: '',
            unit: '',
            answerKind: 'number',
            scaleMin: 1,
            scaleMax: 5,
            options: [],
          },
        },
        parentId: null,
        index: fieldIds.length,
      },
      { label: 'add field' },
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

      {fieldIds.length === 0 ? (
        <Card>
          <p className="text-muted text-sm">{labels.empty}</p>
        </Card>
      ) : (
        <ol className="space-y-3">
          {fieldIds.map((id, index) => (
            <FieldRow key={id} id={id} index={index} locale={locale} labels={labels} />
          ))}
        </ol>
      )}

      <Button type="button" variant="secondary" className="w-full" onPress={addField}>
        {labels.addField}
      </Button>
    </div>
  )
}

/** One field. Subscribes to its OWN node only, so editing one re-renders one row. */
const FieldRow = ({
  id,
  index,
  locale,
  labels,
}: {
  id: NodeId
  index: number
  locale: Locale
  labels: FormBuilderLabels
}) => {
  const store = useEditorStore()
  const node = useNode(id)
  const isSelected = useIsSelected(id)
  const [draft, setDraft] = useState<Record<string, string> | null>(null)

  if (node === null) return null

  const text = (key: string) => (typeof node.props[key] === 'string' ? node.props[key] : '')
  const value = (key: string) => draft?.[key] ?? text(key)
  const kind = text('answerKind') === '' ? 'number' : text('answerKind')
  const nf = new Intl.NumberFormat(locale)

  const setProp = (key: string, next: string) => {
    setDraft((current) => ({ ...current, [key]: next }))
    // Dispatched per keystroke and coalesced by the history engine into ONE undo entry — a coach
    // typing a question means one change, not thirty.
    store.dispatch({ type: 'SetProperty', nodeId: id, key, value: next }, { label: `edit ${key}` })
  }

  const field = (key: string, label: string) => (
    <div className="flex-1">
      <label className="text-muted block text-xs" htmlFor={`${id}-${key}`}>
        {label}
      </label>
      <input
        id={`${id}-${key}`}
        value={value(key)}
        onFocus={() => {
          store.setEphemeral({ selected: [id] })
        }}
        onChange={(event) => {
          setProp(key, event.target.value)
        }}
        onBlur={() => {
          setDraft(null)
        }}
        className="border-default bg-surface-elevated text-primary focus:border-brand-border mt-1 h-10 w-full rounded-md border px-3"
      />
    </div>
  )

  return (
    <li>
      <Card {...(isSelected ? { className: 'border-brand-border border-2' } : {})}>
        <div className="flex items-start gap-2">
          <span className="text-muted nums mt-6 w-6 shrink-0 text-xs">{nf.format(index + 1)}</span>
          {field('label', labels.fieldLabel)}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-6"
            aria-label={`${labels.removeField} ${text('label')}`}
            onPress={() => {
              store.dispatch({ type: 'RemoveNode', nodeId: id }, { label: 'remove field' })
            }}
          >
            ✕
          </Button>
        </div>

        {/*
          `records` and `unit` are required by the aggregate, so they are first-class inputs
          rather than an "advanced" panel. A field that records nothing is the one thing a check-in
          form must not contain — it would be a survey question, and this product does not need a
          survey tool.
        */}
        <div className="mt-3 flex gap-2">
          {field('records', labels.records)}
          {field('unit', labels.unit)}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {(['number', 'scale', 'choice'] as const).map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={kind === option ? 'primary' : 'secondary'}
              aria-pressed={kind === option}
              onPress={() => {
                store.dispatch(
                  { type: 'SetProperty', nodeId: id, key: 'answerKind', value: option },
                  { label: 'change answer shape' },
                )
              }}
            >
              {labels.answerKind[option] ?? option}
            </Button>
          ))}
        </div>
      </Card>
    </li>
  )
}
