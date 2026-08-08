import { isErr, newEntityId, type ProgramVersionId } from '@fitnessos/kernel'
import { programVersion, type Block, type ProgramVersionError } from '../domain/ProgramVersion'
import { progressionIntent, type ProgressionIntentError } from '../domain/ProgressionIntent'
import type {
  BlockSnapshot,
  PrescriptionPorts,
  ProgramSnapshot,
  ProgramVersionSnapshot,
} from './ports/index'

/**
 * Revise a programme: validate the proposed structure, then send it.
 *
 * ## Why the rules run here and not in the hook
 *
 * D-05: the hook composes, the use case decides. A block-order invariant tested through a
 * renderer is a test of the renderer.
 *
 * ## Why only the NEXT version is validated, never the current one
 *
 * The obvious implementation reconstructs the current aggregate and calls `revise()` on it. It
 * is wrong, and the reason is worth stating: the read model is a TOLERANT READER by design, so
 * it accepts programmes written before a rule existed. Validating the current version would
 * therefore refuse to open the editor on exactly the programmes that most need fixing — a
 * legacy programme with duplicate block orders becomes uneditable, forever, by the tool whose
 * job is to fix it.
 *
 * So `programVersion()` is called on the proposed structure alone. `versionNumber` is supplied
 * only because the constructor requires one; it is never sent, because the lineage assigns it
 * (see `ReviseProgramBody`).
 */

/**
 * Why this is a union rather than `ProgramVersionError` alone: a block's progression is its own
 * value object with its own rules, and "rate on a fixed block" is not a fact about the version.
 * Carrying the block id makes the message placeable on the row that caused it.
 */
export type ReviseError =
  | ProgramVersionError
  | {
      readonly kind: 'block-progression-invalid'
      readonly blockId: string
      readonly reason: ProgressionIntentError
    }

export class ProgramValidationError extends Error {
  override readonly name = 'ProgramValidationError'
  constructor(readonly problem: ReviseError) {
    super(problem.kind)
  }
}

/**
 * Someone else revised this programme while it was open here.
 *
 * Carries the programme as the server now holds it, because a conflict the author cannot see is
 * a conflict they cannot resolve (ADR-0033). Both sides survive: the local document is still in
 * the editor, and `current` is what it collided with.
 */
export class ProgramConflictError extends Error {
  override readonly name = 'ProgramConflictError'
  constructor(readonly current: ProgramSnapshot) {
    super('the programme was revised elsewhere')
  }
}

/**
 * Blocks, through the domain constructors.
 *
 * `progressionIntent` is where "a fixed block must not carry a rate" is enforced. The builder
 * already clears the rate when the kind changes, and this is what makes that a guarantee rather
 * than a habit of one component — a second builder, or an AI proposal, gets the same check.
 */
const toDomainBlocks = (blocks: readonly BlockSnapshot[]): Block[] | ReviseError => {
  const built: Block[] = []
  for (const block of blocks) {
    const intent = progressionIntent(block.progression.kind, block.progression.ratePercent)
    if (isErr(intent)) {
      return { kind: 'block-progression-invalid', blockId: block.id, reason: intent.error }
    }
    built.push({
      id: block.id,
      name: block.name,
      order: block.order,
      progressionIntent: intent.value,
    })
  }
  return built
}

export const reviseProgram = async (
  ports: PrescriptionPorts,
  base: ProgramVersionSnapshot,
  next: ProgramVersionSnapshot,
  signal?: AbortSignal,
): Promise<ProgramSnapshot> => {
  const blocks = toDomainBlocks(next.blocks)
  if (!Array.isArray(blocks)) throw new ProgramValidationError(blocks)

  const validated = programVersion({
    id: next.id,
    programId: next.programId,
    // Any positive integer satisfies the constructor; the real number comes back from the server.
    versionNumber: base.versionNumber + 1,
    blocks,
    servesGoal: next.servesGoal,
    authoringDecision: { ...next.authoredBy, rationale: null },
  })
  if (isErr(validated)) throw new ProgramValidationError(validated.error)

  return ports.prescription.revise(
    {
      programId: next.programId,
      // A NEW id for the new version, generated client-side (ADR-0010). Reusing `next.id` would
      // send the id of the version being edited, and the server would read it as a replay of
      // something it already stored.
      id: newEntityId() as ProgramVersionId,
      baseVersionId: base.id,
      // The domain's own output: sorted, and validated. Sending `next.blocks` would send whatever
      // order the editor happened to hold.
      blocks: validated.value.blocks.map((block) => ({
        id: block.id,
        name: block.name,
        order: block.order,
        progression: {
          kind: block.progressionIntent.kind,
          ratePercent: block.progressionIntent.ratePercent,
        },
      })),
      servesGoal: next.servesGoal,
      authoredBy: next.authoredBy,
    },
    signal,
  )
}
