/**
 * Learning — what was proposed, and whether it turned out to be right.
 *
 * ADR-0009 names this context and scopes it to `Proposal` and `DecisionOutcome`. The naming rule
 * is not cosmetic: a context called `AI` or `Recommendations` would be named after a technology
 * and would drift as the technology did.
 *
 * ## The three rules that decide what may live here
 *
 *   ADR-0010  before / during / after. The BEFORE (`Proposal`) and the AFTER
 *             (`DecisionOutcome`) belong here. The DURING — the moment of change — belongs to
 *             the changing context, which is why there is no `accept()` in this package.
 *             Accepting a proposal produces a `ProgramVersion` whose `authoringDecision` records
 *             that an assistant proposed and a human decided.
 *   ADR-0019  Learning may neither write to nor read another context's model. A proposal
 *             therefore names its target with a coarse kind and an opaque id, and nothing here
 *             ever dereferences it.
 *   ADR-0007  the obligation to evaluate is a `Hypothesis` on the authoring record.
 *             `DecisionOutcome` holds the rendered verdict only, immutable from creation;
 *             corrections supersede.
 *
 * `UnjudgedHypothesisView` is where those become a product feature rather than a filing system:
 * it makes visible every accepted proposal whose claim has come due and gone unanswered. ADR-0003
 * is satisfiable on paper by a product that accepts every suggestion and never looks back, and
 * that view is what stops it.
 */
export * from './domain/Hypothesis'
export * from './domain/Proposal'
export * from './domain/DecisionOutcome'
export * from './application/index'
