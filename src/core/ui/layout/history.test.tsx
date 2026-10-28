import { act, renderHook } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { useChipHistory } from './history';
import { HISTORY_LIMIT } from './types';

const a = (f: () => void): void => {
  void act(f);
};

const A = [{ bet: 'red', chips: 1 }];
const B = [{ bet: 'red', chips: 2 }];

describe('useChipHistory', () => {
  it('pushes, undoes and redoes with labels', () => {
    const { result } = renderHook(() => useChipHistory([]));
    expect(result.current.canUndo).toBe(false);
    a(() => {
      result.current.push(A, 'one');
    });
    a(() => {
      result.current.push(B, 'two');
    });
    expect(result.current.spots).toEqual(B);
    expect(result.current.undoLabel).toBe('two');
    a(() => {
      result.current.undo();
    });
    expect(result.current.spots).toEqual(A);
    expect(result.current.redoLabel).toBe('two');
    expect(result.current.canRedo).toBe(true);
    a(() => {
      result.current.redo();
    });
    expect(result.current.spots).toEqual(B);
    expect(result.current.canRedo).toBe(false);
  });

  it('drops a no-op push and clears the redo stack on a new push', () => {
    const { result } = renderHook(() => useChipHistory(A));
    a(() => {
      result.current.push([{ bet: 'red', chips: 1 }], 'same');
    });
    expect(result.current.canUndo).toBe(false);
    a(() => {
      result.current.push(B, 'two');
    });
    a(() => {
      result.current.undo();
    });
    a(() => {
      result.current.push([{ bet: 'black', chips: 1 }], 'other');
    });
    expect(result.current.canRedo).toBe(false);
  });

  it('clear is an undoable step and a no-op when empty', () => {
    const { result } = renderHook(() => useChipHistory([]));
    a(() => {
      result.current.clear();
    });
    expect(result.current.canUndo).toBe(false);
    a(() => {
      result.current.push(A, 'one');
    });
    a(() => {
      result.current.clear();
    });
    expect(result.current.spots).toEqual([]);
    expect(result.current.undoLabel).toBe('Clear');
    a(() => {
      result.current.undo();
    });
    expect(result.current.spots).toEqual(A);
  });

  it('tracks dirty against the initial state, and reset drops history', () => {
    const { result } = renderHook(() => useChipHistory(A));
    expect(result.current.dirty).toBe(false);
    a(() => {
      result.current.push(B, 'two');
    });
    expect(result.current.dirty).toBe(true);
    a(() => {
      result.current.undo();
    });
    expect(result.current.dirty).toBe(false);
    a(() => {
      result.current.reset(B);
    });
    expect(result.current.spots).toEqual(B);
    expect([result.current.dirty, result.current.canUndo, result.current.canRedo]).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('keeps at most HISTORY_LIMIT steps', () => {
    const { result } = renderHook(() => useChipHistory([]));
    for (let i = 1; i <= HISTORY_LIMIT + 20; i++)
      a(() => {
        result.current.push([{ bet: 'red', chips: i }], `s${i}`);
      });
    let undone = 0;
    while (result.current.canUndo) {
      a(() => {
        result.current.undo();
      });
      undone++;
    }
    expect(undone).toBe(HISTORY_LIMIT);
  });

  it('does not alias the caller arrays', () => {
    const src = [{ bet: 'red', chips: 1 }];
    const { result } = renderHook(() => useChipHistory(src));
    src[0]!.chips = 9;
    expect(result.current.spots).toEqual(A);
  });
});
