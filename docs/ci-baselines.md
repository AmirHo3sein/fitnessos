# Visual baselines and the platform they belong to

Playwright suffixes a screenshot baseline with `process.platform`, so `visual.spec.ts` needs
`-darwin` images to run on a laptop and `-linux` images to run in CI. Both sets are committed —
36 files each, in `apps/web/e2e/visual.spec.ts-snapshots/`.

## What a missing baseline actually does

**It fails the run.** This is worth stating because the workflow used to claim the opposite:

> The first run on a new platform writes its own and reports them as missing rather than failing;
> commit those from the run's artefact.

Both halves were wrong. Verified twice — empirically, by deleting one baseline and running with
`CI=1` (the run reports *"A snapshot doesn't exist … writing actual"* and exits non-zero), and in the
pinned Playwright 1.62.1 source, where `handleMissing` returns a `softError` together with
`shouldNotRetryTest: true`. The retry is skipped **deliberately**: a second attempt would grade the
baseline the first attempt had just written and manufacture a false pass. `--update-snapshots=missing`
does not help either; it writes the file and still fails.

So a platform without committed baselines does not bootstrap itself. It stays red.

## Why the CI job runs in a container

`ubuntu-latest` and the Playwright image do not have the same fonts, and a screenshot is a picture of
fonts. Baselines generated anywhere other than where they are compared trade a red build for a diff
nobody can explain — a 1% threshold does not absorb different glyph rasterisation.

So `scheduled.yml`'s `e2e-full` job pins the image, and the committed `-linux` baselines were
generated in that same image. This is the only arrangement in which a visual diff in CI means what it
says.

## Regenerating them

Needed when a screenshot legitimately changes (a layout change, new copy, a new masked region), or
when the Playwright version moves.

```sh
docker run --rm --ipc=host --user pwuser \
  -v "$PWD":/src:ro -v /tmp/out:/out \
  mcr.microsoft.com/playwright:v1.62.1-noble bash -c '
    set -e
    export STUB_API_URL=http://127.0.0.1:8791 \
           INTERNAL_API_URL=http://127.0.0.1:8791/api/v1 CI=1
    mkdir -p /tmp/work && cd /tmp/work
    tar -C /src -cf - --exclude=node_modules --exclude=.next --exclude=.turbo \
        --exclude=.git --exclude=test-results --exclude=playwright-report . | tar -xf -
    mkdir -p /tmp/bin
    corepack enable pnpm --install-directory /tmp/bin
    export PATH=/tmp/bin:$PATH
    pnpm install --frozen-lockfile --silent
    pnpm --filter @fitnessos/web build
    pnpm --filter @fitnessos/web exec playwright test visual.spec.ts --update-snapshots
    cp apps/web/e2e/visual.spec.ts-snapshots/*-linux.png /out/
  '
cp /tmp/out/*-linux.png apps/web/e2e/visual.spec.ts-snapshots/
```

Three details that are not incidental:

- **The repo is copied into the container, not built in place.** A bind-mounted `pnpm install` would
  overwrite the host's macOS-native binaries — esbuild, sharp, the Next SWC binary — and leave the
  laptop broken until a reinstall.
- **`corepack enable pnpm --install-directory`, then PATH.** Playwright's `webServer` spawns
  `pnpm start` through `/bin/sh`, which does not inherit a corepack shim. Without this the servers
  never start and the failure reads as `Exit code: 127` from `config.webServer`.
- **`--user pwuser` and `--ipc=host`.** Chromium's sandbox does not work as root, and the default
  `/dev/shm` is too small for a browser.

Then **verify by comparing, not by writing** — run the suite again with no update flag. Baselines
that were written but never compared are baselines nobody has checked are stable:

```sh
# same container invocation, but the last two lines become:
#   pnpm --filter @fitnessos/web e2e:full
```

The current `-linux` set was verified this way: 277 passed, 1 skipped, in 2.2 minutes — the same
result as macOS, including the one test skipped on `mobile-rtl` for an unresolved Playwright
hit-test disagreement.

## Bumping Playwright

Change the dependency and the `container.image` tag in `scheduled.yml` **together**, then regenerate.
A version skew between the image and the lockfile is a browser the tests were not written against.
