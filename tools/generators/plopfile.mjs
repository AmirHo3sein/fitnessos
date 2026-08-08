import path from 'node:path'

/**
 * Code generators — implementation handbook §4.2.
 *
 * The layering tax is real: a feature touches contracts, mappers, ports, use
 * cases, query definitions and presentation. The answer is to generate the
 * boilerplate, not to remove the layers.
 *
 * Every generator's output must typecheck, lint and pass boundary rules with no
 * hand edits. `plopfile.test.mjs` asserts exactly that, in CI.
 *
 * Destinations are absolute. Plop resolves relative `destination` against the
 * plopfile's own directory, which silently writes into tools/generators/.
 */

/**
 * Destination base, resolved lazily at generation time.
 *
 * Absolute destinations bypass node-plop's own `destBasePath`, so redirection has
 * to be explicit via FITNESSOS_GEN_ROOT — without it the generator tests write
 * into the real workspace. Reading the env var per call rather than at module
 * load means a single imported plopfile can serve many isolated test runs.
 */
const repoRoot = () =>
  process.env['FITNESSOS_GEN_ROOT']
    ? path.resolve(process.env['FITNESSOS_GEN_ROOT'])
    : path.resolve(import.meta.dirname, '../..')

const at = (...segments) => path.join(repoRoot(), ...segments)

const CONTEXT_NAME = /^[a-z][a-z0-9-]*$/

/** @param {import('plop').NodePlopAPI} plop */
export default function (plop) {
  const pascal = (s) =>
    String(s)
      .split('-')
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join('')

  plop.setHelper('pascal', pascal)
  plop.setHelper('camel', (s) => {
    const p = pascal(s)
    return p.charAt(0).toLowerCase() + p.slice(1)
  })

  plop.setGenerator('context', {
    description: 'a bounded context — folder in core, or its own ctx-* package',
    prompts: [
      {
        type: 'input',
        name: 'name',
        message: 'context name (kebab-case, e.g. development)',
        validate: (v) =>
          CONTEXT_NAME.test(v) || 'lowercase letters, digits and hyphens only',
      },
      {
        // `input` rather than `list` so the generator is scriptable. CI must be
        // able to run it headlessly; an arrow-key prompt cannot be piped.
        type: 'input',
        name: 'tier',
        message: 'tier — "core" (folder in packages/core) or "complex" (own ctx-* package)',
        default: 'core',
        validate: (v) =>
          v === 'core' || v === 'complex' || 'must be "core" or "complex"',
      },
    ],
    actions: (answers) => {
      if (!answers) return []

      if (answers.tier === 'complex') {
        return [
          {
            type: 'addMany',
            destination: at('packages/ctx-{{name}}'),
            base: 'templates/context-package',
            templateFiles: 'templates/context-package/**/*',
            globOptions: { dot: true },
            stripExtensions: ['hbs'],
          },
        ]
      }

      return [
        {
          type: 'addMany',
          destination: at('packages/core/src/{{name}}'),
          base: 'templates/context-folder',
          templateFiles: 'templates/context-folder/**/*',
          globOptions: { dot: true },
          stripExtensions: ['hbs'],
        },
        {
          type: 'append',
          path: at('packages/core/src/index.ts'),
          pattern: /(\/\/ <<< contexts >>>)/,
          template: "export * as {{camel name}} from './{{name}}/index'",
        },
      ]
    },
  })
}
