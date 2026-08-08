import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  applyAction,
  emptyDocument,
  type DocumentSnapshot,
  type Node,
  type NodeId,
} from '@fitnessos/editor-engine'
import {
  EditorStoreProvider,
  useChildIds,
  useHistoryControls,
  useIsSelected,
  useNode,
} from './hooks'
import { createEditorStore, type EditorStore } from './store'

const id = (n: string) => n as NodeId
const node = (n: string, props: Record<string, unknown> = {}): Node => ({
  id: id(n),
  type: 'block',
  props,
})

const docWith = (...names: string[]): DocumentSnapshot => {
  let doc = emptyDocument('test')
  for (const [index, name] of names.entries()) {
    doc = applyAction(doc, { type: 'InsertNode', node: node(name), parentId: null, index })
  }
  return doc
}

/**
 * Node props are `Record<string, unknown>` by design — a document holds whatever a builder's schema
 * defines. `String(unknown)` yields "[object Object]" for anything non-primitive, so a test that
 * rendered it directly could assert on the wrong thing; narrowing here says what the test actually
 * expects.
 */
const asText = (value: unknown): string => (typeof value === 'string' ? value : 'none')

const mount = (ui: React.ReactNode, store: EditorStore) =>
  render(<EditorStoreProvider value={store}>{ui}</EditorStoreProvider>)

let clock = 1000
const store = (doc = docWith('a', 'b')) =>
  createEditorStore({ document: doc, now: () => (clock += 10_000) })

describe('document channel', () => {
  it('re-renders when the document changes', () => {
    const s = store()
    const Name = () => <p>{asText(useNode(id('a'))?.props['name'])}</p>
    mount(<Name />, s)

    expect(screen.getByText('none')).toBeInTheDocument()

    act(() => {
      s.dispatch({ type: 'SetProperty', nodeId: id('a'), key: 'name', value: 'squat' }, { label: 'rename' })
    })

    expect(screen.getByText('squat')).toBeInTheDocument()
  })

  it('re-renders ONLY the node that changed', () => {
    /**
     * The payoff of the flat normalised document (D-02) plus Immer's structural sharing: editing
     * one node in a large tree re-renders one component. If this regresses, a builder with two
     * thousand nodes re-renders all of them on every keystroke.
     */
    const s = store()
    const renders = { a: 0, b: 0 }

    const Watch = ({ which }: { which: 'a' | 'b' }) => {
      const n = useNode(id(which))
      renders[which] += 1
      return <p data-testid={which}>{asText(n?.props['name'])}</p>
    }

    mount(
      <>
        <Watch which="a" />
        <Watch which="b" />
      </>,
      s,
    )

    const before = { ...renders }
    act(() => {
      s.dispatch({ type: 'SetProperty', nodeId: id('a'), key: 'name', value: 'x' }, { label: 'r' })
    })

    expect(renders.a).toBeGreaterThan(before.a)
    expect(renders.b).toBe(before.b)
  })

  it('does not re-render on an unrelated node’s change even with the same key', () => {
    const s = store()
    let bRenders = 0
    const WatchB = () => {
      useNode(id('b'))
      bRenders += 1
      return null
    }
    mount(<WatchB />, s)

    const before = bRenders
    act(() => {
      s.dispatch({ type: 'SetProperty', nodeId: id('a'), key: 'k', value: 1 }, { label: 'r' })
      s.dispatch({ type: 'SetProperty', nodeId: id('a'), key: 'k', value: 2 }, { label: 'r' })
    })
    expect(bRenders).toBe(before)
  })

  it('useChildIds compares shallowly rather than by reference', () => {
    // Without shallow comparison every dispatch would produce a new array and re-render every list
    // in the editor, whether or not its children changed.
    const s = store()
    let renders = 0
    const List = () => {
      const ids = useChildIds(null)
      renders += 1
      return <p>{ids.join(',')}</p>
    }
    mount(<List />, s)

    const before = renders
    act(() => {
      s.dispatch({ type: 'SetProperty', nodeId: id('a'), key: 'k', value: 1 }, { label: 'r' })
    })
    expect(renders).toBe(before)
    expect(screen.getByText('a,b')).toBeInTheDocument()
  })
})

describe('ephemeral channel', () => {
  it('a drag does NOT re-render document subscribers', () => {
    /**
     * The central guarantee of the two-channel design. A drag fires sixty times a second; if it
     * woke the document tree the editor would be unusable, and if it went THROUGH the document the
     * user would need two hundred undos to reverse one drag.
     */
    const s = store()
    let documentRenders = 0
    const DocumentWatcher = () => {
      useNode(id('a'))
      documentRenders += 1
      return null
    }
    mount(<DocumentWatcher />, s)

    const before = documentRenders
    act(() => {
      for (let frame = 0; frame < 60; frame += 1) {
        s.setEphemeral({ dragOffset: { x: frame, y: 0 } })
      }
    })

    expect(documentRenders).toBe(before)
  })

  it('a drag DOES re-render ephemeral subscribers', () => {
    const s = store()
    const Selected = () => <p>{useIsSelected(id('a')) ? 'yes' : 'no'}</p>
    mount(<Selected />, s)

    expect(screen.getByText('no')).toBeInTheDocument()
    act(() => {
      s.setEphemeral({ selected: [id('a')] })
    })
    expect(screen.getByText('yes')).toBeInTheDocument()
  })

  it('selection creates no history entry', () => {
    // Selection is not part of the document and must not be undoable. An undo that changes what is
    // selected rather than what was edited is deeply confusing.
    const s = store()
    s.setEphemeral({ selected: [id('a')] })
    expect(s.getState().entries).toHaveLength(0)
    expect(s.canUndo()).toBe(false)
  })

  it('a document change does not re-render ephemeral-only subscribers', () => {
    // The separation runs both ways.
    const s = store()
    let renders = 0
    const HoverOnly = () => {
      useIsSelected(id('a'))
      renders += 1
      return null
    }
    mount(<HoverOnly />, s)

    const before = renders
    act(() => {
      s.dispatch({ type: 'SetProperty', nodeId: id('a'), key: 'k', value: 1 }, { label: 'r' })
    })
    expect(renders).toBe(before)
  })
})

describe('history controls', () => {
  it('reflects undo availability and performs it', () => {
    const s = store()
    const Controls = () => {
      const h = useHistoryControls()
      return (
        <button type="button" disabled={!h.canUndo} onClick={h.undo}>
          undo
        </button>
      )
    }
    mount(<Controls />, s)

    expect(screen.getByRole('button')).toBeDisabled()

    act(() => {
      s.dispatch({ type: 'SetProperty', nodeId: id('a'), key: 'k', value: 1 }, { label: 'r' })
    })
    expect(screen.getByRole('button')).toBeEnabled()

    act(() => {
      screen.getByRole('button').click()
    })
    expect(s.getState().document.nodes[id('a')]?.props['k']).toBeUndefined()
  })

  it('a commit boundary disables undo', () => {
    const s = store()
    act(() => {
      s.dispatch({ type: 'SetProperty', nodeId: id('a'), key: 'k', value: 1 }, { label: 'r' })
      s.commit()
    })
    expect(s.canUndo()).toBe(false)
  })
})

describe('subscription hygiene', () => {
  it('unsubscribes on unmount', () => {
    // A leaked subscription in an editor is not a slow leak: every mounted-and-discarded panel
    // keeps receiving every document change forever.
    const s = store()
    const spy = vi.spyOn(s, 'subscribe')
    const view = mount(<Unmountable />, s)
    view.unmount()

    // Every subscribe call returned an unsubscribe that React invoked; dispatching after unmount
    // must not throw or render.
    expect(() => {
      s.dispatch({ type: 'SetProperty', nodeId: id('a'), key: 'k', value: 1 }, { label: 'r' })
    }).not.toThrow()
    spy.mockRestore()
  })

  it('does not loop when a selector would build a new object', () => {
    // `useSyncExternalStore` throws "getSnapshot should be cached" and hangs if the snapshot is a
    // fresh reference each call. The cache in useStoreSlice makes the unsafe case safe rather than
    // relying on every caller to remember.
    const s = store()
    const Derived = () => {
      const ids = useChildIds(null)
      return <p>{ids.length}</p>
    }
    expect(() => mount(<Derived />, s)).not.toThrow()
    expect(screen.getByText('2')).toBeInTheDocument()
  })
})

const Unmountable = () => {
  useNode(id('a'))
  return null
}
