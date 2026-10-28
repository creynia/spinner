import { useEffect, useState } from 'preact/hooks';
import type { Orientation } from './geometry';

const PHONE = '(max-width: 600px)';

/** Vertical table on phones (<= 600 px wide), horizontal otherwise (game.md §12.1). */
export function useOrientation(): Orientation {
  const query = () =>
    typeof matchMedia === 'function' && matchMedia(PHONE).matches ? 'portrait' : 'landscape';
  const [o, setO] = useState<Orientation>(query);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(PHONE);
    const on = () => setO(mq.matches ? 'portrait' : 'landscape');
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return o;
}
