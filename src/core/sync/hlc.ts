// Hybrid logical clock (sync.md §7.1). String order is causal order.
import type { DeviceId, Hlc } from '../contracts/sync';

export interface HlcClock {
  /** Mint an HLC from an edit time (`syncDirty.last`), not the push time. */
  tickAt(editMs: number): Hlc;
  /** Fold a remote HLC into the clock. */
  recv(remote: Hlc): void;
  readonly last: Hlc;
}

const WALL_DIGITS = 9;
const COUNTER_DIGITS = 4;
const WALL_MAX = 36 ** WALL_DIGITS - 1;
const COUNTER_MAX = 36 ** COUNTER_DIGITS - 1;

function encode(wall: number, counter: number, device: DeviceId): Hlc {
  return `${wall.toString(36).padStart(WALL_DIGITS, '0')}.${counter
    .toString(36)
    .padStart(COUNTER_DIGITS, '0')}.${device}`;
}

function parts(h: Hlc): { wall: number; counter: number; device: DeviceId } {
  const a = h.indexOf('.');
  const b = h.indexOf('.', a + 1);
  if (a !== WALL_DIGITS || b !== a + 1 + COUNTER_DIGITS) {
    throw new Error(`malformed HLC: ${h}`);
  }
  const wall = parseInt(h.slice(0, a), 36);
  const counter = parseInt(h.slice(a + 1, b), 36);
  if (!Number.isFinite(wall) || !Number.isFinite(counter)) throw new Error(`malformed HLC: ${h}`);
  return { wall, counter, device: h.slice(b + 1) };
}

/** Walls beyond this (year 3000) are forged or corrupt: `recv` throws, `verifyEntry` refuses. */
export const HLC_WALL_LIMIT = 32_503_680_000_000;

const clampWall = (ms: number): number => Math.min(HLC_WALL_LIMIT, Math.max(0, Math.floor(ms)));

/**
 * `last`, when given, is where the clock resumes (its wall and counter; its device is ignored).
 * `now` stands in for an edit time that is not a finite number.
 */
export function createClock(device: DeviceId, now: () => number, last?: Hlc): HlcClock {
  let w = 0;
  let c = 0;
  if (last !== undefined) {
    const p = parts(last);
    w = p.wall;
    c = p.counter;
  }
  return {
    tickAt(editMs: number): Hlc {
      const at = clampWall(Number.isFinite(editMs) ? editMs : now());
      if (at > w) {
        w = at;
        c = 0;
      } else if (c >= COUNTER_MAX) {
        if (w >= WALL_MAX) throw new Error('HLC overflow');
        w += 1;
        c = 0;
      } else {
        c += 1;
      }
      return encode(w, c, device);
    },
    recv(remote: Hlc): void {
      const p = parts(remote);
      if (p.wall > HLC_WALL_LIMIT) throw new RangeError(`HLC wall too far ahead: ${remote}`);
      if (p.wall > w || (p.wall === w && p.counter > c)) {
        w = p.wall;
        c = p.counter;
      }
    },
    get last(): Hlc {
      return encode(w, c, device);
    },
  };
}

export function hlcDevice(h: Hlc): DeviceId {
  return parts(h).device;
}
export function hlcWall(h: Hlc): number {
  return parts(h).wall;
}
/** String order is causal order; negative, zero or positive like `Array.sort`. */
export function cmpHlc(a: Hlc, b: Hlc): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
