// A tiny observable store (architecture.md §6.4): get, set, update, subscribe, plus useStore.
import { useEffect, useRef, useState } from 'preact/hooks';

export interface Store<T> {
  get(): T;
  set(next: T): void;
  update(fn: (prev: T) => T): void;
  subscribe(fn: (value: T) => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const subs = new Set<(v: T) => void>();
  const store: Store<T> = {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      subs.forEach((fn) => fn(value));
    },
    update: (fn) => store.set(fn(value)),
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
  };
  return store;
}

/**
 * Subscribe a component to a slice. Re-renders only when the selected value changes by identity,
 * so selectors must return new objects only when something changed.
 */
export function useStore<T, S>(store: Store<T>, selector: (v: T) => S): S {
  const sel = useRef(selector);
  sel.current = selector;
  const [slice, setSlice] = useState(() => selector(store.get()));
  useEffect(() => {
    const check = (v: T) => setSlice(sel.current(v));
    check(store.get());
    return store.subscribe(check);
  }, [store]);
  return slice;
}
