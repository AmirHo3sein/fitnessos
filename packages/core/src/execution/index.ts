/**
 * Execution — what was prescribed and what was actually done.
 *
 * ADR-0021: a `PrescribedSession` cannot be constructed without a `ScreeningVerdict` covering
 * its final resolved dose. The ordering matters and is easy to get backwards — screening an
 * intent is worthless, because an intent has no numbers to screen. Only a resolved dose can be
 * checked against a restriction, so screening happens after resolution and before the session
 * exists. A session that existed first and was screened afterwards would have a window in
 * which it was prescribable and unscreened.
 *
 * NOT here yet: `PerformedSession` and logging. Logging is a write path against a live session
 * with offline requirements (handbook `infra/sync`, storage adapters, serialization/migrate),
 * none of which exists. A logger that silently loses a set an athlete completed in a gym with
 * no signal is worse than no logger.
 */
export * from './domain/ScreeningVerdict'
export * from './domain/PrescribedSession'
export * from './domain/PerformedSession'
export * from './application/index'
