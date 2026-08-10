/**
 * Workflow — a coach's automation, as a graph.
 *
 * The seventh and last editor, and the only one where a library owns interaction: React Flow, per
 * handbook D-11. It is also the first document here that is genuinely a GRAPH — every other editor
 * is a list or a list of lists, and a graph is the one shape a tree cannot hold, because two
 * branches of a condition may converge on the same action.
 *
 * Two decisions are recorded next to the code rather than here, because that is where they bind:
 *
 *   `editor/schema.ts`   an edge is a document NODE, not a new field on `DocumentSnapshot`. D-11
 *                        named a `ConnectPorts` action; the deviation and its reasoning are there.
 *   `topology/graph.ts`  every legality rule, and why each is a refusal rather than a correction —
 *                        the opposite stance from the report canvas, which displaces.
 *
 * Nothing here runs a workflow. The backend does; the client authors one and checks that what it
 * authored could run.
 */
export * from './domain/Workflow'
export * from './topology/graph'
export * from './editor/schema'
export * from './application/index'
