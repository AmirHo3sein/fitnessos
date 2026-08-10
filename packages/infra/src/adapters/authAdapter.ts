import type { AuthPort, CodeRequested, PhoneNumber, SessionEstablished } from '@fitnessos/core/auth'
import type { HttpClient } from '../http/client'
import { codeRequestedFrom, sessionEstablishedFrom } from '../mappers/auth'

/**
 * HTTP implementation of `AuthPort`.
 *
 * No `AuthContext` parameter, unlike the athlete adapter. These are the two endpoints
 * that run *without* a session — passing one would be meaningless, and accepting one
 * would invite a caller to think it mattered.
 *
 * The response bodies carry no token. On success the server sets httpOnly cookies,
 * which the browser stores and attaches automatically; nothing here reads them,
 * because nothing in JavaScript can.
 */
export const createAuthAdapter = (http: HttpClient): AuthPort => ({
  requestCode: async (phone: PhoneNumber, signal?: AbortSignal): Promise<CodeRequested> => {
    const raw = await http.request('/auth/request-code', {
      method: 'POST',
      body: { phone },
      ...(signal ? { signal } : {}),
    })
    return codeRequestedFrom(raw)
  },

  verifyCode: async (
    phone: PhoneNumber,
    code: string,
    signal?: AbortSignal,
  ): Promise<SessionEstablished> => {
    const raw = await http.request('/auth/verify-code', {
      method: 'POST',
      body: { phone, code },
      ...(signal ? { signal } : {}),
    })
    return sessionEstablishedFrom(raw)
  },
})
