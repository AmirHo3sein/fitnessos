'use client'

import type { ReactNode } from 'react'
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components'
import { cn } from '../lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends Omit<AriaButtonProps, 'className' | 'children'> {
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
  children?: ReactNode
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-action text-action-fg hover:bg-action-hover',
  secondary: 'bg-surface-elevated text-primary border border-strong hover:border-brand-border',
  ghost: 'text-muted hover:text-primary hover:bg-surface-elevated',
  danger: 'bg-destructive text-white hover:brightness-110',
}

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm rounded-sm',
  md: 'h-10 px-4 text-sm rounded-md',
  lg: 'h-12 px-6 text-base rounded-lg',
}

/**
 * Built on React Aria's Button rather than a bare `<button>`.
 *
 * The reason is not styling — it is that React Aria implements the parts nobody
 * remembers: press state that behaves identically for mouse, touch and keyboard;
 * cancelling a press when the pointer leaves the target; not firing twice on
 * touch devices that also emit synthetic mouse events; and focus visibility that
 * distinguishes keyboard focus from a click.
 *
 * `isDisabled` (not `disabled`) is the React Aria prop, and it is the correct one:
 * a natively disabled button is removed from the tab order and stops announcing
 * itself, so a screen-reader user cannot discover why the flow is blocked.
 */
export const Button = ({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonProps) => (
  <AriaButton
    {...props}
    className={cn(
      'inline-flex items-center justify-center gap-2 font-medium',
      'transition-colors duration-150 select-none',
      'data-[disabled]:opacity-50 data-[disabled]:pointer-events-none',
      'data-[pressed]:scale-[0.98]',
      VARIANT[variant],
      SIZE[size],
      className,
    )}
  />
)
