import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './button'

describe('Button', () => {
  it('fires on click', async () => {
    const onPress = vi.fn()
    render(<Button onPress={onPress}>Save</Button>)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onPress).toHaveBeenCalledOnce()
  })

  it('fires on Enter, not only on click', async () => {
    // The regression this guards against is a div-with-onClick rewrite, which
    // passes a click test and leaves keyboard users stranded.
    const onPress = vi.fn()
    render(<Button onPress={onPress}>Save</Button>)
    screen.getByRole('button').focus()
    await userEvent.keyboard('{Enter}')
    expect(onPress).toHaveBeenCalledOnce()
  })

  it('does not fire when disabled', async () => {
    const onPress = vi.fn()
    render(
      <Button isDisabled onPress={onPress}>
        Save
      </Button>,
    )
    await userEvent.click(screen.getByRole('button'))
    expect(onPress).not.toHaveBeenCalled()
  })

  it('stays announceable when disabled', () => {
    // React Aria reports disabled state via aria-disabled rather than the native
    // attribute, so the control keeps its place in the accessibility tree and a
    // screen-reader user can still discover why the flow is blocked.
    render(<Button isDisabled>Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('data-disabled')
  })

  it('lets a caller override a default utility rather than fighting it', () => {
    // tailwind-merge resolves the conflict by group; clsx alone would emit both
    // and leave the winner to CSS source order.
    render(<Button className="h-16">Save</Button>)
    const cls = screen.getByRole('button').className
    expect(cls).toContain('h-16')
    expect(cls).not.toContain('h-10')
  })
})
