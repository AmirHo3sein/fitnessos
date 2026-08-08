/**
 * @fitnessos/ctx-development — public API barrel.
 *
 * This file IS the published contract of this bounded context. Nothing outside
 * may import an undeclared path (`no-deep-imports`). No other context may import
 * this one at all (`no-cross-context`) — cross-context composition happens only
 * in apps/web/composition.
 *
 * `presentation` is deliberately NOT re-exported here. It is reachable through
 * the declared `./presentation` subpath export instead, so that framework-free
 * consumers — infra, other application layers — cannot pull React into their
 * dependency graph transitively by importing this barrel.
 *
 * Export layers, never individual files. If a consumer needs something absent
 * here, the question is whether it should be public, not whether the barrel
 * should grow.
 */

export * as domain from './domain/index'
export * as application from './application/index'
