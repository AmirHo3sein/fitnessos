import type { ZodType } from 'zod'
import { ContractViolationError } from '../http/errors'

/**
 * Validate a response body against its generated contract schema before mapping it
 * (ADR-0031).
 *
 * This lives in `mappers/` rather than in the http client, and that placement is the
 * decision worth defending:
 *
 *   - The mapper is the anticorruption layer. Validating the wire shape *is* its job;
 *     an earlier version only transformed, and trusted the shape it was handed.
 *   - The client stays a transport. It knows nothing about which schema belongs to
 *     which path, so it needs no registry to keep in step with the spec.
 *   - A failure names a resource and a field path, because the mapper knows what it
 *     was mapping. A validator inside the client would only know the URL.
 *
 * Every mapper's entry point takes `unknown`. That is what makes validation
 * unskippable: there is no typed value to pass in without going through here.
 */
/**
 * Compile-time assertion that two generated views of the same schema agree on their
 * field set — the openapi-typescript type and the Zod-inferred type.
 *
 * Both come from one spec file in one generator run, so they should never differ.
 * "Should never" is exactly the class of claim worth spending four lines to check:
 * if the two tools ever disagree about what a schema contains, the type says one
 * thing while the validator enforces another, and every guarantee in this layer is
 * quietly void.
 *
 * Field *sets* rather than full assignability, deliberately. `z.number().optional()`
 * infers `number | undefined`, while openapi-typescript emits `number` on an optional
 * key — under `exactOptionalPropertyTypes` those are not mutually assignable. The
 * difference is unobservable for JSON input, since JSON cannot express `undefined`:
 * a key is either absent or holds a real value. Asserting full assignability would
 * therefore fail on an artefact and force a cast that hides real drift too.
 */
export type FieldsAgree<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : { missingFromA: Exclude<keyof B, keyof A> }
  : { missingFromB: Exclude<keyof A, keyof B> }

export const parseContract = <T>(schema: ZodType<T>, raw: unknown, resource: string): T => {
  const result = schema.safeParse(raw)
  if (result.success) return result.data

  throw new ContractViolationError(
    resource,
    result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  )
}
