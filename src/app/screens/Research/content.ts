// STUB (WP I1): replaced by WP C1's real content. Same path, same exports.
export interface Chapter {
  id: string;
  title: string;
  lead: string;
  body: string[];
  takeaways: string[];
  math: { text: string[]; formulas: string[] };
  dataKeys: string[];
}

const ch = (id: string, title: string): Chapter => ({
  id,
  title,
  lead: `Placeholder lead for ${title}.`,
  body: ['Placeholder body.'],
  takeaways: ['Placeholder takeaway.'],
  math: { text: ['Placeholder math.'], formulas: ['x = p * S / B'] },
  dataKeys: [],
});

export const CHAPTERS: Chapter[] = [
  ch('start', 'Start here'),
  ch('edge', 'Every dollar costs the same'),
  ch('martingale', 'Why doubling feels like it works'),
  ch('levels', 'Levels, not luck'),
  ch('placement', 'Beyond red: grow at the right rate'),
  ch('curve', 'One curve rules them all'),
  ch('shapes', 'Towers, shapes and favourite numbers'),
  ch('cashout', 'Cash out: the stop that moves the typical session'),
  ch('limits', 'What breaks it'),
  ch('try', 'Try it'),
];
