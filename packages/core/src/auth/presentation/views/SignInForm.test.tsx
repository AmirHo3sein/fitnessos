import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AuthPorts, SessionEstablished } from '../../application/ports/index'
import { AuthPortsProvider } from '../di'
import { SignInForm, type SignInLabels } from './SignInForm'

const LABELS: SignInLabels = {
  phoneLabel: 'Mobile number',
  phonePlaceholder: '0912 345 6789',
  phoneHint: 'Persian or English digits.',
  sendCode: 'Send code',
  codeLabel: 'Verification code',
  codeSentTo: 'Code sent to',
  verify: 'Verify and sign in',
  changeNumber: 'Change number',
  errors: {
    emptyPhone: 'Enter your mobile number.',
    badPhone: 'That does not look like an Iranian mobile number.',
    badCode: 'The code must be digits only.',
    generic: 'That did not work.',
  },
}

const SESSION: SessionEstablished = {
  personId: 'p-1' as SessionEstablished['personId'],
  isNewPerson: false,
}

const ports = (over: Partial<AuthPorts['auth']> = {}): AuthPorts => ({
  auth: {
    requestCode: () => Promise.resolve({ retryAfterSeconds: 60, codeLength: 6 }),
    verifyCode: () => Promise.resolve(SESSION),
    ...over,
  },
})

const renderForm = (auth: AuthPorts, onSignedIn = vi.fn()) => {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <AuthPortsProvider value={auth}>
        <SignInForm labels={LABELS} onSignedIn={onSignedIn} />
      </AuthPortsProvider>
    </QueryClientProvider>,
  )
  return { onSignedIn }
}

describe('SignInForm — phone step', () => {
  it('sends the NORMALISED phone, whatever the user typed', async () => {
    // The single most important assertion in this file. Users type Persian digits,
    // and everything downstream — the SMS gateway, the person lookup — needs E.164.
    const requestCode = vi.fn(() => Promise.resolve({ retryAfterSeconds: 60, codeLength: 6 }))
    renderForm(ports({ requestCode }))

    await userEvent.type(screen.getByLabelText('Mobile number'), '۰۹۱۲۳۴۵۶۷۸۹')
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }))

    expect(await screen.findByLabelText('Verification code')).toBeInTheDocument()
    expect(requestCode).toHaveBeenCalledWith('+989123456789', undefined)
  })

  it('shows a specific message for an empty number', async () => {
    renderForm(ports())
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(LABELS.errors.emptyPhone)
  })

  it('shows a different message for a malformed number', async () => {
    // "Enter your number" and "that is not an Iranian mobile" are different
    // instructions. Collapsing them tells a user who typed a landline to type it again.
    renderForm(ports())
    await userEvent.type(screen.getByLabelText('Mobile number'), '0212345678')
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(LABELS.errors.badPhone)
  })

  it('does not call the port at all for a malformed number', async () => {
    const requestCode = vi.fn(() => Promise.resolve({ retryAfterSeconds: 60, codeLength: 6 }))
    renderForm(ports({ requestCode }))
    await userEvent.type(screen.getByLabelText('Mobile number'), '0212345678')
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }))
    await screen.findByRole('alert')
    expect(requestCode).not.toHaveBeenCalled()
  })

  it('marks the field invalid and links the message for assistive technology', async () => {
    renderForm(ports())
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }))
    await screen.findByRole('alert')

    const input = screen.getByLabelText('Mobile number')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute('aria-errormessage', 'phone-error')
  })

  it('renders the number LTR so bidi does not reorder its groups', () => {
    // A bare number inside an RTL paragraph is reordered by the bidi algorithm and
    // displays with its groups reversed — the user sees a different number to the one
    // they typed.
    renderForm(ports())
    expect(screen.getByLabelText('Mobile number')).toHaveAttribute('dir', 'ltr')
  })

  it('uses a tel input, not a number input', () => {
    // `type="number"` strips the leading zero, shows a spinner, and on several Android
    // keyboards hides the + entirely.
    renderForm(ports())
    expect(screen.getByLabelText('Mobile number')).toHaveAttribute('type', 'tel')
  })
})

describe('SignInForm — code step', () => {
  const reachCodeStep = async (auth: AuthPorts, onSignedIn = vi.fn()) => {
    renderForm(auth, onSignedIn)
    await userEvent.type(screen.getByLabelText('Mobile number'), '09123456789')
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }))
    await screen.findByLabelText('Verification code')
    return { onSignedIn }
  }

  it('sends the normalised code and reports the session', async () => {
    const verifyCode = vi.fn(() => Promise.resolve(SESSION))
    const { onSignedIn } = await reachCodeStep(ports({ verifyCode }))

    await userEvent.type(screen.getByLabelText('Verification code'), '۱۲۳۴۵۶')
    await userEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }))

    expect(verifyCode).toHaveBeenCalledWith('+989123456789', '123456', undefined)
    expect(onSignedIn).toHaveBeenCalledWith(SESSION)
  })

  it('shows the masked number, so the user can check it is the right phone', async () => {
    await reachCodeStep(ports())
    expect(screen.getByText('0912 *** 6789')).toBeInTheDocument()
  })

  it('takes the code length from the SERVER, never a hardcoded 6', async () => {
    await reachCodeStep(
      ports({ requestCode: () => Promise.resolve({ retryAfterSeconds: 60, codeLength: 4 }) }),
    )
    expect(screen.getByLabelText('Verification code')).toHaveAttribute('maxlength', '4')
  })

  it('rejects a wrong-length code without spending a server attempt', async () => {
    // Server-side attempts are few. Burning one on input that cannot possibly be
    // right locks the user out of their own sign-in for a typo.
    const verifyCode = vi.fn(() => Promise.resolve(SESSION))
    await reachCodeStep(ports({ verifyCode }))

    await userEvent.type(screen.getByLabelText('Verification code'), '123')
    await userEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(LABELS.errors.badCode)
    expect(verifyCode).not.toHaveBeenCalled()
  })

  it('offers one-time-code autofill, which removes the flow’s most error-prone step', async () => {
    await reachCodeStep(ports())
    expect(screen.getByLabelText('Verification code')).toHaveAttribute(
      'autocomplete',
      'one-time-code',
    )
  })

  it('shows a generic message when the server rejects the code', async () => {
    // Never the server's own text: it is written for an operator, and on this screen
    // it can leak whether an account exists.
    await reachCodeStep(
      ports({ verifyCode: () => Promise.reject(new Error('code_invalid: no such attempt')) }),
    )

    await userEvent.type(screen.getByLabelText('Verification code'), '000000')
    await userEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(LABELS.errors.generic)
    expect(alert).not.toHaveTextContent('code_invalid')
  })

  it('goes back to the phone step and clears the error', async () => {
    await reachCodeStep(ports())
    await userEvent.type(screen.getByLabelText('Verification code'), '123')
    await userEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    await screen.findByRole('alert')

    await userEvent.click(screen.getByRole('button', { name: 'Change number' }))

    expect(await screen.findByLabelText('Mobile number')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
