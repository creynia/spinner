export interface SessionVector {
  runSeed: number;
  base: string;
  index: number;
  sessionSeed: string;
  engineState: string[];
  u32: number[];
  spins37: number[];
  spins38: number[];
  stratS0: string;
}

/** harness-data-analysis.md §1.3 per-session vectors (copied from the doc by script). */
export const SESSION_VECTORS: SessionVector[] = [
  {
    runSeed: 0,
    base: '0x0000000000000000',
    index: 0,
    sessionSeed: '0xe220a8397b1dcdaf',
    engineState: ['4d197e6f', 'a706dd2f', 'f4414f5e', 'b382a305'],
    u32: [443589289, 1472243107, 1913443415],
    spins37: [26, 9, 33, 9, 29, 11, 15, 22, 32, 34],
    spins38: [13, 25, 3, 13, 37, 11, 31, 1, 18, 8],
    stratS0: '417a5407',
  },
  {
    runSeed: 0,
    base: '0x0000000000000000',
    index: 1,
    sessionSeed: '0x6e789e6aa1b965f4',
    engineState: ['f0c37c00', '46b73e79', '3d0cc8a6', '374327c6'],
    u32: [452830256, 406101180, 3035359336],
    spins37: [21, 21, 30, 15, 27, 3, 24, 5, 31, 18],
    spins38: [26, 6, 10, 16, 2, 25, 3, 17, 0, 19],
    stratS0: 'b07c6ac1',
  },
  {
    runSeed: 0,
    base: '0x0000000000000000',
    index: 9999,
    sessionSeed: '0x488601e3f80e210a',
    engineState: ['4c92b244', 'd6121dfb', '5d3f2958', '2d9fc2ab'],
    u32: [2544013391, 1432048011, 1255932693],
    spins37: [25, 11, 31, 8, 10, 4, 8, 31, 2, 14],
    spins38: [31, 37, 13, 23, 36, 20, 31, 32, 20, 30],
    stratS0: '387a5656',
  },
  {
    runSeed: 1,
    base: '0x5692161d100b05e5',
    index: 0,
    sessionSeed: '0xbfef8030ddc2d772',
    engineState: ['ed403149', '55c55969', '9a7e41f1', 'fb85af9c'],
    u32: [3629890950, 321708431, 2084616383],
    spins37: [30, 17, 12, 30, 10, 26, 7, 13, 33, 0],
    spins38: [2, 13, 33, 5, 22, 24, 25, 14, 16, 18],
    stratS0: 'b8bb2613',
  },
  {
    runSeed: 42,
    base: '0xa759ea27d4727622',
    index: 0,
    sessionSeed: '0x989b3f130a063869',
    engineState: ['6d073327', '5599b3e0', 'a31128df', 'd6171d07'],
    u32: [38744838, 541465636, 2322453245],
    spins37: [29, 14, 23, 9, 17, 24, 11, 27, 28, 15],
    spins38: [0, 26, 25, 37, 7, 25, 20, 16, 15, 31],
    stratS0: '6be3ccb2',
  },
  {
    runSeed: 42,
    base: '0xa759ea27d4727622',
    index: 1,
    sessionSeed: '0x290db4bf2570ded7',
    engineState: ['6cf5a31d', '66723b87', 'b9eea3a1', 'e44acd82'],
    u32: [171662720, 3216290240, 2625501703],
    spins37: [36, 9, 18, 35, 22, 12, 12, 34, 17, 13],
    spins38: [0, 32, 3, 33, 36, 6, 12, 25, 1, 4],
    stratS0: '41fe118c',
  },
  {
    runSeed: 42,
    base: '0xa759ea27d4727622',
    index: 9999,
    sessionSeed: '0x2a3d69327abab063',
    engineState: ['0012630c', '783ef7f6', 'a22ba7cf', 'fb420b0a'],
    u32: [2295013516, 2717919657, 3575286224],
    spins37: [12, 1, 15, 15, 36, 4, 5, 12, 35, 23],
    spins38: [20, 19, 22, 29, 20, 5, 22, 10, 27, 3],
    stratS0: 'daf87a79',
  },
  {
    runSeed: 4294967295,
    base: '0x8b32c408e8c2c97c',
    index: 0,
    sessionSeed: '0x7f65c5cfc4eb5526',
    engineState: ['a4a135c3', '6a576032', 'c208279e', 'ceaa8390'],
    u32: [2918475089, 1561248416, 3925626691],
    spins37: [4, 5, 25, 21, 5, 32, 22, 34, 16, 24],
    spins38: [1, 24, 21, 3, 27, 15, 25, 22, 29, 23],
    stratS0: '06d4b189',
  },
];
