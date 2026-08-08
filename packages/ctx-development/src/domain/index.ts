/**
 * Development — domain layer.
 *
 * D-06: this layer exists ONLY for aggregates that must be authored without a
 * server. Across the whole system that is exactly two — PerformedSession and
 * Observation. Everything else the client sees is a read model or a command DTO,
 * and belongs in `application/`, not here.
 *
 * If you are about to add an aggregate here, first answer: can a user create
 * this while offline in a gym basement? If no, it does not belong in this layer.
 *
 * Advisory replicas of server rules go in `domain/advisory/` and are named as
 * such. The server is always the authority; a client/server disagreement is
 * resolved server-side, every time.
 */

export {}
