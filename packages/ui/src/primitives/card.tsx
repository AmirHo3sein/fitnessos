import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

export interface CardProps {
  children?: ReactNode
  className?: string
}

export interface CardContainerProps extends CardProps {
  /**
   * A live region, for the cards that announce something rather than sit there.
   *
   * Deliberately narrow — two values, not `string`. A `Card` is a box, and most boxes are not
   * announcements; opening this to every ARIA role would invite `role="button"` on a div and the
   * keyboard bug that follows. These two are what this product needs: `alert` for a save that
   * failed or a collision that needs deciding, `status` for a confirmation.
   *
   * It exists because every one of those cards was a bare `<div>`. A screen-reader user pressed
   * Save, the write failed or collided, and nothing was announced at all — the message was on
   * screen and silent.
   */
  role?: 'alert' | 'status'
  /**
   * Politeness, when the role's default is wrong.
   *
   * `role="alert"` implies `assertive`, which interrupts whatever is being read. That is right for
   * a failure the user caused by pressing a button and wrong for one that arrived on its own.
   */
  'aria-live'?: 'polite' | 'assertive'
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
export const Card = ({
  children,
  className,
  role,
  'aria-live': ariaLive,
}: CardContainerProps) => (
  <div
    role={role}
    aria-live={ariaLive}
    className={cn(
      'bg-surface border border-default rounded-xl p-5',
      'shadow-[0_1px_2px_rgb(0_0_0/0.04)]',
      className,
    )}
  >
    {children}
  </div>
)

export const CardTitle = ({ children, className }: CardProps) => (
  <h2 className={cn('text-display text-lg text-primary mb-1', className)}>{children}</h2>
)

export const CardDescription = ({ children, className }: CardProps) => (
  <p className={cn('text-sm text-muted', className)}>{children}</p>
)
