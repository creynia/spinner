/**
 * Layout store helpers (layouts.md §5.2; owner: WP-L2). FROZEN signatures: L0 ships stubs that
 * throw `not implemented (WP-L2)`. The repo methods (`listLayouts`, `getLayout`, `putLayout`,
 * `deleteLayout`) are added to `repo.ts` by L2 (newest first by `byUpdated`; `LayoutRecord` is in
 * `contracts/layout.ts`).
 */
import type { ChipLayout, LayoutFileV1 } from '../contracts/layout';
import type { Slug } from '../contracts/strategy';

const todo = (name: string): never => {
  throw new Error(`not implemented (WP-L2): ${name}`);
};

/** Why a layout file was refused. */
export type LayoutFileErrorCode =
  'not-json' | 'wrong-format' | 'newer-version' | 'bad-version' | 'bad-shape';

/** Thrown by `decodeLayoutFile`; `code` is stable, `message` is English for the Import screen. */
export class LayoutFileError extends Error {
  readonly code: LayoutFileErrorCode;
  constructor(code: LayoutFileErrorCode, message: string) {
    super(message);
    this.name = 'LayoutFileError';
    this.code = code;
  }
}

/** sha256 hex of canonicalJson({ game, variant, spots sorted by bet }): placement order is ignored. */
export function layoutHash(_l: ChipLayout): Promise<string> {
  return todo('layoutHash');
}

/** A slug from the name (`corners-and-red`, then `-2`, `-3` …) that is not in `taken`. */
export function allocLayoutId(_name: string, _taken: ReadonlySet<string>): Slug {
  return todo('allocLayoutId');
}

/** The `<slug>.layout.json` text: a `LayoutFileV1` as canonical JSON (1..500 layouts). */
export function encodeLayoutFile(
  _layouts: ChipLayout[],
  _app: { id: string; version: string },
): string {
  return todo('encodeLayoutFile');
}

/** Parses a layout file; throws `LayoutFileError`. Does not validate the layouts themselves. */
export function decodeLayoutFile(_text: string): LayoutFileV1 {
  return todo('decodeLayoutFile');
}
