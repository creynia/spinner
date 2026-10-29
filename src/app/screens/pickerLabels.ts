// Labels for run and experiment pickers: name, tie-breakers, then the time (last, so a narrow
// select clips the least useful part). Ties on name and time add a compact " · 30 sess." and then
// " · seed 2"; never a hash or id.
export interface PickItem {
  name: string;
  when: string;
  sessions: number;
  seed: number | undefined;
}

export function pickerLabels(items: PickItem[]): string[] {
  const count = (xs: string[], x: string) => xs.filter((y) => y === x).length;
  const base = items.map((i) => `${i.name} · ${i.when}`);
  const tied1 = items.map((_, k) => count(base, base[k]!) > 1);
  const mid1 = items.map((i, k) =>
    tied1[k] ? ` · ${i.sessions.toLocaleString('en-US')} sess.` : '',
  );
  const l1 = items.map((i, k) => `${i.name}${mid1[k]} · ${i.when}`);
  return items.map((i, k) => {
    const mid =
      count(l1, l1[k]!) > 1 && i.seed !== undefined ? `${mid1[k]} · seed ${i.seed}` : mid1[k];
    return `${i.name}${mid} · ${i.when}`;
  });
}
