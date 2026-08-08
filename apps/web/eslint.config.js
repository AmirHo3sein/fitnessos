import react from '@fitnessos/config/eslint.react.js'

export default [
  ...react,
  {
    languageOptions: {
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    // `composition/` is the one place in the codebase permitted to construct
    // infrastructure (B1). Nothing special is disabled for it — noted here so the
    // absence of an exception is visible rather than assumed.
    files: ['composition/**/*.ts', 'composition/**/*.tsx'],
    rules: {},
  },
  {
    ignores: ['.next/**', 'next-env.d.ts'],
  },
]
