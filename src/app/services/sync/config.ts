// Sync build configuration (sync.md §4.5, §12). The OAuth client id is public by design.
// The owner's OAuth client id is committed as the default (WP-S3). It is public by design: the
// implicit/token flow has no client secret, and none may ever be committed here.
export const COMMITTED_CLIENT_ID =
  '136534818548-gt8occ10t0m2kjgnvv8sgmpu61eqi3gn.apps.googleusercontent.com';

/** '' = unconfigured. `VITE_GOOGLE_CLIENT_ID` overrides the committed default. */
export const GOOGLE_CLIENT_ID: string =
  import.meta.env.VITE_GOOGLE_CLIENT_ID || COMMITTED_CLIENT_ID;
