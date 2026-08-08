import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

/**
 * Tell React it is in a test environment.
 *
 * Without this, `act()` warns and does not properly flush updates — so a test that asserts on
 * post-update state can pass because the assertion happened to run after a microtask, and fail on
 * a different machine. Testing Library sets it internally for its own helpers, but a direct
 * `act()` call (which the editor store tests need, since they update the store outside React)
 * relies on the global.
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  cleanup()
})

/**
 * `matchMedia` does not exist in jsdom, and React Aria queries it during mount
 * to decide pointer/hover behaviour. Without this stub, every component test
 * that touches a React Aria primitive throws before it renders.
 *
 * Deliberately reports "no match" for everything: no hover, no reduced motion,
 * no forced colours. That is the one configuration a test can rely on, since
 * jsdom cannot actually evaluate a media query. A test that needs a specific
 * media state must override this explicitly so the dependency is visible.
 */
Object.defineProperty(globalThis, 'matchMedia', {
  writable: true,
  value: (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList,
})
