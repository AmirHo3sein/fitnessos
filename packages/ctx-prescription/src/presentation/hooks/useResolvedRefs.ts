'use client'

import { useQuery } from '@tanstack/react-query'
import { refKey, type DocumentRef, type RefResolution } from '@fitnessos/editor-engine'
import { usePrescriptionPorts } from '../di'

/**
 * Resolve the references a document holds (D-08).
 *
 * A query rather than an effect, so resolution is cached, deduplicated across components and
 * cancelled on navigation for free — a document showing the same goal on twelve blocks makes one
 * request, and reopening the editor makes none.
 *
 * The key is the sorted set of reference keys, NOT the document. Keying on the document would
 * re-resolve on every keystroke; the references only change when a reference changes.
 *
 * `null` while loading rather than an empty map, because a caller cannot otherwise tell "not
 * resolved yet" from "resolved to nothing" — and those render differently: a spinner-ish chip
 * versus a broken one.
 */
export const useResolvedRefs = (
  refs: readonly DocumentRef[],
): ReadonlyMap<string, RefResolution> | null => {
  const ports = usePrescriptionPorts()
  const keys = refs.map(refKey).sort()

  const { data } = useQuery({
    queryKey: ['references', keys],
    queryFn: ({ signal }) => ports.references.resolve(refs, signal),
    // Resolution is a label and a link. It changes when someone renames a goal, which is rare and
    // not worth a refetch on every mount.
    staleTime: 5 * 60_000,
    enabled: refs.length > 0,
  })

  // No references means nothing to wait for. Returning `null` here would leave a document with no
  // references looking permanently in-flight.
  if (refs.length === 0) return new Map()
  return data ?? null
}
