/**
 * Lightweight, dependency-free helpers for tests that mutate `process.env`.
 *
 * Kept separate from `e2e-helpers.ts` (which pulls in Nest testing modules) so
 * pure unit specs can import it without dragging in the Nest runtime.
 */

/**
 * Restore an env var to a previously captured value, deleting it when the
 * original was unset. Pair with a captured `process.env[name]` in `beforeEach`
 * / `beforeAll` to avoid leaking state into sibling tests.
 */
export function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
