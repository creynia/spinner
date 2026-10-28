// "Check for updates" (architecture.md §8.1): the PWA code registers how to check; Settings calls
// it. The default asks the service worker registration to look for a new version.
export type UpdateResult = 'available' | 'current' | 'unsupported';
export type UpdateChecker = () => Promise<UpdateResult>;

const defaultChecker: UpdateChecker = async () => {
  try {
    if (!('serviceWorker' in navigator)) return 'unsupported';
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return 'unsupported';
    await reg.update();
    return reg.waiting || reg.installing ? 'available' : 'current';
  } catch {
    return 'unsupported';
  }
};

let checker: UpdateChecker = defaultChecker;
/** The PWA layer may replace the check (e.g. to use its own registration). */
export function setUpdateChecker(c: UpdateChecker | null): void {
  checker = c ?? defaultChecker;
}
export function checkForUpdates(): Promise<UpdateResult> {
  return checker();
}
