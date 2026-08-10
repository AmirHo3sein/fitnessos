import type { CodeRequested, SessionEstablished } from '@fitnessos/core/auth'
import {
  RequestCodeResultSchema,
  VerifyCodeResultSchema,
  type components,
} from '@fitnessos/contracts'
import { idFrom } from '@fitnessos/kernel'
import { parseContract, type FieldsAgree } from './parse'

/**
 * Auth mappers. Tier 2 — names align, but the target types are the application's.
 *
 * Both entry points take `unknown` and validate (ADR-0031). That matters more here
 * than elsewhere: these responses decide whether a session exists and where the user
 * lands, so a malformed one must fail loudly rather than produce `isNewPerson:
 * undefined` and route someone into the wrong flow.
 */

type ContractRequestCodeResult = components['schemas']['RequestCodeResult']
type ContractVerifyCodeResult = components['schemas']['VerifyCodeResult']

export const codeRequestedFrom = (raw: unknown): CodeRequested => {
  const c = parseContract(RequestCodeResultSchema, raw, 'RequestCodeResult')
  return {
    retryAfterSeconds: c.retryAfterSeconds,
    codeLength: c.codeLength,
  }
}

export const sessionEstablishedFrom = (raw: unknown): SessionEstablished => {
  const c = parseContract(VerifyCodeResultSchema, raw, 'VerifyCodeResult')
  return {
    personId: idFrom<'PersonId'>(c.personId),
    isNewPerson: c.isNewPerson,
  }
}

export const REQUEST_CODE_COVERAGE: Record<keyof ContractRequestCodeResult, true> = {
  retryAfterSeconds: true,
  codeLength: true,
}

export const VERIFY_CODE_COVERAGE: Record<keyof ContractVerifyCodeResult, true> = {
  personId: true,
  isNewPerson: true,
}

const _requestFieldsAgree: FieldsAgree<
  ContractRequestCodeResult,
  ReturnType<typeof RequestCodeResultSchema.parse>
> = true
const _verifyFieldsAgree: FieldsAgree<
  ContractVerifyCodeResult,
  ReturnType<typeof VerifyCodeResultSchema.parse>
> = true
void _requestFieldsAgree
void _verifyFieldsAgree
