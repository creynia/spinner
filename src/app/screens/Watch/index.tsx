// Watch (architecture.md §6.3): replay one session round by round with its trace.
import type { ScreenProps } from '../types';
import { WatchView } from './WatchView';
import './watch.css';

export function Watch(props: ScreenProps) {
  return <WatchView {...props} />;
}
