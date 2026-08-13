/**
 * @fitnessos/ui — the shared React layer.
 *
 * Two things live here, and the naming should not obscure that:
 *
 *   primitives/ patterns/  the design system — presentational, no domain knowledge
 *   di/                    the React plumbing every context needs to receive ports
 *
 * The DI factory is here rather than in its own package because it is twenty
 * lines whose only dependency is React, and a package per twenty lines is a
 * worse trade than a slightly broader name.
 *
 * Nothing in this package may import a bounded context, infra, or contracts.
 * It knows about React and CSS. That is all.
 */

export { cn } from './lib/cn'

export { createDiContext, type DiContext } from './di/createDiContext'

export {
  Button,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
} from './primitives/button'
export {
  Card,
  CardDescription,
  CardTitle,
  type CardContainerProps,
  type CardProps,
} from './primitives/card'
export { Skeleton, type SkeletonProps } from './primitives/skeleton'

export { SafeHtml, sanitizeHtml, type SafeHtmlProps } from './patterns/safe-html'
export { RefChip, type RefChipProps, type RefChipState } from './patterns/ref-chip'
export { SubjectProvider, useSubject } from './di/subject'
