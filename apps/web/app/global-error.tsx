'use client'

/**
 * The last resort: the root layout itself threw.
 *
 * This replaces the entire document, so it renders its own `<html>` and `<body>` — and it has
 * none of what every other component takes for granted. No locale, because `[locale]/layout.tsx`
 * is what failed. No translations, no fonts, no providers, and no certainty that the stylesheet
 * loaded at all.
 *
 * So it says the same thing twice, Persian first, in markup that means something with no CSS.
 * Anything cleverer than that is a second chance to throw on the page that exists to catch a
 * throw. There is deliberately no telemetry call here either: the sink is constructed from
 * module-level code that may be exactly what is broken.
 *
 * `dir="rtl"` and `lang="fa"` because Persian is the product's primary language and this page
 * cannot ask which one the reader wanted.
 */
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="fa" dir="rtl">
      <body>
        <main style={{ maxWidth: '32rem', margin: '4rem auto', padding: '0 1.5rem' }}>
          <h1>مشکلی پیش آمد</h1>
          <p>برنامه بارگذاری نشد. لطفاً دوباره تلاش کنید.</p>
          <p lang="en" dir="ltr">
            Something went wrong. The application could not load.
          </p>
          <button type="button" onClick={reset}>
            تلاش دوباره · Try again
          </button>
        </main>
      </body>
    </html>
  )
}
