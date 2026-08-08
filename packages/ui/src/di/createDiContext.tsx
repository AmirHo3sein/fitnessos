'use client'

import { createContext, useContext, type ReactNode } from 'react'

/**
 * Dependency-injection factory.
 *
 * Handbook §2.2 (B1): the container is assembled in `apps/web/composition` and
 * arrives as a prop. Presentation must never construct or import infra
 * (`no-presentation-to-infra`).
 *
 * That creates a puzzle — presentation needs to *read* the container, but the
 * container can only be *built* where infra is visible, which is the app. If
 * presentation imported a hook from the app, the dependency would run backwards.
 *
 * The resolution is that each context creates its own typed DI context for its
 * own ports, using this factory. The app mounts every provider with concrete
 * instances. Nothing points the wrong way, and no context can see another's ports.
 *
 * Two rules this enforces by construction:
 *   - the value is a STABLE reference, never mutable state. Mutable state in
 *     Context re-renders the whole subtree on every change.
 *   - a missing provider throws immediately rather than yielding undefined and
 *     failing somewhere unrelated.
 */
export interface DiContext<T> {
  Provider: (props: { value: T; children: ReactNode }) => ReactNode
  useDi: () => T
}

export const createDiContext = <T,>(name: string): DiContext<T> => {
  const Context = createContext<T | null>(null)
  Context.displayName = `${name}Di`

  const Provider = ({ value, children }: { value: T; children: ReactNode }) => (
    <Context.Provider value={value}>{children}</Context.Provider>
  )

  const useDi = (): T => {
    const value = useContext(Context)
    if (value === null) {
      throw new Error(
        `${name} ports were read outside their provider. Mount <${name}Provider> in apps/web/composition.`,
      )
    }
    return value
  }

  return { Provider, useDi }
}
