// "Couldn't download <name> from Drive: <reason>" with Retry (Compare and Sweep, sync.md §8.4).
import { Button } from '@core/ui';
import { DOWNLOAD_FAILURE_TEXT, type DownloadFailure as Reason } from '../services/runs';

export interface DownloadFailureProps {
  /** The experiment's name (`experimentName()`), never an id. */
  name: string;
  reason: Reason;
  onRetry: () => void;
}

export function DownloadFailure({ name, reason, onRetry }: DownloadFailureProps) {
  return (
    <section class="card" role="alert" data-download-failed={reason}>
      <p>
        Couldn't download {name} from Drive: {DOWNLOAD_FAILURE_TEXT[reason]}.
      </p>
      <div class="actions">
        <Button onClick={onRetry}>Retry</Button>
      </div>
    </section>
  );
}
