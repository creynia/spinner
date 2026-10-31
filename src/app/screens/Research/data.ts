// Typed loader for the generated research data (data.json, written by `npm run research:app-data`).
import raw from './data.json';
import type { Candidate, PathSeries, ResearchData, RowStats } from './dataTypes';

export type { Candidate, CurvePoint, PathSeries, ResearchData, RowStats } from './dataTypes';

export const data = raw as unknown as ResearchData;

/** The headline numbers of one ledger row; throws when `key` ("<file>:<id>") is not in the data. */
export function row(key: string): RowStats {
  const found = Object.hasOwn(data.rows, key) ? data.rows[key] : undefined;
  if (!found) throw new Error(`research data: no row "${key}"`);
  return found;
}

/** The equity-path series of one row; throws when the row has none (only drawn rows carry one). */
export function path(key: string): PathSeries {
  const found = Object.hasOwn(data.paths, key) ? data.paths[key] : undefined;
  if (!found) throw new Error(`research data: no path "${key}"`);
  return found;
}

/** One candidate strategy by its document id; throws when unknown. */
export function candidate(id: string): Candidate {
  const found = data.candidates.find((c) => c.id === id);
  if (!found) throw new Error(`research data: no candidate "${id}"`);
  return found;
}

/** Every row of one results file (basename without .json), in key order. */
export function rowsOf(file: string): RowStats[] {
  return Object.keys(data.rows)
    .filter((key) => data.rows[key]!.file === file)
    .map((key) => data.rows[key]!);
}

export default data;
