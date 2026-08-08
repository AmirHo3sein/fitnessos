'use client'

import { Button } from '@fitnessos/ui'
import { useState } from 'react'
import type { SessionEstablished } from '../../application/ports/index'
import { SignInValidationError } from '../../application/signIn'
import { maskPhone } from '../../domain/PhoneNumber'
import { useSignIn } from '../hooks/useSignIn'

export interface SignInLabels {
  readonly phoneLabel: string
  readonly phonePlaceholder: string
  readonly phoneHint: string
  readonly sendCode: string
  readonly codeLabel: string
  readonly codeSentTo: string
  readonly verify: string
  readonly changeNumber: string
  readonly errors: {
    readonly emptyPhone: string
    readonly badPhone: string
    readonly badCode: string
    readonly generic: string
  }
}

export interface SignInFormProps {
  labels: SignInLabels
  onSignedIn: (session: SessionEstablished) => void
}

/**
 * Translates a thrown error into a message. Domain errors get a specific one;
 * anything else gets the generic.
 *
 * Deliberately does NOT surface a server message verbatim. An API error string is
 * written for an operator, not an athlete, and on this screen in particular it can
 * leak whether an account exists — the endpoint is careful not to be an enumeration
 * oracle, and echoing its errors would undo that.
 */
const messageFor = (error: Error | null, labels: SignInLabels): string | null => {
  if (error === null) return null
  if (error instanceof SignInValidationError) {
    switch (error.problem.kind) {
      case 'invalid-phone':
        return error.problem.reason.kind === 'empty'
          ? labels.errors.emptyPhone
          : labels.errors.badPhone
      case 'invalid-code':
        return labels.errors.badCode
    }
  }
  return labels.errors.generic
}

export const SignInForm = ({ labels, onSignedIn }: SignInFormProps) => {
  const signIn = useSignIn(onSignedIn)
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')

  if (signIn.state.phase === 'entering-phone') {
    const error = messageFor(signIn.requestError, labels)
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault()
          signIn.requestCode(phone)
        }}
        className="space-y-4"
      >
        <div>
          <label htmlFor="phone" className="text-muted mb-1.5 block text-sm">
            {labels.phoneLabel}
          </label>
          <input
            id="phone"
            name="phone"
            // `tel`, not `number`: a number input strips leading zeros, offers a
            // spinner, and on some Android keyboards hides the + entirely.
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            // The value is a number, so it reads left-to-right even inside an RTL
            // page. Without this the bidi algorithm reorders the groups as typed.
            dir="ltr"
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value)
            }}
            placeholder={labels.phonePlaceholder}
            aria-describedby="phone-hint"
            {...(error === null ? {} : { 'aria-invalid': true, 'aria-errormessage': 'phone-error' })}
            className="border-line bg-elevated text-fg focus:border-accent nums h-12 w-full rounded-md border px-4 outline-none"
          />
          <p id="phone-hint" className="text-faint mt-1.5 text-xs">
            {labels.phoneHint}
          </p>
          {error !== null && (
            // `role="alert"` so a screen reader announces it. A message that only
            // appears visually is invisible to the users most likely to mistype.
            <p id="phone-error" role="alert" className="text-danger mt-1.5 text-sm">
              {error}
            </p>
          )}
        </div>
        <Button type="submit" size="lg" className="w-full" isDisabled={signIn.isRequesting}>
          {labels.sendCode}
        </Button>
      </form>
    )
  }

  const error = messageFor(signIn.verifyError, labels)
  const { phone: normalized, codeLength } = signIn.state

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        signIn.verifyCode(code)
      }}
      className="space-y-4"
    >
      <p className="text-muted text-sm">
        {labels.codeSentTo} <span className="nums text-fg">{maskPhone(normalized)}</span>
      </p>
      <div>
        <label htmlFor="code" className="text-muted mb-1.5 block text-sm">
          {labels.codeLabel}
        </label>
        <input
          id="code"
          name="code"
          type="text"
          inputMode="numeric"
          // Lets iOS and Android offer the code straight from the SMS notification,
          // which removes the most error-prone step in the whole flow.
          autoComplete="one-time-code"
          dir="ltr"
          // From the server, never hardcoded — the server may change the length.
          maxLength={codeLength}
          value={code}
          onChange={(event) => {
            setCode(event.target.value)
          }}
          {...(error === null ? {} : { 'aria-invalid': true, 'aria-errormessage': 'code-error' })}
          className="border-line bg-elevated text-fg focus:border-accent nums h-12 w-full rounded-md border px-4 text-center tracking-[0.4em] outline-none"
        />
        {error !== null && (
          <p id="code-error" role="alert" className="text-danger mt-1.5 text-sm">
            {error}
          </p>
        )}
      </div>
      <Button type="submit" size="lg" className="w-full" isDisabled={signIn.isVerifying}>
        {labels.verify}
      </Button>
      <Button type="button" variant="ghost" className="w-full" onPress={signIn.backToPhone}>
        {labels.changeNumber}
      </Button>
    </form>
  )
}
