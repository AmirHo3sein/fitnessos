import { setRequestLocale } from 'next-intl/server'

/**
 * Opts a server-rendered segment into static rendering with a known locale.
 *
 * This exists to hold a single deprecation in a single place. next-intl 4.13
 * marks `setRequestLocale` deprecated in favour of `next/root-params` — which is a
 * Next 16 API and does not exist on Next 15. So the replacement is unavailable, and
 * removing the call is not free either: without it, every page that reads a
 * translation opts into dynamic rendering, and the public routes stop being
 * prerendered.
 *
 * Five call sites with five `eslint-disable` comments would be five places to
 * forget. One wrapper is one edit when Next 16 lands.
 *
 * REMOVE WHEN: the app is on Next 16 and `next/root-params` is available. Delete
 * this file, delete the disable, and replace the call sites with `rootParams()`.
 */
export const enableStaticRendering = (locale: string): void => {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- see above; the replacement requires Next 16
  setRequestLocale(locale)
}
