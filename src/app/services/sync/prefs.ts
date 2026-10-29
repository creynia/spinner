// Per-device sync preferences (sync.md §4.2 `syncMeta.prefs`, §7.12): defaults and persistence.
// The engine reads the same row (`enabled`, `runDownload`) at the start of every cycle.
import type { Backend, SyncDevicePrefs } from '@core';

/** What the browser tells us about this device, for the defaults. Injected in tests. */
export interface DeviceTraits {
  /** `navigator.userAgentData.mobile`, when the browser has it. */
  uaMobile?: boolean | undefined;
  /** Screen width in CSS px. */
  screenWidth?: number | undefined;
  coarsePointer?: boolean | undefined;
  userAgent?: string | undefined;
  platform?: string | undefined;
}

export function readTraits(): DeviceTraits {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const uad = (nav as { userAgentData?: { mobile?: boolean; platform?: string } } | undefined)
    ?.userAgentData;
  let coarse: boolean | undefined;
  try {
    coarse = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)').matches : undefined;
  } catch {
    coarse = undefined;
  }
  return {
    uaMobile: uad?.mobile,
    screenWidth: typeof screen === 'undefined' ? undefined : screen.width,
    coarsePointer: coarse,
    userAgent: nav?.userAgent,
    platform: uad?.platform ?? nav?.platform,
  };
}

/**
 * The download policy default (§7.12): `onOpen` when the browser says it is mobile, or the screen
 * is under 768 px wide with a coarse pointer; `all` otherwise.
 */
export function defaultRunDownload(t: DeviceTraits): 'all' | 'onOpen' {
  if (t.uaMobile === true) return 'onOpen';
  if (t.coarsePointer === true && t.screenWidth !== undefined && t.screenWidth < 768)
    return 'onOpen';
  return 'all';
}

/** "Pixel 7", "Chrome on Linux": a readable default the owner can rename. */
export function defaultDeviceName(t: DeviceTraits): string {
  const ua = t.userAgent ?? '';
  const model = /Android[^;)]*;\s*([^;)]+?)(?:\sBuild|[;)])/i.exec(ua)?.[1]?.trim();
  if (model && !/^(K|Mobile|wv)$/i.test(model)) return model;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /Android/i.test(ua)
    ? 'Android'
    : /iPhone|iPad|iOS/i.test(ua)
      ? 'iOS'
      : /Windows/i.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/i.test(ua)
          ? 'Mac'
          : /CrOS/i.test(ua)
            ? 'ChromeOS'
            : /Linux/i.test(ua)
              ? 'Linux'
              : (t.platform ?? '');
  return os ? `${browser} on ${os}` : browser;
}

export function defaultPrefs(t: DeviceTraits): SyncDevicePrefs {
  return { enabled: false, deviceName: defaultDeviceName(t), runDownload: defaultRunDownload(t) };
}

const isRunDownload = (v: unknown): v is 'all' | 'onOpen' => v === 'all' || v === 'onOpen';

/** The stored prefs merged over the defaults (a stored row from an older build may lack a key). */
export async function loadPrefs(raw: Backend, t: DeviceTraits): Promise<SyncDevicePrefs> {
  const d = defaultPrefs(t);
  const row = await raw.get<{ k: 'prefs'; v: Partial<SyncDevicePrefs> }>('syncMeta', 'prefs');
  const v = row?.v;
  if (!v) return d;
  return {
    enabled: v.enabled === true,
    deviceName:
      typeof v.deviceName === 'string' && v.deviceName.trim() ? v.deviceName : d.deviceName,
    runDownload: isRunDownload(v.runDownload) ? v.runDownload : d.runDownload,
  };
}

/** Writes through the raw backend: prefs are never a sync mark. */
export async function savePrefs(raw: Backend, prefs: SyncDevicePrefs): Promise<void> {
  await raw.tx(['syncMeta'], 'readwrite', (t) => t.put('syncMeta', { k: 'prefs', v: prefs }));
}
