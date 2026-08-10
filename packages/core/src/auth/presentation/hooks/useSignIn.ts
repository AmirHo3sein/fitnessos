'use client'

import { useMutation } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import type { SessionEstablished } from '../../application/ports/index'
import { requestSignInCode, verifySignInCode } from '../../application/signIn'
import type { PhoneNumber } from '../../domain/PhoneNumber'
import { useAuthPorts } from '../di'

/**
 * The two-step sign-in flow as a state machine.
 *
 * Modelled as a discriminated union rather than a pile of booleans. `phase`,
 * `isLoading`, `hasCode`, `error` as four independent flags admits sixteen states, of
 * which four are meaningful and twelve are bugs waiting for a race — "sending" and
 * "code sent" both true, or a code screen with no phone to verify against. A union
 * cannot represent those at all.
 *
 * Note that `phone` exists only in the `awaiting-code` state, carrying the NORMALISED
 * value the request used. Verifying against a re-parse of whatever is in the input
 * would work until the user retypes their number with a space while waiting for the
 * SMS — which is a thing people do.
 */
export type SignInState =
  | { readonly phase: 'entering-phone' }
  | {
      readonly phase: 'awaiting-code'
      readonly phone: PhoneNumber
      readonly codeLength: number
      readonly retryAfterSeconds: number
    }

export interface UseSignIn {
  readonly state: SignInState
  readonly requestCode: (rawPhone: string) => void
  readonly verifyCode: (code: string) => void
  readonly backToPhone: () => void
  readonly isRequesting: boolean
  readonly isVerifying: boolean
  readonly requestError: Error | null
  readonly verifyError: Error | null
}

export const useSignIn = (onSignedIn: (session: SessionEstablished) => void): UseSignIn => {
  const ports = useAuthPorts()
  const [state, setState] = useState<SignInState>({ phase: 'entering-phone' })

  const request = useMutation({
    mutationFn: (rawPhone: string) => requestSignInCode(ports, rawPhone),
    onSuccess: ({ phone, result }) => {
      setState({
        phase: 'awaiting-code',
        phone,
        codeLength: result.codeLength,
        retryAfterSeconds: result.retryAfterSeconds,
      })
    },
  })

  const verify = useMutation({
    mutationFn: (code: string) => {
      if (state.phase !== 'awaiting-code') {
        // Unreachable through the UI, which only renders the code field in this
        // phase. Throwing rather than silently resolving means a future refactor that
        // breaks the invariant fails loudly instead of submitting an empty verify.
        throw new Error('verifyCode called before a code was requested')
      }
      return verifySignInCode(ports, state.phone, code, state.codeLength)
    },
    // Wrapped, not passed directly. TanStack calls `onSuccess` with
    // `(data, variables, context)`, so `onSuccess: onSignedIn` would hand the caller
    // the submitted code and the QueryClient alongside the session — leaking library
    // internals through this context's public API, and inviting a consumer to depend
    // on arguments its own signature does not declare.
    onSuccess: (session) => {
      onSignedIn(session)
    },
  })

  const backToPhone = useCallback(() => {
    setState({ phase: 'entering-phone' })
    verify.reset()
    request.reset()
  }, [request, verify])

  return {
    state,
    requestCode: request.mutate,
    verifyCode: verify.mutate,
    backToPhone,
    isRequesting: request.isPending,
    isVerifying: verify.isPending,
    requestError: request.error,
    verifyError: verify.error,
  }
}
