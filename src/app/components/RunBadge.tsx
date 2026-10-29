// "☁ In Drive" on a run row that is in the person's Google Drive and not on this device (sync.md §8.4).
import './sync.css';

export function RunBadge() {
  return (
    <span class="run-badge" title="In your Google Drive">
      <span aria-hidden="true">☁</span> In Drive
    </span>
  );
}

/** "Paused on Laptop · 43%" for a stub whose results never reach this device. */
export function stubLine(r: {
  status: string;
  sessions: number;
  completedSessions: number;
  remote?: { ownerName?: string };
}): string {
  const pct = r.sessions ? Math.floor((r.completedSessions / r.sessions) * 100) : 0;
  const status = r.status.charAt(0).toUpperCase() + r.status.slice(1);
  return `${status} on ${r.remote?.ownerName ?? 'another device'} · ${pct}%`;
}
