import { describe, expect, it } from 'vitest'
import { ApiError, ContractViolationError, NetworkError, problemFrom } from './errors'

/**
 * The error model, and specifically the parts a privacy review would ask about.
 */

describe('ContractViolationError', () => {
  it('separates the code from the message', () => {
    // `code` is what telemetry reports; `message` stays on the device. The split exists
    // because `invalid_enum_value` renders the received value verbatim, so a field holding
    // user input would otherwise ship that input to an observability vendor.
    const error = new ContractViolationError('Athlete', [
      { path: 'status', code: 'invalid_enum_value', message: "received 'hibernating'" },
    ])

    expect(error.issues[0]!.code).toBe('invalid_enum_value')
    expect(error.issues[0]!.code).not.toContain('hibernating')
  })

  it('names the resource and the paths in its own message, for a developer', () => {
    const error = new ContractViolationError('Athlete', [
      { path: 'availability.daysPerWeek', code: 'invalid_type', message: 'expected number' },
    ])
    expect(error.message).toContain('Athlete')
    expect(error.message).toContain('availability.daysPerWeek')
  })

  it('labels a root-level violation rather than showing an empty path', () => {
    const error = new ContractViolationError('Athlete', [
      { path: '', code: 'invalid_type', message: 'expected object' },
    ])
    expect(error.message).toContain('(root)')
  })

  it('is distinguishable from ApiError', () => {
    // An ApiError is a condition to render; this is a defect to report. An error boundary
    // has to be able to tell them apart.
    const violation = new ContractViolationError('Athlete', [])
    expect(violation).not.toBeInstanceOf(ApiError)
    expect(violation.name).toBe('ContractViolationError')
  })
})

describe('problemFrom', () => {
  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })

  it('extracts a string code and detail', async () => {
    const error = await problemFrom(json(404, { code: 'not_found', detail: 'no athlete' }))
    expect(error.status).toBe(404)
    expect(error.code).toBe('not_found')
    expect(error.message).toBe('no athlete')
  })

  it('handles an ARRAY detail without rendering [object Object]', async () => {
    // FastAPI-style APIs return an array for validation errors. V1 had exactly this latent
    // bug: `body.detail` produced "[object Object]" in the UI.
    const error = await problemFrom(
      json(422, { detail: [{ loc: ['body', 'phone'], msg: 'invalid' }] }),
    )
    expect(error.message).not.toContain('[object Object]')
    expect(error.message).toBe('request validation failed')
  })

  it('falls back to the status line for a non-JSON body', async () => {
    const error = await problemFrom(new Response('<html>502</html>', { status: 502 }))
    expect(error.status).toBe(502)
    expect(error.message).toBeTruthy()
  })

  it('ignores a non-string code rather than coercing it', async () => {
    const error = await problemFrom(json(400, { code: 42, detail: 'x' }))
    expect(error.code).toBeNull()
  })

  it('reports 401 as unauthorized', () => {
    expect(new ApiError(401, null, 'x').isUnauthorized).toBe(true)
    expect(new ApiError(403, null, 'x').isUnauthorized).toBe(false)
  })
})

describe('NetworkError', () => {
  it('carries the cause without putting it in the message', () => {
    // The cause may be a fetch failure whose message includes a URL, and a URL can carry
    // an id. The message is fixed; the cause stays local for a developer in a debugger.
    const cause = new Error('failed to fetch https://api.test/athletes/018f2c8a-0000')
    const error = new NetworkError(cause)
    expect(error.message).toBe('network request failed')
    expect(error.message).not.toContain('018f2c8a')
    expect(error.cause).toBe(cause)
  })
})
