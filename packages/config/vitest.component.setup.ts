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

/**
 * `ResizeObserver` does not exist in jsdom either, and React Flow constructs one to measure its
 * container before it will render anything at all.
 *
 * The stub NEVER fires. That is not laziness, it is the honest thing: jsdom has no layout, so any
 * size it reported would be invented, and a canvas that believed an invented size is exactly how a
 * geometry assertion passes in a test and fails in a browser. React Flow consequently renders with
 * a zero-sized viewport here — which is fine for what this tier tests (does the component mount,
 * does an event translate into the right action) and useless for anything about position, which is
 * why the Workflow Builder's geometry lives in Playwright.
 */
Object.defineProperty(globalThis, 'ResizeObserver', {
  writable: true,
  value: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
})

/**
 * `DOMMatrixReadOnly`, for the same reason — React Flow parses its container's CSS transform
 * through it to derive the viewport's zoom.
 *
 * Reports the identity transform: no pan, no zoom. A test asserting on a transformed viewport would
 * be asserting about a number this stub made up.
 */
Object.defineProperty(globalThis, 'DOMMatrixReadOnly', {
  writable: true,
  value: class {
    readonly m22 = 1
    constructor(_transform?: string) {}
  },
})
