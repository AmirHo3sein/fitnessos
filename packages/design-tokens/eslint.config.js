import base from '@fitnessos/config/eslint.base.js'

export default [
  ...base,
  { languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } } },
  // Generated output. The generator is the reviewable artefact, not its emission.
  { ignores: ['src/generated.ts'] },
]
