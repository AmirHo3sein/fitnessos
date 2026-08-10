import {
  emptyDocument,
  type DocumentSnapshot,
  type Node,
  type NodeId,
} from '@fitnessos/editor-engine'
import type { ProgramVersionSnapshot } from '../application/index'
import type { ProgressionKind } from '../domain/ProgressionIntent'

/**
 * The Program Builder's document schema, and the hydrate/commit pair (handbook D-09).
 *
 * A programme version becomes an editor document: one node per block, order carried by `rootIds`.
 * Blocks have no children yet, so the tree is flat — but it is stored in the general document
 * structure rather than an array, so nested blocks later are a schema change and not a rewrite.
 *
 * ## The failure this file exists to prevent
 *
 * Hydrate loses a field, the user edits something unrelated, commit writes the document back, and
 * the missing field is gone. It is **silent data loss on save** — the worst kind, because the user
 * did nothing wrong and the system reported success.
 *
 * Two mechanisms guard it, and they catch different things:
 *
 *   `HYDRATE_COVERAGE`   a compile-time map over every field of the snapshot. Adding a field to
 *                        `ProgramVersionSnapshot` without deciding where it goes is a type error
 *                        at one line.
 *   the round-trip test  a property test asserting `commit(hydrate(x))` deep-equals `x` for
 *                        arbitrary programmes. Catches mappings that exist but are wrong.
 *
 * ## A deviation from the handbook's example, and why
 *
 * D-09 shows the coverage map keyed by `ContractProgramVersion`. That cannot be done here:
 * `no-contracts-escape` confines contract types to `infra/mappers`, and this is a bounded context.
 * The contract↔snapshot coverage already exists in `infra/mappers/program.ts` (`PROGRAM_COVERAGE`);
 * this file owns the snapshot↔document half. Together they cover the same ground, in the two places
 * the boundary rules allow.
 */

export const PROGRAM_SCHEMA_ID = 'program'
export const PROGRAM_SCHEMA_VERSION = 1

/** The single node type a programme document contains today. */
export const BLOCK_NODE = 'block'

export interface BlockProps {
  readonly name: string
  readonly progressionKind: ProgressionKind
  /** Null for anything but `linear`. Mirrors the domain rule rather than restating it. */
  readonly ratePercent: number | null
}

/**
 * Fields the builder does not edit, carried through a round trip untouched.
 *
 * Explicit rather than implicit: an editor that silently dropped `servesGoal` because nobody
 * thought about it would erase a coach's stated purpose the first time anyone renamed a block.
 */
export interface PreservedFields {
  readonly id: ProgramVersionSnapshot['id']
  readonly programId: ProgramVersionSnapshot['programId']
  readonly versionNumber: ProgramVersionSnapshot['versionNumber']
  readonly servesGoal: ProgramVersionSnapshot['servesGoal']
  readonly authoredBy: ProgramVersionSnapshot['authoredBy']
}

export interface ProgramDraft {
  readonly document: DocumentSnapshot
  readonly preserved: PreservedFields
}

/**
 * Where every field of the snapshot goes.
 *
 * `document` — becomes editable content. `preserved` — carried through unchanged.
 *
 * Adding a field to `ProgramVersionSnapshot` without adding it here is a compile error, which is
 * the entire point: the default outcome of forgetting must be a failed build, not lost data.
 */
export const HYDRATE_COVERAGE: Record<keyof ProgramVersionSnapshot, 'document' | 'preserved'> = {
  blocks: 'document',
  id: 'preserved',
  programId: 'preserved',
  versionNumber: 'preserved',
  servesGoal: 'preserved',
  authoredBy: 'preserved',
}

const blockProps = (props: Readonly<Record<string, unknown>>): BlockProps => ({
  name: typeof props['name'] === 'string' ? props['name'] : '',
  progressionKind:
    props['progressionKind'] === 'linear' || props['progressionKind'] === 'autoregulated'
      ? props['progressionKind']
      : 'fixed',
  ratePercent: typeof props['ratePercent'] === 'number' ? props['ratePercent'] : null,
})

export const hydrate = (version: ProgramVersionSnapshot): ProgramDraft => {
  const document = emptyDocument(PROGRAM_SCHEMA_ID, PROGRAM_SCHEMA_VERSION)

  const nodes: Record<string, Node> = {}
  const childIds: Record<string, readonly NodeId[]> = {}
  const rootIds: NodeId[] = []

  // Sorted by `order` here so the DOCUMENT's own sequence is the source of truth from this point
  // on. The editor reorders by moving ids in `rootIds`; carrying a separate `order` field would
  // give the same fact two homes, and they would disagree the first time a drag updated one.
  for (const block of [...version.blocks].sort((a, b) => a.order - b.order)) {
    const nodeId = block.id as NodeId
    nodes[nodeId] = {
      id: nodeId,
      type: BLOCK_NODE,
      props: {
        name: block.name,
        progressionKind: block.progression.kind,
        ratePercent: block.progression.ratePercent,
      },
    }
    childIds[nodeId] = []
    rootIds.push(nodeId)
  }

  return {
    document: { ...document, nodes, childIds, rootIds },
    preserved: {
      id: version.id,
      programId: version.programId,
      versionNumber: version.versionNumber,
      servesGoal: version.servesGoal,
      authoredBy: version.authoredBy,
    },
  }
}

export const commit = (draft: ProgramDraft): ProgramVersionSnapshot => ({
  ...draft.preserved,
  // `order` is derived from position in `rootIds`, which is why the invariant "orders are exactly
  // 0..n-1" can never be violated by the editor: the index IS the order.
  blocks: draft.document.rootIds.map((nodeId, index) => {
    const node = draft.document.nodes[nodeId]
    const props = blockProps(node?.props ?? {})
    return {
      id: nodeId,
      name: props.name,
      order: index,
      progression: { kind: props.progressionKind, ratePercent: props.ratePercent },
    }
  }),
})

/**
 * Strip what a round trip is not required to preserve.
 *
 * Only `order` is normalised, because it is DERIVED on commit — a draft whose blocks arrived with
 * orders 5, 9, 12 legitimately commits as 0, 1, 2. Everything else must survive exactly, and the
 * round-trip test compares it verbatim.
 */
export const normalize = (version: ProgramVersionSnapshot): ProgramVersionSnapshot => ({
  ...version,
  blocks: [...version.blocks]
    .sort((a, b) => a.order - b.order)
    .map((block, index) => ({ ...block, order: index })),
})
