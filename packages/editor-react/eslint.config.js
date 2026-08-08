import react from '@fitnessos/config/eslint.react.js'

export default [
  ...react,
  { languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } } },
]
