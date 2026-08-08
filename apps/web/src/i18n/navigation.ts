import { createNavigation } from 'next-intl/navigation'
import { routing } from './routing'

/**
 * Locale-aware Link / redirect / router.
 *
 * Import these rather than `next/link` and `next/navigation` in app code:
 * the plain versions drop the locale prefix, which sends an English-reading user
 * back to Persian on the first internal navigation.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing)
