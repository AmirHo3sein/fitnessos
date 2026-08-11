# Conformance suite

`BACKEND-CONTRACT.md` describes 29 requirements the backend must meet. Most of them are behavioural —
which status code, which distinction, which frame format — and none of them is checkable by reading an
OpenAPI schema. Until now the only way to verify them was for somebody to read the document.

This runs them.

```sh
CONFORMANCE_BASE_URL=https://api.example.test/api/v1 pnpm conformance
```

Every check names the section it enforces, so a failure is a line in the contract rather than a
puzzle. The output is written for someone who did not write the client.

## What it needs

- **A base URL.** Defaults to the local stub (`http://127.0.0.1:8791/api/v1`), which is how the suite
  proves itself: the stub is the contract's executable form, so a green run against it means the
  checks agree with the document, and `scheduled.yml` runs it that way nightly.
- **A session.** Either `CONFORMANCE_COOKIE` (a `Cookie:` header value, for a real backend) or
  `CONFORMANCE_PHONE` to drive the OTP flow, which is what the stub accepts.
- **Against the stub, a phone ending in `9`.** The stub seeds a programme and prescribed sessions only
  for those, so any other number produces two failures that say "seed one first" — correct behaviour
  reported against the wrong cause, and half an hour to work out. `+989126660009` works;
  `+989126660001` does not.
- **A disposable account.** Several checks WRITE: they log a session twice to prove the second is
  refused, publish a programme version to prove a stale `baseVersionId` is rejected. Do not point this
  at an account whose data matters.

## Before conformance: is it even there?

```sh
COVERAGE_BASE_URL=https://api.example.test/api/v1 pnpm conformance:coverage
```

The conformance suite asks "does this behave correctly?" and assumes the endpoint exists. For a backend
being built from nothing that is the wrong first question — every check would fail for the same
uninteresting reason. `conformance:coverage` probes all 31 operations unauthenticated and reports which
are wired, so the number goes from 0/31 to 31/31 as work lands. It is a map, not a gate: an
unimplemented endpoint is a to-do, not a regression.

It also lists what is absent in the order a vertical slice would want it — auth, then the athlete, then
goals, then the programme — because that ordering is the difference between a backend you can test
against and 31 half-built routes.

## What it does not check

The requirements that are not observable from outside a single request — §3.5 (ordering is not
promised, so nothing can be asserted about it), §3.7 (same-origin, a deployment property), §4.1 and
§4.2 (statements about what the client does not need). Each is listed in `skipped.ts` with the reason,
so the difference between "passes" and "not checked" is never left to inference.
