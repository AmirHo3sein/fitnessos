import react from '@fitnessos/config/eslint.react.js'

/**
 * The React config, even though `domain` and `application` here must stay
 * framework-free. That constraint is held by `dependency-cruiser`, which can see
 * the import graph; ESLint only decides which syntax is legal in a file.
 * Splitting the ESLint config by folder would add a second, weaker enforcement
 * point for a rule that is already mechanically enforced.
 */
export default [
  ...react,
  {
    languageOptions: {
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },
]
