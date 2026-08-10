/**
 * @fitnessos/design-tokens — the colour system.
 *
 * Zero runtime dependencies, no React, no domain knowledge. It is imported by `packages/ui`,
 * by `apps/web`, and eventually by anything else that needs to look like FitnessOS — a
 * marketing site, an email template, a PDF report.
 *
 * A separate package rather than living in `packages/ui` because tokens are DATA, not
 * components: `ui` depends on them, not the reverse, and a designer can own this package
 * without touching React.
 *
 * ## The rule that matters
 *
 * **Components consume semantic CSS variables. Nothing else.**
 *
 *     ✔  className="bg-surface text-primary border-default"
 *     ✔  chartSeries('dark')                    — charts need real strings
 *     ✖  className="bg-teal-600"                — a primitive; breaks theming
 *     ✖  style={{ color: '#008180' }}           — a literal; breaks everything
 *
 * The chain is: component → semantic token → primitive → theme. A component that names a
 * primitive has skipped a link, and the brand cannot be changed without finding it.
 */
export {
  chartColors,
  chartSeries,
  modalityChartSlot,
  modalityColor,
  palette,
  semanticTokenNames,
  type ColorFamily,
  type ColorStep,
  type Modality,
  type ThemeName,
} from './generated'
