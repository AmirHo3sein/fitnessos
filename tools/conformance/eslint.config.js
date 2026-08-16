import base from '@fitnessos/config/eslint.base.js'

export default [
  ...base,
  {
    /*
     * Neither file belongs to a TypeScript project, and `eslint.base.js` sets
     * `projectService: true`, so type-aware linting cannot parse them. `coverage.mjs` is a
     * standalone script run with plain node; this config file lints nothing.
     *
     * Worth recording why they are ignored rather than accommodated: until a `lint` script existed
     * here at all, turbo skipped this package entirely — so every file in it, including the
     * conformance specs, was unlinted and untypechecked while `pnpm check` reported 38/38.
     */
    ignores: ['eslint.config.js', 'coverage.mjs'],
  },
  { languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } } },
]
