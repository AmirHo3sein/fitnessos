import {
  CheckInFormConflictError,
  type CheckInFormSnapshot,
  type Loaded,
  type MeasurementReadPort,
  type MeasurementWritePort,
  type ObservationSnapshot,
  type RecordObservationInput,
} from '@fitnessos/ctx-measurement'
import type { AuthContext, HttpClient } from '../http/client'
import {
  checkInFormBodyFrom,
  indicatorsFrom,
  loadedCheckInFormFrom,
  observationFrom,
  observationsFrom,
  recordObservationBodyFrom,
} from '../mappers/measurement'

/**
 * HTTP implementation of the Measurement ports.
 *
 * ## Why recording is not queued offline, unlike a session log
 *
 * A measurement is a small, quick, deliberate act performed where the athlete happens to be —
 * usually at home, on wifi, next to a scale. A session log is typed in a basement gym with no
 * signal, mid-workout, and cannot wait. The queue exists for the second case; adding the first
 * to it would buy a rare convenience at the cost of another replay path to reason about.
 *
 * If measurement ever moves to a wearable sync, that reasoning changes and so should this.
 */
export const createMeasurementAdapter = (
  http: HttpClient,
  auth: AuthContext,
): MeasurementReadPort & MeasurementWritePort => ({
  observations: async (signal?: AbortSignal) =>
    observationsFrom(await http.request('/observations', { auth, ...(signal ? { signal } : {}) })),

  indicators: async (signal?: AbortSignal) =>
    indicatorsFrom(await http.request('/indicators', { auth, ...(signal ? { signal } : {}) })),

  checkInForm: async (signal?: AbortSignal): Promise<Loaded<CheckInFormSnapshot> | null> => {
    const raw = await http.request('/check-in-forms/current', {
      auth,
      ...(signal ? { signal } : {}),
    })
    // A 204 becomes null. "No form yet" is the normal state before a coach authors one, and
    // `undefined` reaching a component is how that becomes a blank screen with no explanation.
    if (raw === undefined || raw === null) return null
    return loadedCheckInFormFrom(raw)
  },

  saveCheckInForm: async (
    form,
    baseRevision: number | null,
    signal?: AbortSignal,
  ): Promise<Loaded<CheckInFormSnapshot>> => {
    // PUT: a form is not versioned, so submitting the same body twice leaves it in the same
    // state. That is what makes a retry safe here without a client-generated request id.
    //
    // `baseRevision` is what stops that replace from being last-write-wins now that a coach and
    // an athlete can both reach it. A stale one, or a missing one against a form that exists, is
    // refused with 409 (BACKEND-CONTRACT §2.1a) — which the caller sees as a failed save rather
    // than as work that silently vanished.
    //
    // `allowStatus` keeps the 409's BODY, because that body is the form as it now stands. Without
    // it the collision arrives as a bare `ApiError`, and the author is told the save failed with no
    // way to see what they collided with — an unresolvable conflict (ADR-0033).
    const body = checkInFormBodyFrom(form, baseRevision)
    const { status, body: raw } = await http.requestWithStatus(`/check-in-forms/${form.id}`, {
      method: 'PUT',
      body,
      auth,
      allowStatus: [409],
      ...(signal ? { signal } : {}),
    })

    // Mapped before the status is inspected: a 409 body is a CheckInForm too, and a malformed one
    // is a contract violation whichever status carried it.
    const loaded = loadedCheckInFormFrom(raw)
    if (status === 409) throw new CheckInFormConflictError(loaded)
    return loaded
  },

  record: async (
    input: RecordObservationInput,
    signal?: AbortSignal,
  ): Promise<ObservationSnapshot> => {
    // Validated before it is sent, so a malformed body never leaves the device.
    const body = recordObservationBodyFrom(input)
    // 200 and 201 both mean success — 200 is the same id replayed after a lost response, which
    // for a measurement can only be a retry. No `allowStatus` needed: neither is an error.
    return observationFrom(
      await http.request('/observations', {
        method: 'POST',
        body,
        auth,
        ...(signal ? { signal } : {}),
      }),
    )
  },
})
