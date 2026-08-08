import base from '@fitnessos/config/eslint.base.js'

// The base config enables `projectService`, which discovers tsconfig.json
// automatically. No per-package parser options are needed.
export default [
  ...base,
  {
    languageOptions: {
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },
]
