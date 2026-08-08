import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * Base ESLint config for framework-free packages.
 * Presentation packages extend this and add React / a11y plugins.
 */
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true },
    },
    rules: {
      // The handbook's Result-at-the-domain-boundary discipline (D-01, kernel/result)
      // depends on not silently discarding failures.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // Type-system escape hatches are how a sound boundary quietly stops being one.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',

      // Exhaustiveness over closed sum types (ADR-0016, ADR-0020) is enforced,
      // not remembered.
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    ignores: ['dist/**', '.next/**', '.turbo/**', 'coverage/**', '**/*.gen.ts'],
  },
)
