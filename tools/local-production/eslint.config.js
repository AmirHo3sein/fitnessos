import base from '@fitnessos/config/eslint.base.js'

export default [
  ...base,
  {
    /*
     * The flat config file cannot lint itself here.
     *
     * `eslint.base.js` sets `projectService: true`, so every linted file must belong to a
     * TypeScript project — and a `.js` config file does not, unless `allowJs` is turned on for the
     * whole package purely to accommodate one file. Ignoring it is the smaller lie: nothing in it
     * is worth type-aware linting, and turning on `allowJs` would quietly widen what `tsc --noEmit`
     * checks in a package whose whole point is a handful of specs.
     */
    ignores: ['eslint.config.js'],
  },
  { languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } } },
]
