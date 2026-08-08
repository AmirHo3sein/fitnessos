/**
 * Locale — the supported set and its writing direction.
 *
 * fa is the default and is RTL. ar is declared in the vision but not implemented;
 * adding it is appending to LOCALES and RTL_LOCALES plus a message catalogue.
 */

export const LOCALES = ['fa', 'en'] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'fa'

const RTL_LOCALES: readonly Locale[] = ['fa']

export const isRtl = (locale: Locale): boolean => RTL_LOCALES.includes(locale)

export const isLocale = (value: string): value is Locale =>
  (LOCALES as readonly string[]).includes(value)

export const direction = (locale: Locale): 'rtl' | 'ltr' => (isRtl(locale) ? 'rtl' : 'ltr')

/**
 * Text carried in multiple locales. Reference data uses this; user-authored
 * content does not (it has one locale, recorded on the record itself).
 */
export type LocalizedText = Readonly<Record<Locale, string>>

export const localized = (text: LocalizedText, locale: Locale): string => text[locale]
