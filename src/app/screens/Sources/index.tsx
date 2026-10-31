// Sources: where the rules, figures and strategies come from (linked from More).
import { Card } from '@core/ui';
import { href } from '../../router';
import { SOURCE_GROUPS } from '../../sources';

export function Sources() {
  return (
    <>
      <h1>Sources</h1>
      <p>
        <a class="link-tap" href={href('/more')}>
          ← More
        </a>
      </p>
      <p class="muted">
        Every figure in this app is computed by the app itself, in exact arithmetic or by exhaustive
        enumeration or simulation, and cross-checked against the published references below. The
        rules and strategies are the standard ones; these are the places they are documented.
      </p>
      {SOURCE_GROUPS.map((g) => (
        <Card key={g.group}>
          <h2>{g.group}</h2>
          <ul class="rows" aria-label={g.group}>
            {g.items.map((i) => (
              <li key={i.id} data-source-id={i.id} class="source-item">
                <span class="row-title">
                  {i.url ? (
                    <a href={i.url} target="_blank" rel="noopener noreferrer">
                      {i.title}
                    </a>
                  ) : (
                    i.title
                  )}
                </span>
                {i.author ? <span class="row-sub"> {i.author}</span> : null}
                <p class="muted">{i.note}</p>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </>
  );
}
