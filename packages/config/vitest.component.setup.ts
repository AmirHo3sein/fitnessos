import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

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
