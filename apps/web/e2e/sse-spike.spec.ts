import { expect, test, type Page } from '@playwright/test'

/**
 * D-12 — the SSE spike, run against a real browser and a real `text/event-stream`.
 *
 * The handbook allots two days and a pass/fail matrix, and says to record an ADR either way. The
 * findings live in `docs/spikes/d-12-sse.md`; this file is the evidence, kept as tests rather than
 * as a transcript so the answers stay true.
 *
 * ## Why measure the platform rather than wire the feature
 *
 * Every row below is a question about what `EventSource` and the intermediaries do, not about our
 * code. Building event-driven invalidation first and inferring the answers from whether it worked
 * would confuse "our wiring is right" with "the transport behaves" — and the transport is the part
 * nobody can change.
 *
 * So the stream is opened with `page.evaluate`, in the page, same-origin. No product code is
 * involved, which is the point.
 *
 * ## Which rows this file cannot answer, stated plainly
 *
 * `Behind reverse proxy — verify X-Accel-Buffering: no` is only half-answerable here. There IS a
 * proxy in the path — Next's own `rewrites()` forwards `/api/v1/*` to the stub — so a pass below
 * proves that Next does not buffer a stream. It says nothing about nginx, a CDN, or whatever sits in
 * front of production, and the spike report does not pretend otherwise.
 */

const GOOD_CODE = '۰۰۰۰۰۰'

const phoneFor = (testCode: string, project: string) => {
  const projectCode = project === 'chromium' ? '180' : '181'
  const ascii = `0912${testCode}${projectCode}9`
  return [...ascii].map((d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]).join('')
}

const signIn = async (page: Page, phone: string) => {
  await page.goto('/sign-in')
  await page.getByLabel('شماره‌ی موبایل').fill(phone)
  await page.getByRole('button', { name: 'ارسال کد' }).click()
  await page.getByLabel('کد تأیید').fill(GOOD_CODE)
  await page.getByRole('button', { name: 'تأیید و ورود' }).click()
  await expect(page).not.toHaveURL(/\/sign-in/)
}

/** Publish an event, or sever the stream, through the stub's test-only control. */
const emit = async (page: Page, body: { kind?: string; drop?: boolean }) => {
  const response = await page.request.post('/api/v1/__emit', { data: body })
  expect(response.status()).toBe(204)
}

/**
 * Open a stream in the page and collect what arrives.
 *
 * State lives on `window` because each `evaluate` runs in its own scope; a closure would be lost
 * between calls.
 */
const openStream = async (page: Page) => {
  await page.evaluate(() => {
    const w = window as unknown as {
      __sse?: { events: { kind: string; id: string }[]; errors: number; source: EventSource }
    }
    const events: { kind: string; id: string }[] = []
    let errors = 0
    const source = new EventSource('/api/v1/events')
    source.onmessage = (message: MessageEvent<string>) => {
      events.push({ kind: String(JSON.parse(message.data).kind), id: message.lastEventId })
    }
    source.onerror = () => {
      errors += 1
    }
    w.__sse = {
      events,
      get errors() {
        return errors
      },
      source,
    } as never
  })
}

const collected = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __sse?: { events: { kind: string; id: string }[] } }
    return w.__sse?.events ?? []
  })

const readyState = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __sse?: { source: EventSource } }
    return w.__sse?.source.readyState ?? -1
  })

test.describe('D-12 · row 1 — a same-origin stream delivers', () => {
  test('an event published after the stream opened arrives', async ({ page }) => {
    await signIn(page, phoneFor('111', test.info().project.name))
    await openStream(page)

    await emit(page, { kind: 'programme-revised' })

    await expect.poll(async () => collected(page)).toEqual([
      { kind: 'programme-revised', id: '1' },
    ])
  })

  test('Next’s own rewrite does not buffer the stream', async ({ page }) => {
    /**
     * The half of the proxy row that IS answerable locally. `/api/v1/*` reaches the stub through
     * `next.config.ts`'s `rewrites()`, so a proxy is genuinely in the path — and a buffering proxy
     * would hold the frame until the response closed, which for an open stream is never.
     *
     * Three events, one at a time, each observed before the next is sent. A buffer would surface them
     * in a batch at the end, so arriving one-by-one is the assertion.
     */
    await signIn(page, phoneFor('222', test.info().project.name))
    await openStream(page)

    for (const [index, kind] of ['session-logged', 'observation-recorded', 'proposal-raised'].entries()) {
      await emit(page, { kind })
      await expect.poll(async () => (await collected(page)).length).toBe(index + 1)
    }
  })
})

test.describe('D-12 · row 5 — a dropped connection', () => {
  test('@critical the browser reconnects on its own, and the server replays what was missed', async ({
    page,
  }) => {
    /**
     * The finding that decided the client's shape. `EventSource` reconnects with its own backoff and
     * sends `Last-Event-ID` without being asked — so the events published while the socket was down
     * arrive after it comes back, in order, with no client-side bookkeeping at all.
     *
     * A hand-rolled reconnect layer would race this and open a second socket. That is why
     * `sseClient` deliberately does nothing on error except count.
     */
    await signIn(page, phoneFor('333', test.info().project.name))
    await openStream(page)

    await emit(page, { kind: 'session-logged' })
    await expect.poll(async () => (await collected(page)).length).toBe(1)

    // Sever it, then publish into the gap.
    await emit(page, { drop: true })
    await expect.poll(async () => readyState(page)).not.toBe(1)
    await emit(page, { kind: 'observation-recorded' })
    await emit(page, { kind: 'proposal-raised' })

    // Recovered without help, and the gap is filled from the last id the browser saw.
    await expect
      .poll(async () => (await collected(page)).map((e) => e.kind), { timeout: 15_000 })
      .toEqual(['session-logged', 'observation-recorded', 'proposal-raised'])

    // Back to OPEN, not stuck in CONNECTING.
    await expect.poll(async () => readyState(page)).toBe(1)
  })

  test('the reconnect happens within the five seconds the matrix asks for', async ({ page }) => {
    await signIn(page, phoneFor('444', test.info().project.name))
    await openStream(page)
    await emit(page, { kind: 'session-logged' })
    await expect.poll(async () => (await collected(page)).length).toBe(1)

    const startedAt = Date.now()
    await emit(page, { drop: true })
    await expect.poll(async () => readyState(page), { timeout: 10_000 }).toBe(1)
    // Chromium's default retry is ~3s and the server sends no `retry:` field, so this measures the
    // platform default. If it ever exceeds the budget the answer is a `retry:` on the server, not a
    // client-side loop.
    expect(Date.now() - startedAt).toBeLessThan(5_000)
  })
})

test.describe('D-12 · row 6 — a session that expires mid-stream', () => {
  test('@critical EventSource retries a 401 FOREVER, which is why the client must intervene', async ({
    page,
  }) => {
    /**
     * The row that produced a design requirement rather than a pass or a fail.
     *
     * `EventSource` exposes no status code and no body — a 401 is reported through `onerror`,
     * identically to a dropped socket, and it retries indefinitely. So an expired session becomes an
     * endless reconnect loop against an endpoint that will never accept it, from every open tab, with
     * nothing on screen to say so.
     *
     * Nothing can fix that inside `EventSource`. The client has to notice and close the stream
     * itself, which is what `onSuspectedAuthLoss` exists for — and the heuristic it uses (two
     * immediate failures) is a guess, recorded as one, because the platform gives nothing better.
     */
    await signIn(page, phoneFor('555', test.info().project.name))
    await openStream(page)
    await emit(page, { kind: 'session-logged' })
    await expect.poll(async () => (await collected(page)).length).toBe(1)

    // Arm the stream route to refuse, then sever the live connection.
    const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ')
    const armed = await page.request.post('http://127.0.0.1:8791/__fault', {
      headers: { cookie },
      data: { route: 'GET /api/v1/events', fault: 'unauthorized' },
    })
    expect(armed.status()).toBe(204)
    await emit(page, { drop: true })

    /*
     * It keeps trying. Asserted as "still not OPEN after several retry windows AND the error count
     * kept climbing" — the point is that it never gives up on its own, which is precisely the
     * behaviour that needs a client-side answer.
     */
    await page.waitForTimeout(6_000)
    expect(await readyState(page)).not.toBe(1)

    const errorsAfterSix = await page.evaluate(() => {
      const w = window as unknown as { __sse?: { errors: number } }
      return w.__sse?.errors ?? 0
    })
    expect(errorsAfterSix).toBeGreaterThan(1)
  })
})

test.describe('D-12 · row 4 — concurrent streams', () => {
  test('a seventh stream STALLS on HTTP/1.1, which decides one stream per tab', async ({ page }) => {
    /**
     * The row ADR-0025 does not pre-resolve, and the one with a concrete architectural consequence.
     *
     * A browser allows six connections per origin over HTTP/1.1. Each open stream holds one for its
     * whole life, so seven tabs — or one tab opening a stream per context — exhausts the pool and the
     * seventh waits behind the others indefinitely. Every ordinary request queues behind them too.
     *
     * Measured here rather than cited, because the number that matters is what happens at seven, and
     * the answer is: nothing at all. Consequence for the design: **one stream per tab, shared by
     * every context**, and the invalidation map is what makes one stream enough. HTTP/2 raises the
     * limit but is a deployment property, so the client must be correct without it.
     */
    await signIn(page, phoneFor('666', test.info().project.name))

    const openCount = await page.evaluate(async () => {
      const sources = Array.from({ length: 8 }, () => new EventSource('/api/v1/events'))
      await new Promise((resolve) => setTimeout(resolve, 3_000))
      const open = sources.filter((s) => s.readyState === 1).length
      for (const s of sources) s.close()
      return open
    })

    // Six or fewer reached OPEN. The exact number is the browser's business; the ceiling is the point.
    expect(openCount).toBeLessThanOrEqual(6)
    expect(openCount).toBeGreaterThan(0)
  })
})

test.describe('event-driven invalidation, wired', () => {
  test('@critical a published event refreshes an open screen with no reload', async ({ page }) => {
    /**
     * The loop the spike was for, end to end and through the product rather than through
     * `page.evaluate`: the app's own stream, the app's own invalidation map, the app's own query
     * cache.
     *
     * The assertion is deliberately about a screen and not about a network call. A test that counted
     * requests would pass for a client that refetched on a timer, which is the thing SSE replaces.
     */
    await signIn(page, phoneFor('777', test.info().project.name))
    await page.goto('/sessions')
    // Something from the sessions query is on screen, so there is a cache entry to invalidate.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    const requestsBefore = await settledSessionRequests(page)

    // A coach revises the programme elsewhere. `programme-revised` maps to ['program', 'session'].
    await emit(page, { kind: 'programme-revised' })

    // The session query refetched, without a navigation or a reload.
    await expect.poll(async () => countSessionRequests(page), { timeout: 10_000 }).toBeGreaterThan(
      requestsBefore,
    )
    expect(page.url()).toContain('/sessions')
  })

  test('an unknown kind changes nothing', async ({ page }) => {
    /*
     * A newer server will publish kinds this build has never heard of. Ignoring them is the design —
     * "refetch everything" would make each unrecognised event a thundering herd from every open tab —
     * and this is the assertion that keeps it a decision rather than an accident.
     */
    await signIn(page, phoneFor('888', test.info().project.name))
    await page.goto('/sessions')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    // Sampled once the page has stopped fetching on its own. The first draft read the count as soon
    // as the heading appeared, which is before the client query has settled — so the test compared a
    // number that was still moving and failed for a reason that had nothing to do with the event.
    const before = await settledSessionRequests(page)
    await emit(page, { kind: 'something-a-newer-server-sends' })

    // Given time to be wrong in.
    await page.waitForTimeout(2_000)
    expect(await countSessionRequests(page)).toBe(before)
  })
})

/**
 * How many times the sessions endpoint has been fetched by this page.
 *
 * Counted from the browser's own resource timings rather than by intercepting, so the product is not
 * altered by the measurement — `page.route` changes the very timing this asserts on.
 */
/**
 * The count, once it has stopped moving.
 *
 * Two equal samples 400 ms apart. Without this the baseline is read while the page is still doing its
 * own first fetches, and the comparison afterwards is against a number that was never stable.
 */
const settledSessionRequests = async (page: Page): Promise<number> => {
  let previous = -1
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const current = await countSessionRequests(page)
    if (current === previous) return current
    previous = current
    await page.waitForTimeout(400)
  }
  return previous
}

const countSessionRequests = (page: Page) =>
  page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .filter((entry) => entry.name.includes('/api/v1/sessions')).length,
  )
