// SyncIndicator (sync.md §8.2): the cloud glyph in the TopBar (phones) and the NavRail (from
// 768 px). Hidden while sync is `off`. Also owns the shared status model the Account card uses.
import { useEffect, useRef, useState } from 'preact/hooks';
import { relativeTime } from '@core/ui';
import type { AuthState, SyncStatus } from '@core';
import { useStore } from '../state/store';
import * as sync from '../services/sync';
import './sync.css';

export type StatusTone = 'ok' | 'muted' | 'busy' | 'offline' | 'paused' | 'attention';
export type StatusAction =
  'sync' | 'reconnect' | 'signin' | 'update' | 'library' | 'link-drive' | null;

export interface StatusView {
  tone: StatusTone;
  /** The status line; also the indicator's aria-label. */
  text: string;
  action: StatusAction;
  /** True for the amber states (§8.2): never for a paused or merely offline device. */
  attention: boolean;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

const PHASE: Record<string, string> = {
  list: 'checking Drive',
  pull: 'getting changes',
  apply: 'applying changes',
  'upload-runs': 'uploading run',
  push: 'sending changes',
  'download-runs': 'downloading run',
  gc: 'tidying up',
};

function retryIn(retryAt: number | undefined, now: number): string {
  if (retryAt === undefined) return '';
  const min = Math.max(1, Math.ceil((retryAt - now) / 60_000));
  return ` · retrying in ${min} min`;
}

/** The status line, action and tone for a sync status (§8.1 table); `error` is keyed by code. */
export function statusView(
  st: SyncStatus,
  _auth: AuthState = { state: 'signed-out' },
  now: number = Date.now(),
): StatusView {
  const waiting = st.pending > 0 ? ` · ${plural(st.pending, 'change')} waiting` : '';
  switch (st.state) {
    case 'off':
      return { tone: 'muted', text: '', action: null, attention: false };
    case 'idle':
      return {
        tone: 'ok',
        text: st.lastSyncedAt ? `Up to date · ${relativeTime(st.lastSyncedAt, now)}` : 'Up to date',
        action: 'sync',
        attention: false,
      };
    case 'syncing': {
      const p = st.progress;
      let detail = '';
      if (p) {
        detail = `${PHASE[p.phase] ?? p.phase}`;
        if (p.total > 0 && (p.phase === 'upload-runs' || p.phase === 'download-runs'))
          detail += ` ${p.done} of ${p.total}`;
        if (p.bytes !== undefined) detail += ` (${formatBytes(p.bytes)})`;
      }
      return {
        tone: 'busy',
        text: `Syncing…${detail ? ` ${detail}` : ''}`,
        action: null,
        attention: false,
      };
    }
    case 'offline':
      return { tone: 'offline', text: `Offline${waiting}`, action: null, attention: false };
    case 'needs-auth':
      return st.pending > 0
        ? {
            tone: 'attention',
            text: `Sign-in expired${waiting}`,
            action: 'reconnect',
            attention: true,
          }
        : {
            tone: 'paused',
            text: 'Sync paused · sign in again to get changes from your other devices',
            action: 'reconnect',
            attention: false,
          };
    case 'waiting-run':
      return {
        tone: 'paused',
        text: 'Waiting for the run to finish',
        action: null,
        attention: false,
      };
    case 'backoff':
      return {
        tone: 'muted',
        text: `Google Drive is busy${retryIn(st.retryAt, now)}`,
        action: 'sync',
        attention: false,
      };
    case 'drive-full':
      return {
        tone: 'attention',
        text: 'Your Google Drive is full',
        action: 'link-drive',
        attention: true,
      };
    case 'local-full':
      return {
        tone: 'attention',
        text: 'This device is out of space · runs stay in Drive',
        action: 'library',
        attention: true,
      };
    case 'error': {
      const code = st.error?.code ?? 'unknown';
      switch (code) {
        case 'newer-layout':
          return {
            tone: 'attention',
            text: 'Drive data is from a newer spinner. Update the app.',
            action: 'update',
            attention: true,
          };
        case 'access-removed':
          return {
            tone: 'attention',
            text: 'Access was removed. Sign in again.',
            action: 'signin',
            attention: true,
          };
        case 'account-mismatch':
          return {
            tone: 'attention',
            text: 'This device is linked to a different Google account. Sign in with that account.',
            action: 'signin',
            attention: true,
          };
        case 'erased':
          return {
            tone: 'attention',
            text: 'Your Drive data was removed from another device. Sync is off here.',
            action: null,
            attention: true,
          };
        case 'auth':
          return {
            tone: 'attention',
            text: 'Sign-in expired',
            action: 'reconnect',
            attention: true,
          };
        case 'network':
        case 'quota':
        case 'unknown':
        default:
          return {
            tone: 'attention',
            text: st.error?.message ? `Sync problem: ${st.error.message}` : 'Sync hit a problem',
            action: 'sync',
            attention: true,
          };
      }
    }
  }
}

const CLOUD = 'M7 18a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17 8.5a4.75 4.75 0 0 1 .5 9.5z';
const MARKS: Record<StatusTone, string> = {
  ok: 'M9.5 13.5l2 2 3.5-4', // check
  muted: 'M9.5 13.5l2 2 3.5-4',
  busy: 'M9.5 14a2.5 2.5 0 1 1 1 2M9.5 17v-3h3', // loop
  offline: 'M9 16l6-5M9 11l6 5', // cross-out
  paused: 'M10.5 11v5M13.5 11v5', // pause bars
  attention: 'M12 11v3M12 16.2v.1', // !
};

export function SyncGlyph({ tone }: { tone: StatusTone }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
      data-glyph={tone}
    >
      <path d={CLOUD} />
      <path d={MARKS[tone]} class={tone === 'busy' ? 'sync-spin' : undefined} />
    </svg>
  );
}

/**
 * Announces entering or leaving an attention state, including when the indicator first mounts
 * already in one (it renders nothing while sync is `off`, so that is how it appears). Silent when
 * it mounts in a calm state.
 */
function AttentionAnnouncer({ attention }: { attention: boolean }) {
  const prev = useRef(false);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (prev.current === attention) return;
    prev.current = attention;
    setMsg(attention ? 'Sync needs your attention' : 'Sync is working again');
  }, [attention]);
  return (
    <span class="visually-hidden" role="status" aria-live="polite" data-sync-live>
      {msg}
    </span>
  );
}

export interface SyncIndicatorProps {
  /** `top`: TopBar (phones); `rail`: NavRail (from 768 px). */
  place: 'top' | 'rail';
}

export function SyncIndicator({ place }: SyncIndicatorProps) {
  const st = useStore(sync.syncStatus, (v) => v);
  const auth = useStore(sync.syncAuth, (v) => v);
  const v = statusView(st, auth);
  if (st.state === 'off') return null;
  // The visible "Reconnect" text must be part of the accessible name (WCAG 2.5.3).
  const reconnectLabel = v.attention && st.state === 'needs-auth';
  const onClick = () => {
    // `reconnect()` must start inside the click (a popup needs the user gesture).
    if (st.state === 'needs-auth') void sync.reconnect();
    else location.hash = '#/settings?account=1';
  };
  return (
    <>
      <button
        type="button"
        class={`sync-ind sync-ind-${place}${v.attention ? ' attention' : ''}`}
        aria-label={reconnectLabel ? `Reconnect: ${v.text}` : v.text}
        data-sync-indicator={st.state}
        onClick={onClick}
      >
        <SyncGlyph tone={v.tone} />
        {reconnectLabel ? <span class="sync-ind-label">Reconnect</span> : null}
      </button>
      {place === 'top' ? <AttentionAnnouncer attention={v.attention} /> : null}
    </>
  );
}
