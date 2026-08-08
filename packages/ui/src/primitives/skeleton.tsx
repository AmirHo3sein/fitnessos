import { cn } from '../lib/cn'

export interface SkeletonProps {
  className?: string
  /**
   * What is loading, for assistive technology. Required rather than optional:
   * a busy region with no label announces nothing at all, which is worse than
   * the spinner a sighted user sees.
   */
  label: string
}

export const Skeleton = ({ className, label }: SkeletonProps) => (
  <div
    role="status"
    aria-busy="true"
    aria-label={label}
    className={cn('bg-elevated animate-pulse rounded-md', className)}
  />
)
