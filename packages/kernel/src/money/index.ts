import { type Result, err, ok } from '../result/index'

/**
 * Money — integer minor units plus currency. Never a float.
 *
 * IRR has no minor unit in practice, so `minorUnits` is 0 and amounts are whole
 * Rials. The type still carries the exponent so a second currency does not
 * require reworking every call site.
 */

export const CURRENCIES = {
  IRR: { minorUnits: 0 },
  USD: { minorUnits: 2 },
  EUR: { minorUnits: 2 },
} as const

export type CurrencyCode = keyof typeof CURRENCIES

export interface Money {
  readonly amount: number // integer, in minor units
  readonly currency: CurrencyCode
}

export type MoneyError =
  | { kind: 'not-integer'; amount: number }
  | { kind: 'currency-mismatch'; left: CurrencyCode; right: CurrencyCode }

export const money = (amount: number, currency: CurrencyCode): Result<Money, MoneyError> => {
  if (!Number.isInteger(amount)) return err({ kind: 'not-integer', amount })
  return ok({ amount, currency })
}

export const addMoney = (a: Money, b: Money): Result<Money, MoneyError> => {
  if (a.currency !== b.currency) {
    return err({ kind: 'currency-mismatch', left: a.currency, right: b.currency })
  }
  return ok({ amount: a.amount + b.amount, currency: a.currency })
}

export const minorUnits = (c: CurrencyCode): number => CURRENCIES[c].minorUnits

export const isZero = (m: Money): boolean => m.amount === 0
