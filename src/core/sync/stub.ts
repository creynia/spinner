// Shared by the WP-S0 stubs: each stub throws until its work package replaces the body.
// Signatures are frozen (docs/design/sync.md §4.4); only the bodies change.

/** The error every unfinished stub raises: "not implemented (WP-S2a): foldEntries". */
export function notImplementedError(wp: string, what: string): Error {
  return new Error(`not implemented (WP-${wp}): ${what}`);
}

/** For synchronous stubs: throws. */
export function notImplemented(wp: string, what: string): never {
  throw notImplementedError(wp, what);
}

/** For Promise-returning stubs: rejects (never throws synchronously). */
export function notImplementedAsync<T>(wp: string, what: string): Promise<T> {
  return Promise.reject(notImplementedError(wp, what));
}
