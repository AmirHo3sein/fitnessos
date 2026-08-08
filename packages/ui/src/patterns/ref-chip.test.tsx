import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RefChip } from './ref-chip'

const LABELS = {
  loading: 'Loading the goal',
  deleted: 'no longer available',
  forbidden: 'not visible to you',
}

describe('resolved', () => {
  it('renders the LIVE label, not the stale fallback', () => {
    // The fallback is a snapshot from when the reference was made. If the goal has since been
    // renamed, showing it would be quietly wrong in the one case the live value is available.
    render(
      <RefChip
        resolution={{ state: 'resolved', label: 'Run 10k', href: '/goals/g1' }}
        fallbackLabel="an old name"
        labels={LABELS}
      />,
    )
    expect(screen.getByRole('link')).toHaveTextContent('Run 10k')
    expect(screen.queryByText('an old name')).not.toBeInTheDocument()
  })

  it('links to the target', () => {
    render(
      <RefChip
        resolution={{ state: 'resolved', label: 'Run 10k', href: '/goals/g1' }}
        fallbackLabel="x"
        labels={LABELS}
      />,
    )
    expect(screen.getByRole('link')).toHaveAttribute('href', '/goals/g1')
  })
})

describe('broken', () => {
  it('still names WHICH reference broke', () => {
    // The whole reason `fallbackLabel` is required. A chip that renders only "no longer
    // available" leaves the reader with no idea which goal is gone.
    render(
      <RefChip
        resolution={{ state: 'broken', reason: 'deleted' }}
        fallbackLabel="base phase"
        labels={LABELS}
      />,
    )
    expect(screen.getByText(/base phase/)).toBeInTheDocument()
    expect(screen.getByText(/no longer available/)).toBeInTheDocument()
  })

  it('distinguishes forbidden from deleted', () => {
    // Different facts about the world. Reporting "not yours to see" as "deleted" would tell a
    // coach something untrue about a goal that still exists (ADR-0002 / ADR-0014).
    render(
      <RefChip
        resolution={{ state: 'broken', reason: 'forbidden' }}
        fallbackLabel="base phase"
        labels={LABELS}
      />,
    )
    expect(screen.getByText(/not visible to you/)).toBeInTheDocument()
    expect(screen.queryByText(/no longer available/)).not.toBeInTheDocument()
  })

  it('is not a link', () => {
    // There is nowhere to go. A link to a deleted goal is a 404 the reader was invited into.
    render(
      <RefChip
        resolution={{ state: 'broken', reason: 'deleted' }}
        fallbackLabel="base phase"
        labels={LABELS}
      />,
    )
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('renders without throwing', () => {
    // Stated as a test because it is the guarantee the whole component exists for: a coach whose
    // goal was tidied up last week must still be able to open their programme.
    expect(() =>
      render(
        <RefChip
          resolution={{ state: 'broken', reason: 'deleted' }}
          fallbackLabel="x"
          labels={LABELS}
        />,
      ),
    ).not.toThrow()
  })
})

describe('loading', () => {
  it('shows the fallback rather than a blank placeholder', () => {
    // The chip already has something true to show. Replacing it with a grey rectangle hides
    // information the reader has while pretending to have none.
    render(
      <RefChip resolution={{ state: 'loading' }} fallbackLabel="base phase" labels={LABELS} />,
    )
    expect(screen.getByText(/base phase/)).toBeInTheDocument()
  })

  it('announces that it is busy', () => {
    const { container } = render(
      <RefChip resolution={{ state: 'loading' }} fallbackLabel="base phase" labels={LABELS} />,
    )
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.getByText('Loading the goal')).toBeInTheDocument()
  })
})
