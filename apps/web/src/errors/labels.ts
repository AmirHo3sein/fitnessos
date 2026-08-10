import type { ErrorPanelLabels } from './ErrorPanel'

/**
 * The error boundary's own strings, held here rather than in the message catalogue.
 *
 * ## Why not `useTranslations`
 *
 * That was the first implementation and it cost 11 kB gzipped on **every route**. An error
 * boundary is a client component that receives no props, so reading a translation means
 * `useTranslations`, which means `NextIntlClientProvider` serialises the whole catalogue into
 * every client bundle — undoing the pattern the rest of this app follows deliberately, where
 * server components resolve labels and pass them down as plain strings. Six route budgets failed
 * at once, which is exactly what those budgets are for.
 *
 * There is a second and better reason. This code renders because something already broke, and
 * the less it depends on, the more often it can actually run. The i18n runtime is part of the
 * app that might be what failed. `global-error.tsx` takes the same position for the same reason
 * and goes further, because by then even this module may not be reachable.
 *
 * ## The cost
 *
 * These five strings are outside the translator's catalogue. That is a real trade and it is
 * worth stating: five strings on a page nobody should see, against 11 kB on every page everyone
 * sees. If the set ever grows past a handful, the answer is not to move them back — it is to ask
 * why an error page needs a vocabulary.
 */
const LABELS: Record<'fa' | 'en', ErrorPanelLabels> = {
  fa: {
    title: 'مشکلی پیش آمد',
    body: 'این بخش از برنامه نمایش داده نشد. چیزی از آنچه ذخیره کرده‌اید آسیب ندیده است.',
    retry: 'تلاش دوباره',
    home: 'بازگشت به ابتدا',
    reference: 'کد پیگیری:',
  },
  en: {
    title: 'Something went wrong',
    body: 'This part of the app could not be shown. Nothing you have saved is affected.',
    retry: 'Try again',
    home: 'Back to the start',
    reference: 'Reference:',
  },
}

/**
 * The locale, from the path.
 *
 * Persian is served unprefixed and English under `/en`, so the first segment is the whole
 * question. Read from `location` rather than a route param because a boundary is not given one,
 * and defaulting to Persian is correct twice over: it is the product's primary language, and it
 * is what an unprefixed path means.
 */
export const errorLabelsFor = (pathname: string): ErrorPanelLabels =>
  pathname === '/en' || pathname.startsWith('/en/') ? LABELS.en : LABELS.fa
