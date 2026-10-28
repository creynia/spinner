// The day-one strategy presets (decisions #10; game.md §11, with the S1 rename). The ids and names
// are real data; the JSON definitions (`presets/*.json`) are delivered by the game WP.
export const STRATEGY_PRESETS = [
  { id: 'flat-red', name: 'Flat: red' },
  { id: 'martingale-red', name: 'Martingale: red' },
  { id: 'grand-martingale-red', name: 'Grand Martingale: red' },
  { id: 'fibonacci-red', name: 'Fibonacci: red' },
  { id: 'dalembert-red', name: "d'Alembert: red" },
  { id: 'labouchere-red', name: 'Labouchere 1-2-3-4: red' },
  { id: 'paroli-red', name: 'Paroli: red' },
  { id: 'one-three-two-six-red', name: '1-3-2-6: red' },
  { id: 'oscars-grind-red', name: "Oscar's Grind: red" },
  { id: 'james-bond', name: 'James Bond' },
  { id: 'two-dozens-martingale', name: 'Two dozens, Martingale-style' },
  { id: 'red-mart-then-flat', name: 'Martingale on red, then flat' },
] as const;

export type StrategyPresetId = (typeof STRATEGY_PRESETS)[number]['id'];
export const STRATEGY_PRESET_IDS: readonly StrategyPresetId[] = STRATEGY_PRESETS.map((p) => p.id);
