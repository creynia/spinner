/** Props every routed screen receives (architecture.md §6.2). Screens validate their own params. */
export interface ScreenProps {
  /** Path params, e.g. `{ runId: 'abc' }` for `/run/:runId`. */
  params: Record<string, string>;
  /** Query string of the hash, e.g. `?tab=risk`. */
  query: URLSearchParams;
}
