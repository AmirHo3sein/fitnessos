/**
 * Playwright global setup: reset the stub API before the suite runs.
 *
 * Runs before the webServer processes are guaranteed up, so a connection failure is tolerated —
 * a stub that is not yet listening has no state to clear, which is the desired end condition
 * anyway. A hard failure here would turn a cold start into a red suite.
 */
export default async function resetStub(): Promise<void> {
  const base = process.env['STUB_API_URL'] ?? 'http://127.0.0.1:8791'
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await fetch(`${base}/__reset`, { method: 'POST' })
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
}
