import type { DocumentSnapshot, Node, NodeId } from '../document/snapshot'

/**
 * Cross-document references (handbook D-08).
 *
 * A reference points OUTSIDE the document: a programme that serves a goal, a report that charts
 * an indicator, a session that cites a movement. The thing pointed at has its own lifecycle and
 * can be deleted, or become forbidden to this reader (ADR-0002 / ADR-0014), while the document
 * holding the reference is untouched.
 *
 * The whole design follows from that: a reference is a VALUE the document owns, resolution is a
 * separate asynchronous concern, and **broken is a first-class state rather than an error**. An
 * editor that throws when a goal was deleted is an editor a coach cannot open.
 */

/**
 * What a reference may point at.
 *
 * A closed union rather than an open string. Each kind needs its own resolver and its own href
 * shape, so a new kind is a change to code somewhere regardless; making it a compile error is
 * strictly better than a reference that silently resolves to nothing.
 */
export type RefKind = 'goal' | 'indicator' | 'movement'

export interface DocumentRef<K extends RefKind = RefKind> {
  readonly kind: K
  readonly id: string
  /**
   * The only renderable content when resolution fails.
   *
   * Justified under S1 (semantic, not presentational): this is not a cached label kept for speed,
   * it is the last thing the document itself can say about what it points at. Without it a broken
   * reference renders as "(deleted)" and the coach has no way to know which goal is gone.
   *
   * Written once, when the reference is created, and never refreshed from the resolver — a
   * fallback that tracked the live label would be empty in exactly the case it exists for.
   */
  readonly fallbackLabel: string
}

export type ResolvedRef = { readonly state: 'resolved'; readonly label: string; readonly href: string }
export type BrokenRef = { readonly state: 'broken'; readonly reason: 'deleted' | 'forbidden' }
export type RefResolution = ResolvedRef | BrokenRef

/**
 * Resolution is a PORT, and that is the point of it.
 *
 * The document lives in one bounded context and points at another. Prescription must not import
 * Development to find out what a goal is called — that is the coupling the context boundary
 * exists to prevent. So the editor declares "resolve these", and the composition root supplies
 * something that knows how. The port is the anticorruption layer.
 *
 * Batched, taking an array, because a document with thirty references must not produce thirty
 * requests.
 */
export interface ReferenceResolver {
  readonly resolve: (
    refs: readonly DocumentRef[],
    signal?: AbortSignal,
  ) => Promise<ReadonlyMap<string, RefResolution>>
}

/** The key a resolution is stored under. Kind and id together — ids are only unique per kind. */
export const refKey = (ref: DocumentRef): string => `${ref.kind}:${ref.id}`

/**
 * Structural rather than nominal.
 *
 * Node props are `Record<string, unknown>` by design, so a reference arrives as an unknown value
 * and has to be recognised. Checking the three fields is what makes `refsIn` work over a document
 * whose schema the engine does not know.
 */
export const isDocumentRef = (value: unknown): value is DocumentRef => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<DocumentRef>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.fallbackLabel === 'string' &&
    (candidate.kind === 'goal' || candidate.kind === 'indicator' || candidate.kind === 'movement')
  )
}

/**
 * Every reference in the document, deduplicated by key.
 *
 * Deduplicated because a resolver call is a network request: a programme with the same goal on
 * twelve blocks must ask about it once. The order is the order first encountered, so a resolver
 * that logs or batches sees something stable rather than whatever the object key order happened
 * to be.
 */
export const refsIn = (doc: DocumentSnapshot): readonly DocumentRef[] => {
  const found = new Map<string, DocumentRef>()
  for (const node of Object.values(doc.nodes)) {
    for (const value of Object.values(node.props)) {
      if (isDocumentRef(value)) found.set(refKey(value), value)
    }
  }
  return [...found.values()]
}

/**
 * Rewrite node ids — the paste path.
 *
 * Pasting a copied subtree must give every node a NEW id, or the second paste collides with the
 * first and edits to one silently change the other.
 *
 * **References are preserved unchanged, and that is the whole subtlety of this function.** A
 * `DocumentRef` looks like an id and is not one: it points outside the document, at something the
 * paste did not copy. Remapping it would repoint a pasted block at a goal that does not exist —
 * the sort of bug that produces a broken reference nobody can explain, in a document nobody
 * edited by hand.
 *
 * `idMap` is supplied by the caller rather than generated here, because the engine must stay free
 * of id generation (the kernel owns UUIDv7) and because a caller pasting into a document may need
 * the mapping afterwards to select what it just pasted.
 */
export const remapIds = (
  doc: DocumentSnapshot,
  idMap: ReadonlyMap<NodeId, NodeId>,
): DocumentSnapshot => {
  const to = (id: NodeId): NodeId => idMap.get(id) ?? id

  const nodes: Record<string, Node> = {}
  for (const [id, node] of Object.entries(doc.nodes)) {
    // Props are copied by reference on purpose: a `DocumentRef` inside them must come through
    // untouched, and nothing else in a prop is a NodeId the engine can recognise.
    nodes[to(id as NodeId)] = { ...node, id: to(node.id) }
  }

  const childIds: Record<string, readonly NodeId[]> = {}
  for (const [id, children] of Object.entries(doc.childIds)) {
    childIds[to(id as NodeId)] = children.map(to)
  }

  return { ...doc, nodes, childIds, rootIds: doc.rootIds.map(to) }
}
