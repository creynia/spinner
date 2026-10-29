// Sync build configuration (sync.md §4.5, §12). The OAuth client id is public by design.
// WP-S3 commits the owner's client id as the default; until then the build is `unconfigured`.
export const COMMITTED_CLIENT_ID = '';

/** '' = unconfigured. `VITE_GOOGLE_CLIENT_ID` overrides the committed default. */
export const GOOGLE_CLIENT_ID: string =
  import.meta.env.VITE_GOOGLE_CLIENT_ID || COMMITTED_CLIENT_ID;
