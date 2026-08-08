/**
 * Development — presentation layer. The only React-aware code in this package.
 *
 * Three component tiers, strictly (handbook §3.2):
 *
 *   primitive  render + emit events. Knows no domain concept.
 *              Lives in @fitnessos/ui, not here.
 *   context    calls use cases, reads stores. NEVER contains business rules,
 *              knows HTTP, or imports another context.
 *   hooks/     composes use cases, queries and stores. Hard cap 40 lines —
 *              exceeding it means a use case is missing (D-05).
 *
 * May not import @fitnessos/infra (`no-presentation-to-infra`). The DI container
 * is assembled in apps/web/composition and arrives as a prop.
 *
 * Nothing is exported until there is something to export — an empty barrel that
 * re-exports empty folders trips `no-unresolvable`.
 */

export {}
