// Chart slot per chapter. Wave-B implementers replace the contents of their own Ch*.tsx files and
// touch nothing here: one import line and one map line per chapter. Every component receives its
// chapter.
import type { ComponentType } from 'preact';
import { ChCashout } from './ChCashout';
import { ChCurve } from './ChCurve';
import { ChEdge } from './ChEdge';
import { ChLevels } from './ChLevels';
import { ChLimits } from './ChLimits';
import { ChMartingale } from './ChMartingale';
import { ChPlacement } from './ChPlacement';
import { ChPlayC9 } from './ChPlayC9';
import { ChShapes } from './ChShapes';
import { ChStart } from './ChStart';
import { ChTry } from './ChTry';
import type { Chapter } from './content';

export type ChapterChart = ComponentType<{ chapter: Chapter }>;

export const CHAPTER_CHARTS: Record<string, ChapterChart> = {
  start: ChStart,
  edge: ChEdge,
  martingale: ChMartingale,
  levels: ChLevels,
  placement: ChPlacement,
  curve: ChCurve,
  shapes: ChShapes,
  cashout: ChCashout,
  limits: ChLimits,
  try: ChTry,
  'play-c9': ChPlayC9,
};
