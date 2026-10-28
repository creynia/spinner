// The game the app plays (architecture.md §6.4). `rouletteUi` joins this object when the game WP
// ships `@game/roulette/ui`; the shell itself needs only the plugin.
import { roulette } from '@game/roulette';

export const game = { plugin: roulette };
