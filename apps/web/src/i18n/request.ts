import { getRequestConfig } from 'next-intl/server'
import { hasLocale } from 'next-intl'
import { routing } from './routing'

/**
 * A dynamic `import()` of JSON is typed `any`, so its `.default` cannot be read
 * without tripping `no-unsafe-member-access`. Narrowing it here once, with a real
 * runtime check, is better than asserting the shape at the call site — a missing or
 * malformed message file should fail loudly at startup rather than surface as
 * `undefined` translations on a page somewhere.
 */
type Messages = Record<string, unknown>

const loadMessages = async (locale: string): Promise<Messages> => {
  const mod: unknown = await import(`../../messages/${locale}.json`)
  if (typeof mod !== 'object' || mod === null || !('default' in mod)) {
    throw new Error(`messages/${locale}.json did not resolve to a module with a default export`)
  }
  const { default: messages } = mod
  if (typeof messages !== 'object' || messages === null) {
    throw new Error(`messages/${locale}.json is not an object`)
  }
  return messages as Messages
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale

  return {
    locale,
    messages: await loadMessages(locale),
    // Explicit rather than inherited from the runtime. Without this the server
    // formats in the container's timezone and the browser in the user's, and the
    // two disagree on which day a session happened — a hydration mismatch that
    // silently resolves in the client's favour, so it never shows up as an error.
    timeZone: 'Asia/Tehran',
  }
})
