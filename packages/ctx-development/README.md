# @fitnessos/ctx-development

Bounded context. Graduated to its own package because it has an editor or an
owning team (handbook §2.1 graduation rule).

## Where does X live?

| I want to… | Put it in |
|---|---|
| enforce a rule about an offline-authorable aggregate | `src/domain/` |
| replicate a server rule for fast feedback | `src/domain/advisory/` — **always advisory; server wins** |
| orchestrate a workflow | `src/application/usecases/` |
| define a query key, cache policy or invalidation rule | `src/application/queries/` |
| shape data for display with no invariants | `src/application/readmodels/` — suffix `View` |
| declare an interface for something external | `src/application/ports/` |
| hold selection, drafts or UI intent | `src/application/store/` (`zustand/vanilla`) |
| declare which events this context emits or reacts to | `src/application/events/` |
| wire React to a use case | `src/presentation/hooks/` — **40-line cap** |
| render something | `src/presentation/views/` |
| render something that spans two contexts | **`apps/web/composition/` — not here** |
| talk to HTTP | **`packages/infra/` — never here** |

## Rules this package is held to

1. Nothing outside imports a path deeper than `src/index.ts`.
2. No other `ctx-*` package appears in `dependencies`.
3. `domain/` and `application/` never import React, Next or `@tanstack/react-query`.
4. `presentation/` never imports `@fitnessos/infra`.
5. Contract types never appear here — only in `infra/mappers`.

`pnpm lint` fails on any violation. There are no waivers; the answer to a blocking
rule is an ADR in `docs/v2/adr/`.

## Commands

```bash
pnpm --filter @fitnessos/ctx-development typecheck
pnpm --filter @fitnessos/ctx-development lint
pnpm --filter @fitnessos/ctx-development test:unit
```
