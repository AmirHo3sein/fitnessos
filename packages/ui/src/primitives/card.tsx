import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

export interface CardProps {
  children?: ReactNode
  className?: string
}

/**
 * No `'use client'`. This is a pure server component — it has no state, no
 * effects and no event handlers, so shipping it to the browser would be paying
 * bundle cost for nothing.
 *
 * The default is deliberate: `'use client'` marks the boundary where the bundle
 * starts, so it belongs on the leaf that genuinely needs interactivity, never on
 * a container that merely holds one.
 */
export const Card = ({ children, className }: CardProps) => (
  <div
    className={cn(
      'bg-surface border border-line rounded-xl p-5',
      'shadow-[0_1px_2px_rgb(0_0_0/0.04)]',
      className,
    )}
  >
    {children}
  </div>
)

export const CardTitle = ({ children, className }: CardProps) => (
  <h2 className={cn('text-display text-lg text-fg mb-1', className)}>{children}</h2>
)

export const CardDescription = ({ children, className }: CardProps) => (
  <p className={cn('text-sm text-muted', className)}>{children}</p>
)
