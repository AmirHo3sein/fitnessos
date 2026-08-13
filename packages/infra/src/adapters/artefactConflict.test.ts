import { describe, expect, it } from 'vitest'
import { ReportConflictError } from '@fitnessos/ctx-report'
import { createReportAdapter } from './reportAdapter'

/**
 * §2.1a's 409 has to reach the caller as a CONFLICT carrying the server's copy.
 *
 * Before this, the http client turned every non-ok status into an `ApiError` and the body was
 * discarded — so an author who collided was told something went wrong and could not see what with.
 * The client was safe (nothing was overwritten) but not explained, which for a save is only half the
 * job: a conflict the author cannot see is a conflict they cannot resolve.
 */
const stubHttp = (status: number, body: unknown) => ({
  request: async () => body,
  requestWithStatus: async () => ({ status, body }),
})

const REPORT = {
  id: '019ff600-0000-7000-8000-000000000001',
  title: 'As the server holds it',
  tiles: [],
  revision: 7,
}

describe('an artefact save conflict', () => {
  it('arrives as a conflict carrying the server’s copy, not a generic failure', async () => {
    const adapter = createReportAdapter(
      stubHttp(409, REPORT) as never,
      { onSessionLost: () => {} } as never,
    )

    await expect(adapter.save({ id: REPORT.id, title: 'mine', tiles: [] } as never, 6)).rejects.toThrow(
      ReportConflictError,
    )

    // The copy survives, and with its revision — which is what the author needs in order to decide
    // whether to re-save on top of it.
    await adapter
      .save({ id: REPORT.id, title: 'mine', tiles: [] } as never, 6)
      .catch((error: unknown) => {
        expect(error).toBeInstanceOf(ReportConflictError)
        expect((error as ReportConflictError).current.artefact.title).toBe('As the server holds it')
        expect((error as ReportConflictError).current.revision).toBe(7)
      })
  })

  it('does not treat an accepted save as a conflict', async () => {
    const adapter = createReportAdapter(
      stubHttp(200, REPORT) as never,
      { onSessionLost: () => {} } as never,
    )
    const saved = await adapter.save({ id: REPORT.id, title: 'mine', tiles: [] } as never, 6)
    expect(saved.revision).toBe(7)
  })
})
