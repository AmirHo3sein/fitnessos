import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Conditional class names, with later Tailwind utilities winning over earlier
 * ones in the same group.
 *
 * `clsx` alone would emit `px-4 px-2` and leave the winner to CSS source order —
 * which is not what the caller meant. `twMerge` resolves the conflict by group,
 * so a `className` prop can reliably override a component's own defaults.
 */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs))
