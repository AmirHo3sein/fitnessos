import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import base from './eslint.base.js'

/**
 * ESLint config for presentation packages and the app shell.
 *
 * Extends the framework-free base. The base's type-safety rules all still apply —
 * presentation is not a place where `any` becomes acceptable.
 */
export default [
  ...base,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,

      // The exhaustive-deps warning is the single most-ignored React lint rule and
      // the source of most stale-closure bugs. It is an error here.
      'react-hooks/exhaustive-deps': 'error',

      // Accessibility is a correctness property, not a nice-to-have. A keyboard
      // user who cannot reach a control cannot use the product at all.
      'jsx-a11y/no-autofocus': 'error',
      'jsx-a11y/anchor-is-valid': 'error',

      'no-restricted-syntax': [
        'error',
        {
          // The ONE permitted HTML rendering path is <SafeHtml> in ui/patterns,
          // which sanitises through DOMPurify with an explicit allowlist.
          //
          // This matters more than usual here: notes, cues and programme
          // descriptions are authored by coaches in a rich-text editor and read
          // by their athletes. That is user-generated HTML crossing an account
          // boundary — stored XSS with a built-in audience.
          selector: 'JSXAttribute[name.name="dangerouslySetInnerHTML"]',
          message:
            'Use <SafeHtml> from @fitnessos/ui. It is the only sanctioned HTML ' +
            'rendering path; everything else is stored XSS waiting for an author.',
        },
        {
          // A locale-blind number is a bug in an RTL product: Persian digits,
          // separators and calendar all differ. Intl.NumberFormat with an
          // explicit locale, or the `nums` utility for LTR-in-RTL numerals.
          selector: 'CallExpression[callee.property.name="toLocaleString"]:not([arguments.length>0])',
          message:
            'Pass an explicit locale. toLocaleString() with no argument silently ' +
            'formats to the runtime default, which differs between server and browser.',
        },
      ],
    },
  },
  {
    // <SafeHtml> is the implementation of the rule above, so it is the one file
    // that must be allowed to break it.
    files: ['**/patterns/safe-html.tsx'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
]
