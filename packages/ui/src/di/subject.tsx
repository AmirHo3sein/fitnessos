'use client'

import type { SubjectId } from '@fitnessos/kernel'
import { createDiContext } from './createDiContext'

/**
 * Whose data the surrounding surface is about.
 *
 * ## Why this is a DI context and not a prop, a hook argument, or a global
 *
 * ADR-0031 established that **ports are provided by the route group that uses them**. The subject is
 * the same kind of fact and arrives from the same place: the athlete route group provides the signed-in
 * athlete's own id, the coach route group provides the id in the URL. Every hook below reads it the way
 * it already reads its ports.
 *
 * Threading it as an argument through every hook was the alternative, and it fails on the first shared
 * component: a chart used by both surfaces would need the subject passed to it for no reason of its own,
 * and the seven editors — which are subject-agnostic by design — would acquire a parameter they must
 * never interpret.
 *
 * A module-level global was the other alternative and is worse: two subjects can be mounted at once (a
 * coach's roster page showing a preview alongside their own dashboard), and a global cannot represent
 * that. `createDiContext` throws when read outside a provider, so a surface that forgets to supply one
 * fails loudly at the first render rather than silently reading somebody else's id.
 */
const { Provider, useDi } = createDiContext<SubjectId>('Subject')

export { Provider as SubjectProvider, useDi as useSubject }
