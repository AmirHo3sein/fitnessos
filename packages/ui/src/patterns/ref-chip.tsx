import { cn } from '../lib/cn'

/**
 * The three states of a cross-document reference (handbook D-08).
 *
 * Structurally identical to the engine's `RefResolution` plus a loading case, and NOT imported
 * from it: `packages/ui` may not import a bounded context or the engine (`no-context-in-ui`), and
 * the rule is right — a chip is presentation and must be renderable from anything. The engine
 * types flow in through the props at the call site.
 */
export type RefChipState =
  | { readonly state: 'loading' }
  | { readonly state: 'resolved'; readonly label: string; readonly href: string }
  | { readonly state: 'broken'; readonly reason: 'deleted' | 'forbidden' }

export interface RefChipProps {
  readonly resolution: RefChipState
  /**
   * What the document itself says the target is called.
   *
   * Required, not optional, and this is the load-bearing decision in the component. When
   * resolution fails it is the ONLY renderable content — a chip without it says "(deleted)" and
   * leaves the reader with no idea which goal is gone.
   */
  readonly fallbackLabel: string
  /** Localised, because this component cannot reach a message catalogue. */
  readonly labels: {
    readonly loading: string
    readonly deleted: string
    readonly forbidden: string
  }
  readonly className?: string
}

const BASE =
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs whitespace-nowrap'

/**
 * A reference to something in another document.
 *
 * **Broken never throws, and never renders empty.** A goal deleted last week, or one this reader
 * is not permitted to see (ADR-0002 / ADR-0014), must leave the editor openable — a coach who
 * cannot load their programme because a goal was tidied up has lost their work to a cleanup.
 *
 * `forbidden` and `deleted` are told apart on purpose. "It was removed" and "you may not see it"
 * are different facts about the world, and collapsing them into "unavailable" would tell a coach
 * something untrue about a goal that still exists.
 */
export const RefChip = ({ resolution, fallbackLabel, labels, className }: RefChipProps) => {
  if (resolution.state === 'loading') {
    return (
      <span
        // `aria-busy` rather than a skeleton block: the chip already has content to show — the
        // fallback — so replacing it with a grey rectangle would hide information the reader
        // already has while pretending to have none.
        aria-busy="true"
        className={cn(BASE, 'border-default bg-surface-elevated text-muted', className)}
      >
        <span aria-hidden="true">◌</span>
        {fallbackLabel}
        <span className="sr-only">{labels.loading}</span>
      </span>
    )
  }

  if (resolution.state === 'broken') {
    const reason = resolution.reason === 'forbidden' ? labels.forbidden : labels.deleted
    return (
      <span
        className={cn(BASE, 'border-warning-border bg-warning-surface text-warning-fg', className)}
      >
        <span aria-hidden="true">⚠</span>
        {/* The fallback FIRST, the reason second. Which reference broke matters more than why. */}
        {fallbackLabel}
        <span className="text-xs opacity-80">· {reason}</span>
      </span>
    )
  }

  return (
    <a
      href={resolution.href}
      className={cn(
        BASE,
        // `surface` rather than a brand-tinted fill: no brand surface token exists, and the
        // contrast report verifies text-brand against `surface` (6.43:1 light, 5.58:1 dark) and
        // border-brand against it (4.72:1). Inventing a tint here would ship an unverified pair.
        'border-brand-border bg-surface text-brand',
        'hover:bg-surface-hover focus-visible:ring-brand-border focus-visible:ring-2 focus-visible:outline-none',
        className,
      )}
    >
      {/*
        The RESOLVED label, not the fallback. The fallback is a snapshot from when the reference
        was made; if the goal has since been renamed, showing the stale copy would be quietly
        wrong in the one case the live value is available.
      */}
      {resolution.label}
    </a>
  )
}
