import type {
  MeasurementReadPort,
  MeasurementWritePort,
  ObservationSnapshot,
  RecordObservationInput,
} from '@fitnessos/ctx-measurement'
import type { AuthContext, HttpClient } from '../http/client'
import {
  indicatorsFrom,
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
