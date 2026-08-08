import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createDiContext } from './createDiContext'

interface Ports {
  greet: () => string
}

describe('createDiContext', () => {
  it('delivers the injected value to a consumer', () => {
    const { Provider, useDi } = createDiContext<Ports>('Test')
    const Consumer = () => <p>{useDi().greet()}</p>

    render(
      <Provider value={{ greet: () => 'injected' }}>
        <Consumer />
      </Provider>,
    )

    expect(screen.getByText('injected')).toBeInTheDocument()
  })

  it('throws a named error when read outside its provider', () => {
    // Without this, a missing provider yields undefined and fails somewhere
    // unrelated — usually as "cannot read property of undefined" inside a
    // query function, three files away from the actual mistake.
    const { useDi } = createDiContext<Ports>('Development')
    const Consumer = () => <p>{useDi().greet()}</p>

    const onError = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Consumer />)).toThrow(/Development ports were read outside/)
    onError.mockRestore()
  })

  it('gives each context its own independent value', () => {
    // The isolation that makes `no-cross-context` hold at runtime as well as at
    // lint time: one context cannot reach another's ports even by accident.
    const a = createDiContext<Ports>('A')
    const b = createDiContext<Ports>('B')

    const Consumer = () => (
      <>
        <p>{a.useDi().greet()}</p>
        <p>{b.useDi().greet()}</p>
      </>
    )

    render(
      <a.Provider value={{ greet: () => 'from-a' }}>
        <b.Provider value={{ greet: () => 'from-b' }}>
          <Consumer />
        </b.Provider>
      </a.Provider>,
    )

    expect(screen.getByText('from-a')).toBeInTheDocument()
    expect(screen.getByText('from-b')).toBeInTheDocument()
  })
})
