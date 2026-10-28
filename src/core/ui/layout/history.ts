// The undo/redo/clear reducer over `LayoutSpot[]` (layouts.md §4.3, §6.1).
import { useCallback, useMemo, useRef, useState } from 'preact/hooks';
import type { LayoutSpot } from '../../contracts/layout';
import { sameSpotsInOrder } from './adjust';
import { HISTORY_LIMIT, type ChipHistory } from './types';

interface Step {
  /** The spots before this step (what undo restores). */
  before: readonly LayoutSpot[];
  after: readonly LayoutSpot[];
  label: string;
}
interface State {
  initial: readonly LayoutSpot[];
  present: readonly LayoutSpot[];
  past: Step[];
  future: Step[];
}

const copy = (s: readonly LayoutSpot[]): LayoutSpot[] => s.map((x) => ({ ...x }));

export function useChipHistory(initial: readonly LayoutSpot[]): ChipHistory {
  const ref = useRef<State | null>(null);
  if (ref.current === null) {
    const s = copy(initial);
    ref.current = { initial: s, present: s, past: [], future: [] };
  }
  const [, bump] = useState(0);
  const set = useCallback((next: State) => {
    ref.current = next;
    bump((n) => n + 1);
  }, []);

  const push = useCallback(
    (next: readonly LayoutSpot[], label: string) => {
      const st = ref.current!;
      if (sameSpotsInOrder(st.present, next)) return;
      const after = copy(next);
      const past = [...st.past, { before: st.present, after, label }];
      if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
      set({ ...st, present: after, past, future: [] });
    },
    [set],
  );
  const undo = useCallback(() => {
    const st = ref.current!;
    const step = st.past[st.past.length - 1];
    if (!step) return;
    set({ ...st, present: step.before, past: st.past.slice(0, -1), future: [step, ...st.future] });
  }, [set]);
  const redo = useCallback(() => {
    const st = ref.current!;
    const step = st.future[0];
    if (!step) return;
    set({ ...st, present: step.after, past: [...st.past, step], future: st.future.slice(1) });
  }, [set]);
  const clear = useCallback(() => push([], 'Clear'), [push]);
  const reset = useCallback(
    (spots: readonly LayoutSpot[]) => {
      const s = copy(spots);
      set({ initial: s, present: s, past: [], future: [] });
    },
    [set],
  );

  const st = ref.current;
  return useMemo(
    () => ({
      spots: st.present,
      push,
      undo,
      redo,
      clear,
      reset,
      canUndo: st.past.length > 0,
      canRedo: st.future.length > 0,
      undoLabel: st.past[st.past.length - 1]?.label ?? null,
      redoLabel: st.future[0]?.label ?? null,
      dirty: !sameSpotsInOrder(st.present, st.initial),
    }),
    [st, push, undo, redo, clear, reset],
  );
}
